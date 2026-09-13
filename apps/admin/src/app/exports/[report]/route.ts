import {
  ACCOUNTING_REPORTS,
  accountingCsv,
  type AccountingReport,
} from "@magicmis/billing";
import { appendAuditInTransaction } from "@magicmis/db/audit";

import { resolveSession } from "@/server/identity";
import { allowlist, db, ipAllowlist, requestMeta } from "@/server/runtime";
import { sessionToken } from "@/server/session";

/** GET /exports/:report?month=YYYY-MM — CSV download, admin only, audit-logged. */
export async function GET(
  request: Request,
  context: { params: Promise<{ report: string }> },
): Promise<Response> {
  const { ip } = await requestMeta();
  const allowedIps = ipAllowlist();
  if (allowedIps !== null && (ip === null || !allowedIps.has(ip)))
    return new Response("forbidden", { status: 403 });
  const session = await resolveSession(db(), await sessionToken());
  if (session === null || !allowlist().has(session.email.toLowerCase()))
    return new Response("unauthorised", { status: 401 });

  const { report } = await context.params;
  if (!(ACCOUNTING_REPORTS as readonly string[]).includes(report))
    return new Response("not found", { status: 404 });
  const month = new URL(request.url).searchParams.get("month") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/u.test(month))
    return new Response("month must be YYYY-MM", { status: 400 });

  const csv = await accountingCsv(db(), report as AccountingReport, month);
  await appendAuditInTransaction(db(), {
    actorType: "admin",
    actorId: session.adminId,
    action: "billing.accounting_export",
    targetType: "report",
    metadata: { report, month },
    ip,
  });
  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${report}-${month}.csv"`,
      "cache-control": "private, no-store",
    },
  });
}
