import { marginReport, modelRegistryView } from "@magicmis/ai/margin";
import { formatPaise } from "@magicmis/core/format";
import { paise } from "@magicmis/core/money";
import { readConfig } from "@magicmis/db/config";
import { z } from "zod";

import { input, num, td, th } from "@/components/Flash";
import { Alert, Panel } from "@/components/ui";
import { db } from "@/server/runtime";
import { requireAdmin } from "@/server/session";

export const metadata = { title: "Margin" };
export const dynamic = "force-dynamic";

const inr = (p: bigint) =>
  `${p < 0n ? "−" : ""}₹${formatPaise(paise(p < 0n ? -p : p), { decimals: 2, style: "lakhs_crores" })}`;
const usd = (micro: bigint) => {
  const cents = (micro + 9_999n) / 10_000n; // up to the cent, never understated
  const s = cents.toString().padStart(3, "0");
  return `$${s.slice(0, -2)}.${s.slice(-2)}`;
};

const ACTIONS = [
  "data_diagnostic",
  "company_setup",
  "reference_mis_recreate",
  "monthly_refresh",
  "refresh_with_restructure",
  "dashboard_addon",
  "dashboard_refresh",
  "commentary",
  "chat_quick",
  "chat_deep",
  "chat_edit",
] as const;

/** SPEC §26: the margin dashboard, filterable by date, action, tier and account. */
export default async function MarginPage({
  searchParams,
}: {
  searchParams: Promise<{
    days?: string;
    action?: string;
    tier?: string;
    account?: string;
  }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const days = z.coerce.number().int().min(1).max(366).catch(30).parse(params.days);
  const action = z
    .enum(ACTIONS)
    .optional()
    .catch(undefined)
    .parse(params.action || undefined);
  const tier = z
    .enum(["efficient", "professional", "expert", "expert_plus"])
    .optional()
    .catch(undefined)
    .parse(params.tier || undefined);
  const account = z
    .uuid()
    .optional()
    .catch(undefined)
    .parse(params.account || undefined);
  const pool = db();
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const staleDays = await readConfig(
    pool,
    "ai.registry_stale_days",
    z.number().int().positive(),
  );
  const [report, registry] = await Promise.all([
    marginReport(pool, from, to, {
      ...(action === undefined ? {} : { actionKey: action }),
      ...(tier === undefined ? {} : { tier }),
      ...(account === undefined ? {} : { accountId: account }),
    }),
    modelRegistryView(pool, staleDays, to),
  ]);
  const flagged = report.actions.filter((a) => a.overCap);
  const stale = registry.filter((m) => m.stale);
  const gm = report.grossMargin;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[1.5rem] leading-tight font-semibold tracking-tight text-neutral-900">
        Margin
      </h1>

      <form className="flex flex-wrap items-end gap-3 text-sm" method="get">
        <label className="flex flex-col">
          Days
          <select name="days" defaultValue={days.toString()} className={input}>
            {[1, 7, 30, 90, 365].map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          Action
          <select name="action" defaultValue={action ?? ""} className={input}>
            <option value="">All</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          Tier
          <select name="tier" defaultValue={tier ?? ""} className={input}>
            <option value="">All</option>
            {["efficient", "professional", "expert", "expert_plus"].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          Account ID
          <input
            name="account"
            defaultValue={account ?? ""}
            className={`${input} w-80 font-mono`}
          />
        </label>
        <button type="submit" className="h-8 rounded-md bg-neutral-900 px-3 text-white">
          Apply
        </button>
      </form>

      {flagged.length > 0 ? (
        <Alert tone="error">
          <span data-testid="margin-flags">
            Over max AI cost ratio: {flagged.map((a) => a.actionKey).join(", ")}
          </span>
        </Alert>
      ) : null}
      {stale.length > 0 ? (
        <Alert tone="error">
          Model prices not re-verified in {staleDays} days:{" "}
          {stale.map((m) => m.modelId).join(", ")}
        </Alert>
      ) : null}

      <Panel title={`Gross margin estimate — ${gm.days.toString()} days`}>
        <dl
          className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-4"
          data-testid="gross-margin"
        >
          <dt className="text-neutral-600">Captured value</dt>
          <dd className="font-mono">{inr(gm.capturedValuePaise)}</dd>
          <dt className="text-neutral-600">AI cost</dt>
          <dd className="font-mono">{inr(gm.aiCostPaise)}</dd>
          <dt className="text-neutral-600">Payment fees</dt>
          <dd className="font-mono">{inr(gm.paymentFeesPaise)}</dd>
          <dt className="text-neutral-600">Infra cost</dt>
          <dd className="font-mono">{inr(gm.infraCostPaise)}</dd>
          <dt className="text-neutral-600">Gross margin</dt>
          <dd className={`font-mono ${gm.marginPaise < 0n ? "text-red-700" : ""}`}>
            {inr(gm.marginPaise)}
          </dd>
          <dt className="text-neutral-600">Per day</dt>
          <dd className="font-mono">{inr(gm.perDayPaise)}</dd>
          <dt className="text-neutral-600">Memory fee revenue</dt>
          <dd className="font-mono">{report.memoryFeeCredits.toString()} credits</dd>
          <dt className="text-neutral-600">Expired credits (breakage)</dt>
          <dd className="font-mono">{report.breakageCredits.toString()} credits</dd>
        </dl>
      </Panel>

      <Panel title="AI cost ratio by action">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                {[
                  "Action",
                  "Items",
                  "Captured credits",
                  "Captured value",
                  "AI cost",
                  "Ratio",
                  "p50",
                  "p90",
                  "Max",
                  "",
                ].map((h) => (
                  <th key={h} className={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.actions.map((a) => (
                <tr
                  key={a.actionKey}
                  className={`border-t border-neutral-100 ${a.overCap ? "bg-red-50" : ""}`}
                  data-testid={`margin-action-${a.actionKey}`}
                >
                  <td className={td}>{a.actionKey}</td>
                  <td className={num}>{a.jobs}</td>
                  <td className={num}>{a.capturedCredits.toString()}</td>
                  <td className={num}>{inr(a.capturedCredits * 100n)}</td>
                  <td className={num}>{inr(a.aiCostPaise)}</td>
                  <td className={num}>{a.ratio ?? "—"}</td>
                  <td className={num}>{a.p50 ?? "—"}</td>
                  <td className={num}>{a.p90 ?? "—"}</td>
                  <td className={num}>{a.maxRatio ?? "—"}</td>
                  <td className={td}>
                    {a.overCap ? <strong className="text-red-700">over</strong> : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Estimates, quotes and failures">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-4">
          <dt className="text-neutral-600">Actual ÷ estimated AI cost</dt>
          <dd className="font-mono">
            {report.estimator.actualToEstimate} ({report.estimator.underestimated}/
            {report.estimator.jobs} under)
          </dd>
          <dt className="text-neutral-600">Quote rate</dt>
          <dd className="font-mono">{report.quotes.rate}</dd>
          <dt className="text-neutral-600">Quote acceptance</dt>
          <dd className="font-mono">
            {report.quotes.acceptance} of {report.quotes.offered}
          </dd>
          <dt className="text-neutral-600">Commentary batch share</dt>
          <dd className="font-mono">{report.commentaryBatchShare}</dd>
          <dt className="text-neutral-600">Estimation misses</dt>
          <dd className="font-mono">
            {report.estimationMisses.count} ({inr(report.estimationMisses.costPaise)})
          </dd>
          <dt className="text-neutral-600">Platform-absorbed cost</dt>
          <dd className="font-mono">
            {report.absorbed.count} ({inr(report.absorbed.costPaise)})
          </dd>
          {report.failures.map((f) => (
            <div key={f.failureClass} className="contents">
              <dt className="text-neutral-600">Failure rate: {f.failureClass}</dt>
              <dd className="font-mono">
                {f.rate} ({f.jobs})
              </dd>
            </div>
          ))}
        </dl>
      </Panel>

      <Panel title="Stages">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                {[
                  "Stage",
                  "Calls",
                  "AI cost",
                  "Cache hit rate",
                  "Fallback rate",
                  "Failure rate",
                ].map((h) => (
                  <th key={h} className={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.stages.map((s) => (
                <tr
                  key={s.stage}
                  className="border-b border-neutral-100 last:border-0 hover:bg-neutral-25"
                >
                  <td className={td}>{s.stage}</td>
                  <td className={num}>{s.calls}</td>
                  <td className={num}>{usd(s.costMicroUsd)}</td>
                  <td className={num}>{s.cacheHitRate}</td>
                  <td className={num}>{s.fallbackRate}</td>
                  <td className={num}>{s.failureRate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
