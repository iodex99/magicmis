/**
 * Ingestion Web Worker (SPEC §15). Everything heavy runs here, off the main thread: reading
 * bytes, the zip-bomb guard, SheetJS or CSV parsing, profiling, report detection and loading
 * into DuckDB-WASM (its own nested worker, self-hosted under /vendor/duckdb).
 *
 * Raw data exists only in this worker's memory and DuckDB's in-memory database. Nothing is
 * posted back except the pre-payment summary, progress, and — in developer mode — the
 * redacted payload preview.
 */

import type { DateOrder } from "@magicmis/core/time";
import * as duckdb from "@duckdb/duckdb-wasm";
import {
  checkFiles,
  fileKind,
  inspectZip,
  loadSheet,
  profileSheet,
  readCsvGrid,
  readExcel,
  sha256Hex,
  type DuckConn,
  type IngestLimits,
  type SheetGrid,
  type SheetProfile,
} from "@magicmis/ingest";
import {
  buildOutboundSheet,
  generateRedactionKey,
  inspectPayload,
  Redactor,
} from "@magicmis/redact";
import {
  assignRoles,
  detectReport,
  parseBalanceReport,
  PARTY_GROUP_KEYS,
  groupKey,
} from "@magicmis/tally";
import * as Comlink from "comlink";

import type { FileSummary, IngestApi, IngestProgress } from "./types";

interface LoadedFile {
  readonly summary: FileSummary;
  readonly sheets: readonly { grid: SheetGrid; profile: SheetProfile; table: string }[];
}

let limits: IngestLimits | null = null;
let caps = { sampleRowsPerSheet: 15, distinctValuesPerColumn: 500 };
// SPEC §2.3: recognition results are shown only inside a paid action; the inspector is a
// developer tool and refuses outside developer mode.
let developerMode = false;
const files = new Map<string, LoadedFile>();
const tables = new Set<string>();
/** Set by `configure` before any file is added; day-first until it is. */
let dateOrder: DateOrder = "day_first";
let dbPromise: Promise<{ db: duckdb.AsyncDuckDB; conn: DuckConn }> | null = null;

async function openDuck(): Promise<{ db: duckdb.AsyncDuckDB; conn: DuckConn }> {
  const base = `${self.location.origin}/vendor/duckdb`;
  const bundle = await duckdb.selectBundle({
    mvp: {
      mainModule: `${base}/duckdb-mvp.wasm`,
      mainWorker: `${base}/duckdb-browser-mvp.worker.js`,
    },
    eh: {
      mainModule: `${base}/duckdb-eh.wasm`,
      mainWorker: `${base}/duckdb-browser-eh.worker.js`,
    },
  });
  if (!bundle.mainWorker) throw new Error("DuckDB worker bundle missing");
  const db = new duckdb.AsyncDuckDB(
    new duckdb.VoidLogger(),
    new Worker(bundle.mainWorker),
  );
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  const connection = await db.connect();
  const conn: DuckConn = {
    query: async (sql) =>
      (await connection.query(sql))
        .toArray()
        .map((r) => (r as { toJSON(): Record<string, unknown> }).toJSON()),
    registerFileText: (name, text) => db.registerFileText(name, text),
    dropFile: async (name) => {
      await db.dropFile(name);
    },
  };
  return { db, conn };
}

const duck = () => (dbPromise ??= openDuck());

const PARTY_REPORTS = new Set([
  "sales_register",
  "purchase_register",
  "bills_receivable",
  "bills_payable",
]);

/** In registers and bills the particulars column holds party names (SPEC §17 party ledgers). */
function partyColumnsOf(profile: SheetProfile): ReadonlySet<number> {
  if (!PARTY_REPORTS.has(profile.reportType) || profile.header === null) return new Set();
  const col = assignRoles(profile.header.headers).particulars;
  return col === undefined ? new Set() : new Set([col]);
}

function rowsOf(grid: SheetGrid): number {
  let n = 0;
  for (const row of grid.rows)
    if (row.some((c) => c !== undefined && c.text.trim() !== "")) n += 1;
  return n;
}

const api: IngestApi = {
  configure(l, c, dev, order) {
    limits = l;
    caps = c;
    developerMode = dev;
    dateOrder = order;
    return Promise.resolve();
  },

  async addFiles(input, onProgress) {
    if (limits === null) throw new Error("ingestion is not configured");
    const report = (p: IngestProgress) => {
      onProgress(p);
    };
    const existing = [...files.values()].map((f) => ({
      name: f.summary.name,
      size: f.summary.size,
    }));
    const verdict = checkFiles(
      [...existing, ...input.map((f) => ({ name: f.name, size: f.size }))],
      limits,
    );
    if (!verdict.ok) {
      const message = {
        unsupported_type: "Only .xlsx, .xlsm, .xls and .csv files are accepted.",
        file_too_large: "A file is larger than the per-file limit.",
        session_too_large:
          "These files together exceed the session limit. Split them into smaller sets.",
        too_many_files: "Too many files for one job.",
      }[verdict.reason];
      for (const f of input)
        report({ name: f.name, stage: "error", percent: 0, message });
      return [];
    }

    const added: FileSummary[] = [];
    for (const file of input) {
      try {
        report({ name: file.name, stage: "reading", percent: 5 });
        const bytes = new Uint8Array(await file.arrayBuffer());
        const fileId = await sha256Hex(bytes);
        if (files.has(fileId)) {
          report({
            name: file.name,
            stage: "done",
            percent: 100,
            message: "Already loaded",
          });
          continue;
        }
        const kind = fileKind(file.name);
        if (kind === "xlsx" || kind === "xlsm") {
          const zip = inspectZip(bytes, {
            maxEntries: limits.zip_max_entries,
            maxUncompressedBytes: limits.zip_max_uncompressed_bytes,
            maxRatio: limits.zip_max_ratio,
          });
          if (!zip.ok) {
            report({
              name: file.name,
              stage: "error",
              percent: 0,
              message:
                "This workbook's contents are too large or malformed to open safely.",
            });
            continue;
          }
        }
        report({ name: file.name, stage: "parsing", percent: 20 });
        const grids =
          kind === "csv"
            ? [readCsvGrid(bytes, file.name.replace(/\.csv$/iu, "")).grid]
            : readExcel(bytes).sheets;

        const { conn } = await duck();
        const sheets: LoadedFile["sheets"][number][] = [];
        for (const [i, grid] of grids.entries()) {
          const profile = await profileSheet(grid, (g, h) => detectReport(g, h).type);
          report({
            name: file.name,
            stage: "loading",
            percent: 40 + Math.floor((50 * i) / Math.max(grids.length, 1)),
          });
          const loaded = await loadSheet(conn, {
            fileId,
            sheet: grid,
            profile,
            tableTaken: tables,
            dateOrder,
          });
          sheets.push({ grid, profile, table: loaded.table });
        }
        const summary: FileSummary = {
          fileId,
          name: file.name,
          size: file.size,
          sheets: sheets.map((s) => ({ rows: rowsOf(s.grid) })),
        };
        files.set(fileId, { summary, sheets });
        added.push(summary);
        report({ name: file.name, stage: "done", percent: 100 });
      } catch {
        // Never echo parser messages: they can quote cell content.
        report({
          name: file.name,
          stage: "error",
          percent: 0,
          message:
            "This file could not be read. Check that it opens in Excel and try again.",
        });
      }
    }
    return added;
  },

  summaries() {
    return Promise.resolve([...files.values()].map((f) => f.summary));
  },

  async clear() {
    if (dbPromise !== null) {
      const { db } = await dbPromise;
      await db.terminate();
    }
    dbPromise = null;
    files.clear();
    tables.clear();
  },

  async inspect(fileId) {
    if (!developerMode)
      throw new Error("the payload inspector is available in developer mode only");
    const file = files.get(fileId);
    if (!file) throw new Error("unknown file");
    // Preview only: an ephemeral key, not the company's redaction key (which arrives with
    // companies). Tokens here are therefore not the tokens a real action would send.
    const redactor = await Redactor.create(generateRedactionKey());
    // Party names come from every loaded trial balance or group summary, not just this file.
    for (const loaded of files.values()) {
      for (const s of loaded.sheets) {
        if (s.profile.header === null) continue;
        if (
          s.profile.reportType === "trial_balance" ||
          s.profile.reportType === "group_summary"
        ) {
          const tb = parseBalanceReport(s.grid, s.profile.header);
          const inPartyGroup =
            s.profile.reportType === "group_summary" &&
            /sundrys+(debtors|creditors)/iu.test(s.profile.header.titleLines.join(" "));
          redactor.registerParties(
            tb.ledgers
              .filter(
                (l) =>
                  inPartyGroup || l.path.some((p) => PARTY_GROUP_KEYS.has(groupKey(p))),
              )
              .map((l) => l.name),
          );
        }
      }
    }
    const out = [];
    for (const s of file.sheets) {
      out.push(
        await buildOutboundSheet({
          fileId,
          grid: s.grid,
          profile: s.profile,
          redactor,
          caps,
          sheetKind: s.profile.reportType === "pay_sheet" ? "payroll" : "other",
          partyColumns: partyColumnsOf(s.profile),
        }),
      );
    }
    return inspectPayload(out);
  },
};

Comlink.expose(api);
