"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";

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

  // The pack chosen before billing details existed, so that saving them goes on to pay for it.
  const [wanted, setWanted] = useState<string | null>(null);
  const [askingBilling, setAskingBilling] = useState(false);
  const billing = useRef<HTMLDivElement>(null);
  const choose = (packId: string) => {
    setWanted(packId);
    setNotice(null);
    // After the form has rendered: it is below the cards and must not be missed.
    setTimeout(() => {
      billing.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };
  const continuePurchase = async () => {
    const next = await refresh();
    const packId = wanted;
    setWanted(null);
    setAskingBilling(false);
    if (next === null || !next.billingReady || packId === null) return;
    if (next.packs.some((p) => p.packId === packId)) await buy(packId);
  };

  // One shape for a card, priced two ways: with tax and a total once the account has said
  // where to invoice it, and at the list price before tax until then.
  const cards = view.billingReady
    ? view.packs.map((p) => ({
        packId: p.packId,
        name: p.name,
        credits: p.credits,
        bonusCredits: p.bonusCredits,
        worth: p.worth,
        price: money(p.totalMinor),
        tax:
          p.supply === "export"
            ? "No tax added"
            : p.supply === "intra_state"
              ? `${money(p.taxableMinor)} + CGST ${money(p.cgstMinor)} + SGST ${money(p.sgstMinor)}`
              : `${money(p.taxableMinor)} + IGST ${money(p.igstMinor)}`,
        action: `Pay ${money(p.totalMinor)}`,
        bankTransferEligible: p.bankTransferEligible,
      }))
    : (view.listed?.packs ?? []).map((p) => ({
        packId: p.packId,
        name: p.name,
        credits: p.credits,
        bonusCredits: p.bonusCredits,
        worth: p.worth,
        // A list price in whole units reads as "$29", as it does on the public page.
        price: formatMoney(view.listed?.currency ?? "USD", p.priceMinor).replace(
          /\.00$/u,
          "",
        ),
        tax: "before tax",
        action: "Buy",
        bankTransferEligible: false,
      }));
  const chosenName =
    cards.find((c) => c.packId === wanted)?.name ??
    `${formatCredits(cards.find((c) => c.packId === wanted)?.credits ?? "0")} credits`;

  // The pack to point at: the smallest that covers what the run needs, or the one most
  // accounts choose when nothing in particular is waiting.
  const shortfall = need === null ? 0n : BigInt(need) - available;
  const sellable: readonly { packId: string; credits: string; bonusCredits: string }[] =
    view.billingReady ? view.packs : (view.listed?.packs ?? []);
  const suggested =
    shortfall > 0n
      ? (sellable.find((p) => BigInt(p.credits) + BigInt(p.bonusCredits) >= shortfall)
          ?.packId ?? sellable.at(-1)?.packId)
      : (sellable[1]?.packId ?? sellable[0]?.packId);

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

      {/*
        Buying is what this page is for (ADR 0050), so it is the first thing on it and it is
        never behind a form. Every pack is shown with its price and a button, whether or not the
        account has said where to invoice it yet. For a first purchase the button asks that one
        thing and then carries straight on to payment with the pack that was chosen.
      */}
      <section aria-labelledby="add-credits" data-testid="add-credits">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2
              id="add-credits"
              className="display text-[1.25rem] font-semibold tracking-tight text-neutral-900"
            >
              Add credits
            </h2>
            <p className="mt-0.5 text-[0.8125rem] text-neutral-600">
              One-time packs, no subscription. Credits never expire.
              {view.billingReady ? "" : " Prices are before tax."}
            </p>
          </div>
          <p className="flex items-center gap-1.5 text-[0.75rem] text-neutral-500">
            <Icon name="lock" size={13} />
            {/* Only a customer billed in rupees is told about Indian payment methods. */}
            {(view.currency ?? view.listed?.currency) === "INR"
              ? "Card, UPI, netbanking and wallets, through a secure payment window"
              : "Card payment, through a secure payment window"}
          </p>
        </div>

        <ul
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
          data-testid="wallet-packs"
        >
          {cards.map((p) => {
            const recommended = p.packId === suggested;
            return (
              <li
                key={p.packId}
                className={`lift relative flex flex-col rounded-2xl border bg-surface p-5 shadow-sm ${
                  recommended ? "border-accent-400 ring-1 ring-accent-400" : "border-line"
                }`}
                data-testid="wallet-pack"
              >
                {recommended ? (
                  <span className="absolute -top-2.5 left-5 rounded-full bg-accent-600 px-2.5 py-0.5 text-[0.6875rem] font-semibold tracking-wide text-white uppercase">
                    {need === null ? "Recommended" : "Covers this run"}
                  </span>
                ) : null}
                <h3 className="text-[0.9375rem] font-semibold text-neutral-900">
                  {p.name ?? `${formatCredits(p.credits)} credits`}
                </h3>
                <p className="mt-3 flex items-baseline gap-1.5">
                  <span className="display num text-left text-[1.875rem] leading-none font-semibold tracking-tight text-neutral-900">
                    {p.price}
                  </span>
                </p>
                <p className="mt-1 min-h-[1.125rem] text-[0.75rem] text-neutral-500">
                  {p.tax}
                </p>
                <p className="mt-3 text-[0.875rem] text-neutral-700">
                  <span className="num font-semibold text-neutral-900">
                    {formatCredits(p.credits)}
                  </span>{" "}
                  credits
                  {p.bonusCredits === "0" ? null : (
                    <Badge tone="positive" className="ml-2">
                      +{formatCredits(p.bonusCredits)} bonus
                    </Badge>
                  )}
                </p>
                <p className="mt-1.5 text-[0.75rem] leading-relaxed text-neutral-500">
                  {p.worth}
                </p>
                <div className="mt-4 flex-1" />
                <Button
                  variant={recommended ? "primary" : "secondary"}
                  disabled={busy !== null}
                  className="w-full"
                  iconAfter="arrow-right"
                  onClick={() => {
                    if (view.billingReady) void buy(p.packId);
                    else choose(p.packId);
                  }}
                >
                  {busy === p.packId ? "Opening payment…" : p.action}
                </Button>
                {p.bankTransferEligible ? (
                  <button
                    type="button"
                    className="mt-2 text-center text-[0.75rem] font-medium text-neutral-600 underline underline-offset-2 hover:text-neutral-900 disabled:opacity-50"
                    disabled={busy !== null}
                    onClick={() => void bankTransfer(p.packId)}
                  >
                    Pay by bank transfer
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>

        {view.billingReady ? null : (
          <div ref={billing} className="mt-4 scroll-mt-6">
            {wanted === null && !askingBilling ? (
              <p className="text-[0.8125rem] text-neutral-600">
                Your first purchase asks once where to invoice you, then goes to payment.{" "}
                <button
                  type="button"
                  className="font-medium text-accent-700 underline underline-offset-2"
                  onClick={() => {
                    setAskingBilling(true);
                  }}
                >
                  Add invoice details now
                </button>
              </p>
            ) : (
              <BillingDetailsForm
                defaultCountry={view.listed?.currency === "INR" ? "IN" : "US"}
                description={
                  wanted === null
                    ? "Asked once, to work out tax and print your invoice. You can change it later in Settings."
                    : `One thing before paying for ${chosenName}: where to invoice you. Asked once; tax depends on it.`
                }
                submitLabel={wanted === null ? "Save" : "Save and continue to payment"}
                onCancel={() => {
                  setWanted(null);
                  setAskingBilling(false);
                }}
                onSaved={() => {
                  void continuePurchase();
                }}
              />
            )}
          </div>
        )}
        {/* Spending is one link away and never between a customer and the packs (ADR 0050). */}
        <p className="mt-3 text-[0.75rem] text-neutral-500">
          <Link
            href="/wallet/prices"
            className="underline underline-offset-2 hover:text-neutral-800"
          >
            What actions cost
          </Link>
        </p>
      </section>

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
