/**
 * Balance-style reports — Trial Balance and Group Summary (SPEC §16).
 *
 * Hierarchy is rebuilt from, in order of reliability: a level column, a parent-group column,
 * Excel outline levels or leading-space indentation, or group header rows closed by interleaved
 * subtotal rows. Group and subtotal rows are marked and never aggregated as data; each group's
 * reported figures are checked against the sum of its children (feeds validation V4).
 *
 * Sign convention: debit positive, credit negative, applied from the column (Debit/Credit) or
 * an explicit Dr/Cr suffix. An amount with no side in a single-column balance is recorded as a
 * finding, never assigned a side by guess.
 */

import {
  cellAt,
  isBlankRow,
  parseAmount,
  type HeaderDetection,
  type SheetGrid,
} from "@magicmis/ingest";

import { assignRoles, type RoleMap } from "./columns";
import { predefinedGroup, primaryOf } from "./groups";

export type Field = "opening" | "debit" | "credit" | "closing";
export const FIELDS: readonly Field[] = ["opening", "debit", "credit", "closing"];

export type Amounts = Partial<Record<Field, bigint>>;

export interface BalanceNode {
  readonly name: string;
  /** Ancestor group names then this name. Distinguishes one ledger name under two groups. */
  readonly path: readonly string[];
  readonly level: number;
  readonly kind: "group" | "ledger";
  /** 1-based source row as seen in Excel. */
  readonly sourceRow: number;
  readonly amounts: Amounts;
}

export interface SubtotalCheck {
  readonly path: readonly string[];
  readonly sourceRow: number;
  readonly field: Field;
  readonly reported: bigint;
  readonly computed: bigint;
  readonly ok: boolean;
}

export type BalanceFinding =
  | {
      readonly kind: "unsigned_amount";
      readonly sourceRow: number;
      readonly field: Field;
    }
  | {
      readonly kind: "unparseable_amount";
      readonly sourceRow: number;
      readonly field: Field;
      readonly text: string;
    }
  | { readonly kind: "truncated_name"; readonly sourceRow: number; readonly name: string }
  | { readonly kind: "wrapped_name"; readonly sourceRow: number; readonly name: string }
  | {
      readonly kind: "total_row";
      readonly sourceRow: number;
      readonly label: string;
      readonly amounts: Amounts;
    }
  | {
      readonly kind: "unclosed_group";
      readonly sourceRow: number;
      readonly name: string;
    };

export type HierarchySource =
  "level_column" | "parent_column" | "indentation" | "subtotal_rows" | "flat";

export interface BalanceReport {
  readonly period: HeaderDetection["period"];
  readonly asAt: string | null;
  readonly hierarchy: HierarchySource;
  readonly nodes: readonly BalanceNode[];
  readonly ledgers: readonly BalanceNode[];
  readonly checks: readonly SubtotalCheck[];
  /** Reported grand total row, if present. */
  readonly grandTotal: Amounts | null;
  readonly findings: readonly BalanceFinding[];
}

const TOTAL_RE = /^(?:grand\s+)?(?:sub[\s-]?)?total\b/iu;
const TRUNCATED_RE = /(\.\.\.|…)$/u;

interface RawRow {
  readonly r: number;
  readonly raw: string;
  readonly name: string;
  readonly indent: number;
  readonly amounts: Amounts;
  readonly hasAmounts: boolean;
  readonly levelValue: number | null;
  readonly parentValue: string | null;
  readonly outline: number | undefined;
}

function signed(
  text: string,
  value: string | number | boolean | null,
  side: "dr" | "cr" | "suffix",
): { amount: bigint | null; unsigned: boolean; unparseable: boolean } {
  if (text.trim() === "" && (value === null || value === ""))
    return { amount: null, unsigned: false, unparseable: false };
  const parsed = parseAmount(typeof value === "number" ? value : text);
  if (parsed === null) return { amount: null, unsigned: false, unparseable: true };
  if (side === "dr")
    return {
      amount: parsed.side === "cr" ? -parsed.paise : parsed.paise,
      unsigned: false,
      unparseable: false,
    };
  if (side === "cr")
    return {
      amount: parsed.side === "dr" ? parsed.paise : -parsed.paise,
      unsigned: false,
      unparseable: false,
    };
  // Single column: the suffix decides; a parenthesised or minus value is credit only if the
  // report says so, which Tally single columns do not — so no suffix means unsigned.
  if (parsed.side === "dr")
    return { amount: parsed.paise, unsigned: false, unparseable: false };
  if (parsed.side === "cr")
    return { amount: -parsed.paise, unsigned: false, unparseable: false };
  return {
    amount: parsed.paise === 0n ? 0n : parsed.paise,
    unsigned: parsed.paise !== 0n,
    unparseable: false,
  };
}

function readAmounts(
  sheet: SheetGrid,
  r: number,
  roles: RoleMap,
  findings: BalanceFinding[],
): Amounts {
  const out: Amounts = {};
  const read = (col: number | undefined, side: "dr" | "cr" | "suffix") => {
    if (col === undefined) return null;
    const c = cellAt(sheet, r, col);
    return signed(c.text, c.value, side);
  };
  const pair = (
    field: Field,
    drCol: number | undefined,
    crCol: number | undefined,
    single: number | undefined,
  ) => {
    if (drCol !== undefined || crCol !== undefined) {
      const dr = read(drCol, "dr");
      const cr = read(crCol, "cr");
      for (const [x, col] of [
        [dr, drCol],
        [cr, crCol],
      ] as const) {
        if (x?.unparseable && col !== undefined)
          findings.push({
            kind: "unparseable_amount",
            sourceRow: r + 1,
            field,
            text: cellAt(sheet, r, col).text,
          });
      }
      if (dr?.amount != null || cr?.amount != null)
        out[field] = (dr?.amount ?? 0n) + (cr?.amount ?? 0n);
      return;
    }
    const s = read(single, "suffix");
    if (s === null) return;
    if (s.unparseable && single !== undefined)
      findings.push({
        kind: "unparseable_amount",
        sourceRow: r + 1,
        field,
        text: cellAt(sheet, r, single).text,
      });
    if (s.unsigned) findings.push({ kind: "unsigned_amount", sourceRow: r + 1, field });
    if (s.amount !== null) out[field] = s.amount;
  };
  pair("opening", roles.opening_dr, roles.opening_cr, roles.opening);
  pair("closing", roles.closing_dr, roles.closing_cr, roles.closing);
  // Transaction columns are magnitudes on their own side.
  const debit = read(roles.debit, "dr");
  const credit = read(roles.credit, "dr");
  if (debit?.amount != null) out.debit = debit.amount;
  if (credit?.amount != null) out.credit = credit.amount;
  // A TB with only Debit/Credit columns (no closing) reports closing as Debit − Credit.
  if (
    roles.closing_dr === undefined &&
    roles.closing_cr === undefined &&
    roles.closing === undefined &&
    (debit?.amount != null || credit?.amount != null)
  ) {
    out.closing = (debit?.amount ?? 0n) - (credit?.amount ?? 0n);
  }
  return out;
}

const addAmounts = (a: Amounts, b: Amounts): Amounts => {
  const out: Amounts = { ...a };
  for (const f of FIELDS) if (b[f] !== undefined) out[f] = (out[f] ?? 0n) + (b[f] ?? 0n);
  return out;
};

export function parseBalanceReport(
  sheet: SheetGrid,
  header: HeaderDetection,
  /** Roles decided elsewhere (content inference, ADR 0031); header text otherwise. */
  rolesOverride?: RoleMap,
): BalanceReport {
  const roles = rolesOverride ?? assignRoles(header.headers);
  const findings: BalanceFinding[] = [];
  const particularsCol = roles.particulars ?? 0;

  const raws: RawRow[] = [];
  let grandTotal: Amounts | null = null;
  for (let r = header.bodyStart; r < sheet.rows.length; r += 1) {
    if (isBlankRow(sheet.rows[r])) continue;
    const cell = cellAt(sheet, r, particularsCol);
    const raw = cell.text.replace(/\t/gu, "    ");
    const name = raw.trim();
    const amounts = readAmounts(sheet, r, roles, findings);
    const hasAmounts = Object.keys(amounts).length > 0;
    const levelText =
      roles.level === undefined ? "" : cellAt(sheet, r, roles.level).text.trim();
    const parentText =
      roles.parent_group === undefined
        ? ""
        : cellAt(sheet, r, roles.parent_group).text.trim();

    if (/^grand\s+total\b/iu.test(name)) {
      grandTotal = amounts;
      findings.push({ kind: "total_row", sourceRow: r + 1, label: name, amounts });
      continue;
    }
    raws.push({
      r,
      raw,
      name,
      indent: raw.length - raw.trimStart().length,
      amounts,
      hasAmounts,
      levelValue: /^\d+$/u.test(levelText) ? Number.parseInt(levelText, 10) : null,
      parentValue: parentText === "" ? null : parentText,
      outline: sheet.outlineLevels?.[r],
    });
  }

  const indents = new Set(raws.map((x) => x.indent));
  const outlines = new Set(raws.map((x) => x.outline ?? 0));
  const hierarchy: HierarchySource =
    roles.level !== undefined && raws.some((x) => x.levelValue !== null)
      ? "level_column"
      : roles.parent_group !== undefined
        ? "parent_column"
        : indents.size > 1 || outlines.size > 1
          ? "indentation"
          : raws.some((x) => TOTAL_RE.test(x.name)) ||
              raws.some((x) => !x.hasAmounts && x.name !== "")
            ? "subtotal_rows"
            : "flat";

  const nodes: BalanceNode[] = [];
  const checks: SubtotalCheck[] = [];

  const verify = (group: BalanceNode, children: readonly BalanceNode[]) => {
    const computed = children.reduce<Amounts>((acc, c) => addAmounts(acc, c.amounts), {});
    for (const f of FIELDS) {
      if (group.amounts[f] === undefined) continue;
      const reported = group.amounts[f] ?? 0n;
      const sum = computed[f] ?? 0n;
      checks.push({
        path: group.path,
        sourceRow: group.sourceRow,
        field: f,
        reported,
        computed: sum,
        ok: reported === sum,
      });
    }
  };

  const noteTruncated = (x: RawRow) => {
    if (TRUNCATED_RE.test(x.name))
      findings.push({ kind: "truncated_name", sourceRow: x.r + 1, name: x.name });
  };

  if (hierarchy === "level_column" || hierarchy === "indentation") {
    // Rank distinct indentation (or outline, or level values) into 0..n.
    const keyOf = (x: RawRow) =>
      hierarchy === "level_column"
        ? (x.levelValue ?? 0)
        : outlines.size > 1
          ? (x.outline ?? 0)
          : x.indent;
    const ranks = [...new Set(raws.map(keyOf))].sort((a, b) => a - b);

    // Join wrapped names: an amount-less row immediately followed by a same-level row with amounts.
    const rows: RawRow[] = [];
    for (let i = 0; i < raws.length; i += 1) {
      const x = raws[i];
      const next = raws[i + 1];
      if (
        x &&
        next &&
        !x.hasAmounts &&
        keyOf(x) === keyOf(next) &&
        next.hasAmounts &&
        !TOTAL_RE.test(next.name)
      ) {
        const joined = { ...next, name: `${x.name} ${next.name}`.replace(/\s+/gu, " ") };
        findings.push({ kind: "wrapped_name", sourceRow: x.r + 1, name: joined.name });
        rows.push(joined);
        i += 1;
      } else if (x) rows.push(x);
    }

    const stack: { node: BalanceNode; children: BalanceNode[] }[] = [];
    const close = (toLevel: number) => {
      while (stack.length > 0 && (stack[stack.length - 1]?.node.level ?? -1) >= toLevel) {
        const top = stack.pop();
        if (top) verify(top.node, top.children);
      }
    };
    rows.forEach((x, i) => {
      if (TOTAL_RE.test(x.name)) {
        findings.push({
          kind: "total_row",
          sourceRow: x.r + 1,
          label: x.name,
          amounts: x.amounts,
        });
        return;
      }
      noteTruncated(x);
      const level = ranks.indexOf(keyOf(x));
      close(level);
      const parentPath =
        stack.length === 0 ? [] : (stack[stack.length - 1]?.node.path ?? []);
      const next = rows.slice(i + 1).find((y) => !TOTAL_RE.test(y.name));
      const isGroup = next !== undefined && ranks.indexOf(keyOf(next)) > level;
      const node: BalanceNode = {
        name: x.name,
        path: [...parentPath, x.name],
        level,
        kind: isGroup ? "group" : "ledger",
        sourceRow: x.r + 1,
        amounts: x.amounts,
      };
      nodes.push(node);
      stack[stack.length - 1]?.children.push(node);
      if (isGroup) stack.push({ node, children: [] });
    });
    close(0);
  } else if (hierarchy === "parent_column") {
    const byGroup = new Map<string, BalanceNode[]>();
    for (const x of raws) {
      if (TOTAL_RE.test(x.name)) {
        findings.push({
          kind: "total_row",
          sourceRow: x.r + 1,
          label: x.name,
          amounts: x.amounts,
        });
        continue;
      }
      noteTruncated(x);
      const group = x.parentValue ?? "";
      const chain: string[] = [];
      let g = predefinedGroup(group);
      if (g) {
        while (g) {
          chain.unshift(g.name);
          g = g.parent ? predefinedGroup(g.parent) : null;
        }
      } else if (group !== "") chain.push(group);
      const node: BalanceNode = {
        name: x.name,
        path: [...chain, x.name],
        level: chain.length,
        kind: "ledger",
        sourceRow: x.r + 1,
        amounts: x.amounts,
      };
      nodes.push(node);
      const list = byGroup.get(group) ?? [];
      list.push(node);
      byGroup.set(group, list);
    }
  } else if (hierarchy === "subtotal_rows") {
    const stack: {
      name: string;
      row: RawRow;
      children: BalanceNode[];
      path: string[];
    }[] = [];
    for (const x of raws) {
      const top = stack[stack.length - 1];
      const closes =
        top !== undefined &&
        (TOTAL_RE.test(x.name) || x.name === "" || x.name === top.name) &&
        x.hasAmounts;
      if (closes) {
        stack.pop();
        const node: BalanceNode = {
          name: top.name,
          path: top.path,
          level: stack.length,
          kind: "group",
          sourceRow: top.row.r + 1,
          amounts: x.amounts,
        };
        nodes.push(node);
        verify({ ...node, sourceRow: x.r + 1 }, top.children);
        stack[stack.length - 1]?.children.push(node);
        continue;
      }
      if (TOTAL_RE.test(x.name)) {
        findings.push({
          kind: "total_row",
          sourceRow: x.r + 1,
          label: x.name,
          amounts: x.amounts,
        });
        continue;
      }
      noteTruncated(x);
      const parentPath = top?.path ?? [];
      if (!x.hasAmounts) {
        stack.push({ name: x.name, row: x, children: [], path: [...parentPath, x.name] });
        continue;
      }
      const node: BalanceNode = {
        name: x.name,
        path: [...parentPath, x.name],
        level: stack.length,
        kind: "ledger",
        sourceRow: x.r + 1,
        amounts: x.amounts,
      };
      nodes.push(node);
      top?.children.push(node);
    }
    for (const open of stack)
      findings.push({
        kind: "unclosed_group",
        sourceRow: open.row.r + 1,
        name: open.name,
      });
  } else {
    for (const x of raws) {
      if (TOTAL_RE.test(x.name)) {
        findings.push({
          kind: "total_row",
          sourceRow: x.r + 1,
          label: x.name,
          amounts: x.amounts,
        });
        continue;
      }
      noteTruncated(x);
      const isPredefined = predefinedGroup(x.name) !== null;
      nodes.push({
        name: x.name,
        path: [x.name],
        level: 0,
        kind: isPredefined ? "group" : "ledger",
        sourceRow: x.r + 1,
        amounts: x.amounts,
      });
    }
  }

  return {
    period: header.period,
    asAt: header.asAt,
    hierarchy,
    nodes,
    ledgers: nodes.filter((n) => n.kind === "ledger"),
    checks,
    grandTotal,
    findings,
  };
}

/** The top-level group of a ledger path, resolved to its Tally primary group when predefined. */
export function primaryGroupOfPath(path: readonly string[]): string | null {
  for (const name of path) {
    const primary = primaryOf(name);
    if (primary) return primary.name;
  }
  return null;
}
