import { verifyAuditChain } from "@magicmis/db/audit";
import { verifyIntegrityAnchors } from "@magicmis/jobs";

import { td, th } from "@/components/Flash";
import { Alert, Panel } from "@/components/ui";
import { db, keyWrapper } from "@/server/runtime";
import { requireAdmin } from "@/server/session";

export const metadata = { title: "Audit log" };
export const dynamic = "force-dynamic";

/** SPEC §26: audit log viewer with hash-chain and keyed-anchor verification (R-52). */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ verify?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const pool = db();
  const [entries, verification, anchors] = await Promise.all([
    pool.query<{
      seq_text: string;
      actor_type: string;
      actor_id: string | null;
      action: string;
      target_type: string | null;
      target_id: string | null;
      metadata: unknown;
      created_at: Date;
    }>(
      `select seq::text as seq_text, actor_type, actor_id, action, target_type, target_id, metadata, created_at
       from public.audit_log order by seq desc limit 200`,
    ),
    params.verify === "1" ? verifyAuditChain(pool) : Promise.resolve(null),
    params.verify === "1"
      ? verifyIntegrityAnchors(pool, keyWrapper())
      : Promise.resolve(null),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-[1.5rem] leading-tight font-semibold tracking-tight text-neutral-900">
          Audit log
        </h1>
        <a href="/audit?verify=1" className="text-sm text-accent-700 underline">
          Verify hash chain
        </a>
      </div>
      {verification === null ? null : verification.ok ? (
        <Alert tone="success">
          Chain verified: {verification.checked} entries, no mismatches.
        </Alert>
      ) : (
        <Alert tone="error">
          Chain verification FAILED at {verification.failures.length} entr
          {verification.failures.length === 1 ? "y" : "ies"}:{" "}
          {verification.failures
            .slice(0, 5)
            .map((f) => `${f.id} (${f.reason})`)
            .join(", ")}
        </Alert>
      )}
      {anchors === null ? null : anchors.failures.length === 0 ? (
        <Alert tone="success">
          Anchors verified: {anchors.anchorsChecked} anchors over the audit log and credit
          ledger.
        </Alert>
      ) : (
        <Alert tone="error">
          Anchor verification FAILED:{" "}
          {anchors.failures
            .slice(0, 5)
            .map((f) => `${f.chain} ${f.anchorId ?? ""} (${f.reason})`)
            .join(", ")}
        </Alert>
      )}
      <Panel title="Latest 200 entries">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                {["Seq", "At (UTC)", "Actor", "Action", "Target", "Metadata"].map((h) => (
                  <th key={h} className={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.rows.map((e) => (
                <tr key={e.seq_text} className="border-t border-neutral-100 align-top">
                  <td className={`${td} font-mono`}>{e.seq_text}</td>
                  <td className={td}>{e.created_at.toISOString()}</td>
                  <td className={td}>
                    {e.actor_type}
                    <span className="block font-mono text-xs text-neutral-500">
                      {e.actor_id ?? ""}
                    </span>
                  </td>
                  <td className={td}>{e.action}</td>
                  <td className={td}>
                    {e.target_type ?? ""}
                    <span className="block font-mono text-xs text-neutral-500">
                      {e.target_id ?? ""}
                    </span>
                  </td>
                  <td className={`${td} font-mono text-xs`}>
                    {JSON.stringify(e.metadata)}
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
