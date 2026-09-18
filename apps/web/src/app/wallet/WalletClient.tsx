"use client";

import { useCallback, useState } from "react";

import { Donut, sharePercent } from "@/components/Charts";
import { Icon } from "@/components/Icon";
import {
  Alert,
  Badge,
  Button,
  DataTable,
  EmptyState,
  Panel,
  StatCard,
  Td,
  Th,
  Tr,
} from "@/components/ui";
import { formatCredits, formatMoney } from "@/lib/actions";
import { PRODUCT_NAME } from "@/lib/brand";
import { loadCheckout, type RazorpayConstructor } from "@/lib/checkout";
import { api, newIdempotencyKey } from "@/lib/client-api";

import { BillingDetailsForm } from "./BillingDetailsForm";

import type { WalletView } from "@/lib/billing";

const SOURCE_LABELS: Record<string, string> = {
  purchase: "Purchase",
  bonus: "Bonus",
  admin_grant: "Adjustment",
  goodwill: "Goodwill",
};
const ENTRY_LABELS: Record<string, string> = {
  grant: "Credits added",
  reserve: "Action started",
  release: "Returned, unused",
  capture: "Charged",
  expire: "Expired",
  admin_adjust: "Adjustment",
};

/**
 * Which way an entry moves the balance. Reserving and returning move the *held* figure, not
 * the balance, so they get no sign at all rather than a misleading one. An adjustment is the
 * only entry whose amount carries its own sign.
 */
const DIRECTION: Record<string, "up" | "down" | "none"> = {
  grant: "up",
  capture: "down",
  expire: "down",
  reserve: "none",
  release: "none",
};

const istDate = (iso: string): string =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));

/**
 * What a credit balance actually buys, in the customer's own terms.
 *
 * Prices come from the price book and can change, so these are deliberately approximate
 * and hedged — the authority is the Pricing page, and nothing here is a quote.
 */
const REFRESH_CREDITS = 299n;
function covers(credits: bigint): string {
  const refreshes = credits / REFRESH_CREDITS;
  if (refreshes < 1n) return "Part of one monthly refresh";
  return `About ${refreshes.toString()} monthly ${refreshes === 1n ? "refresh" : "refreshes"}`;
}

export function WalletClient({
  initial,
  businessName,
  need,
}: {
  initial: WalletView;
  businessName: string;
  /** Credits a run needs, when the customer arrived here from one that was short. */
  need: string | null;
}) {
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  /**
   * Money in the account's own billing currency (ADR 0030).
   *
   * Defaulting to the wallet's currency rather than to rupees: a visitor billed in dollars
   * seeing "₹2,900" would read it as a price forty times lower than it is. Historic rows
   * pass their own currency, since an invoice keeps the currency it was issued in even if
   * the account's changes.
   */
  const money = (minor: string, currency = view.currency ?? "INR") =>
    formatMoney(currency, minor);
  const [notice, setNotice] = useState<{
    tone: "info" | "success" | "error";
    text: string;
  } | null>(null);

  const refresh = useCallback(async () => {
    const result = await api<WalletView>("/api/wallet");
    if (result.ok) setView(result.data);
    return result.ok ? result.data : null;
  }, []);

  /** After checkout, the webhook grants credits; poll briefly so the page reflects it. */
  const awaitCredit = useCallback(
    async (purchaseId: string) => {
      for (let i = 0; i < 20; i += 1) {
        await new Promise((r) => setTimeout(r, 1500));
        const next = await refresh();
        if (next?.purchases.find((p) => p.id === purchaseId)?.status === "credited") {
          setNotice({
            tone: "success",
            text: "Payment confirmed. Credits added and your tax invoice is ready.",
          });
          return;
        }
      }
      setNotice({
        tone: "info",
        text: "Payment received. Credits appear as soon as the payment provider confirms it — usually within a few minutes.",
      });
    },
    [refresh],
  );

  async function buy(packId: string) {
    setBusy(packId);
    setNotice(null);
    const created = await api<{
      purchaseId: string;
      orderId: string;
      amountMinor: string;
      currency: string;
      keyId: string;
    }>("/api/wallet/purchases", {
      body: { packId },
      idempotencyKey: newIdempotencyKey(),
    });
    if (!created.ok) {
      setBusy(null);
      setNotice({ tone: "error", text: created.message });
      return;
    }
    let Razorpay: RazorpayConstructor;
    try {
      Razorpay = await loadCheckout();
    } catch {
      setBusy(null);
      setNotice({
        tone: "error",
        text: "The payment window could not load. Check your connection or disable blockers and try again.",
      });
      return;
    }
    const checkout = new Razorpay({
      key: created.data.keyId,
      amount: created.data.amountMinor,
      currency: created.data.currency,
      name: PRODUCT_NAME,
      description: `Credits for ${businessName}`,
      order_id: created.data.orderId,
      handler: (response) => {
        void (async () => {
          const verified = await api<{ status: string }>("/api/wallet/purchases/verify", {
            body: {
              orderId: response.razorpay_order_id,
              paymentId: response.razorpay_payment_id,
              signature: response.razorpay_signature,
            },
          });
          if (!verified.ok) {
            setNotice({ tone: "error", text: verified.message });
            setBusy(null);
            return;
          }
          setNotice({
            tone: "info",
            text: "Payment received. Confirming with the payment provider…",
          });
          await awaitCredit(created.data.purchaseId);
          setBusy(null);
        })();
      },
      modal: {
        ondismiss: () => {
          setBusy(null);
        },
      },
    });
    checkout.on("payment.failed", (response) => {
      setNotice({
        tone: "error",
        text: response.error.description ?? "The payment failed. No credits were added.",
      });
    });
    checkout.open();
  }

  async function bankTransfer(packId: string) {
    setBusy(packId);
    setNotice(null);
    const result = await api<{ proformaNumber: string | null }>(
      "/api/wallet/bank-transfer",
      {
        body: { packId },
        idempotencyKey: newIdempotencyKey(),
      },
    );
    setBusy(null);
    if (!result.ok) {
      setNotice({ tone: "error", text: result.message });
      return;
    }
    await refresh();
    setNotice({
      tone: "success",
      text: `Proforma ${result.data.proformaNumber ?? ""} issued and emailed. Transfer the total quoting the proforma number; credits are added when we confirm receipt.`,
    });
  }

  const available = BigInt(view.available);
  const held = BigInt(view.held);

  // The pack to point at: the smallest that covers what the run needs, or the one most
  // accounts choose when nothing in particular is waiting.
  const shortfall = need === null ? 0n : BigInt(need) - available;
  const suggested =
    shortfall > 0n
      ? (view.packs.find((p) => BigInt(p.credits) + BigInt(p.bonusCredits) >= shortfall)
          ?.packId ?? view.packs.at(-1)?.packId)
      : view.packs[2]?.packId;

  return (
    <div className="flex flex-col gap-5">
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}

      {shortfall > 0n ? (
        <Alert tone="info" title="Your run needs more credits">
          It needs {formatCredits(need ?? "0")} and you have{" "}
          {formatCredits(view.available)}. The pack marked below covers it; the run is
          still waiting where you left it.
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3" data-testid="wallet-balance">
        <StatCard
          label="Available"
          value={formatCredits(view.available)}
          unit="credits"
          icon="wallet"
          tone="accent"
          hint="Ready to spend on an action"
        />
        <StatCard
          label="Running now"
          value={formatCredits(view.held)}
          unit="credits"
          icon="loader"
          hint={
            held === 0n
              ? "Nothing is running right now"
              : "Being spent by actions in progress. Back in your balance if one fails."
          }
        />
        <StatCard
          label="Total balance"
          value={formatCredits(view.balance)}
          unit="credits"
          icon="bank"
          hint="Credits never expire"
          chart={
            available + held === 0n ? undefined : (
              <div className="flex items-center gap-3">
                <Donut
                  parts={[
                    {
                      percent: sharePercent(available, available + held),
                      tone: "accent",
                    },
                    { percent: sharePercent(held, available + held), tone: "warning" },
                  ]}
                />
                <span className="flex flex-col gap-1 text-[0.75rem] text-neutral-500">
                  <span className="flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 rounded-full bg-accent-500"
                    />
                    Available
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 rounded-full bg-warning"
                    />
                    Running now
                  </span>
                </span>
              </div>
            )
          }
        />
      </div>

      {view.billingReady ? (
        <Panel
          title="Add credits"
          description="Credits are prepaid and non-refundable, and there is no free tier. Prices below are in your billing currency, before tax."
          icon="plus"
          padding="none"
        >
          <DataTable
            className="px-2 pb-2"
            head={
              <>
                <Th>Credits</Th>
                <Th>What it covers</Th>
                <Th numeric>Price (ex-GST)</Th>
                <Th numeric>GST</Th>
                <Th numeric>Total</Th>
                <Th />
              </>
            }
          >
            {view.packs.map((p) => {
              const total = BigInt(p.credits) + BigInt(p.bonusCredits);
              return (
                <Tr
                  key={p.packId}
                  className={p.packId === suggested ? "bg-accent-50" : ""}
                >
                  <Td>
                    {p.name === null ? null : (
                      <span className="mr-2 text-[0.8125rem] font-medium text-neutral-500">
                        {p.name}
                      </span>
                    )}
                    <span className="num text-[0.9375rem] font-semibold text-neutral-900">
                      {formatCredits(p.credits)}
                    </span>
                    {p.bonusCredits !== "0" ? (
                      <Badge tone="positive" className="ml-2">
                        +{formatCredits(p.bonusCredits)} bonus
                      </Badge>
                    ) : null}
                    {p.packId === suggested ? (
                      <Badge tone="accent" className="ml-2">
                        {need === null ? "Recommended" : "Covers this run"}
                      </Badge>
                    ) : null}
                  </Td>
                  <Td className="text-[0.8125rem] text-neutral-500">{covers(total)}</Td>
                  <Td numeric>{money(p.taxableMinor)}</Td>
                  <Td numeric className="text-[0.75rem] text-neutral-500">
                    {p.supply === "export"
                      ? "Zero-rated export"
                      : p.supply === "intra_state"
                        ? `CGST ${money(p.cgstMinor)} + SGST ${money(p.sgstMinor)}`
                        : `IGST ${money(p.igstMinor)}`}
                  </Td>
                  <Td numeric className="font-semibold">
                    {money(p.totalMinor)}
                  </Td>
                  <Td className="text-right whitespace-nowrap">
                    <Button
                      size="sm"
                      variant={p.packId === suggested ? "primary" : "secondary"}
                      disabled={busy !== null}
                      onClick={() => void buy(p.packId)}
                    >
                      Pay {money(p.totalMinor)}
                    </Button>
                    {p.bankTransferEligible ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="ml-2"
                        disabled={busy !== null}
                        onClick={() => void bankTransfer(p.packId)}
                      >
                        Bank transfer
                      </Button>
                    ) : null}
                  </Td>
                </Tr>
              );
            })}
          </DataTable>
        </Panel>
      ) : (
        <BillingDetailsForm
          onSaved={() => {
            void refresh();
          }}
        />
      )}

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Panel
          title="Credit lots"
          description="Spent oldest first."
          icon="archive"
          padding="none"
        >
          {view.lots.length === 0 ? (
            <EmptyState icon="wallet" title="No credits yet">
              Add a pack above. Credits appear here as lots and are spent oldest first.
            </EmptyState>
          ) : (
            <DataTable
              className="px-2 pb-2"
              head={
                <>
                  <Th>Source</Th>
                  <Th numeric>Remaining</Th>
                  <Th numeric>Bought</Th>
                </>
              }
            >
              {view.lots.map((l) => (
                <Tr key={l.id}>
                  <Td>{SOURCE_LABELS[l.source] ?? l.source}</Td>
                  <Td numeric>{formatCredits(l.remaining)}</Td>
                  <Td numeric>{formatCredits(l.granted)}</Td>
                </Tr>
              ))}
            </DataTable>
          )}
        </Panel>

        <Panel title="Invoices" icon="document" padding="none">
          {view.invoices.length === 0 ? (
            <EmptyState icon="document" title="No invoices yet">
              A tax invoice is issued the moment a payment is confirmed, and a proforma
              when you request a bank transfer.
            </EmptyState>
          ) : (
            <DataTable
              testId="invoices"
              className="px-2 pb-2"
              head={
                <>
                  <Th>Number</Th>
                  <Th>Type</Th>
                  <Th>Date</Th>
                  <Th numeric>Total</Th>
                  <Th />
                </>
              }
            >
              {view.invoices.map((i) => (
                <Tr key={i.id}>
                  <Td className="font-mono text-[0.8125rem] text-neutral-900">
                    {i.number}
                  </Td>
                  <Td>
                    <Badge tone={i.type === "tax_invoice" ? "accent" : "neutral"}>
                      {i.type === "tax_invoice" ? "Tax invoice" : "Proforma"}
                    </Badge>
                  </Td>
                  <Td className="whitespace-nowrap">{istDate(i.issuedAt)}</Td>
                  <Td numeric>{money(i.totalMinor, i.currency)}</Td>
                  <Td className="text-right">
                    <a
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[0.8125rem] font-medium text-accent-700 hover:bg-accent-50"
                      href={`/api/invoices/${i.id}/pdf`}
                    >
                      <Icon name="download" size={13} />
                      Download PDF
                    </a>
                  </Td>
                </Tr>
              ))}
            </DataTable>
          )}
        </Panel>
      </div>

      <Panel
        title="History"
        description="Every movement of credits, newest first."
        icon="clock"
        padding="none"
      >
        {view.ledger.length === 0 ? (
          <EmptyState icon="clock" title="No activity yet">
            Buying credits and running actions both appear here, with the balance after
            each movement.
          </EmptyState>
        ) : (
          <DataTable
            className="px-2 pb-2"
            maxHeight="26rem"
            head={
              <>
                <Th>Date</Th>
                <Th>Activity</Th>
                <Th numeric>Credits</Th>
                <Th numeric>Balance after</Th>
              </>
            }
          >
            {view.ledger.map((e) => {
              const direction =
                DIRECTION[e.entryType] ?? (e.amount.startsWith("-") ? "down" : "up");
              const magnitude = formatCredits(e.amount.replace(/^-/u, ""));
              return (
                <Tr key={e.seq}>
                  <Td className="whitespace-nowrap">{istDate(e.createdAt)}</Td>
                  <Td className="text-neutral-900">
                    {ENTRY_LABELS[e.entryType] ?? e.entryType}
                  </Td>
                  <Td
                    numeric
                    className={
                      direction === "up"
                        ? "text-positive"
                        : direction === "down"
                          ? "text-negative"
                          : "text-neutral-500"
                    }
                  >
                    {direction === "up" ? "+" : direction === "down" ? "−" : ""}
                    {magnitude}
                  </Td>
                  <Td numeric>{formatCredits(e.balanceAfter)}</Td>
                </Tr>
              );
            })}
          </DataTable>
        )}
      </Panel>
    </div>
  );
}
