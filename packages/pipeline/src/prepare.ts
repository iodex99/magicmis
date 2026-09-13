/**
 * Preflight and profiling in the browser (SPEC §15, §16, §23): read files, detect reports, parse
 * the ones the engine uses, tokenise party ledgers before anything else touches their names
 * (SPEC §17), build ledger facts, sheet signatures for blueprint matching, and the counts-only size
 * descriptors the server prices from. Deterministic; no AI.
 */

import type { SizeDescriptors } from "@magicmis/ai/estimator";
import type { PeriodId } from "@magicmis/core/time";
import { ledgerFactsFromReport, type LedgerFact } from "@magicmis/engine";
import {
  fileKind,
  profileSheet,
  readCsvGrid,
  readExcel,
  type SheetGrid,
  type SheetProfile,
} from "@magicmis/ingest";
import type { Redactor } from "@magicmis/redact";
import {
  detectReport,
  groupKey,
  parseBalanceReport,
  parseBills,
  parsePaySheet,
  PARTY_GROUP_KEYS,
  type BalanceReport,
  type BillLine,
  type PayLine,
  type ReportType,
  type SubtotalCheck,
} from "@magicmis/tally";
import type { DataRequirement } from "@magicmis/templates";

export interface PipelineFile {
  readonly fileId: string;
  readonly name: string;
  readonly bytes: Uint8Array;
}

export interface LoadedReport {
  readonly fileId: string;
  readonly fileName: string;
  readonly sheet: string;
  readonly reportType: ReportType;
  readonly period: PeriodId | null;
  readonly signature: string | null;
}

export interface Prepared {
  readonly reports: readonly LoadedReport[];
  /** Tokenised ledger facts from trial balances and group summaries. */
  readonly facts: readonly LedgerFact[];
  readonly subtotalChecks: readonly {
    period: PeriodId;
    checks: readonly SubtotalCheck[];
  }[];
  readonly grandTotals: readonly {
    period: PeriodId;
    reported: BalanceReport["grandTotal"];
  }[];
  readonly bills: readonly {
    side: "receivable" | "payable";
    asAt: string;
    period: PeriodId;
    fileId: string;
    sheet: string;
    lines: readonly BillLine[];
  }[];
  readonly pay: readonly {
    period: PeriodId;
    fileId: string;
    sheet: string;
    lines: readonly PayLine[];
  }[];
  /** Sheets deterministic detection could not recognise: the only input to AI classification. */
  readonly unrecognised: readonly {
    fileId: string;
    sheet: string;
    profile: SheetProfile;
  }[];
  readonly periods: readonly PeriodId[];
  readonly fingerprints: Readonly<Record<string, string>>;
  readonly size: SizeDescriptors;
  readonly available: ReadonlySet<DataRequirement>;
}

function sheetsOf(file: PipelineFile): SheetGrid[] {
  const kind = fileKind(file.name);
  if (kind === "csv") return [readCsvGrid(file.bytes, file.name).grid];
  if (kind === null) return [];
  return [...readExcel(file.bytes).sheets];
}

const periodOf = (iso: string | null | undefined): PeriodId | null =>
  iso === null || iso === undefined ? null : (iso.slice(0, 7) as PeriodId);

const underParty = (path: readonly string[]): boolean =>
  path.some((g) => PARTY_GROUP_KEYS.has(groupKey(g)));

async function tokeniseReport(
  report: BalanceReport,
  redactor: Redactor,
): Promise<BalanceReport> {
  const renamed = new Map<number, string>();
  for (const l of report.ledgers) {
    if (underParty(l.path.slice(0, -1)))
      renamed.set(l.sourceRow, await redactor.token("PARTY", l.name));
  }
  const fix = <T extends { sourceRow: number; name: string; path: readonly string[] }>(
    n: T,
  ): T => {
    const token = renamed.get(n.sourceRow);
    return token === undefined
      ? n
      : { ...n, name: token, path: [...n.path.slice(0, -1), token] };
  };
  return { ...report, ledgers: report.ledgers.map(fix), nodes: report.nodes.map(fix) };
}

export async function prepare(
  files: readonly PipelineFile[],
  redactor: Redactor,
): Promise<Prepared> {
  const reports: LoadedReport[] = [];
  const facts: LedgerFact[] = [];
  const subtotalChecks: Prepared["subtotalChecks"][number][] = [];
  const grandTotals: Prepared["grandTotals"][number][] = [];
  const bills: Prepared["bills"][number][] = [];
  const pay: Prepared["pay"][number][] = [];
  const unrecognised: Prepared["unrecognised"][number][] = [];
  const signatures = new Map<string, Set<string>>();
  let sheets = 0;
  let columns = 0;
  let rows = 0;

  for (const file of files) {
    for (const sheet of sheetsOf(file)) {
      const profile = await profileSheet(sheet, (s, h, c) => detectReport(s, h, c).type);
      sheets += 1;
      columns += profile.columns.length;
      rows += profile.bodyRows;
      const header = profile.header;
      const period = periodOf(header?.period?.to ?? header?.asAt);
      reports.push({
        fileId: file.fileId,
        fileName: file.name,
        sheet: sheet.name,
        reportType: profile.reportType as ReportType,
        period,
        signature: profile.signature,
      });
      if (profile.signature !== null) {
        const set = signatures.get(profile.reportType) ?? new Set<string>();
        set.add(profile.signature);
        signatures.set(profile.reportType, set);
      }
      if (header === null || profile.reportType === "generic") {
        unrecognised.push({ fileId: file.fileId, sheet: sheet.name, profile });
        continue;
      }
      switch (profile.reportType as ReportType) {
        case "trial_balance":
        case "group_summary": {
          const report = await tokeniseReport(
            parseBalanceReport(sheet, header),
            redactor,
          );
          if (period === null) break;
          facts.push(
            ...ledgerFactsFromReport(report, {
              fileId: file.fileId,
              sheet: sheet.name,
              period,
            }),
          );
          subtotalChecks.push({ period, checks: report.checks });
          grandTotals.push({ period, reported: report.grandTotal });
          break;
        }
        case "bills_receivable":
        case "bills_payable": {
          const parsed = parseBills(sheet, header);
          const asAt = parsed.asAt ?? header.period?.to ?? null;
          if (asAt === null || period === null) break;
          const lines: BillLine[] = [];
          for (const b of parsed.bills)
            lines.push({ ...b, party: await redactor.token("PARTY", b.party) });
          bills.push({
            side: profile.reportType === "bills_receivable" ? "receivable" : "payable",
            asAt,
            period,
            fileId: file.fileId,
            sheet: sheet.name,
            lines,
          });
          break;
        }
        case "pay_sheet": {
          if (period === null) break;
          const parsed = parsePaySheet(sheet, header);
          const lines: PayLine[] = [];
          for (const l of parsed.lines)
            lines.push({ ...l, employee: await redactor.token("PERSON", l.employee) });
          pay.push({ period, fileId: file.fileId, sheet: sheet.name, lines });
          break;
        }
        default:
          break;
      }
    }
  }

  const fingerprints: Record<string, string> = {};
  for (const [role, set] of [...signatures.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    [...set].sort().forEach((sig, i) => (fingerprints[`${role}:${i.toString()}`] = sig));
  }
  const distinctLedgers = new Set(facts.map((f) => f.ledgerKey)).size;
  const available = new Set<DataRequirement>();
  if (facts.length > 0) available.add("balances");
  if (bills.some((b) => b.side === "receivable")) available.add("bills_receivable");
  if (bills.some((b) => b.side === "payable")) available.add("bills_payable");
  if (pay.length > 0) available.add("pay_sheet");

  return {
    reports,
    facts,
    subtotalChecks,
    grandTotals,
    bills,
    pay,
    unrecognised,
    periods: [...new Set(facts.map((f) => f.period))].sort(),
    fingerprints,
    size: {
      files: files.length,
      sheets,
      columns,
      rows,
      distinctLedgerValues: distinctLedgers,
      referenceMisSheets: 0,
    },
    available,
  };
}
