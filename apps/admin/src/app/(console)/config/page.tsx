import { Flash, input, td, th, type FlashParams } from "@/components/Flash";
import { Button, Panel } from "@/components/ui";
import { EDITABLE_CONFIG_PREFIXES, listConfig } from "@/server/console";
import { db } from "@/server/runtime";
import { requireAdmin } from "@/server/session";

import { publishConfigAction } from "../console-actions";

export const metadata = { title: "Config" };
export const dynamic = "force-dynamic";

/**
 * SPEC §26 config editor: limits, retention, lifecycle, FX, GST, seller details and the rest. Each
 * change is a new version effective now, keeping the value's shape; every change is audited.
 */
export default async function ConfigPage({
  searchParams,
}: {
  searchParams: FlashParams;
}) {
  await requireAdmin();
  const rows = (await listConfig(db())).filter((r) =>
    EDITABLE_CONFIG_PREFIXES.some((p) => r.key.startsWith(p)),
  );
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-neutral-900">Config</h1>
      <Flash searchParams={searchParams} />
      <Panel>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                {["Key", "Value (JSON)", "Version", "Effective from"].map((h) => (
                  <th key={h} className={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-t border-neutral-100 align-top">
                  <td className={`${td} font-mono text-xs`}>{r.key}</td>
                  <td className={td}>
                    <form action={publishConfigAction} className="flex items-start gap-2">
                      <input type="hidden" name="key" value={r.key} />
                      <textarea
                        name="value"
                        aria-label={r.key}
                        defaultValue={JSON.stringify(r.value)}
                        className={`${input} h-auto min-h-8 w-[28rem] font-mono text-xs`}
                      />
                      <Button type="submit" variant="secondary">
                        Save
                      </Button>
                    </form>
                  </td>
                  <td className={td}>{r.version}</td>
                  <td className={`${td} text-xs`}>{r.effective_from.toISOString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
