import Link from "next/link";

import { AppFrame } from "@/components/AppFrame";
import { Icon } from "@/components/Icon";
import { EmptyState, PageHeader, Panel } from "@/components/ui";
import { accountOrRedirect } from "@/lib/account-page";
import { db } from "@/lib/db";
import { istLabelled } from "@/lib/job-display";
import { inbox } from "@/lib/server/inbox";

import { MarkRead } from "./MarkRead";

export const metadata = { title: "Inbox" };
export const dynamic = "force-dynamic";

/**
 * Every notice the product has emailed, inside the app too (ADR 0087): a run finished or failed,
 * a quote waiting, a month due, a low balance, a sign-in. Each says what its email said and opens
 * the same page. Seeing it reads it: the page marks itself read once it is on screen, never as a
 * side effect of being fetched.
 */
export default async function InboxPage() {
  const account = await accountOrRedirect("/app/inbox");
  const pool = db();
  const items = await inbox(pool, account.accountId);
  return (
    <AppFrame accountId={account.accountId} businessName={account.businessName}>
      <PageHeader
        eyebrow="Workspace"
        title="Inbox"
        description="Everything we have emailed you, here as well, newest first."
      />
      <MarkRead
        unread={items.filter((i) => !i.read).length}
        upTo={items[0]?.at.toISOString() ?? null}
      />
      {items.length === 0 ? (
        <EmptyState icon="mail" title="Nothing yet" testId="inbox-empty">
          When a run finishes, a quote is waiting or a month is due, it appears here as
          well as in your email.
        </EmptyState>
      ) : (
        <Panel padding="none">
          <ul className="divide-y divide-neutral-100" data-testid="inbox">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5"
                data-testid="inbox-item"
                data-read={item.read ? "true" : "false"}
              >
                <span
                  aria-hidden="true"
                  className={`size-2 shrink-0 rounded-full ${item.read ? "bg-transparent" : "bg-accent-600"}`}
                />
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-[0.875rem] ${item.read ? "text-neutral-700" : "font-semibold text-neutral-900"}`}
                  >
                    {/* The dot is for the eye; a screen reader is told in words (ADR 0091). */}
                    {item.read ? null : <span className="sr-only">Unread: </span>}
                    {item.title}
                  </p>
                  {item.summary === "" ? null : (
                    <p className="mt-0.5 text-[0.8125rem] text-neutral-600">
                      {item.summary}
                    </p>
                  )}
                  <p className="mt-0.5 text-[0.75rem] text-neutral-500">
                    {istLabelled(item.at)}
                  </p>
                </div>
                {item.link === null ? null : (
                  <Link
                    href={item.link.path}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[0.8125rem] font-medium text-accent-700 hover:bg-accent-50"
                  >
                    {item.link.label}
                    <Icon name="arrow-right" size={13} />
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </AppFrame>
  );
}
