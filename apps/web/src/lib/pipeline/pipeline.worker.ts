/**
 * Job pipeline Web Worker (SPEC §15–§24). Raw files, parsed grids, the redaction token map and
 * DuckDB live only here. The page receives pre-payment counts, then — inside a reserved job —
 * review rows, validation results and the finished workbook.
 */

// Must stay first: it redirects the SQL parser's WebAssembly request before that module loads.
import "./pg-wasm-shim";

import * as duckdb from "@duckdb/duckdb-wasm";
import { addMonths, periodId, type PeriodId } from "@magicmis/core/time";
import { gateOutcome } from "@magicmis/engine";
import {
  checkFiles,
  extractReferenceLayout,
  readSourceFile,
  redactReferenceLayout,
  sheetsToXlsx,
  SOURCE_REFUSAL_MESSAGES,
  type DuckConn,
  type IngestLimits,
} from "@magicmis/ingest";
import {
  chatTables,
  computeAndRender,
  loadChatTables,
  runChatQuery,
  mapStep,
  nextRules,
  prepare,
  sheetKey,
  validate,
  type MappingStep,
  type PipelineFile,
  type PrepareGuidance,
  type Prepared,
} from "@magicmis/pipeline";
import { buildOutboundSheet, Redactor, TOKEN_PATTERN } from "@magicmis/redact";
import {
  applyAiMappings,
  head,
  HEADS_VERSION,
  isHeadCode,
  normaliseName,
  type Mapping,
} from "@magicmis/semantic";
import {
  buildRecreatedTemplate,
  MONTHLY_FINANCIAL_MIS,
  type ReferenceLayout,
  type TemplateSpec,
} from "@magicmis/templates";
import * as Comlink from "comlink";

import type { JobSession } from "../server/companies";

import type {
  ClassifySheetsInput,
  ClassifySheetsOutput,
  ComputeResult,
  MapResult,
  PipelineApi,
  PipelineFileSummary,
  ReferenceReviewRow,
} from "./types";

let session: JobSession | null = null;
let limits: IngestLimits | null = null;
let redactor: Redactor | null = null;
const files: PipelineFile[] = [];
let prepared: Prepared | null = null;
/** What classification and the person running the job have added since files were read. */
let guidance: { periods: Record<string, PeriodId>; classified: Record<string, string> } =
  {
    periods: {},
    classified: {},
  };
/** Classification refs sent to the server, back to the sheets they stand for. */
const classificationRefs = new Map<string, string>();
let step: MappingStep | null = null;
let mappings: Mapping[] = [];
let duckPromise: Promise<{ db: duckdb.AsyncDuckDB; conn: DuckConn }> | null = null;
/** The reference MIS (SPEC §22): its layout as read, and as redacted for the server. */
let reference: { layout: ReferenceLayout; redacted: ReferenceLayout | null } | null =
  null;
let referenceTemplate: TemplateSpec | null = null;
/** A separate DuckDB for Deep chat, locked after its tables are loaded. */
let chatDuck: {
  db: duckdb.AsyncDuckDB;
  conn: DuckConn & { cancel: () => Promise<void> };
} | null = null;

async function openDuck(): Promise<{
  db: duckdb.AsyncDuckDB;
  conn: DuckConn & { cancel: () => Promise<void> };
}> {
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
  const conn: DuckConn & { cancel: () => Promise<void> } = {
    query: async (sql) =>
      (await connection.query(sql))
        .toArray()
        .map((r) => (r as { toJSON(): Record<string, unknown> }).toJSON()),
    registerFileText: (name, text) => db.registerFileText(name, text),
    dropFile: async (name) => {
      await db.dropFile(name);
    },
    // duckdb-wasm 1.32.0 AsyncDuckDBConnection.cancelSent(): cancels the query in flight.
    cancel: async () => {
      await connection.cancelSent();
    },
  };
  return { db, conn };
}

const need = <T>(v: T | null, what: string): T => {
  if (v === null) throw new Error(`${what} is not ready`);
  return v;
};

const display = (token: string): string => redactor?.rehydrate(token).name ?? token;
const labelText = (label: string): string =>
  label.replace(TOKEN_PATTERN, (token) => display(token));

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
  prepared ??= await prepare(
    files,
    need(redactor, "session"),
    need(session, "session").company.dateOrder,
    guidance as PrepareGuidance,
  );
  return prepared;
}

const zipLimitsOf = (l: IngestLimits) => ({
  maxEntries: l.zip_max_entries,
  maxUncompressedBytes: l.zip_max_uncompressed_bytes,
  maxRatio: l.zip_max_ratio,
});

/**
 * Ledger names bound for AI mapping pass through the redactor first. Party ledgers are
 * already tokens; this catches identifiers inside other names (an email, a PAN, a phone
 * number in "Loan — 98xxxxxxxx"), which exports from other systems do not group away.
 */
const toMapResult = async (s: MappingStep): Promise<MapResult> => {
  const r = need(redactor, "session");
  const unmatched = [];
  for (const u of s.unmatched)
    unmatched.push({
      ref: u.ref,
      name: await r.redactText(u.name),
      group_path: await Promise.all(u.groupPath.map((g) => r.redactText(g))),
    });
  return { reviewRows: s.reviewRows, unmatched };
};

const api: PipelineApi = {
  async start(s, l) {
    session = s;
    limits = l;
    redactor = await Redactor.create(b64ToBytes(s.redactionKey));
    files.length = 0;
    prepared = null;
    step = null;
    mappings = [];
    guidance = { periods: {}, classified: {} };
    classificationRefs.clear();
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
    if (!verdict.ok) return { added: [], refused: verdict.reason, skipped: [] };
    const added: PipelineFileSummary[] = [];
    const skipped: { name: string; message: string }[] = [];
    for (const file of input) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      // Any format: the file's own bytes decide what it is (ADR 0031). A file that cannot be
      // read is listed with the reason and what to do; the others are still added.
      const read = await readSourceFile(file.name, bytes, zipLimitsOf(lim));
      if (!read.ok) {
        skipped.push({ name: file.name, message: SOURCE_REFUSAL_MESSAGES[read.reason] });
        continue;
      }
      files.push({
        fileId: crypto.randomUUID(),
        name: file.name,
        bytes,
        sheets: read.sheets,
      });
      added.push({
        name: file.name,
        size: file.size,
        sheets: read.sheets.length,
        rows: read.sheets.reduce(
          (n, g) =>
            n +
            g.rows.filter((r) => r.some((c) => c !== undefined && c.text.trim() !== ""))
              .length,
          0,
        ),
      });
    }
    prepared = null;
    return { added, refused: null, skipped };
  },

  async addReference(file) {
    const lim = need(limits, "limits");
    if (file.size > lim.max_file_bytes)
      return { summary: null, refused: "file_too_large" };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const read = await readSourceFile(file.name, bytes, zipLimitsOf(lim));
    if (!read.ok) return { summary: null, refused: read.reason };
    let extracted;
    try {
      // An .xlsx keeps its bold and indentation, which help read the layout; any other
      // format is converted first and read from its text alone.
      extracted = await extractReferenceLayout(
        read.format === "workbook" ? bytes : sheetsToXlsx(read.sheets),
      );
    } catch {
      try {
        extracted = await extractReferenceLayout(sheetsToXlsx(read.sheets));
      } catch {
        return { summary: null, refused: "unreadable_reference" };
      }
    }
    reference = { layout: extracted.layout, redacted: null };
    referenceTemplate = null;
    // Before payment: name, size, sheet and row counts only (SPEC §2.3).
    return {
      summary: {
        name: file.name,
        size: file.size,
        sheets: extracted.layout.sheets.length,
        rows: extracted.layout.sheets.reduce((n, sh) => n + sh.rows.length, 0),
      },
      refused: null,
    };
  },

  async pricingInputs() {
    const p = await ensurePrepared();
    return {
      size: { ...p.size, referenceMisSheets: reference?.layout.sheets.length ?? 0 },
      fingerprints: p.fingerprints,
    };
  },

  async referenceLayout() {
    if (reference === null) return null;
    // Party names from the loaded books are registered while preparing; redact after that.
    await ensurePrepared();
    const r = need(redactor, "session");
    reference.redacted ??= await redactReferenceLayout(reference.layout, (t) =>
      r.redactText(t),
    );
    return reference.redacted;
  },

  referenceReview(bindings) {
    const ref = need(reference, "reference MIS");
    const byRef = new Map(bindings.map((b) => [b.ref, b]));
    const labels = new Map(
      ref.layout.sheets.flatMap((sh) => sh.rows.map((row) => [row.ref, row.label])),
    );
    const rows: ReferenceReviewRow[] = [];
    for (const sh of ref.layout.sheets) {
      for (const row of sh.rows) {
        const binding = byRef.get(row.ref);
        if (binding === undefined || binding.kind === "blank") continue;
        rows.push({
          ref: row.ref,
          sheet: sh.name,
          label: row.label,
          bold: row.bold,
          indent: row.indent,
          hasValues: row.hasValues,
          binding,
          termLabels:
            binding.kind === "subtotal"
              ? binding.terms.map(
                  (t) => `${t.sign === 1 ? "+" : "−"} ${labels.get(t.row) ?? t.row}`,
                )
              : [],
        });
      }
    }
    return Promise.resolve(rows);
  },

  useReferenceBindings(bindings) {
    const ref = need(reference, "reference MIS");
    const redacted = need(ref.redacted, "redacted layout");
    referenceTemplate = buildRecreatedTemplate(redacted, bindings, {
      name: "Recreated MIS",
    });
    return Promise.resolve();
  },

  async recognition() {
    const s = need(session, "session");
    const p = await ensurePrepared();
    // A sensible month to offer for a sheet that names none: the one after the company's
    // latest, else the latest loaded, else last calendar month.
    const now = new Date();
    const lastMonth = addMonths(
      periodId(now.getUTCFullYear(), now.getUTCMonth() + 1),
      -1,
    );
    const latestLoaded = p.periods.at(-1) ?? null;
    const suggested =
      s.memory.latestPeriod !== null
        ? addMonths(s.memory.latestPeriod as PeriodId, 1)
        : (latestLoaded ?? lastMonth);
    return {
      hasBalances: p.facts.length > 0,
      usable: p.facts.length > 0 || p.bills.length > 0 || p.pay.length > 0,
      unrecognised: p.unrecognised.length,
      needsPeriod: p.needsPeriod.map((n) => ({
        key: n.key,
        fileName: n.fileName,
        sheet: n.sheet,
      })),
      suggestedPeriod: suggested,
    };
  },

  async classificationInput(): Promise<ClassifySheetsInput | null> {
    const p = await ensurePrepared();
    const r = need(redactor, "session");
    classificationRefs.clear();
    const cut = (t: string) => t.slice(0, 200);
    const sheets: ClassifySheetsInput["sheets"][number][] = [];
    for (const u of p.unrecognised.slice(0, 60)) {
      const grid = files
        .find((x) => x.fileId === u.fileId)
        ?.sheets?.find((g) => g.name === u.sheet);
      if (grid === undefined || u.profile.columns.length === 0) continue;
      // The same builder every outbound payload uses: text redacted, title lines never sent.
      const out = await buildOutboundSheet({
        fileId: u.fileId,
        grid,
        profile: u.profile,
        redactor: r,
        caps: { sampleRowsPerSheet: 15, distinctValuesPerColumn: 0 },
        sheetKind: "other",
      });
      const ref = `s${sheets.length.toString()}`;
      classificationRefs.set(ref, sheetKey(u.fileId, u.sheet));
      sheets.push({
        ref,
        name: cut(out.sheet),
        titleLines: [],
        headers: out.columns.slice(0, 80).map((c) => cut(c.header)),
        types: out.columns.slice(0, 80).map((c) => c.type.slice(0, 20)),
        samples: out.sample
          .slice(0, 15)
          .map((row) => row.slice(0, 80).map((v) => cut(v ?? ""))),
      });
    }
    return sheets.length === 0 ? null : { sheets };
  },

  applyClassification(answers: ClassifySheetsOutput["sheets"]) {
    for (const a of answers) {
      const key = classificationRefs.get(a.ref);
      if (key !== undefined) guidance.classified[key] = a.report_type;
    }
    prepared = null;
    step = null;
    return Promise.resolve();
  },

  setPeriods(periods) {
    guidance.periods = { ...guidance.periods, ...(periods as Record<string, PeriodId>) };
    prepared = null;
    step = null;
    return Promise.resolve();
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
    return await toMapResult(step);
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
    const template = referenceTemplate ?? s.memory.templateSpec ?? MONTHLY_FINANCIAL_MIS;
    const out = await computeAndRender(conn, p, {
      mappings: finalMappings,
      prior: s.memory.priorBalances,
      fyStartMonth: s.company.fyStartMonth,
      period,
      template,
      companyName: s.company.name,
      currencySymbol: s.company.currencySymbol,
      labelText,
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
      referenceTemplate !== null ||
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
            templateSpec: template,
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

  async chatStart() {
    const s = need(session, "session");
    const p = await ensurePrepared();
    const rules = s.memory.mappingRules;
    const mapped = mapStep(p, {
      companyRules: rules?.rules ?? [],
      accountRules: s.memory.accountRules,
      library: s.library,
      fuzzyThreshold: s.fuzzyThreshold,
      previous:
        rules === null ? null : new Map(rules.rules.map((r) => [r.ledgerKey, r.head])),
      displayName: display,
    });
    const tables = chatTables(p, mapped.mappings, (code) =>
      isHeadCode(code) ? head(code).name : code,
    );
    if (chatDuck !== null) await chatDuck.db.terminate();
    const opened = await openDuck();
    chatDuck = opened;
    await loadChatTables(opened.conn, tables);
    return { balances: tables.balances.length, bills: tables.bills.length };
  },

  async chatQuery(sql, caps) {
    const duck = need(chatDuck, "chat session");
    const r = need(redactor, "session");
    return runChatQuery(duck.conn, sql, {
      maxRows: caps.rowsPerRound,
      maxBytes: caps.bytesPerRound,
      timeoutMs: caps.queryTimeoutMs,
      redactText: (t) => r.redactText(t),
    });
  },

  displayNames(tokens) {
    return Promise.resolve(
      Object.fromEntries(tokens.map((t) => [t, redactor?.rehydrate(t).name ?? null])),
    );
  },

  async clear() {
    if (chatDuck !== null) await chatDuck.db.terminate();
    chatDuck = null;
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
    reference = null;
    referenceTemplate = null;
    guidance = { periods: {}, classified: {} };
    classificationRefs.clear();
  },

  dropReference() {
    reference = null;
    referenceTemplate = null;
    return Promise.resolve();
  },
};

Comlink.expose(api);
