import { marginReport, modelRegistryView } from "@magicmis/ai/margin";
import { formatPaise } from "@magicmis/core/format";
import { paise } from "@magicmis/core/money";
import { readConfig } from "@magicmis/db/config";
import { z } from "zod";

import { num, td, th } from "@/components/Flash";
import { Alert, Panel } from "@/components/ui";
import { db } from "@/server/runtime";
import { requireAdmin } from "@/server/session";

export const metadata = { title: "Margin" };
export const dynamic = "force-dynamic";

const inr = (p: bigint) =>
  `₹${formatPaise(paise(p), { decimals: 2, style: "lakhs_crores" })}`;
const usd = (micro: bigint) => {
  const cents = (micro + 9_999n) / 10_000n; // up to the cent, never understated
  const s = cents.toString().padStart(3, "0");
  return `$${s.slice(0, -2)}.${s.slice(-2)}`;
};

/** SPEC §26 margin screen v1: AI cost ratio per action, stage health, registry freshness. */
export default async function MarginPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const days = z.coerce.number().int().min(1).max(366).catch(30).parse(params.days);
  const pool = db();
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const staleDays = await readConfig(
    pool,
    "ai.registry_stale_days",
    z.number().int().positive(),
  );
  const [report, registry] = await Promise.all([
    marginReport(pool, from, to),
    modelRegistryView(pool, staleDays, to),
  ]);
  const flagged = report.actions.filter((a) => a.overCap);
  const stale = registry.filter((m) => m.stale);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-neutral-900">Margin</h1>
        <nav aria-label="Window" className="flex gap-3 text-sm">
          {[7, 30, 90].map((d) => (
            <a
              key={d}
              href={`/margin?days=${d.toString()}`}
              className={
                d === days
                  ? "font-semibold text-neutral-900"
                  : "text-accent-700 underline"
              }
            >
              {d} days
            </a>
          ))}
        </nav>
      </div>

      {flagged.length > 0 ? (
        <Alert tone="error">
          Over max AI cost ratio: {flagged.map((a) => a.actionKey).join(", ")}
        </Alert>
      ) : null}
      {stale.length > 0 ? (
        <Alert tone="error">
          Model prices not re-verified in {staleDays} days:{" "}
          {stale.map((m) => m.modelId).join(", ")}
        </Alert>
      ) : null}

      <Panel title="AI cost ratio by action">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                {[
                  "Action",
                  "Jobs",
                  "Captured credits",
                  "AI cost",
                  "Ratio",
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
                <tr key={a.actionKey} className="border-t border-neutral-100">
                  <td className={td}>{a.actionKey}</td>
                  <td className={num}>{a.jobs}</td>
                  <td className={num}>{a.capturedCredits.toString()}</td>
                  <td className={num}>{inr(a.aiCostPaise)}</td>
                  <td className={num}>{a.ratio ?? "—"}</td>
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
                <tr key={s.stage} className="border-t border-neutral-100">
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
        <p className="mt-3 text-sm text-neutral-700">
          Estimation misses: {report.estimationMisses.count} (
          {inr(report.estimationMisses.costPaise)}) · Platform-absorbed:{" "}
          {report.absorbed.count} ({inr(report.absorbed.costPaise)})
        </p>
      </Panel>

      <Panel title="Model registry">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                {[
                  "Model",
                  "Input $/MTok",
                  "Output $/MTok",
                  "Available",
                  "Version",
                  "Verified",
                  "Source",
                ].map((h) => (
                  <th key={h} className={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {registry.map((m) => (
                <tr key={m.modelId} className="border-t border-neutral-100">
                  <td className={`${td} font-mono`}>{m.modelId}</td>
                  <td className={num}>{usd(m.inputPricePerMTokMicroUsd)}</td>
                  <td className={num}>{usd(m.outputPricePerMTokMicroUsd)}</td>
                  <td className={td}>{m.available ? "yes" : "no"}</td>
                  <td className={num}>{m.version}</td>
                  <td className={td}>
                    {m.verifiedAt.toISOString().slice(0, 10)}
                    {m.stale ? (
                      <strong className="ml-2 text-red-700">stale</strong>
                    ) : null}
                  </td>
                  <td className={td}>
                    <a
                      href={m.sourceUrl}
                      className="text-accent-700 underline"
                      rel="noreferrer"
                    >
                      pricing
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
