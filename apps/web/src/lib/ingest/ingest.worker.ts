/**
 * Ingestion Web Worker (SPEC §15). Everything heavy runs here, off the main thread: reading
 * bytes, the zip-bomb guard, SheetJS or CSV parsing, profiling, report detection and loading
 * into DuckDB-WASM (its own nested worker, self-hosted under /vendor/duckdb).
 *
 * Raw data exists only in this worker's memory and DuckDB's in-memory database. Nothing is
 * posted back except the pre-payment summary and progress.
 */

import type { DateOrder } from "@magicmis/core/time";
import * as duckdb from "@duckdb/duckdb-wasm";
import {
  checkFiles,
  loadSheet,
  profileSheet,
  readSourceFile,
  sha256Hex,
  SOURCE_REFUSAL_MESSAGES,
  type DuckConn,
  type IngestLimits,
  type SheetGrid,
  type SheetProfile,
} from "@magicmis/ingest";
import { detectReport } from "@magicmis/tally";
import * as Comlink from "comlink";

import type { FileSummary, IngestApi, IngestProgress } from "./types";

interface LoadedFile {
  readonly summary: FileSummary;
  readonly sheets: readonly { grid: SheetGrid; profile: SheetProfile; table: string }[];
}

let limits: IngestLimits | null = null;
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

function rowsOf(grid: SheetGrid): number {
  let n = 0;
  for (const row of grid.rows)
    if (row.some((c) => c !== undefined && c.text.trim() !== "")) n += 1;
  return n;
}

const api: IngestApi = {
  configure(l, _caps, order) {
    limits = l;
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
        // Any format; the bytes decide what the file is (ADR 0031).
        const read = await readSourceFile(file.name, bytes, {
          maxEntries: limits.zip_max_entries,
          maxUncompressedBytes: limits.zip_max_uncompressed_bytes,
          maxRatio: limits.zip_max_ratio,
        });
        if (!read.ok) {
          report({
            name: file.name,
            stage: "error",
            percent: 0,
            message: SOURCE_REFUSAL_MESSAGES[read.reason],
          });
          continue;
        }
        report({ name: file.name, stage: "parsing", percent: 20 });
        const grids = read.sheets;

        const { conn } = await duck();
        const sheets: LoadedFile["sheets"][number][] = [];
        for (const [i, grid] of grids.entries()) {
          const profile = await profileSheet(
            grid,
            (g, h, c) => detectReport(g, h, c).type,
          );
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
            "This file couldn't be read. Check that it opens on your computer, or export it again as Excel, CSV or PDF.",
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
};

Comlink.expose(api);
