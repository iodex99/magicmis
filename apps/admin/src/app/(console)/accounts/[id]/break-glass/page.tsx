import { notFound } from "next/navigation";
import { z } from "zod";

import { num, td, th } from "@/components/Flash";
import { Alert, Panel } from "@/components/ui";
import { BreakGlassRequired, breakGlassView } from "@/server/console";
import { db, keyWrapper } from "@/server/runtime";
import { requireAdmin } from "@/server/session";

export const metadata = { title: "Break-glass view" };
export const dynamic = "force-dynamic";

/** SPEC §26: decrypted company memory under an active grant; this page view is audit-logged. */
export default async function BreakGlassPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ grant?: string; company?: string }>;
}) {
  const admin = await requireAdmin();
  const { id } = await params;
  const q = await searchParams;
  const grant = z.uuid().safeParse(q.grant);
  const company = z.uuid().safeParse(q.company);
  if (!z.uuid().safeParse(id).success || !grant.success || !company.success) notFound();
  let view;
  try {
    view = await breakGlassView(db(), keyWrapper(), {
      adminId: admin.adminId,
      ip: admin.ip,
      grantId: grant.data,
      companyId: company.data,
    });
  } catch (error) {
    if (error instanceof BreakGlassRequired)
      return <Alert tone="error">{error.message}</Alert>;
    throw error;
  }
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-neutral-900">Break-glass view</h1>
      <Alert tone="warning">
        This view was recorded in the audit log under your grant.
      </Alert>
      <Panel title={`${view.template} — ${view.period ?? "no months stored"}`}>
        <table className="w-full">
          <thead>
            <tr>
              {["Metric", "Period", "Value", "Unit", "Formula"].map((h) => (
                <th key={h} className={th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.values.map((v) => (
              <tr
                key={`${v.metricId}@${v.period}`}
                className="border-t border-neutral-100"
              >
                <td className={`${td} font-mono`}>{v.metricId}</td>
                <td className={td}>{v.period}</td>
                <td className={num}>{v.value ?? v.nullReason ?? ""}</td>
                <td className={td}>{v.unit}</td>
                <td className={`${td} text-xs`}>{v.formula}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
