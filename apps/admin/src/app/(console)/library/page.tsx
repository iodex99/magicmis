import { readConfig } from "@magicmis/db/config";
import { z } from "zod";

import { Flash, input, num, td, th } from "@/components/Flash";
import { Button, Panel } from "@/components/ui";
import { libraryCandidates, librarySearch } from "@/server/console";
import { db } from "@/server/runtime";
import { requireAdmin } from "@/server/session";

import { decideCandidateAction, removeLibraryEntryAction } from "../console-actions";

export const metadata = { title: "Mapping library" };
export const dynamic = "force-dynamic";

/**
 * SPEC §18, §26: the candidates queue (names seen across enough distinct accounts, never which
 * accounts), the library browser, and seed management. Promotion is always an admin decision.
 */
export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; ok?: string; error?: string }>;
}) {
  await requireAdmin();
  const p = await searchParams;
  const pool = db();
  const min = await readConfig(pool, "semantic.library_promotion_min_accounts", z.number().int().positive());
  const [candidates, entries] = await Promise.all([libraryCandidates(pool, min), librarySearch(pool, p.q ?? "")]);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-neutral-900">Mapping library</h1>
      <Flash searchParams={Promise.resolve(p)} />
      <Panel title={`Candidates (seen in at least ${min.toString()} accounts)`}>
        {candidates.length === 0 ? (
          <p className="text-sm text-neutral-700">No candidates waiting.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                {["Name", "Proposed head", "Accounts", ""].map((h) => (
                  <th key={h} className={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => (
                <tr key={c.id} className="border-t border-neutral-100">
                  <td className={`${td} font-mono`}>{c.normalized_name}</td>
                  <td className={td}>
                    {c.head_code} · {c.head_name}
                  </td>
                  <td className={num}>{c.distinct_account_count}</td>
                  <td className={td}>
                    <form action={decideCandidateAction} className="flex gap-2">
                      <input type="hidden" name="candidateId" value={c.id} />
                      <Button type="submit" name="decision" value="approved">
                        Approve
                      </Button>
                      <Button type="submit" name="decision" value="rejected" variant="secondary">
                        Reject
                      </Button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      <Panel title="Library">
        <form method="get" className="mb-3 flex gap-2 text-sm">
          <input name="q" defaultValue={p.q ?? ""} placeholder="Name or head code" className={input} />
          <button type="submit" className="h-8 rounded-md bg-neutral-900 px-3 text-white">
            Search
          </button>
        </form>
        <table className="w-full">
          <thead>
            <tr>
              {["Name", "Aliases", "Head", "Source", ""].map((h) => (
                <th key={h} className={th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-t border-neutral-100">
                <td className={`${td} font-mono`}>{e.normalized_name}</td>
                <td className={`${td} text-xs`}>{e.aliases.join(", ")}</td>
                <td className={td}>{e.head_code}</td>
                <td className={td}>{e.source}</td>
                <td className={td}>
                  <form action={removeLibraryEntryAction}>
                    <input type="hidden" name="entryId" value={e.id} />
                    <Button type="submit" variant="secondary">
                      Remove
                    </Button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
