import { sessionClaimsSchema } from "@magicmis/accounts";
import { appendAudit } from "@magicmis/db/audit";
import { withTransaction } from "@magicmis/db/tx";

import { db } from "@/lib/db";
import { currentClaims, ok, requestMeta } from "@/lib/http";
import { supabaseForRequest } from "@/lib/supabase/server";

/**
 * POST /api/auth/sign-out — this session only.
 *
 * Clears `active_session_id` only if it still points at this session: signing out of an
 * already-superseded tab must not log out the device that superseded it.
 */
export async function POST(): Promise<Response> {
  const parsed = sessionClaimsSchema.safeParse(await currentClaims());
  const supabase = await supabaseForRequest();
  const { ip, userAgent } = await requestMeta();

  if (parsed.success) {
    const claims = parsed.data;
    await withTransaction(db(), async (tx) => {
      const cleared = await tx.query<{ id: string }>(
        `update public.accounts set active_session_id = null
         where auth_user_id = $1 and active_session_id = $2
         returning id`,
        [claims.sub, claims.session_id],
      );
      const accountId = cleared.rows[0]?.id;
      if (accountId === undefined) return;
      await tx.query(
        `insert into public.login_events (account_id, event_type, ip, user_agent) values ($1, 'logout', $2, $3)`,
        [accountId, ip, userAgent],
      );
      await appendAudit(tx, {
        actorType: "account",
        actorId: accountId,
        action: "auth.signed_out",
        targetType: "account",
        targetId: accountId,
        metadata: {},
        ip,
      });
    });
  }

  await supabase.auth.signOut({ scope: "local" });
  return ok({ status: "signed_out" });
}
