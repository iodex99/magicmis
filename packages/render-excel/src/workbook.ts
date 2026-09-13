/**
 * Excel MIS workbook (SPEC §24.1), built with ExcelJS 4.4.0 in the browser: Cover, Index, one sheet
 * per included template section, Checks, Data and Lineage. Report cells are SUMIFS formulas over
 * the Data sheet with cached results; comparisons reference report cells with guarded division.
 *
 * Every formula cell is paired with the engine's value for V11 (`verify.ts`).
 *
 * API used (from the package's type declarations): `new Workbook()`, `addWorksheet(name, options)`
 * with `views: [{ state: "frozen", xSplit, ySplit }]` and `pageSetup` (`paperSize: 9` = A4,
 * `orientation`, `printTitlesRow`, `fitToWidth`), `getCell(row, col).value = { formula, result }`,
 * `numFmt`, `font`, `alignment.indent`, `getRow(n).hidden`, `columns[i].width`,
 * `xlsx.writeBuffer()`.
 */

import { formatIstDateTime } from "@magicmis/core/time";
import {
  addMonths,
  financialYearOf,
  periodParts,
  periodRange,
  type PeriodId,
} from "@magicmis/core/time";
import { daysInMonth } from "@magicmis/core/time";
import type { CheckResult, HeadCube, MetricValue } from "@magicmis/engine";
import { MetricEngine } from "@magicmis/engine";
import { divideRounded, formatDecimal } from "@magicmis/core/money";
import type { ColumnKind, ResolvedSection, TemplateSpec } from "@magicmis/templates";
import ExcelJS from "exceljs";

import { DATA_COLUMNS, dataRowsFromCube, periodIndex } from "./data";
import { DAYS_FORMAT, moneyFormat, PERCENT_FORMAT, RATIO_FORMAT } from "./formats";
import {
  DataRange,
  isFlow,
  metricExpression,
  unitKind,
  type ColumnContext,
} from "./formulas";

export const DISCLAIMER =
  "Prepared from data provided by the user; requires professional review.";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
export const periodLabel = (p: PeriodId): string => {
  const { year, month } = periodParts(p);
  return `${MONTHS[month - 1] ?? ""} ${year.toString()}`;
};

export interface Expectation {
  readonly sheet: string;
  readonly row: number;
  readonly col: number;
  readonly metricId: string;
  /** "paise": integer string; "decimal": 6-dp string; null: the cell must evaluate to "" or be empty. */
  readonly unit: "paise" | "decimal";
  readonly value: string | null;
}

export interface RenderInput {
  readonly companyName: string;
  readonly template: TemplateSpec;
  readonly sections: readonly ResolvedSection[];
  readonly period: PeriodId;
  readonly tierLabel: string;
  readonly generatedAt: Date;
  readonly snapshotVersion: number;
  readonly cube: HeadCube;
  readonly displayName: (ledgerKey: string) => string;
  readonly validation: readonly CheckResult[];
  readonly extraValues?: Readonly<Record<string, readonly MetricValue[]>>;
  /** Display text for a template row label: rehydrates redaction tokens in the browser (SPEC §17). */
  readonly labelText?: (label: string) => string;
}

export interface RenderedWorkbook {
  readonly workbook: ExcelJS.Workbook;
  readonly expectations: readonly Expectation[];
  readonly fileName: string;
}

type Col =
  | { readonly kind: "period"; readonly header: string; readonly period: PeriodId }
  | {
      readonly kind: "ytd";
      readonly header: string;
      readonly period: PeriodId;
      readonly engineKind: "ytd" | "ly_ytd";
    }
  | {
      readonly kind: "diff_abs" | "diff_pct";
      readonly header: string;
      readonly a: number;
      readonly b: number;
      readonly engineKind: "mom" | "yoy";
    };

function buildColumns(
  kinds: readonly ColumnKind[],
  period: PeriodId,
  cube: HeadCube,
): Col[] {
  const cols: Col[] = [];
  const indexOf = (header: string) => cols.findIndex((c) => c.header === header);
  for (const k of kinds) {
    switch (k) {
      case "fy_months": {
        const fy = financialYearOf(period, cube.fyStartMonth);
        for (const m of periodRange(fy.start, period)) {
          if (cube.periods.includes(m))
            cols.push({ kind: "period", header: periodLabel(m), period: m });
        }
        break;
      }
      case "current":
        cols.push({ kind: "period", header: "Current month", period });
        break;
      case "previous":
        cols.push({
          kind: "period",
          header: "Previous month",
          period: addMonths(period, -1),
        });
        break;
      case "same_month_ly":
        cols.push({
          kind: "period",
          header: "Same month last year",
          period: addMonths(period, -12),
        });
        break;
      case "mom_abs":
      case "variance":
      case "mom_pct":
      case "yoy_abs":
      case "yoy_pct": {
        const yoy = k.startsWith("yoy");
        const a = indexOf("Current month");
        const b = indexOf(yoy ? "Same month last year" : "Previous month");
        if (a < 0 || b < 0)
          throw new Error(`template column ${k} needs its comparison columns first`);
        const pct = k.endsWith("_pct");
        const header =
          k === "variance"
            ? "Variance"
            : `${yoy ? "YoY" : "MoM"} ${pct ? "%" : "change"}`;
        cols.push({
          kind: pct ? "diff_pct" : "diff_abs",
          header,
          a,
          b,
          engineKind: yoy ? "yoy" : "mom",
        });
        break;
      }
      case "ytd":
        cols.push({ kind: "ytd", header: "YTD", period, engineKind: "ytd" });
        break;
      case "ly_ytd":
        cols.push({
          kind: "ytd",
          header: "Last year YTD",
          period: addMonths(period, -12),
          engineKind: "ly_ytd",
        });
        break;
    }
  }
  return cols;
}

const colLetter = (n: number): string => {
  let s = "";
  let x = n;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
};

const HEADER_ROWS = {
  title: 1,
  subtitle: 2,
  index: 3,
  fy: 4,
  header: 5,
  first: 6,
} as const;

function engineValue(
  engine: MetricEngine,
  cube: HeadCube,
  metricId: string,
  col: Col,
  period: PeriodId,
): MetricValue | null {
  if (col.kind === "period") {
    return cube.periods.includes(col.period)
      ? engine.evaluate(metricId, col.period)
      : null;
  }
  if (col.kind === "ytd") {
    if (!isFlow(metricId)) return null;
    return (
      engine
        .comparisons(metricId, period, [col.engineKind])
        .find((v) => v.metricId === `${metricId}.${col.engineKind}`) ?? null
    );
  }
  const suffix = `${col.engineKind}_${col.kind === "diff_pct" ? "pct" : "abs"}`;
  return (
    engine
      .comparisons(metricId, period, [col.engineKind])
      .find((v) => v.metricId === `${metricId}.${suffix}`) ?? null
  );
}

export function renderWorkbook(input: RenderInput): RenderedWorkbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MIS";
  wb.created = input.generatedAt;
  const { cube, template, period } = input;
  const engine = new MetricEngine(cube);
  const expectations: Expectation[] = [];
  const nf = template.numberFormat;
  const included = input.sections.filter((s) => s.included);

  const pageSetup = (titleRows: string): Partial<ExcelJS.PageSetup> => ({
    paperSize: 9,
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: titleRows,
  });

  // Cover and Index first so they open first.
  const cover = wb.addWorksheet("Cover", { pageSetup: pageSetup("1:1") });
  const coverRows: [string, string][] = [
    ["Company", input.companyName],
    ["Period", periodLabel(period)],
    ["Generated", `${formatIstDateTime(input.generatedAt)} IST`],
    ["Intelligence tier", input.tierLabel],
    ["Template", `${template.name} (v${template.version.toString()})`],
    ["Snapshot version", input.snapshotVersion.toString()],
  ];
  cover.getCell(1, 1).value = `${input.companyName} — ${template.name}`;
  cover.getCell(1, 1).font = { bold: true, size: 14 };
  coverRows.forEach(([k, v], i) => {
    cover.getCell(3 + i, 1).value = k;
    cover.getCell(3 + i, 1).font = { bold: true };
    cover.getCell(3 + i, 2).value = v;
  });
  cover.getCell(10, 1).value = DISCLAIMER;
  cover.getCell(10, 1).font = { italic: true };
  template.notes.forEach((n, i) => (cover.getCell(12 + i, 1).value = n));
  cover.getColumn(1).width = 24;
  cover.getColumn(2).width = 48;

  const index = wb.addWorksheet("Index");
  index.getCell(1, 1).value = "Contents";
  index.getCell(1, 1).font = { bold: true };

  // Data sheet rows are needed to size the formula ranges.
  const dataRows = dataRowsFromCube(cube, input.displayName);
  const range = new DataRange(dataRows.length + 1);

  for (const { section } of included) {
    const ws = wb.addWorksheet(section.sheet, {
      views: [{ state: "frozen", xSplit: 1, ySplit: HEADER_ROWS.header }],
      pageSetup: pageSetup(
        `${HEADER_ROWS.header.toString()}:${HEADER_ROWS.header.toString()}`,
      ),
    });
    ws.getCell(HEADER_ROWS.title, 1).value = `${input.companyName} — ${section.title}`;
    ws.getCell(HEADER_ROWS.title, 1).font = { bold: true, size: 13 };
    ws.getCell(HEADER_ROWS.subtitle, 1).value =
      `Period: ${periodLabel(period)} · Amounts in ₹ · ${DISCLAIMER}`;
    ws.getCell(HEADER_ROWS.index, 1).value = "period index";
    ws.getCell(HEADER_ROWS.fy, 1).value = "FY start index";
    ws.getRow(HEADER_ROWS.index).hidden = true;
    ws.getRow(HEADER_ROWS.fy).hidden = true;
    ws.getColumn(1).width = 34;

    const metricRows = section.rows.filter(
      (r) => r.kind === "metric" || r.kind === "subtotal",
    );
    const hasMetrics = metricRows.length > 0;
    const cols = hasMetrics ? buildColumns(section.columns, period, cube) : [];
    cols.forEach((c, i) => {
      const col = i + 2;
      ws.getColumn(col).width = 16;
      const header = ws.getCell(HEADER_ROWS.header, col);
      header.value = c.header;
      header.font = { bold: true };
      header.alignment = { horizontal: "right", wrapText: true };
      if (c.kind === "period" || c.kind === "ytd") {
        ws.getCell(HEADER_ROWS.index, col).value = periodIndex(c.period);
        ws.getCell(HEADER_ROWS.fy, col).value = periodIndex(
          financialYearOf(c.period, cube.fyStartMonth).start,
        );
      }
    });
    ws.getCell(HEADER_ROWS.header, 1).value = "Particulars";
    ws.getCell(HEADER_ROWS.header, 1).font = { bold: true };

    const rowOf = new Map<string, number>();
    section.rows.forEach((r, i) => {
      if (r.kind === "metric") rowOf.set(r.metric, HEADER_ROWS.first + i);
    });

    const rowNumber = new Map(section.rows.map((r, i) => [r.id, HEADER_ROWS.first + i]));
    // Money written per row id and column, for subtotal formulas and their expected values.
    const money = new Map<string, Map<number, bigint>>();
    const moneyOf = (id: string) => {
      let m = money.get(id);
      if (m === undefined) {
        m = new Map();
        money.set(id, m);
      }
      return m;
    };

    section.rows.forEach((r, i) => {
      const row = HEADER_ROWS.first + i;
      const label = ws.getCell(row, 1);
      label.value = input.labelText ? input.labelText(r.label) : r.label;
      if (r.kind === "heading") {
        label.font = { bold: true };
        return;
      }
      if (r.kind === "unavailable") {
        ws.getCell(row, 2).value = "Not available from supplied data";
        return;
      }
      label.alignment = { indent: r.indent };
      if (r.emphasis) label.font = { bold: true };
      if (r.kind === "subtotal") {
        writeSubtotal(r, row);
        return;
      }
      const kind = unitKind(r.metric);

      cols.forEach((c, ci) => {
        const col = ci + 2;
        const letter = colLetter(col);
        const cell = ws.getCell(row, col);
        if (r.emphasis) cell.font = { bold: true };
        const expected = engineValue(engine, cube, r.metric, c, period);
        const unit: Expectation["unit"] =
          expected?.unit === "paise" ? "paise" : "decimal";
        const blank =
          expected === null ||
          (expected.value === null && expected.nullReason !== "zero_denominator");
        if (blank) return;

        let formula: string | null;
        if (c.kind === "period" || c.kind === "ytd") {
          const ctx: ColumnContext = {
            kind: c.kind,
            indexCell: `${letter}$${HEADER_ROWS.index.toString()}`,
            fyCell: `${letter}$${HEADER_ROWS.fy.toString()}`,
            days:
              c.kind === "period"
                ? daysInMonth(periodParts(c.period).year, periodParts(c.period).month)
                : 0,
          };
          formula = metricExpression(r.metric, ctx, range, (id) => {
            const rr = rowOf.get(id);
            return rr === undefined ? null : `${letter}${rr.toString()}`;
          });
        } else {
          const a = `${colLetter(c.a + 2)}${row.toString()}`;
          const b = `${colLetter(c.b + 2)}${row.toString()}`;
          formula =
            c.kind === "diff_abs"
              ? `IF(OR(${a}="",${b}=""),"",${a}-${b})`
              : `IF(OR(${a}="",${b}=""),"",IF(${b}=0,"",(${a}-${b})/ABS(${b})*100))`;
        }
        if (formula === null) return;

        const cached =
          expected.value === null
            ? ""
            : unit === "paise"
              ? Number.parseInt(expected.value, 10) / 100
              : Number.parseFloat(expected.value);
        cell.value = { formula, result: cached };
        cell.numFmt =
          c.kind === "diff_pct" || kind === "ratio"
            ? r.metric.endsWith("_ratio")
              ? RATIO_FORMAT
              : PERCENT_FORMAT
            : kind === "days"
              ? DAYS_FORMAT
              : unit === "paise"
                ? moneyFormat(
                    BigInt(expected.value ?? "0"),
                    nf.style,
                    nf.decimals,
                    nf.negativesInBrackets,
                  )
                : PERCENT_FORMAT;
        expectations.push({
          sheet: section.sheet,
          row,
          col,
          metricId: `${r.metric}@${c.header}`,
          unit,
          value: expected.value,
        });
        if (unit === "paise" && expected.value !== null && c.kind !== "diff_abs")
          moneyOf(r.id).set(col, BigInt(expected.value));
      });
    });

    /**
     * A subtotal rule (SPEC §22): cell arithmetic over its term rows in each value column, and the
     * usual guarded comparisons on its own cells. Written only where every term has a value.
     */
    function writeSubtotal(
      r: Extract<(typeof section.rows)[number], { kind: "subtotal" }>,
      row: number,
    ) {
      cols.forEach((c, ci) => {
        const col = ci + 2;
        const letter = colLetter(col);
        const cell = ws.getCell(row, col);
        if (r.emphasis) cell.font = { bold: true };
        let formula: string;
        let value: string | null;
        let unit: Expectation["unit"] = "paise";
        if (c.kind === "period" || c.kind === "ytd") {
          const parts: string[] = [];
          let total = 0n;
          for (const t of r.terms) {
            const v = money.get(t.row)?.get(col);
            const at = rowNumber.get(t.row);
            if (v === undefined || at === undefined) return;
            total += t.sign === 1 ? v : -v;
            parts.push(
              `${parts.length === 0 ? (t.sign === 1 ? "" : "-") : t.sign === 1 ? "+" : "-"}${letter}${at.toString()}`,
            );
          }
          formula = parts.join("");
          value = total.toString();
          moneyOf(r.id).set(col, total);
        } else {
          const a = money.get(r.id)?.get(c.a + 2);
          const b = money.get(r.id)?.get(c.b + 2);
          if (a === undefined || b === undefined) return;
          const ac = `${colLetter(c.a + 2)}${row.toString()}`;
          const bc = `${colLetter(c.b + 2)}${row.toString()}`;
          if (c.kind === "diff_abs") {
            formula = `IF(OR(${ac}="",${bc}=""),"",${ac}-${bc})`;
            value = (a - b).toString();
          } else {
            formula = `IF(OR(${ac}="",${bc}=""),"",IF(${bc}=0,"",(${ac}-${bc})/ABS(${bc})*100))`;
            unit = "decimal";
            value =
              b === 0n
                ? null
                : formatDecimal({
                    unscaled: divideRounded(
                      (a - b) * 100n * 1_000_000n,
                      b < 0n ? -b : b,
                      "half_even",
                    ),
                    scale: 6,
                  });
          }
        }
        cell.value = {
          formula,
          result:
            value === null
              ? ""
              : unit === "paise"
                ? Number.parseInt(value, 10) / 100
                : Number.parseFloat(value),
        };
        cell.numFmt =
          unit === "decimal"
            ? PERCENT_FORMAT
            : moneyFormat(
                BigInt(value ?? "0"),
                nf.style,
                nf.decimals,
                nf.negativesInBrackets,
              );
        expectations.push({
          sheet: section.sheet,
          row,
          col,
          metricId: `subtotal:${r.id}@${c.header}`,
          unit,
          value,
        });
      });
    }

    // Extra value tables (ageing, payroll) are written as values with lineage, not formulas.
    const extra = input.extraValues?.[section.id] ?? [];
    extra.forEach((v, i) => {
      const row = HEADER_ROWS.first + section.rows.length + 1 + i;
      ws.getCell(row, 1).value = [
        v.metricId.replace(/_/gu, " "),
        ...Object.values(v.dims),
      ].join(" · ");
      const cell = ws.getCell(row, 2);
      if (v.value === null) return;
      cell.value =
        v.unit === "paise"
          ? Number.parseInt(v.value, 10) / 100
          : Number.parseInt(v.value, 10);
      if (v.unit === "paise")
        cell.numFmt = moneyFormat(
          BigInt(v.value),
          nf.style,
          nf.decimals,
          nf.negativesInBrackets,
        );
      ws.getColumn(2).width = 18;
    });
  }

  // Checks.
  const checks = wb.addWorksheet("Checks", { views: [{ state: "frozen", ySplit: 1 }] });
  ["Check", "Status", "Severity", "Class", "Result", "How to fix"].forEach((h, i) => {
    const c = checks.getCell(1, i + 1);
    c.value = h;
    c.font = { bold: true };
  });
  let checkRow = 2;
  for (const r of input.validation) {
    [r.id, r.status, r.severity, r.failureClass, r.message, r.fix].forEach(
      (v, i) => (checks.getCell(checkRow, i + 1).value = v),
    );
    checkRow += 1;
  }
  for (const s of input.sections.filter((x) => !x.included)) {
    checks.getCell(checkRow, 1).value = "Section";
    checks.getCell(checkRow, 2).value = "omitted";
    checks.getCell(checkRow, 5).value = s.omittedReason ?? "";
    checkRow += 1;
  }
  checks.getColumn(5).width = 80;
  checks.getColumn(6).width = 60;

  // Data.
  const data = wb.addWorksheet("Data", { views: [{ state: "frozen", ySplit: 1 }] });
  DATA_COLUMNS.forEach((h, i) => {
    const c = data.getCell(1, i + 1);
    c.value = h;
    c.font = { bold: true };
  });
  dataRows.forEach((d, i) => {
    const values = [
      d.period,
      d.periodIndex,
      d.fyStartIndex,
      d.headCode,
      d.headName,
      d.headPath,
      d.measure,
      Number.parseInt(d.amountPaise.toString(), 10),
      d.subHead,
    ];
    values.forEach((v, ci) => (data.getCell(i + 2, ci + 1).value = v));
  });
  data.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: DATA_COLUMNS.length },
  };

  // Lineage: every report metric for the current period.
  const lineage = wb.addWorksheet("Lineage", { views: [{ state: "frozen", ySplit: 1 }] });
  ["metric_id", "label", "formula", "source references"].forEach((h, i) => {
    const c = lineage.getCell(1, i + 1);
    c.value = h;
    c.font = { bold: true };
  });
  let lineageRow = 2;
  const seen = new Set<string>();
  for (const { section } of included) {
    const labelOf = new Map(section.rows.map((r) => [r.id, r.label]));
    const text = (l: string) => (input.labelText ? input.labelText(l) : l);
    for (const r of section.rows) {
      if (r.kind === "subtotal") {
        const formula = r.terms
          .map(
            (t, i) =>
              `${i === 0 ? (t.sign === 1 ? "" : "− ") : t.sign === 1 ? "+ " : "− "}${text(labelOf.get(t.row) ?? t.row)}`,
          )
          .join(" ");
        [
          `subtotal:${r.id}@${period}`,
          text(r.label),
          `${text(r.label)} = ${formula}`,
          `${section.sheet} rows`,
        ].forEach((x, i) => (lineage.getCell(lineageRow, i + 1).value = x));
        lineageRow += 1;
        continue;
      }
      if (r.kind !== "metric" || seen.has(r.metric) || !cube.periods.includes(period))
        continue;
      seen.add(r.metric);
      const v = engine.evaluate(r.metric, period);
      const sources = v.inputs
        .map((inp) =>
          inp.kind === "head"
            ? `${inp.head} ${inp.field} ${inp.period} (${inp.ledgers.toString()} ledgers)`
            : inp.kind === "metric"
              ? `${inp.metricId} ${inp.period}`
              : `${inp.description}: ${inp.fileId} ${inp.sheet} ${inp.column} (${inp.rows.toString()} rows)`,
        )
        .join("; ");
      [`${r.metric}@${period}`, r.label, v.formula, sources].forEach(
        (x, i) => (lineage.getCell(lineageRow, i + 1).value = x),
      );
      lineageRow += 1;
    }
  }
  lineage.getColumn(3).width = 60;
  lineage.getColumn(4).width = 80;

  [...included.map((s) => s.section.sheet), "Checks", "Data", "Lineage"].forEach(
    (name, i) => {
      index.getCell(3 + i, 1).value = {
        text: name,
        hyperlink: `#'${name.replace(/'/gu, "''")}'!A1`,
      };
    },
  );
  index.getColumn(1).width = 30;

  const safe = (s: string) => s.replace(/[^A-Za-z0-9]+/gu, "_").replace(/^_+|_+$/gu, "");
  const fileName = `${safe(input.companyName)}_${safe(template.name)}_${period}_v${input.snapshotVersion.toString()}.xlsx`;
  return { workbook: wb, expectations, fileName };
}
