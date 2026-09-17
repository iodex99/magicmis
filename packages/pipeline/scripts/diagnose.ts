/**
 * What the pipeline makes of a file, sheet by sheet (ADR 0031). Local support tool.
 *
 *   pnpm --filter @magicmis/web exec tsx ../../packages/pipeline/scripts/diagnose.ts <file> [more files…]
 *
 * Prints structure only — sheet names, detected headings, column types, the report type each
 * sheet was recognised as, what content inference found, and the month — never a cell's value,
 * so its output can be shared to debug a file without sharing the figures in it.
 */

import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { periodFromText } from "@magicmis/core/time";
import { profileSheet, readSourceFile } from "@magicmis/ingest";
import { Redactor } from "@magicmis/redact";
import { detectReport, inferBalanceReport } from "@magicmis/tally";

import { prepare, type PipelineFile } from "../src/prepare";

const LIMITS = {
  maxEntries: 10_000,
  maxUncompressedBytes: 500_000_000,
  maxRatio: 1_000,
};

const paths = process.argv.slice(2);
if (paths.length === 0) {
  console.error("usage: diagnose.ts <file> [more files…]");
  process.exit(2);
}

const files: PipelineFile[] = [];
for (const p of paths) {
  const bytes = new Uint8Array(await readFile(p));
  const name = path.basename(p);
  const read = await readSourceFile(name, bytes, LIMITS);
  console.log(`\n=== ${name} (${bytes.length.toString()} bytes)`);
  if (!read.ok) {
    console.log(`  refused: ${read.reason}`);
    continue;
  }
  console.log(`  format: ${read.format}, sheets: ${read.sheets.length.toString()}`);
  files.push({ fileId: randomUUID(), name, bytes, sheets: read.sheets });

  for (const sheet of read.sheets) {
    const profile = await profileSheet(sheet, (s, h, c) => detectReport(s, h, c).type);
    const header = profile.header;
    console.log(`\n  -- sheet "${sheet.name}": ${sheet.rows.length.toString()} rows`);
    console.log(`     detected type: ${profile.reportType}`);
    if (header === null) {
      console.log("     header: none found");
    } else {
      console.log(
        `     header rows ${(header.headerStart + 1).toString()}-${(header.headerEnd + 1).toString()}, body from row ${(header.bodyStart + 1).toString()}`,
      );
      console.log(`     title lines: ${header.titleLines.length.toString()}`);
      console.log(`     period in title: ${header.period?.to ?? header.asAt ?? "none"}`);
    }
    console.log(
      `     columns: ${profile.columns.map((c) => `[${c.header} : ${c.type} ${c.nonBlank.toString()}]`).join(" ")}`,
    );
    const month =
      periodFromText(header?.titleLines.join("\n") ?? "") ??
      periodFromText(sheet.name) ??
      periodFromText(name);
    console.log(`     month found: ${month ?? "none (the run would ask)"}`);
    const inferred =
      header === null ? null : inferBalanceReport(sheet, header, profile.columns);
    if (inferred === null) {
      console.log("     balance inference: no name + amount shape");
    } else {
      console.log(
        `     balance inference: roles ${JSON.stringify(inferred.roles)}, ledgers ${inferred.report.ledgers.length.toString()}, hierarchy ${inferred.report.hierarchy}, balanced ${String(inferred.balanced)}, unsigned ${String(inferred.unsigned)}`,
      );
    }
  }
}

if (files.length > 0) {
  const redactor = await Redactor.create(randomBytes(32));
  for (const bestEffort of [false, true]) {
    const p = await prepare(files, redactor, "day_first", { bestEffort });
    console.log(
      `\nprepare (bestEffort ${String(bestEffort)}): ledger facts ${p.facts.length.toString()}, periods ${p.periods.join(",") || "none"}, bills ${p.bills.length.toString()}, pay ${p.pay.length.toString()}, unrecognised ${p.unrecognised.length.toString()}, needs month ${p.needsPeriod.length.toString()}, guessed ${p.guessed.toString()}, unsigned ${p.unsigned.length.toString()}`,
    );
  }
}
