/**
 * Open the workbook's number formats in a real spreadsheet application and compare what it
 * displays with what the screen shows (R-35, `src/format-proof.ts`).
 *
 *   pnpm --filter @magicmis/render-excel format-proof -- --excel
 *   pnpm --filter @magicmis/render-excel format-proof -- --libreoffice "C:/Program Files/LibreOffice/program/soffice.exe"
 *
 * `--excel` drives Excel through COM (Windows, Excel installed); `--libreoffice` converts the
 * file to CSV with the values as shown. Exits non-zero on any difference. Development only:
 * neither application exists on the CI runner, so the unit tests hold the codes and this holds
 * the applications to them.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ExcelJS from "exceljs";

import { groupIndian, groupWestern } from "@magicmis/core/format";

import { cellValue, formatProofCases, type FormatCase } from "../src/format-proof";

const args = process.argv.slice(2);
const useExcel = args.includes("--excel");
const soffice = args.includes("--libreoffice")
  ? args[args.indexOf("--libreoffice") + 1]
  : undefined;
if (!useExcel && soffice === undefined) {
  console.error("Say which application: --excel, or --libreoffice <path to soffice>.");
  process.exit(2);
}

const cases = formatProofCases();
const dir = mkdtempSync(join(tmpdir(), "format-proof-"));
const file = join(dir, "format-proof.xlsx");

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("Formats");
ws.getColumn(1).width = 60;
ws.getColumn(2).width = 40;
ws.getCell(1, 1).value = "code";
ws.getCell(1, 2).value = "shown";
cases.forEach((c, i) => {
  ws.getCell(i + 2, 1).value = c.code;
  const cell = ws.getCell(i + 2, 2);
  cell.value = cellValue(c.paise);
  cell.numFmt = c.code;
});
// Two control cells after the cases: how this application groups thousands and marks decimals in
// the reader's region, which `absolute` and `millions` deliberately follow (formats.ts).
const probes = [
  { value: 1234567, code: "#,##0" },
  { value: 1.5, code: "0.0" },
];
probes.forEach((p, i) => {
  const cell = ws.getCell(cases.length + 2 + i, 2);
  cell.value = p.value;
  cell.numFmt = p.code;
});
const rows = cases.length + probes.length;
await wb.xlsx.writeFile(file);

function shownByExcel(): string[] {
  // Read `.Text`, which is exactly what Excel draws in the cell. The column is wide enough that
  // it never draws "####" instead.
  const out = join(dir, "excel.json");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$x = New-Object -ComObject Excel.Application",
    "$x.Visible = $false; $x.DisplayAlerts = $false",
    "try {",
    `  $wb = $x.Workbooks.Open('${file}', 0, $true)`,
    "  $ws = $wb.Worksheets.Item(1)",
    "  $rows = @()",
    `  for ($r = 2; $r -le ${(rows + 1).toString()}; $r++) { $rows += [string]$ws.Cells.Item($r, 2).Text }`,
    "  $wb.Close($false)",
    `  ConvertTo-Json -InputObject $rows | Out-File -Encoding utf8 '${out}'`,
    "} finally { $x.Quit() }",
  ].join("\n");
  execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
    stdio: "inherit",
  });
  return JSON.parse(readFileSync(out, "utf8").replace(/^\uFEFF/u, "")) as string[];
}

function shownByLibreOffice(path: string): string[] {
  // Filter options 44,34,76,1,,0,false,true,true: comma, double quote, UTF-8, from line 1, … and
  // "save cell contents as shown" true, which is the point.
  execFileSync(
    path,
    [
      "--headless",
      "--convert-to",
      "csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,true",
      "--outdir",
      dir,
      file,
    ],
    { stdio: "inherit" },
  );
  const csv = readdirSync(dir).find((f) => f.endsWith(".csv"));
  if (csv === undefined) throw new Error("LibreOffice wrote no CSV");
  const lines = readFileSync(join(dir, csv), "utf8").split(/\r?\n/u).slice(1);
  return Array.from({ length: rows }, (_, i) => {
    const line = lines[i] ?? "";
    // Column two, which may be quoted because it can hold a comma.
    const m = /^(?:"(?:[^"]|"")*"|[^,]*),(?:"((?:[^"]|"")*)"|([^,]*))$/u.exec(line);
    return (m?.[1] ?? m?.[2] ?? "").replaceAll('""', '"');
  });
}

const shown = useExcel ? shownByExcel() : shownByLibreOffice(soffice ?? "");
const grouped = shown[cases.length] ?? "";
const decimalMark = (shown[cases.length + 1] ?? "1.5").replace(/\d/gu, "");
const regionalSeparator = grouped.replace(/\d/gu, "").charAt(0) || ",";
const regionalIndian = grouped.replace(/\D/gu, " ").trim() === "12 34 567";

/** The screen's text, written the way this application draws the same format code. */
function expectedHere(c: FormatCase): string {
  const m = /^(\(|-)?([\d,]+)(?:\.(\d+))?(\))?$/u.exec(c.expected);
  if (m === null) throw new Error(`unexpected screen text ${c.expected}`);
  const digits = (m[2] ?? "").replaceAll(",", "");
  const whole =
    c.style === "lakhs_crores"
      ? groupIndian(digits)
      : (regionalIndian ? groupIndian(digits) : groupWestern(digits)).replaceAll(
          ",",
          regionalSeparator,
        );
  const fractionPart = m[3] === undefined ? "" : `${decimalMark}${m[3]}`;
  return `${m[1] ?? ""}${whole}${fractionPart}${m[4] ?? ""}`;
}

const wrong = cases.flatMap((c, i) =>
  shown[i] === expectedHere(c)
    ? []
    : [
        {
          paise: c.paise.toString(),
          style: c.style,
          decimals: c.decimals,
          brackets: c.negativesInBrackets,
          code: c.code,
          shown: shown[i],
          expected: expectedHere(c),
        },
      ],
);
const app = useExcel ? "Excel" : "LibreOffice";
const region = `${regionalIndian ? "Indian" : "Western"} grouping with "${regionalSeparator}", decimal mark "${decimalMark}"`;
writeFileSync(join(dir, "result.json"), JSON.stringify({ app, region, wrong }, null, 2));
if (wrong.length > 0) {
  console.error(
    `${app}: ${wrong.length.toString()} of ${cases.length.toString()} cells differ from the screen:`,
  );
  console.table(wrong);
  process.exit(1);
}
console.log(
  `${app} (${region}): all ${cases.length.toString()} cells display exactly what the screen shows.`,
);
