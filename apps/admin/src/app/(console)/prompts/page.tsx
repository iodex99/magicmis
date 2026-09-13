import { Flash, num, td, th, type FlashParams } from "@/components/Flash";
import { Button, Panel } from "@/components/ui";
import { evalRuns, listRouting } from "@/server/console";
import { db } from "@/server/runtime";
import { requireAdmin } from "@/server/session";

import { activatePromptAction } from "../console-actions";

export const metadata = { title: "Prompts and evals" };
export const dynamic = "force-dynamic";

/**
 * SPEC §14, §26: eval results per stage, tier and prompt version, and the activation gate. A version
 * activates only with a live eval at or above the configured threshold; replays never count.
 */
export default async function PromptsPage({ searchParams }: { searchParams: FlashParams }) {
  await requireAdmin();
  const pool = db();
  const [runs, routing] = await Promise.all([evalRuns(pool), listRouting(pool)]);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-neutral-900">Prompts and evals</h1>
      <Flash searchParams={searchParams} />
      <Panel title="Active prompt versions">
        <table className="w-full">
          <thead>
            <tr>
              {["Tier", "Stage", "Active prompt"].map((h) => (
                <th key={h} className={th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {routing.map((r) => (
              <tr key={`${r.tier}:${r.stage}`} className="border-t border-neutral-100">
                <td className={td}>{r.tier}</td>
                <td className={td}>{r.stage}</td>
                <td className={td}>{r.prompt_version === null ? <span className="text-red-700">none</span> : `v${r.prompt_version.toString()}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Panel title="Eval runs">
        <table className="w-full">
          <thead>
            <tr>
              {["When", "Stage", "Tier", "Prompt", "Mode", "Items", "Accuracy", "Cost µ$", ""].map((h) => (
                <th key={h} className={th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} className="border-t border-neutral-100">
                <td className={`${td} text-xs`}>{r.created_at.toISOString().slice(0, 16).replace("T", " ")}</td>
                <td className={td}>{r.stage}</td>
                <td className={td}>{r.tier}</td>
                <td className={td}>v{r.prompt_version}</td>
                <td className={td}>{r.mode}</td>
                <td className={num}>
                  {r.correct}/{r.items}
                </td>
                <td className={num}>{r.accuracy}</td>
                <td className={num}>{r.cost_micro_usd}</td>
                <td className={td}>
                  {r.mode === "live" ? (
                    <form action={activatePromptAction}>
                      <input type="hidden" name="stage" value={r.stage} />
                      <input type="hidden" name="tier" value={r.tier} />
                      <input type="hidden" name="promptVersion" value={r.prompt_version} />
                      <Button type="submit" variant="secondary">
                        Activate
                      </Button>
                    </form>
                  ) : (
                    <span className="text-xs text-neutral-600">replay: not eligible</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
