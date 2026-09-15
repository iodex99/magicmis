import { STAGES } from "@magicmis/ai";
import { modelRegistryView } from "@magicmis/ai/margin";
import { readConfig } from "@magicmis/db/config";
import { z } from "zod";

import { Flash, input, num, td, th, type FlashParams } from "@/components/Flash";
import { Alert, Button, Panel } from "@/components/ui";
import { listRouting } from "@/server/console";
import { db } from "@/server/runtime";
import { requireAdmin } from "@/server/session";

import { publishModelAction, publishRouteAction } from "../console-actions";

export const metadata = { title: "Models and routing" };
export const dynamic = "force-dynamic";

/** SPEC §26: model registry (with source and verification age) and tier routing editor. */
export default async function ModelsPage({
  searchParams,
}: {
  searchParams: FlashParams;
}) {
  await requireAdmin();
  const pool = db();
  const staleDays = await readConfig(
    pool,
    "ai.registry_stale_days",
    z.number().int().positive(),
  );
  const [registry, routing] = await Promise.all([
    modelRegistryView(pool, staleDays),
    listRouting(pool),
  ]);
  const stale = registry.filter((m) => m.stale);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[1.5rem] leading-tight font-semibold tracking-tight text-neutral-900">
        Models and routing
      </h1>
      <Flash searchParams={searchParams} />
      {stale.length > 0 ? (
        <Alert tone="error">
          Not re-verified in {staleDays} days: {stale.map((m) => m.modelId).join(", ")}
        </Alert>
      ) : null}

      <Panel title="Model registry">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                {[
                  "Model",
                  "Input µ$/MTok",
                  "Output µ$/MTok",
                  "Available",
                  "Version",
                  "Verified",
                  "Source",
                  "",
                ].map((h) => (
                  <th key={h} className={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {registry.map((m) => (
                <tr key={m.modelId} className="border-t border-neutral-100 align-top">
                  <td className={`${td} font-mono`}>{m.modelId}</td>
                  <td colSpan={7} className={td}>
                    <form
                      action={publishModelAction}
                      className="flex flex-wrap items-center gap-2"
                    >
                      <input type="hidden" name="modelId" value={m.modelId} />
                      <input
                        name="input"
                        defaultValue={m.inputPricePerMTokMicroUsd.toString()}
                        className={`${input} w-28`}
                      />
                      <input
                        name="output"
                        defaultValue={m.outputPricePerMTokMicroUsd.toString()}
                        className={`${input} w-28`}
                      />
                      <label className="flex items-center gap-1 text-xs">
                        <input
                          type="checkbox"
                          name="available"
                          defaultChecked={m.available}
                        />{" "}
                        available
                      </label>
                      <span className={num}>v{m.version}</span>
                      <span className="text-xs">
                        {m.verifiedAt.toISOString().slice(0, 10)}
                        {m.stale ? (
                          <strong className="ml-1 text-red-700">stale</strong>
                        ) : null}
                      </span>
                      <input
                        name="sourceUrl"
                        defaultValue={m.sourceUrl}
                        className={`${input} w-72`}
                      />
                      <Button type="submit" variant="secondary">
                        Re-verify
                      </Button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Tier routing">
        <form
          action={publishRouteAction}
          className="mb-4 flex flex-wrap items-end gap-2 text-sm"
        >
          <label className="flex flex-col">
            Tier
            <select name="tier" className={input}>
              {["efficient", "professional", "expert", "expert_plus"].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col">
            Stage
            <select name="stage" className={input}>
              {STAGES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col">
            Model
            <select name="modelId" className={input}>
              {registry.map((m) => (
                <option key={m.modelId}>{m.modelId}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col">
            Effort
            <select name="effort" className={input}>
              <option value="">none</option>
              {["low", "medium", "high", "xhigh", "max"].map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col">
            max_tokens
            <input name="maxTokens" className={`${input} w-24`} defaultValue="2000" />
          </label>
          <label className="flex flex-col">
            Fallback chain (comma separated)
            <input name="fallbackChain" className={`${input} w-64`} />
          </label>
          <Button type="submit">Publish route</Button>
        </form>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                {[
                  "Tier",
                  "Stage",
                  "Model",
                  "Effort",
                  "max_tokens",
                  "Fallbacks",
                  "Prompt",
                  "Version",
                ].map((h) => (
                  <th key={h} className={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {routing.map((r) => (
                <tr
                  key={`${r.tier}:${r.stage}`}
                  className="border-b border-neutral-100 last:border-0 hover:bg-neutral-25"
                >
                  <td className={td}>{r.tier}</td>
                  <td className={td}>{r.stage}</td>
                  <td className={`${td} font-mono`}>{r.model_id}</td>
                  <td className={td}>{r.effort ?? "—"}</td>
                  <td className={num}>{r.max_tokens}</td>
                  <td className={`${td} font-mono text-xs`}>
                    {r.fallback_chain.join(", ") || "—"}
                  </td>
                  <td className={td}>
                    {r.prompt_version === null ? (
                      <span className="text-red-700">not activated</span>
                    ) : (
                      `v${r.prompt_version.toString()}`
                    )}
                  </td>
                  <td className={num}>{r.version}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
