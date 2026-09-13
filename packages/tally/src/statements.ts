/**
 * Profit & Loss A/c and Balance Sheet (SPEC §16).
 *
 * Tally prints these either horizontally (two sides side by side, each with its own
 * Particulars column) or vertically. Each side is parsed as an indented hierarchy with one
 * amount column; groups carry their totals and are checked against their children.
 */

import {
  cellAt,
  isBlankRow,
  parseAmount,
  type HeaderDetection,
  type SheetGrid,
} from "@magicmis/ingest";

import { normaliseHeader } from "@magicmis/ingest";

export interface StatementItem {
  readonly name: string;
  readonly path: readonly string[];
  readonly level: number;
  readonly kind: "group" | "ledger";
  readonly sourceRow: number;
  readonly amount: bigint;
}

export interface StatementSide {
  readonly items: readonly StatementItem[];
  readonly total: bigint | null;
  readonly checks: readonly {
    path: readonly string[];
    sourceRow: number;
    reported: bigint;
    computed: bigint;
    ok: boolean;
  }[];
}

export interface Statement {
  readonly period: HeaderDetection["period"];
  readonly asAt: string | null;
  readonly layout: "horizontal" | "vertical";
  /** Horizontal: left then right. Vertical: one side. */
  readonly sides: readonly StatementSide[];
}

const TOTAL_RE = /^(?:grand\s+)?total\b/iu;

function parseSide(
  sheet: SheetGrid,
  start: number,
  nameCol: number,
  amountCols: readonly number[],
): StatementSide {
  interface Raw {
    r: number;
    name: string;
    indent: number;
    amount: bigint | null;
  }
  const raws: Raw[] = [];
  let total: bigint | null = null;
  for (let r = start; r < sheet.rows.length; r += 1) {
    if (isBlankRow(sheet.rows[r])) continue;
    const rawText = cellAt(sheet, r, nameCol).text.replace(/\t/gu, "    ");
    const name = rawText.trim();
    let amount: bigint | null = null;
    // Tally shows ledger amounts in an inner column and group totals in an outer one; take
    // whichever is filled, rightmost first.
    for (const col of [...amountCols].reverse()) {
      const c = cellAt(sheet, r, col);
      const p =
        c.text.trim() === "" && typeof c.value !== "number"
          ? null
          : parseAmount(typeof c.value === "number" ? c.value : c.text);
      if (p !== null) {
        amount = p.side === "cr" ? -p.paise : p.paise;
        break;
      }
    }
    if (name === "" && amount === null) continue;
    if (TOTAL_RE.test(name)) {
      total = amount;
      continue;
    }
    raws.push({ r, name, indent: rawText.length - rawText.trimStart().length, amount });
  }
  const ranks = [...new Set(raws.map((x) => x.indent))].sort((a, b) => a - b);
  const items: StatementItem[] = [];
  const checks: StatementSide["checks"][number][] = [];
  const stack: { item: StatementItem; sum: bigint }[] = [];
  const close = (level: number) => {
    while (stack.length > 0 && (stack[stack.length - 1]?.item.level ?? -1) >= level) {
      const top = stack.pop();
      if (top)
        checks.push({
          path: top.item.path,
          sourceRow: top.item.sourceRow,
          reported: top.item.amount,
          computed: top.sum,
          ok: top.item.amount === top.sum,
        });
    }
  };
  raws.forEach((x, i) => {
    const level = ranks.indexOf(x.indent);
    close(level);
    const next = raws[i + 1];
    const isGroup = next !== undefined && ranks.indexOf(next.indent) > level;
    const item: StatementItem = {
      name: x.name,
      path: [...(stack[stack.length - 1]?.item.path ?? []), x.name],
      level,
      kind: isGroup ? "group" : "ledger",
      sourceRow: x.r + 1,
      amount: x.amount ?? 0n,
    };
    items.push(item);
    const parent = stack[stack.length - 1];
    if (parent) parent.sum += item.amount;
    if (isGroup) stack.push({ item, sum: 0n });
  });
  close(0);
  return { items, total, checks };
}

export function parseStatement(sheet: SheetGrid, header: HeaderDetection): Statement {
  const norm = header.headers.map(normaliseHeader);
  const particularCols = norm
    .map((h, i) => ({ h, i }))
    .filter((c) => /\bparticulars\b/u.test(c.h))
    .map((c) => c.i);

  if (particularCols.length >= 2) {
    const [left = 0, right = 0] = particularCols;
    const leftAmounts = norm.map((_, i) => i).filter((i) => i > left && i < right);
    const rightAmounts = norm.map((_, i) => i).filter((i) => i > right);
    return {
      period: header.period,
      asAt: header.asAt,
      layout: "horizontal",
      sides: [
        parseSide(sheet, header.bodyStart, left, leftAmounts),
        parseSide(sheet, header.bodyStart, right, rightAmounts),
      ],
    };
  }
  const nameCol = particularCols[0] ?? 0;
  const amountCols = norm.map((_, i) => i).filter((i) => i !== nameCol);
  return {
    period: header.period,
    asAt: header.asAt,
    layout: "vertical",
    sides: [parseSide(sheet, header.bodyStart, nameCol, amountCols)],
  };
}
