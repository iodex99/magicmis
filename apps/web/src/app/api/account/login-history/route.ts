import { describeUserAgent } from "@magicmis/accounts";

import { db } from "@/lib/db";
import { ok, withAccount } from "@/lib/http";

/** GET /api/account/login-history — SPEC §8: login history in Security settings. */
export async function GET(): Promise<Response> {
  return withAccount(async (account) => {
    const result = await db().query<{
      event_type: string;
      ip: string | null;
      geo: { country?: string; city?: string } | null;
      user_agent: string | null;
      new_device: boolean;
      created_at: Date;
    }>(
      `select event_type, host(ip) as ip, geo, user_agent, new_device, created_at
       from public.login_events
       where account_id = $1
       order by created_at desc
       limit 100`,
      [account.accountId],
    );
    return ok({
      events: result.rows.map((r) => ({
        type: r.event_type,
        ip: r.ip,
        location: [r.geo?.city, r.geo?.country].filter(Boolean).join(", ") || null,
        device: r.user_agent ? describeUserAgent(r.user_agent) : null,
        newDevice: r.new_device,
        // UTC on the wire; the page renders IST (SPEC §2.14).
        at: r.created_at.toISOString(),
      })),
    });
  });
}
