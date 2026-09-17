/**
 * Write a sample workbook from the synthetic fixtures, for looking at how it is typeset.
 *
 * Development only: it renders the same way a job does, so opening the file answers "does this
 * look like something a client would put in a board pack?" — a question no assertion can answer.
 *
 * `pnpm --filter @magicmis/render-excel sample [outPath] [currencySymbol]`
 */

import { writeFile } from "node:fs/promises";

import type { PeriodId } from "@magicmis/core/time";
import { computeCube } from "@magicmis/engine";
import { buildFixtureSet } from "@magicmis/fixtures";
import { detectHeader, readExcel } from "@magicmis/ingest";
import { GLOBAL_LIBRARY_SEED, indexLibrary, runCascade } from "@magicmis/semantic";
import { parseBalanceReport } from "@magicmis/tally";
import { MONTHLY_FINANCIAL_MIS, resolveSections } from "@magicmis/templates";

import { ledgerFactsFromReport } from "../../engine/src/facts";
import { openTestDuck } from "../../ingest/test/duck";
import { renderWorkbook } from "../src/workbook";

const out = process.argv[2] ?? "sample.xlsx";
const symbol = process.argv[3] ?? "₹";
const period = "2026-05" as PeriodId;

const duck = await openTestDuck();
const set = buildFixtureSet();
const files = set.files.filter(
  (f) => f.company === "trading" && f.report === "trial_balance" && f.variant === "clean",
);
const facts = files.flatMap((f) => {
  const sheet = readExcel(f.bytes()).sheets[0];
  if (sheet === undefined) throw new Error("no sheet");
  const header = detectHeader(sheet);
  if (header === null) throw new Error("no header");
  return ledgerFactsFromReport(parseBalanceReport(sheet, header), {
    fileId: f.name,
    sheet: sheet.name,
  });
});
const { mappings } = runCascade(
  facts.map((f) => ({ groupPath: f.groupPath, name: f.name })),
  {
    companyRules: [],
    accountRules: [],
    library: indexLibrary(GLOBAL_LIBRARY_SEED),
    fuzzyThreshold: "0.85",
  },
);
const cube = await computeCube(duck, { facts, mappings: [...mappings], fyStartMonth: 4 });

const rendered = renderWorkbook({
  companyName: "Northwind Traders Pvt Ltd",
  currencySymbol: symbol,
  template: MONTHLY_FINANCIAL_MIS,
  sections: resolveSections(MONTHLY_FINANCIAL_MIS, new Set(["balances"])),
  period,
  tierLabel: "Professional",
  generatedAt: new Date(),
  snapshotVersion: 1,
  cube,
  displayName: (k) => k,
  validation: [
    {
      id: "V1",
      status: "pass",
      severity: "blocking",
      failureClass: "data_fault",
      message: "Trial balance nets to zero in every loaded month.",
      fix: "",
    },
    {
      id: "V4",
      status: "fail",
      severity: "warning",
      failureClass: "data_fault",
      message: "A subtotal in the export does not equal the sum of its children.",
      fix: "Re-export the trial balance with subtotals switched off.",
    },
  ],
});
await writeFile(out, Buffer.from(await rendered.workbook.xlsx.writeBuffer()));
duck.close();
console.log(`wrote ${out} (${rendered.fileName})`);
