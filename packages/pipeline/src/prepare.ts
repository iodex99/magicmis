/**
 * Preflight and profiling in the browser (SPEC §15, §16, §23): read files, detect reports, parse
 * the ones the engine uses, tokenise party ledgers before anything else touches their names
 * (SPEC §17), build ledger facts, sheet signatures for blueprint matching, and the counts-only size
 * descriptors the server prices from. Deterministic; no AI.
 *
 * Tolerant by design (ADR 0031). A sheet that cannot be placed is set aside, never fatal: the job
 * runs on what was recognised, and only when nothing usable is found do the set-aside sheets go
 * to AI classification, whose answers come back in as `guidance`. A sheet that states no month
 * takes one from its title, its sheet name or its file name, and failing all three is listed in
 * `needsPeriod` so the person running the job can say — rather than its balances being dropped.
 */

import type { SizeDescriptors } from "@magicmis/ai/estimator";
import {
  formatIso,
  periodEndDate,
  periodFromText,
  resolveDateOrder,
  type DateOrder,
  type PeriodId,
} from "@magicmis/core/time";
import { ledgerFactsFromReport, type LedgerFact } from "@magicmis/engine";
import {
  cellAt,
  profileSheet,
  readSourceFile,
  type HeaderDetection,
  type SheetGrid,
  type SheetProfile,
} from "@magicmis/ingest";
import type { Redactor } from "@magicmis/redact";
import {
  balanceRoles,
  detectReport,
  groupKey,
  inferBalanceReport,
  isUnsigned,
  withSideColumn,
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
  /** Grids already read (the worker reads each file once, PDFs included). */
  readonly sheets?: readonly SheetGrid[];
}

/** One sheet of one file, as a map key. */
export const sheetKey = (fileId: string, sheet: string): string => `${fileId}|${sheet}`;

/** What the person running the job, or AI classification, has told us since the last pass. */
export interface PrepareGuidance {
  /** A month for each sheet that names none, keyed by `sheetKey`. */
  readonly periods?: Readonly<Record<string, PeriodId>>;
  /** Report types for sheets detection could not place, keyed by `sheetKey`. */
  readonly classified?: Readonly<Record<string, ReportType | "other">>;
  /**
   * The last resort when nothing was recognised and AI could not say either: any sheet shaped
   * like a list of names and amounts — including a profit and loss or balance sheet — is read
   * as balances, and the report says so. A likely report with warnings beats a refusal.
   */
  readonly bestEffort?: boolean;
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
  /** Recognised sheets whose month could not be found anywhere; their data waits for one. */
  readonly needsPeriod: readonly {
    key: string;
    fileName: string;
    sheet: string;
    reportType: ReportType;
  }[];
  /**
   * `ledgerKey|period` of facts whose balances arrived without a side (one unsigned column).
   * Their sign is taken from the head each maps to, once mapping is known.
   */
  readonly unsigned: readonly string[];
  /** Sheets read by `bestEffort` rather than recognised. */
  readonly guessed: number;
  readonly periods: readonly PeriodId[];
  readonly fingerprints: Readonly<Record<string, string>>;
  readonly size: SizeDescriptors;
  readonly available: ReadonlySet<DataRequirement>;
}

// Bytes handed straight to prepare (tests, the server-side flow) are trusted to be bounded; the
// browser worker applies the configured zip limits when the file is added.
const UNBOUNDED = {
  maxEntries: Number.MAX_SAFE_INTEGER,
  maxUncompressedBytes: Number.MAX_SAFE_INTEGER,
  maxRatio: Number.MAX_SAFE_INTEGER,
};

async function sheetsOf(file: PipelineFile): Promise<readonly SheetGrid[]> {
  if (file.sheets !== undefined) return file.sheets;
  const read = await readSourceFile(file.name, file.bytes, UNBOUNDED);
  return read.ok ? read.sheets : [];
}

/** A header for a sheet with none: every row is data, columns keep their inferred names. */
const syntheticHeader = (profile: SheetProfile): HeaderDetection => ({
  headerStart: 0,
  headerEnd: -1,
  bodyStart: 0,
  headers: profile.columns.map((c) => c.header),
  titleLines: [],
  companyName: null,
  period: null,
  asAt: null,
  confidence: 0,
});

/**
 * The order a sheet's dates are written in: what its date columns prove, else the company's
 * setting (ADR 0031). An export from another system is read the way it was written.
 */
function sheetDateOrder(
  sheet: SheetGrid,
  header: HeaderDetection,
  profile: SheetProfile,
  fallback: DateOrder,
): DateOrder {
  const values: string[] = [];
  for (const c of profile.columns) {
    if (c.type !== "date") continue;
    for (let r = header.bodyStart; r < sheet.rows.length; r += 1) {
      const cell = cellAt(sheet, r, c.index);
      if (typeof cell.value === "string" && cell.text.trim() !== "")
        values.push(cell.text);
    }
  }
  return resolveDateOrder(fallback, values) ?? fallback;
}

const COMPUTED_LINE =
  /^(?:gross|net|operating)\s+(?:profit|loss|income|surplus|deficit)\b|^(?:ebitda|pbt|pat)$|^(?:profit|loss)\s+(?:before|after)\s+tax/iu;

const USED: ReadonlySet<string> = new Set([
  "trial_balance",
  "group_summary",
  "bills_receivable",
  "bills_payable",
  "pay_sheet",
]);

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
  /**
   * The company's date order (ADR 0030). Ambiguous numeric dates in bills and voucher
   * registers are read this way round; day-first unless the caller says otherwise, which
   * is SPEC §2.14 and what every Tally export writes.
   */
  dateOrder: DateOrder = "day_first",
  guidance: PrepareGuidance = {},
): Promise<Prepared> {
  const reports: LoadedReport[] = [];
  const facts: LedgerFact[] = [];
  const subtotalChecks: Prepared["subtotalChecks"][number][] = [];
  const grandTotals: Prepared["grandTotals"][number][] = [];
  const bills: Prepared["bills"][number][] = [];
  const pay: Prepared["pay"][number][] = [];
  const unrecognised: Prepared["unrecognised"][number][] = [];
  const needsPeriod: Prepared["needsPeriod"][number][] = [];
  const unsigned: string[] = [];
  let guessed = 0;
  const signatures = new Map<string, Set<string>>();
  let sheets = 0;
  let columns = 0;
  let rows = 0;

  for (const file of files) {
    for (const sheet of await sheetsOf(file)) {
      const profile = await profileSheet(sheet, (s, h, c) => detectReport(s, h, c).type);
      sheets += 1;
      columns += profile.columns.length;
      rows += profile.bodyRows;
      const key = sheetKey(file.fileId, sheet.name);
      const header = profile.header ?? syntheticHeader(profile);

      // Detection first; then content (a balanced list with no usable header); then what AI
      // classification said about a sheet neither could place.
      let type = profile.reportType as ReportType;
      if (
        type === "generic" &&
        profile.header === null &&
        inferBalanceReport(sheet, header, profile.columns)?.balanced === true
      )
        type = "trial_balance";
      const classified = guidance.classified?.[key];
      if (type === "generic" && classified !== undefined && classified !== "other")
        type = classified;
      if (
        guidance.bestEffort === true &&
        (type === "generic" || type === "profit_and_loss" || type === "balance_sheet") &&
        (inferBalanceReport(sheet, header, profile.columns)?.report.ledgers.length ??
          0) >= 2
      ) {
        type = "trial_balance";
        guessed += 1;
      }

      const period =
        periodOf(header.period?.to ?? header.asAt) ??
        periodFromText(header.titleLines.join("\n"), dateOrder) ??
        periodFromText(sheet.name, dateOrder) ??
        periodFromText(file.name, dateOrder) ??
        guidance.periods?.[key] ??
        null;

      reports.push({
        fileId: file.fileId,
        fileName: file.name,
        sheet: sheet.name,
        reportType: type,
        period,
        signature: profile.signature,
      });
      if (profile.signature !== null) {
        const set = signatures.get(type) ?? new Set<string>();
        set.add(profile.signature);
        signatures.set(type, set);
      }
      if (!USED.has(type)) {
        if (type === "generic")
          unrecognised.push({ fileId: file.fileId, sheet: sheet.name, profile });
        continue;
      }
      if (period === null) {
        needsPeriod.push({
          key,
          fileName: file.name,
          sheet: sheet.name,
          reportType: type,
        });
        continue;
      }

      // One odd sheet never stops the job: whatever cannot be parsed is set aside with the
      // unrecognised ones, and the rest of the files carry on.
      try {
        switch (type) {
          case "trial_balance":
          case "group_summary": {
            // A separate Dr/Cr column is folded into the amounts first.
            const sided = withSideColumn(sheet, header, profile.columns);
            const parsed = parseBalanceReport(
              sided,
              header,
              balanceRoles(sided, header, profile.columns) ?? undefined,
            );
            // Rows with a name and no amount are headings, not ledgers missing a balance; and
            // a statement's computed lines (gross profit, net profit) are not ledgers at all.
            const report = await tokeniseReport(
              {
                ...parsed,
                ledgers: parsed.ledgers.filter(
                  (l) => Object.keys(l.amounts).length > 0 && !COMPUTED_LINE.test(l.name),
                ),
              },
              redactor,
            );
            if (report.ledgers.length === 0) {
              unrecognised.push({ fileId: file.fileId, sheet: sheet.name, profile });
              break;
            }
            const built = ledgerFactsFromReport(report, {
              fileId: file.fileId,
              sheet: sheet.name,
              period,
            });
            if (isUnsigned(report))
              for (const fact of built) unsigned.push(`${fact.ledgerKey}|${fact.period}`);
            facts.push(...built);
            subtotalChecks.push({ period, checks: report.checks });
            grandTotals.push({ period, reported: report.grandTotal });
            break;
          }
          case "bills_receivable":
          case "bills_payable": {
            const parsed = parseBills(
              sheet,
              header,
              sheetDateOrder(sheet, header, profile, dateOrder),
            );
            const asAt =
              parsed.asAt ?? header.period?.to ?? formatIso(periodEndDate(period));
            const lines: BillLine[] = [];
            for (const b of parsed.bills)
              lines.push({ ...b, party: await redactor.token("PARTY", b.party) });
            bills.push({
              side: type === "bills_receivable" ? "receivable" : "payable",
              asAt,
              period: periodOf(asAt) ?? period,
              fileId: file.fileId,
              sheet: sheet.name,
              lines,
            });
            break;
          }
          case "pay_sheet": {
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
      } catch {
        unrecognised.push({ fileId: file.fileId, sheet: sheet.name, profile });
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
    needsPeriod,
    unsigned,
    guessed,
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
