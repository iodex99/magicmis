import Link from "next/link";
import { z } from "zod";

import { input, num, td, th } from "@/components/Flash";
import { Panel } from "@/components/ui";
import { listJobs } from "@/server/console";
import { db } from "@/server/runtime";
import { requireAdmin } from "@/server/session";

export const metadata = { title: "Jobs" };
export const dynamic = "force-dynamic";

/** SPEC §26 jobs inspector: find jobs by state, type or account. */
export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; type?: string; account?: string }>;
}) {
  await requireAdmin();
  const p = await searchParams;
  const account = z
    .uuid()
    .optional()
    .catch(undefined)
    .parse(p.account || undefined);
  const jobs = await listJobs(db(), {
    ...(p.state ? { state: p.state } : {}),
    ...(p.type ? { type: p.type } : {}),
    ...(account === undefined ? {} : { accountId: account }),
  });
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-neutral-900">Jobs</h1>
      <form method="get" className="flex flex-wrap items-end gap-2 text-sm">
        <label className="flex flex-col">
          State
          <input name="state" defaultValue={p.state ?? ""} className={input} />
        </label>
        <label className="flex flex-col">
          Type
          <input name="type" defaultValue={p.type ?? ""} className={input} />
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
          Filter
        </button>
      </form>
      <Panel>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                {[
                  "Created",
                  "Type",
                  "Tier",
                  "State",
                  "Price",
                  "Captured",
                  "AI cost (paise)",
                  "Failure",
                ].map((h) => (
                  <th key={h} className={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-t border-neutral-100">
                  <td className={td}>
                    <Link href={`/jobs/${j.id}`} className="text-accent-700 underline">
                      {j.created_at.toISOString().slice(0, 16).replace("T", " ")}
                    </Link>
                  </td>
                  <td className={td}>{j.type}</td>
                  <td className={td}>{j.tier}</td>
                  <td className={td}>{j.state}</td>
                  <td className={num}>{j.price_credits ?? "—"}</td>
                  <td className={num}>{j.captured_credits ?? "—"}</td>
                  <td className={num}>{j.actual_ai_cost_paise}</td>
                  <td className={td}>{j.failure_class ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
