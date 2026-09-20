import "server-only";

import {
  classifySheets,
  extractReferenceLayout as bindLayoutWithAi,
  jobAiContext,
  mapLedgers,
  runJobAiStage,
  type ClassifySheetsInput,
  type ClassifySheetsOutput,
} from "@magicmis/ai";
import { addMonths, periodId, type PeriodId } from "@magicmis/core/time";
import {
  detectSourceFinancialYear,
  gateOutcome,
  type CheckResult,
} from "@magicmis/engine";
import { saveAccountRules } from "@magicmis/engine/server";
import { primaryOf } from "@magicmis/tally";
import {
  extractReferenceLayout,
  readSourceFile,
  redactReferenceLayout,
  sheetsToXlsx,
  SOURCE_REFUSAL_MESSAGES,
} from "@magicmis/ingest";
import {
  advanceJob,
  bringDashboardUpToDate,
  completeJob,
  DashboardError,
  failJob,
  heartbeatJob,
  loadStageOutput,
  loadUploadBytes,
  recordLibraryVotes,
  recordUploadPeriods,
  saveStageOutput,
  uploadLimits,
  type DashboardUpdate,
  type ReadPurpose,
} from "@magicmis/jobs";
import {
  applyNormalSides,
  computeAndRender,
  mapStep,
  nextRules,
  prepare,
  sheetKey,
  validate,
  type PipelineFile,
  type PrepareGuidance,
  type Prepared,
} from "@magicmis/pipeline";
import {
  buildOutboundSheet,
  isPartyColumn,
  Redactor,
  TOKEN_PATTERN,
} from "@magicmis/redact";
import {
  aiHeadList,
  applyAiMappings,
  HEADS_VERSION,
  normaliseName,
  type Mapping,
} from "@magicmis/semantic";
import {
  applyAiBindings,
  bindReferenceLayout,
  buildRecreatedTemplate,
  MONTHLY_FINANCIAL_MIS,
  referenceLayoutAiInput,
  unboundRefs,
  type RowBinding,
  type TemplateSpec,
} from "@magicmis/templates";
import { readConfig } from "@magicmis/db/config";
import type { Pool } from "pg";
import { z } from "zod";

import { TIER_LABELS } from "@/lib/actions";

import { aiTransport } from "./ai";
import { jobSession, type JobSession } from "./companies";
import { openServerDuck } from "./duck";
import { keyWrapper, outputStore } from "./runtime";

/**
 * A setup or refresh, run entirely on the server (ADR 0032).
 *
 * The customer uploads, sees the price, presses one button, and receives a workbook. Every step
 * the browser used to run — reading files, recognising sheets, mapping ledgers, computing,
 * checking, rendering — happens here, and nothing waits on the customer in between: sheets
 * nothing can place are set aside, AI is asked when rules run out, a missing month is assumed and
 * said, unmatched ledgers go to an Unmapped line with a warning, and data problems arrive as
 * warnings on a delivered workbook (ADR 0031).
 *
 * Claude still never produces a figure (SPEC §2.7): it names sheet types and proposes heads;
 * every number comes from the engine. What Claude receives is redacted by the same outbound
 * builder as before, now running here.
 */

export interface RunOutcome {
  readonly status: "completed" | "failed" | "needs_quote";
  readonly message: string | null;
  readonly capturedCredits: string;
  readonly outputId: string | null;
  readonly fileName: string | null;
  readonly checks: readonly CheckResult[];
  readonly notices: readonly string[];
  readonly quoteCredits?: string;
  /** What happened to the dashboard after a completed run (ADR 0047). */
  readonly dashboard?: DashboardUpdate;
}

export interface JobSources {
  readonly uploads: readonly string[];
  readonly reference: string | null;
}

const NOTHING_USABLE =
  "We couldn't find account balances in these files. Add a trial balance exported from your accounting software (Excel, CSV or PDF all work) and run it again.";

const MAX_AI_LEDGERS = 2000;

/** The one notice that has to name a month in words (ADR 0035). */
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const monthLabel = (p: PeriodId): string =>
  new Date(`${p}-01T00:00:00Z`).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

class NeedsQuote extends Error {
  constructor(readonly credits: string) {
    super("needs_quote");
  }
}

/** Read every uploaded file of a job into pipeline files. Unreadable files are skipped. */
export async function loadJobFiles(
  pool: Pool,
  accountId: string,
  uploadIds: readonly string[],
  /** Why the files are being opened; written to each file's read log (ADR 0047). */
  reason: { purpose: ReadPurpose; jobId?: string | null },
): Promise<{ files: PipelineFile[]; skipped: { name: string; message: string }[] }> {
  const wrapper = keyWrapper();
  const store = await outputStore();
  const limits = await uploadLimits(pool);
  const files: PipelineFile[] = [];
  const skipped: { name: string; message: string }[] = [];
  for (const id of uploadIds) {
    const { upload, bytes } = await loadUploadBytes(pool, wrapper, store, {
      accountId,
      uploadId: id,
      purpose: reason.purpose,
      jobId: reason.jobId ?? null,
    });
    const read = await readSourceFile(upload.fileName, new Uint8Array(bytes), {
      maxEntries: 10_000,
      maxUncompressedBytes: limits.maxFileBytes * 20,
      maxRatio: 200,
    });
    if (!read.ok) {
      skipped.push({
        name: upload.fileName,
        message: SOURCE_REFUSAL_MESSAGES[read.reason],
      });
      continue;
    }
    files.push({
      fileId: upload.id,
      name: upload.fileName,
      bytes: new Uint8Array(bytes),
      sheets: read.sheets,
    });
  }
  return { files, skipped };
}

export async function jobSources(pool: Pool, jobId: string): Promise<JobSources> {
  const r = await pool.query<{ stage_checkpoints: Record<string, unknown> }>(
    `select stage_checkpoints from jobs where id = $1`,
    [jobId],
  );
  const cp = r.rows[0]?.stage_checkpoints ?? {};
  const uploads = Array.isArray(cp["source_uploads"])
    ? cp["source_uploads"].filter((x): x is string => typeof x === "string")
    : [];
  const reference =
    typeof cp["reference_upload"] === "string" ? cp["reference_upload"] : null;
  return { uploads, reference };
}

export async function runJobOnServer(
  pool: Pool,
  input: { accountId: string; jobId: string; tier: keyof typeof TIER_LABELS },
): Promise<RunOutcome> {
  const { accountId, jobId } = input;
  const job = await pool.query<{ company_id: string; type: string; state: string }>(
    `select company_id, type, state from jobs where id = $1 and account_id = $2`,
    [jobId, accountId],
  );
  const row = job.rows[0];
  if (row === undefined) throw new Error("job not found");
  const companyId = row.company_id;
  const notices: string[] = [];
  const notice = (text: string) => {
    if (!notices.includes(text)) notices.push(text);
  };
  const step = async (to: Parameters<typeof advanceJob>[1]["to"]) => {
    await advanceJob(pool, { accountId, jobId, to });
    await heartbeatJob(pool, { accountId, jobId });
  };
  const fail = async (message: string, platform = true): Promise<RunOutcome> => {
    const r = await failJob(pool, {
      accountId,
      jobId,
      failureClass: platform ? "platform_fault" : "data_fault",
      code: "server_run",
      detail: message,
      reportedBy: "server",
    });
    return {
      status: "failed",
      message,
      capturedCredits: r.captured.toString(),
      outputId: null,
      fileName: null,
      checks: [],
      notices,
    };
  };

  // A saved layout that cannot be read stops the run before it changes anything, and the hold
  // is released: running on the standard layout instead would store it over the company's own.
  const UNREADABLE =
    "This company's saved layout could not be read, so nothing was run or changed and no credits were charged. Contact support and we will put it right.";
  const unreadable = (error: unknown): error is DashboardError => {
    if (!(error instanceof DashboardError) || error.code !== "unreadable") return false;
    // Schema paths and messages only: no figure or name from the company's data.
    console.error("layout_unreadable: a saved company layout does not parse", {
      companyId,
      jobId,
      issues: error.errors,
    });
    return true;
  };
  let session: Awaited<ReturnType<typeof jobSession>>;
  try {
    session = await jobSession(pool, accountId, companyId);
  } catch (error) {
    if (unreadable(error)) return fail(UNREADABLE);
    throw error;
  }
  if (session === null) return fail("This company could not be opened.");
  const wrapper = keyWrapper();
  const redactor = await Redactor.create(Buffer.from(session.redactionKey, "base64"));
  const display = (token: string): string => redactor.rehydrate(token).name ?? token;
  const aiScope = (stage: string) => ({ accountId, companyId, jobId, stage });

  /** One AI stage, checkpointed so a retry never pays twice; null when AI cannot answer. */
  const ai = async <T>(stage: string, run: () => Promise<T>): Promise<T | null> => {
    const cached = await loadStageOutput(pool, wrapper, aiScope(stage));
    if (cached !== null) return cached as T;
    try {
      const value = await run();
      await saveStageOutput(pool, wrapper, { ...aiScope(stage), output: value });
      return value;
    } catch (error) {
      if (error instanceof NeedsQuote) throw error;
      return null;
    }
  };
  const aiContext = () => jobAiContext(pool, aiTransport(), jobId);

  try {
    const sources = await jobSources(pool, jobId);
    await step("preflight");
    const loaded = await loadJobFiles(pool, accountId, sources.uploads, {
      purpose: "run",
      jobId,
    });
    for (const s of loaded.skipped) notice(`${s.name} was left out: ${s.message}`);

    await step("profiling");
    const guidance: {
      periods: Record<string, PeriodId>;
      classified: Record<string, NonNullable<PrepareGuidance["classified"]>[string]>;
      bestEffort: boolean;
    } = { periods: {}, classified: {}, bestEffort: false };
    const run = () =>
      prepare(loaded.files, redactor, session.company.dateOrder, guidance);
    let p = await run();

    await step("classifying");
    if (p.facts.length === 0 && p.unrecognised.length > 0) {
      // How many sample rows may leave for the model is an operator's decision, not a
      // literal (SPEC §0.5). It was hardcoded to 15 here, so lowering it to reduce what
      // is exposed had no effect on the one server path that actually sends a sample.
      const sampleRows = await readConfig(
        pool,
        "ai.payload_caps",
        z.object({ sample_rows_per_sheet: z.number().int().positive() }).loose(),
      ).then((c) => c.sample_rows_per_sheet);
      const refs = new Map<string, string>();
      const sheets: ClassifySheetsInput["sheets"][number][] = [];
      const cut = (t: string) => t.slice(0, 200);
      for (const u of p.unrecognised.slice(0, 60)) {
        const grid = loaded.files
          .find((f) => f.fileId === u.fileId)
          ?.sheets?.find((g) => g.name === u.sheet);
        if (grid === undefined || u.profile.columns.length === 0) continue;
        /*
         * These are the sheets nothing recognised, which is why they are being classified at
         * all. Since we do not know what they hold, they are redacted as though they hold
         * people (ADR 0053).
         *
         * `sheetKind: "other"` was passed here, which narrows the person-name heuristic to the
         * literal headers "employee name", "emp name" and "staff name". A column headed simply
         * "Name", or "Particulars", "Party", "Customer" or "Vendor", went to the model in
         * clear — and the privacy notice promises in terms that party and employee names are
         * replaced with tokens before any part of a file is sent. "payroll" is the wider
         * setting, which is the right default when the alternative is guessing wrong about
         * personal data.
         */
        const partyColumns = new Set(
          u.profile.columns.flatMap((c, i) => (isPartyColumn(c.header) ? [i] : [])),
        );
        const out = await buildOutboundSheet({
          fileId: u.fileId,
          grid,
          profile: u.profile,
          redactor,
          caps: { sampleRowsPerSheet: sampleRows, distinctValuesPerColumn: 0 },
          sheetKind: "payroll",
          partyColumns,
        });
        const ref = `s${sheets.length.toString()}`;
        refs.set(ref, sheetKey(u.fileId, u.sheet));
        sheets.push({
          ref,
          name: cut(out.sheet),
          titleLines: [],
          headers: out.columns.slice(0, 80).map((c) => cut(c.header)),
          types: out.columns.slice(0, 80).map((c) => c.type.slice(0, 20)),
          samples: out.sample
            .slice(0, 15)
            .map((r) => r.slice(0, 80).map((v) => cut(v ?? ""))),
        });
      }
      if (sheets.length > 0) {
        const answer = await ai<ClassifySheetsOutput>(
          "sheet_classification",
          async () => {
            const outcome = await runJobAiStage(await aiContext(), (c) =>
              classifySheets(c, { sheets }),
            );
            if (outcome.status === "paused")
              throw new NeedsQuote(outcome.quoteCredits.toString());
            return outcome.value.output;
          },
        );
        if (answer !== null) {
          for (const a of answer.sheets) {
            const key = refs.get(a.ref);
            if (key !== undefined) guidance.classified[key] = a.report_type;
          }
          p = await run();
        }
      }
    }
    const usable = (x: Prepared) =>
      x.facts.length > 0 || x.bills.length > 0 || x.pay.length > 0;
    if (!usable(p)) {
      guidance.bestEffort = true;
      p = await run();
      if (p.guessed > 0)
        notice(
          "We couldn't tell for certain which sheets hold your balances, so we used the ones that looked most like them. Check the figures and the warnings.",
        );
    }
    if (p.needsPeriod.length > 0) {
      const now = new Date();
      const lastMonth = addMonths(
        periodId(now.getUTCFullYear(), now.getUTCMonth() + 1),
        -1,
      );
      const assumed =
        session.memory.latestPeriod !== null
          ? addMonths(session.memory.latestPeriod as PeriodId, 1)
          : (p.periods.at(-1) ?? lastMonth);
      for (const n of p.needsPeriod) {
        guidance.periods[n.key] = assumed;
        notice(
          `${n.fileName} doesn't say which month it covers, so it was reported as ${monthLabel(assumed)}. If that's wrong, rename the file with its month (for example "TB ${monthLabel(assumed)}") and run it again.`,
        );
      }
      p = await run();
    }
    if (!usable(p)) return await fail(NOTHING_USABLE);
    if (p.unrecognised.length > 0)
      notice(
        `${p.unrecognised.length.toString()} ${p.unrecognised.length === 1 ? "sheet was" : "sheets were"} not needed for the MIS and ${p.unrecognised.length === 1 ? "was" : "were"} left out.`,
      );

    await step("mapping");
    const rules = session.memory.mappingRules;
    const mapped = mapStep(p, {
      companyRules: rules?.rules ?? [],
      accountRules: session.memory.accountRules,
      library: session.library,
      fuzzyThreshold: session.fuzzyThreshold,
      previous:
        rules === null ? null : new Map(rules.rules.map((r) => [r.ledgerKey, r.head])),
      displayName: display,
    });
    let mappings: Mapping[] = [...mapped.mappings];
    if (mapped.unmatched.length > 0) {
      const batch = mapped.unmatched.slice(0, MAX_AI_LEDGERS);
      const ledgers: { ref: string; name: string; group_path: string[] }[] = [];
      for (const u of batch)
        ledgers.push({
          ref: u.ref,
          name: await redactor.redactText(u.name),
          group_path: await Promise.all(u.groupPath.map((g) => redactor.redactText(g))),
        });
      const answer = await ai("ledger_mapping", async () => {
        const outcome = await runJobAiStage(await aiContext(), (c) =>
          mapLedgers(c, { heads: aiHeadList(), ledgers }),
        );
        if (outcome.status === "paused")
          throw new NeedsQuote(outcome.quoteCredits.toString());
        return outcome.value.output;
      });
      const refs = new Map(mapped.unmatched.map((u) => [u.ref, u.ledgerKey]));
      mappings = applyAiMappings(
        {
          mappings: mapped.mappings,
          unmatched: mapped.unmatched.map((u) => ({
            ledgerKey: u.ledgerKey,
            ledger: { groupPath: u.groupPath, name: u.name },
          })),
        },
        answer?.mappings ?? [],
        refs,
      );
      const unmapped = mappings.filter((m) => m.head === "UNMAPPED").length;
      if (unmapped > 0)
        notice(
          `${unmapped.toString()} ${unmapped === 1 ? "ledger" : "ledgers"} could not be matched to a line and ${unmapped === 1 ? "is" : "are"} shown as Unmapped in the workbook.`,
        );
    }

    // A reference MIS, bound by rules then AI, accepted as proposed.
    let template: TemplateSpec = session.memory.templateSpec ?? MONTHLY_FINANCIAL_MIS;
    let referenceUsed = false;
    if (row.type === "reference_mis_recreate" && sources.reference !== null) {
      try {
        const ref = await loadJobFiles(pool, accountId, [sources.reference], {
          purpose: "run",
          jobId,
        });
        const file = ref.files[0];
        if (file !== undefined) {
          const bytes = /^PK/u.test(
            Buffer.from(file.bytes.subarray(0, 2)).toString("latin1"),
          )
            ? file.bytes
            : sheetsToXlsx(file.sheets ?? []);
          const extracted = await extractReferenceLayout(bytes);
          const redacted = await redactReferenceLayout(extracted.layout, (t) =>
            redactor.redactText(t),
          );
          const byRules = bindReferenceLayout(redacted);
          let bindings: RowBinding[] = byRules;
          if (unboundRefs(byRules).length > 0) {
            const answer = await ai<{ bindings: RowBinding[] }>(
              "reference_layout",
              async () => {
                const outcome = await runJobAiStage(await aiContext(), (c) =>
                  bindLayoutWithAi(c, referenceLayoutAiInput(redacted, byRules)),
                );
                if (outcome.status === "paused")
                  throw new NeedsQuote(outcome.quoteCredits.toString());
                return {
                  bindings: applyAiBindings(redacted, byRules, outcome.value.output.rows),
                };
              },
            );
            if (answer !== null) bindings = answer.bindings;
          }
          template = buildRecreatedTemplate(redacted, bindings, {
            name: "Recreated MIS",
          });
          referenceUsed = true;
        }
      } catch (error) {
        /*
         * A quote is not a failure and must not be swallowed here (ADR 0053).
         *
         * `runJobAiStage` has already released the hold and moved the job to `needs_quote`
         * by the time it throws, so carrying on walked into an illegal transition at the
         * next step and surfaced as a generic error. The customer lost the quote and the
         * stages already paid for, because the checkpoint is keyed to the job that pressing
         * the button again replaces.
         */
        if (error instanceof NeedsQuote) throw error;
        notice(
          session.memory.templateSpec === null
            ? "Your MIS layout couldn't be read, so the standard layout is used."
            : "Your MIS layout couldn't be read, so this company keeps the layout it already has.",
        );
      }
    }

    await step("computing");
    const confirmed = mappings.map((m) => ({
      ledgerKey: m.ledgerKey,
      head: m.head,
      applyToAllCompanies: false,
    }));
    const signed: Prepared = {
      ...p,
      facts: applyNormalSides(p.facts, mappings, new Set(p.unsigned)),
    };
    const period = (signed.periods.at(-1) ?? "") as PeriodId;
    const first =
      (session.memory.latestPeriod === null
        ? signed.periods[0]
        : addMonths(session.memory.latestPeriod as PeriodId, 1)) ?? period;
    const previousPeriod = session.memory.latestPeriod as PeriodId | null;
    const closings = new Map(
      session.memory.priorBalances
        .filter((b) => b.period === previousPeriod)
        .map((b) => [b.ledgerKey, BigInt(b.closing)]),
    );
    // ADR 0035: an export on a different financial year from the company stays invisible until a
    // month of revenue comes out as the whole year with a minus sign, so it is said plainly.
    const sourceYear = detectSourceFinancialYear(
      signed.facts,
      (fact) => primaryOf(fact.groupPath[0] ?? "")?.statement === "profit_and_loss",
    );
    if (sourceYear !== null && sourceYear.startMonth !== session.company.fyStartMonth)
      notice(
        [
          `These files run a financial year starting in ${MONTH_NAMES[sourceYear.startMonth - 1] ?? ""},`,
          `but this company is set to start in ${MONTH_NAMES[session.company.fyStartMonth - 1] ?? ""}.`,
          "Until they match, the first month of each year reads as a whole year.",
          "Change the year under Reporting conventions on the company page, then run the month again.",
        ].join(" "),
      );
    const namesByKey = new Map(signed.facts.map((f) => [f.ledgerKey, f.name]));
    const labelText = (label: string) => label.replace(TOKEN_PATTERN, (t) => display(t));
    const duck = await openServerDuck();
    let out;
    try {
      out = await computeAndRender(duck, signed, {
        mappings,
        prior: session.memory.priorBalances,
        fyStartMonth: session.company.fyStartMonth,
        period,
        template,
        companyName: session.company.name,
        currencySymbol: session.company.currencySymbol,
        labelText,
        tierLabel: TIER_LABELS[input.tier],
        snapshotVersion:
          period === session.memory.latestPeriod
            ? (session.memory.latestVersion ?? 0) + 1
            : 1,
        generatedAt: new Date(),
        displayName: (key) =>
          display(namesByKey.get(key) ?? key.split(" > ").at(-1) ?? key),
        ageingBuckets: session.validation.ageingBuckets,
        validation: (cube) =>
          validate(cube, signed, {
            config: {
              tbTolerancePaise: BigInt(session.validation.tbTolerancePaise),
              reconciliationTolerancePaise: BigInt(
                session.validation.reconciliationTolerancePaise,
              ),
              signSanityHeads: session.validation.signSanityHeads,
              ageingBuckets: session.validation.ageingBuckets,
            },
            // Unmapped balances are reported, never a reason to withhold (ADR 0031).
            unmappedAccepted: true,
            expected: { from: first, to: period },
            previousSnapshot:
              previousPeriod === null ? null : { period: previousPeriod, closings },
            netProfitStatements: [],
          }),
      });
    } finally {
      duck.close();
    }

    await step("validating");
    const checks = [...out.checks, out.v11];
    const gate = gateOutcome(checks);
    if (!gate.ok) {
      const first = checks.find((c) => c.status === "fail" && c.severity === "blocking");
      const failed = await fail(
        first?.message ?? "The workbook could not be verified, so it was not delivered.",
      );
      return { ...failed, checks };
    }

    await step("rendering");
    const names = new Map(signed.facts.map((f) => [f.ledgerKey, f.name]));
    const nextBlueprint = nextRules(
      session.memory.mappingRules,
      mappings,
      confirmed,
      names,
      HEADS_VERSION,
    );
    const changed =
      referenceUsed ||
      session.memory.mappingRules === null ||
      JSON.stringify(session.memory.mappingRules.rules) !==
        JSON.stringify(nextBlueprint.rules.rules);
    const workbook = Buffer.from(await out.rendered.workbook.xlsx.writeBuffer());
    const completed = await completeJob(pool, wrapper, {
      accountId,
      jobId,
      snapshot: out.snapshot,
      blueprint: changed
        ? {
            templateSpec: template,
            recipe: {
              schemaVersion: 1,
              sources: Object.entries(signed.fingerprints).map(([role, sig], i) => ({
                id: `s${i.toString()}`,
                role: role.split(":")[0] ?? "trial_balance",
                sheetSignature: sig,
                columns: {},
                sign: "split_columns",
              })),
              filters: [],
              mappingRulesVersion: nextBlueprint.rules.schemaVersion,
              period: {
                fyStartMonth: session.company.fyStartMonth,
                granularity: "month",
              },
              dimensions: [],
              metrics: [{ id: "revenue", comparisons: ["mom", "yoy", "ytd"] }],
            },
            mappingRules: nextBlueprint.rules,
            dashboardSpec: null,
            materiality: {
              pct: template.materiality.pct,
              absPaise: template.materiality.absPaise,
            },
            sourceFingerprints: signed.fingerprints,
          }
        : null,
      // Only recreating a reference MIS asks for a new layout. Every other run keeps the
      // company's own, read again at the moment of writing (ADR 0045).
      layout: referenceUsed ? "replace" : "keep",
      output: { fileName: out.rendered.fileName, bytes: workbook },
      outputStore: await outputStore(),
    });
    const accountRules = nextBlueprint.accountRules.map((r) => ({
      pattern: normaliseName(r.pattern),
      head: r.head,
    }));
    await saveAccountRules(pool, wrapper, { accountId, companyId, rules: accountRules });
    await recordLibraryVotes(pool, wrapper, { accountId, rules: accountRules });
    await pool.query(
      `update jobs set stage_checkpoints = stage_checkpoints || jsonb_build_object('notices', $2::jsonb) where id = $1`,
      [jobId, JSON.stringify(notices)],
    );
    // Each file remembers the months it fed, so its owner can untick it and have exactly those
    // months leave the dashboard (ADR 0047). Recorded only for a run that delivered.
    const fed = new Map<string, string[]>();
    for (const report of p.reports)
      if (report.period !== null)
        fed.set(report.fileId, [...(fed.get(report.fileId) ?? []), report.period]);
    await recordUploadPeriods(pool, { accountId, periods: fed });

    // One press: the new figures go to the dashboard too, as its own priced action.
    const dashboard = await bringDashboardUpToDate(pool, wrapper, {
      accountId,
      companyId,
      runJobId: jobId,
    });
    return {
      status: "completed",
      message: null,
      capturedCredits: completed.captured.toString(),
      outputId: completed.outputId,
      fileName: out.rendered.fileName,
      checks,
      notices,
      dashboard,
    };
  } catch (error) {
    if (unreadable(error)) return fail(UNREADABLE);
    if (error instanceof NeedsQuote)
      return {
        status: "needs_quote",
        message:
          "This job needs more analysis than its price covers. Review the quote to continue.",
        capturedCredits: "0",
        outputId: null,
        fileName: null,
        checks: [],
        notices,
        quoteCredits: error.credits,
      };
    /*
     * Anything else is still ours to settle before it leaves (ADR 0053).
     *
     * Rethrowing alone left the job in whatever running state it had reached, with its credits
     * held until the two-hour reservation lapsed, while the screen told the customer the run
     * had failed and nothing was charged. Pressing the button again minted a fresh job and a
     * second hold against a balance the first one was still sitting on.
     *
     * A platform fault releases the hold and charges nothing, which is what this is: the
     * customer did nothing wrong and we could not finish. If settling itself fails there is
     * nothing further to try, and the sweeper remains the backstop, so the original error is
     * what surfaces either way.
     */
    try {
      return await fail(
        "Something went wrong while building this. Nothing has been charged — please try again.",
      );
    } catch {
      throw error;
    }
  }
}

/** Counts-only pricing inputs computed from a job's own uploads (SPEC §12, now server-side). */
export async function pricingFromUploads(
  pool: Pool,
  accountId: string,
  session: JobSession,
  uploadIds: readonly string[],
  referenceId: string | null,
) {
  const { files } = await loadJobFiles(pool, accountId, uploadIds, {
    purpose: "pricing",
  });
  const redactor = await Redactor.create(Buffer.from(session.redactionKey, "base64"));
  const p = await prepare(files, redactor, session.company.dateOrder, {});
  let referenceSheets = 0;
  if (referenceId !== null) {
    const ref = await loadJobFiles(pool, accountId, [referenceId], {
      purpose: "pricing",
    });
    referenceSheets = ref.files[0]?.sheets?.length ?? 0;
  }
  return {
    size: { ...p.size, referenceMisSheets: referenceSheets },
    fingerprints: p.fingerprints,
  };
}
