import { randomUUID } from "node:crypto";

import { listInvoices, listPurchases, rupeeCell } from "@magicmis/billing";
import { walletSummary } from "@magicmis/wallet";
import { notFound } from "next/navigation";
import { z } from "zod";

import { Flash, input, num, td, th, type FlashParams } from "@/components/Flash";
import { Button, Panel } from "@/components/ui";
import { accountDetail } from "@/server/accounts";
import { activeGrants } from "@/server/console";
import { db } from "@/server/runtime";
import { requireAdmin } from "@/server/session";

import { adjustCreditsAction, setStatusAction } from "../../actions";
import { grantBreakGlassAction, revokeBreakGlassAction } from "../../console-actions";

export const metadata = { title: "Account" };
export const dynamic = "force-dynamic";

function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <table className="w-full">
      <thead>
        <tr>
          {head.map((h) => (
            <th key={h} className={th}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t border-neutral-100">
            {r.map((c, j) => (
              <td
                key={j}
                className={typeof c === "number" || /^-?[\d.]+$/u.test(c) ? num : td}
              >
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** SPEC §26 account view: profile, companies (names and states only), wallet, ledger, billing, logins. */
export default async function AccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: FlashParams;
}) {
  await requireAdmin();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const pool = db();
  const detail = await accountDetail(pool, id);
  if (detail === null) notFound();
  const [wallet, purchases, invoices, grants] = await Promise.all([
    walletSummary(pool, id),
    listPurchases(pool, id),
    listInvoices(pool, id),
    activeGrants(pool, id),
  ]);
  const a = detail.account;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-neutral-900">{a.business_name}</h1>
      <Flash searchParams={searchParams} />

      <div className="grid grid-cols-2 gap-6">
        <Panel title="Profile">
          <dl className="grid grid-cols-2 gap-y-1 text-sm">
            <dt className="text-neutral-600">Email</dt>
            <dd>{a.email}</dd>
            <dt className="text-neutral-600">GSTIN</dt>
            <dd>{a.gstin ?? "—"}</dd>
            <dt className="text-neutral-600">State code</dt>
            <dd>{a.state_code}</dd>
            <dt className="text-neutral-600">Status</dt>
            <dd>{a.status}</dd>
            <dt className="text-neutral-600">Account id</dt>
            <dd className="font-mono text-xs">{a.id}</dd>
          </dl>
          <form action={setStatusAction} className="mt-4 flex gap-2">
            <input type="hidden" name="accountId" value={a.id} />
            <input
              type="hidden"
              name="status"
              value={a.status === "suspended" ? "active" : "suspended"}
            />
            <input
              name="reason"
              placeholder="Reason (required)"
              className={`${input} flex-1`}
              required
              minLength={5}
            />
            <Button
              type="submit"
              variant={a.status === "suspended" ? "secondary" : "danger"}
            >
              {a.status === "suspended" ? "Reactivate" : "Suspend"}
            </Button>
          </form>
        </Panel>

        <Panel title="Wallet">
          <dl className="grid grid-cols-3 gap-4 text-sm">
            {[
              ["Balance", wallet.balance],
              ["Held", wallet.held],
              ["Available", wallet.available],
            ].map(([k, v]) => (
              <div key={String(k)}>
                <dt className="text-xs text-neutral-600">{String(k)}</dt>
                <dd className="font-mono text-xl tabular-nums">{String(v)}</dd>
              </div>
            ))}
          </dl>
          <form action={adjustCreditsAction} className="mt-4 flex flex-wrap gap-2">
            <input type="hidden" name="accountId" value={a.id} />
            <input type="hidden" name="idempotencyKey" value={randomUUID()} />
            <input
              name="delta"
              placeholder="+500 or -200"
              className={`${input} w-32`}
              required
            />
            <input
              name="reason"
              placeholder="Reason (required, audited)"
              className={`${input} flex-1`}
              required
              minLength={5}
            />
            <Button type="submit">Adjust credits</Button>
          </form>
        </Panel>
      </div>

      <Panel title="Companies">
        <Table
          head={["Name", "State"]}
          rows={detail.companies.map((c) => [c.name, c.lifecycle_state])}
        />
      </Panel>
      <Panel title="Lots">
        <Table
          head={["Source", "Remaining", "Granted", "Expires"]}
          rows={wallet.lots.map((l) => [
            l.source,
            l.remaining.toString(),
            l.granted.toString(),
            l.expiresAt.toISOString().slice(0, 10),
          ])}
        />
      </Panel>
      <Panel title="Ledger (latest 100)">
        <Table
          head={["Seq", "Type", "Amount", "Balance after", "Held after", "At (UTC)"]}
          rows={detail.ledger.map((e) => [
            e.seq_text,
            e.entry_type,
            e.amount,
            e.balance_after,
            e.held_after,
            e.created_at.toISOString(),
          ])}
        />
      </Panel>
      <Panel title="Purchases">
        <Table
          head={["Method", "Status", "Credits", "Bonus", "Total (₹)", "Created"]}
          rows={purchases.map((p) => [
            p.method,
            p.status,
            p.credits.toString(),
            p.bonusCredits.toString(),
            rupeeCell(p.totalPaise),
            p.createdAt.toISOString().slice(0, 10),
          ])}
        />
      </Panel>
      <Panel title="Invoices">
        <Table
          head={["Number", "Type", "Total (₹)", "Issued"]}
          rows={invoices.map((i) => [
            i.number,
            i.type,
            rupeeCell(i.totals.total_paise),
            i.issuedAt.toISOString().slice(0, 10),
          ])}
        />
      </Panel>
      <Panel title="Break-glass access">
        <p className="mb-3 text-xs text-neutral-600">
          Customer financial data is not visible by default. Access needs a written
          reason, lasts a limited time, is recorded for every view, and emails the account
          holder.
        </p>
        {grants.map((g) => (
          <div
            key={g.id}
            className="mb-3 rounded-md border border-neutral-200 p-3 text-sm"
            data-testid="break-glass-grant"
          >
            <p>
              {g.admin_email} until {g.expires_at.toISOString()} — {g.reason}
            </p>
            <div className="mt-2 flex flex-wrap gap-3">
              {detail.companies.map((c) => (
                <a
                  key={c.id}
                  className="text-accent-700 underline"
                  href={`/accounts/${id}/break-glass?grant=${g.id}&company=${c.id}`}
                >
                  View {c.name}
                </a>
              ))}
              <form action={revokeBreakGlassAction}>
                <input type="hidden" name="accountId" value={id} />
                <input type="hidden" name="grantId" value={g.id} />
                <Button type="submit" variant="secondary">
                  Revoke
                </Button>
              </form>
            </div>
          </div>
        ))}
        <form
          action={grantBreakGlassAction}
          className="flex flex-wrap items-end gap-2 text-sm"
        >
          <input type="hidden" name="accountId" value={id} />
          <label className="flex flex-col">
            Reason (at least 20 characters)
            <textarea
              name="reason"
              required
              minLength={20}
              className={`${input} h-16 w-96`}
            />
          </label>
          <label className="flex flex-col">
            Minutes
            <input name="minutes" defaultValue="15" className={`${input} w-20`} />
          </label>
          <Button type="submit" variant="danger">
            Grant access
          </Button>
        </form>
      </Panel>
      <Panel title="Login events">
        <Table
          head={["Event", "IP", "User agent", "At (UTC)"]}
          rows={detail.logins.map((l) => [
            l.event_type,
            l.ip ?? "",
            (l.user_agent ?? "").slice(0, 80),
            l.created_at.toISOString(),
          ])}
        />
      </Panel>
    </div>
  );
}
