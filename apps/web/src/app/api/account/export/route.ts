import { listAccountExports, requestAccountExport } from "@magicmis/jobs";

import { db } from "@/lib/db";
import { idempotent, ok, requestMeta, withAccount } from "@/lib/http";
import { rateLimited } from "@/lib/server/ratelimit";

/** GET /api/account/export — recent export requests and their state. */
export async function GET(): Promise<Response> {
  return withAccount(async (account) => {
    const exports = await listAccountExports(db(), account.accountId);
    return ok({
      exports: exports.map((e) => ({
        id: e.id,
        status: e.status,
        requestedAt: e.requestedAt.toISOString(),
        readyAt: e.readyAt?.toISOString() ?? null,
        expiresAt: e.expiresAt?.toISOString() ?? null,
        bytes: e.byteSize,
      })),
    });
  });
}

/**
 * POST /api/account/export — ask for a data export (SPEC §10: generated asynchronously and emailed as
 * a time-limited link). Uncharged: exercising a data right is not a paid action.
 */
export async function POST(request: Request): Promise<Response> {
  return withAccount(async (account) => {
    const limited = await rateLimited("export_per_account", account.accountId);
    if (limited !== null) return limited;
    const { ip } = await requestMeta();
    return idempotent(
      request,
      `account:${account.accountId}`,
      { action: "request_export" },
      async () => {
        const r = await requestAccountExport(db(), { accountId: account.accountId, ip });
        return { status: r.created ? 201 : 200, body: { id: r.id, status: "queued" } };
      },
    );
  });
}
