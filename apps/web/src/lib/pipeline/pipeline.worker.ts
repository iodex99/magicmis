/**
 * Job pipeline Web Worker (SPEC §15–§24). Raw files, parsed grids, the redaction token map and
 * DuckDB live only here. The page receives pre-payment counts, then — inside a reserved job —
 * review rows, validation results and the finished workbook.
 */

import * as duckdb from "@duckdb/duckdb-wasm";
import { addMonths, type PeriodId } from "@magicmis/core/time";
import { gateOutcome } from "@magicmis/engine";
import {
  checkFiles,
  fileKind,
  inspectZip,
  readCsvGrid,
  readExcel,
  type DuckConn,
  type IngestLimits,
} from "@magicmis/ingest";
import {
  computeAndRender,
  mapStep,
  nextRules,
  prepare,
  validate,
  type MappingStep,
  type PipelineFile,
  type Prepared,
} from "@magicmis/pipeline";
import { Redactor } from "@magicmis/redact";
import {
  applyAiMappings,
  HEADS_VERSION,
  normaliseName,
  type Mapping,
} from "@magicmis/semantic";
import { MONTHLY_FINANCIAL_MIS } from "@magicmis/templates";
import * as Comlink from "comlink";

import type { JobSession } from "../server/companies";

import type { ComputeResult, MapResult, PipelineApi, PipelineFileSummary } from "./types";

let session: JobSession | null = null;
let limits: IngestLimits | null = null;
let redactor: Redactor | null = null;
const files: PipelineFile[] = [];
let prepared: Prepared | null = null;
let step: MappingStep | null = null;
let mappings: Mapping[] = [];
let duckPromise: Promise<{ db: duckdb.AsyncDuckDB; conn: DuckConn }> | null = null;

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

const need = <T>(v: T | null, what: string): T => {
  if (v === null) throw new Error(`${what} is not ready`);
  return v;
};

const display = (token: string): string => redactor?.rehydrate(token).name ?? token;

const KEY_TOKEN =
  /^(pan|aadhaar|uan|ifsc|bankac|gstin|email|mobile|person|party|sensitive) ([0-9a-f]{12})$/u;

/**
 * The ledger name to show for a ledger key: the loaded fact's name (a token for parties,
 * rehydrated here), or for ledgers known only from an earlier snapshot, the key's last segment
 * with any normalised token turned back into its token form.
 */
function ledgerDisplayName(key: string, names: ReadonlyMap<string, string>): string {
  const name = names.get(key);
  if (name !== undefined) return display(name);
  const last = key.split(" > ").at(-1) ?? key;
  const m = KEY_TOKEN.exec(last);
  return m === null ? last : display(`${(m[1] ?? "").toUpperCase()}_${m[2] ?? ""}`);
}

const b64ToBytes = (b64: string): Uint8Array =>
  Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function ensurePrepared(): Promise<Prepared> {
  prepared ??= await prepare(files, need(redactor, "session"));
  return prepared;
}

const toMapResult = (s: MappingStep): MapResult => ({
  reviewRows: s.reviewRows,
  unmatched: s.unmatched.map((u) => ({
    ref: u.ref,
    name: u.name,
    group_path: u.groupPath,
  })),
});

const api: PipelineApi = {
  async start(s, l) {
    session = s;
    limits = l;
    redactor = await Redactor.create(b64ToBytes(s.redactionKey));
    files.length = 0;
    prepared = null;
    step = null;
    mappings = [];
  },

  async addFiles(input) {
    const lim = need(limits, "limits");
    const verdict = checkFiles(
      [
        ...files.map((f) => ({ name: f.name, size: f.bytes.length })),
        ...input.map((f) => ({ name: f.name, size: f.size })),
      ],
      lim,
    );
    if (!verdict.ok) return { added: [], refused: verdict.reason };
    const added: PipelineFileSummary[] = [];
    for (const file of input) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const kind = fileKind(file.name);
      if (kind === "xlsx" || kind === "xlsm") {
        const zip = inspectZip(bytes, {
          maxEntries: lim.zip_max_entries,
          maxUncompressedBytes: lim.zip_max_uncompressed_bytes,
          maxRatio: lim.zip_max_ratio,
        });
        if (!zip.ok) return { added, refused: "unsafe_workbook" };
      }
      const sheets =
        kind === "csv"
          ? [readCsvGrid(bytes, file.name).grid]
          : [...readExcel(bytes).sheets];
      files.push({ fileId: crypto.randomUUID(), name: file.name, bytes });
      added.push({
        name: file.name,
        size: file.size,
        sheets: sheets.length,
        rows: sheets.reduce(
          (n, g) =>
            n +
            g.rows.filter((r) => r.some((c) => c !== undefined && c.text.trim() !== ""))
              .length,
          0,
        ),
      });
    }
    prepared = null;
    return { added, refused: null };
  },

  async pricingInputs() {
    const p = await ensurePrepared();
    return { size: p.size, fingerprints: p.fingerprints };
  },

  async unrecognisedSheets() {
    return (await ensurePrepared()).unrecognised.length;
  },

  async map() {
    const s = need(session, "session");
    const p = await ensurePrepared();
    const rules = s.memory.mappingRules;
    step = mapStep(p, {
      companyRules: rules?.rules ?? [],
      accountRules: s.memory.accountRules,
      library: s.library,
      fuzzyThreshold: s.fuzzyThreshold,
      previous:
        rules === null ? null : new Map(rules.rules.map((r) => [r.ledgerKey, r.head])),
      displayName: display,
    });
    mappings = [...step.mappings];
    return toMapResult(step);
  },

  async applyAi(answers) {
    const s = need(step, "mapping");
    const refs = new Map(s.unmatched.map((u) => [u.ref, u.ledgerKey]));
    mappings = applyAiMappings(
      {
        mappings: s.mappings,
        unmatched: s.unmatched.map((u) => ({
          ledgerKey: u.ledgerKey,
          ledger: { groupPath: u.groupPath, name: u.name },
        })),
      },
      answers,
      refs,
    );
    const p = await ensurePrepared();
    const byKey = new Map(p.facts.map((f) => [f.ledgerKey, f]));
    const rows = mappings
      .filter((m) => m.needsReview)
      .map((m) => {
        const f = byKey.get(m.ledgerKey);
        return {
          ledgerKey: m.ledgerKey,
          displayName: display(f?.name ?? m.ledgerKey),
          parentGroup: f?.groupPath.at(-1) ?? "",
          sourceFile: f?.source.fileId ?? "",
          sourceSheet: f?.source.sheet ?? "",
          amountPaise: (f?.closing ?? 0n).toString(),
          proposed: m,
        };
      });
    return {
      reviewRows: [
        ...s.reviewRows.filter((r) => !rows.some((x) => x.ledgerKey === r.ledgerKey)),
        ...rows,
      ],
      unmatched: [],
    };
  },

  async compute(input): Promise<ComputeResult> {
    const s = need(session, "session");
    const p = await ensurePrepared();
    duckPromise ??= openDuck();
    const { conn } = await duckPromise;
    const byKey = new Map(input.confirmed.map((c) => [c.ledgerKey, c]));
    const finalMappings = mappings.map((m) => {
      const c = byKey.get(m.ledgerKey);
      return c === undefined ? m : { ...m, head: c.head };
    });
    const period = (p.periods.at(-1) ?? "") as PeriodId;
    const first =
      (s.memory.latestPeriod === null
        ? p.periods[0]
        : addMonths(s.memory.latestPeriod as PeriodId, 1)) ?? period;
    const previousPeriod = s.memory.latestPeriod as PeriodId | null;
    const closings = new Map(
      s.memory.priorBalances
        .filter((b) => b.period === previousPeriod)
        .map((b) => [b.ledgerKey, BigInt(b.closing)]),
    );
    const namesByKey = new Map(p.facts.map((f) => [f.ledgerKey, f.name]));
    const out = await computeAndRender(conn, p, {
      mappings: finalMappings,
      prior: s.memory.priorBalances,
      fyStartMonth: s.company.fyStartMonth,
      period,
      template: MONTHLY_FINANCIAL_MIS,
      companyName: s.company.name,
      tierLabel: input.tierLabel,
      snapshotVersion:
        period === s.memory.latestPeriod ? (s.memory.latestVersion ?? 0) + 1 : 1,
      generatedAt: new Date(),
      displayName: (key) => ledgerDisplayName(key, namesByKey),
      ageingBuckets: s.validation.ageingBuckets,
      validation: (cube) =>
        validate(cube, p, {
          config: {
            tbTolerancePaise: BigInt(s.validation.tbTolerancePaise),
            reconciliationTolerancePaise: BigInt(
              s.validation.reconciliationTolerancePaise,
            ),
            signSanityHeads: s.validation.signSanityHeads,
            ageingBuckets: s.validation.ageingBuckets,
          },
          unmappedAccepted: input.unmappedAccepted,
          expected: { from: first, to: period },
          previousSnapshot:
            previousPeriod === null ? null : { period: previousPeriod, closings },
          netProfitStatements: [],
        }),
    });
    const checks = [...out.checks, out.v11];
    const gate = gateOutcome(checks);
    const names = new Map(p.facts.map((f) => [f.ledgerKey, f.name]));
    const rules = nextRules(
      s.memory.mappingRules,
      finalMappings,
      input.confirmed,
      names,
      HEADS_VERSION,
    );
    const changed =
      s.memory.mappingRules === null ||
      JSON.stringify(s.memory.mappingRules.rules) !== JSON.stringify(rules.rules.rules);
    const bytes = new Uint8Array(await out.rendered.workbook.xlsx.writeBuffer());
    return {
      checks,
      blocking: checks.filter((c) => c.status === "fail" && c.severity === "blocking"),
      failureClass: gate.ok ? null : gate.failureClass,
      period,
      fileName: out.rendered.fileName,
      workbookBase64: bytesToB64(bytes),
      snapshot: out.snapshot,
      blueprint: changed
        ? {
            templateSpec: MONTHLY_FINANCIAL_MIS,
            recipe: {
              schemaVersion: 1,
              sources: Object.entries(p.fingerprints).map(([role, sig], i) => ({
                id: `s${i.toString()}`,
                role: role.split(":")[0] ?? "trial_balance",
                sheetSignature: sig,
                columns: {},
                sign: "split_columns",
              })),
              filters: [],
              mappingRulesVersion: rules.rules.schemaVersion,
              period: { fyStartMonth: s.company.fyStartMonth, granularity: "month" },
              dimensions: [],
              metrics: [{ id: "revenue", comparisons: ["mom", "yoy", "ytd"] }],
            },
            mappingRules: rules.rules,
            sourceFingerprints: p.fingerprints,
          }
        : null,
      accountRules: rules.accountRules.map((r) => ({
        pattern: normaliseName(r.pattern),
        head: r.head,
      })),
    };
  },

  async clear() {
    if (duckPromise !== null) {
      const { db } = await duckPromise;
      await db.terminate();
    }
    duckPromise = null;
    files.length = 0;
    prepared = null;
    step = null;
    mappings = [];
    redactor = null;
    session = null;
  },
};

Comlink.expose(api);
