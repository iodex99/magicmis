import { notFound } from "next/navigation";
import { z } from "zod";

import { num, td, th } from "@/components/Flash";
import { Panel } from "@/components/ui";
import { jobDetail } from "@/server/console";
import { db } from "@/server/runtime";
import { requireAdmin } from "@/server/session";

export const metadata = { title: "Job" };
export const dynamic = "force-dynamic";

/** SPEC §26: state timeline, stages, ai_calls and charge outcome. No decrypted content. */
export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const detail = await jobDetail(db(), id);
  if (detail === null) notFound();
  const { job, history, calls, ledger } = detail;
  const facts: [string, string][] = [
    ["Account", job.account_id],
    ["Company", job.company_id ?? "—"],
    ["Type", job.type],
    ["Tier / delivery", `${job.tier} / ${job.delivery_mode}`],
    ["State", job.state],
    ["Price", job.price_credits ?? "—"],
    ["Quote", job.quote_id ?? "—"],
    ["Captured", job.captured_credits ?? "—"],
    ["Estimated AI cost (µ$)", job.estimated_ai_cost_micro_usd ?? "—"],
    [
      "Actual AI cost (µ$ / paise)",
      `${job.actual_ai_cost_micro_usd} / ${job.actual_ai_cost_paise}`,
    ],
    [
      "Failure",
      job.failure_class === null
        ? "—"
        : `${job.failure_class} · ${job.failure_code ?? ""}`,
    ],
    ["Checkpoints", job.checkpointKeys.join(", ")],
  ];
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-neutral-900">Job {job.id}</h1>
      <Panel>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          {facts.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-neutral-600">{k}</dt>
              <dd className="font-mono text-xs">{v}</dd>
            </div>
          ))}
        </dl>
        {job.failure_detail === null ? null : (
          <p className="mt-3 text-sm text-neutral-700">{job.failure_detail}</p>
        )}
      </Panel>
      <Panel title="State timeline">
        <ol className="flex flex-col gap-1 text-sm" data-testid="job-timeline">
          <li className="font-mono text-xs">{job.created_at.toISOString()} · created</li>
          {history.map((h, i) => (
            <li key={i} className="font-mono text-xs">
              {h.at} · {h.from ?? "?"} → {h.state}
            </li>
          ))}
        </ol>
      </Panel>
      <Panel title="AI calls">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                {[
                  "At",
                  "Stage",
                  "Prompt",
                  "Requested",
                  "Used",
                  "Fallback",
                  "In",
                  "Out",
                  "Cache read",
                  "Cache write",
                  "µ$",
                  "Paise",
                  "Batch",
                  "Status",
                ].map((h) => (
                  <th key={h} className={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {calls.map((c, i) => (
                <tr key={i} className="border-t border-neutral-100">
                  <td className={`${td} text-xs`}>
                    {c.created_at.toISOString().slice(11, 19)}
                  </td>
                  <td className={td}>{c.stage}</td>
                  <td className={`${td} text-xs`}>{c.prompt_version}</td>
                  <td className={`${td} font-mono text-xs`}>{c.model_requested}</td>
                  <td className={`${td} font-mono text-xs`}>{c.model_used}</td>
                  <td className={`${td} font-mono text-xs`}>{c.fallback_from ?? ""}</td>
                  <td className={num}>{c.input_tokens}</td>
                  <td className={num}>{c.output_tokens}</td>
                  <td className={num}>{c.cache_read_input_tokens}</td>
                  <td className={num}>{c.cache_creation_input_tokens}</td>
                  <td className={num}>{c.usd_cost_micro}</td>
                  <td className={num}>{c.inr_cost_paise}</td>
                  <td className={td}>{c.is_batch ? "yes" : ""}</td>
                  <td className={td}>
                    {c.status}
                    {c.error_type === null ? "" : ` (${c.error_type})`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Charge outcome">
        <ul className="flex flex-col gap-1 text-sm">
          {ledger.map((l, i) => (
            <li key={i} className="font-mono text-xs">
              {l.created_at.toISOString()} · {l.entry_type} {l.amount}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
