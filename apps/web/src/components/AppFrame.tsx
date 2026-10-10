import "server-only";

import { one } from "@magicmis/db/tx";
import { walletSummary } from "@magicmis/wallet";
import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { formatCredits } from "@/lib/actions";
import { db } from "@/lib/db";
import { RAIL_COOKIE } from "@/lib/prefs";
import { unreadCount } from "@/lib/server/inbox";

import { SessionWatcher } from "./SessionWatcher";
import { Sidebar } from "./Sidebar";
import { SignOutButton } from "./SignOutButton";
import { SkipLink } from "./ui";

/**
 * The signed-in shell: a dark navigation rail against the light working surface.
 *
 * The available balance sits in the rail on every page because this is a prepaid product
 * (SPEC §2.4) -- knowing what is left is part of deciding whether to start a paid action,
 * and hunting for it on the Wallet page each time is the wrong answer.
 *
 * So does the chat (ADR 0044). It belongs to a company, so from a page that is not about one
 * the rail opens the chat of the company most recently worked on. A company that is not set up
 * has no MIS to chat with, so on its pages — and for an account with nothing set up yet — the
 * button stays in the rail, visibly unavailable, and says why (ADR 0091): it used to send the
 * reader to the page they were already on, or fire an event nothing on the page was listening
 * for.
 */
export async function AppFrame({
  accountId,
  businessName,
  company,
  wide = false,
  children,
}: {
  /** Omit only where the caller has no account context; the rail then shows a dash. */
  accountId?: string;
  businessName: string;
  company?: { id: string; name: string };
  /** The company workspace uses the full width for the dashboard and the chat. */
  wide?: boolean;
  children: ReactNode;
}) {
  const pool = db();
  const [available, recent, jar, unread, here] = await Promise.all([
    accountId === undefined
      ? Promise.resolve("—")
      : walletSummary(pool, accountId).then((w) => formatCredits(w.available.toString())),
    accountId === undefined || company !== undefined
      ? Promise.resolve(null)
      : one<{ id: string }>(
          pool,
          `select id from public.companies
            where account_id = $1 and deleted_at is null
              and lifecycle_state = 'active' and first_setup_at is not null
            order by updated_at desc limit 1`,
          [accountId],
        ),
    cookies(),
    accountId === undefined ? Promise.resolve(0) : unreadCount(pool, accountId),
    accountId === undefined || company === undefined
      ? Promise.resolve(null)
      : one<{ set_up: boolean }>(
          pool,
          `select first_setup_at is not null as set_up from public.companies
            where id = $1 and account_id = $2 and deleted_at is null`,
          [company.id, accountId],
        ),
  ]);
  const chatCompanyId =
    company === undefined
      ? (recent?.id ?? null)
      : accountId === undefined || here?.set_up === true
        ? company.id
        : null;

  return (
    <div className="flex min-h-screen">
      {/* Past the rail to the page, for a keyboard (ADR 0091). */}
      <SkipLink />
      <SessionWatcher />
      <Sidebar
        businessName={businessName}
        availableCredits={available}
        {...(company === undefined ? {} : { company })}
        chatCompanyId={chatCompanyId}
        chatUnavailable={
          company === undefined
            ? "Chat opens once a company is set up."
            : "Chat opens once this company is set up."
        }
        initialCollapsed={jar.get(RAIL_COOKIE)?.value === "collapsed"}
        onSignOut={<SignOutButton />}
        unread={unread}
      />
      <main id="content" tabIndex={-1} className="canvas-grid min-w-0 flex-1 px-8 py-7">
        <div className={`mx-auto w-full ${wide ? "max-w-[1680px]" : "max-w-[1180px]"}`}>
          {children}
        </div>
      </main>
    </div>
  );
}
