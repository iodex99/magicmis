"use client";

import { useCallback, useState } from "react";

import { Alert, Button, Panel } from "@/components/ui";
import { formatCredits, formatRupees } from "@/lib/actions";
import { PRODUCT_NAME } from "@/lib/brand";
import { api, newIdempotencyKey } from "@/lib/client-api";

import type { WalletView } from "@/lib/billing";

/** Razorpay Checkout's documented surface (https://razorpay.com/docs/payments/server-integration/nodejs/integration-steps/). */
interface RazorpayResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}
interface RazorpayInstance {
  open(): void;
  on(
    event: "payment.failed",
    handler: (response: { error: { description?: string } }) => void,
  ): void;
}
type RazorpayConstructor = new (options: {
  key: string;
  amount: string;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  handler: (response: RazorpayResponse) => void;
  modal?: { ondismiss?: () => void };
  theme?: { color?: string };
}) => RazorpayInstance;

const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

function loadCheckout(): Promise<RazorpayConstructor> {
  const existing = (window as unknown as { Razorpay?: RazorpayConstructor }).Razorpay;
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = CHECKOUT_SRC;
    script.async = true;
    script.onload = () => {
      const loaded = (window as unknown as { Razorpay?: RazorpayConstructor }).Razorpay;
      if (loaded) resolve(loaded);
      else reject(new Error("Checkout did not load"));
    };
    script.onerror = () => {
      reject(new Error("Checkout did not load"));
    };
    document.body.appendChild(script);
  });
}

const SOURCE_LABELS: Record<string, string> = {
  purchase: "Purchase",
  bonus: "Bonus",
  admin_grant: "Adjustment",
  goodwill: "Goodwill",
};
const ENTRY_LABELS: Record<string, string> = {
  grant: "Credits added",
  reserve: "Held for an action",
  release: "Hold released",
  capture: "Charged",
  expire: "Expired",
  admin_adjust: "Adjustment",
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
}: {
  initial: WalletView;
  businessName: string;
}) {
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
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
      amountPaise: string;
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
      amount: created.data.amountPaise,
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

  return (
    <div className="flex flex-col gap-6">
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}

      <Panel title="Balance">
        <dl className="grid grid-cols-3 gap-6" data-testid="wallet-balance">
          {[
            ["Available", view.available],
            ["Held for running actions", view.held],
            ["Total balance", view.balance],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-neutral-600">{label}</dt>
              <dd className="font-mono text-2xl tabular-nums text-neutral-900">
                {formatCredits(value ?? "0")}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-neutral-600">
          1 credit = ₹1 before GST. Credits are prepaid, non-refundable and expire{" "}
          {view.lotValidityMonths} months after purchase.
        </p>
      </Panel>

      <Panel title="Buy credits">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-neutral-600">
              <tr>
                <th className="py-2 pr-4 font-medium">Credits</th>
                <th className="py-2 pr-4 text-right font-medium">Price (ex-GST)</th>
                <th className="py-2 pr-4 text-right font-medium">GST</th>
                <th className="py-2 pr-4 text-right font-medium">Total</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {view.packs.map((p) => (
                <tr key={p.packId} className="border-t border-neutral-100">
                  <td className="py-2 pr-4 tabular-nums">
                    {formatCredits(p.credits)}
                    {p.bonusCredits !== "0" ? (
                      <span className="ml-2 text-xs text-positive">
                        +{formatCredits(p.bonusCredits)} bonus
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-4 text-right font-mono tabular-nums">
                    {formatRupees(p.taxablePaise)}
                  </td>
                  <td className="py-2 pr-4 text-right font-mono tabular-nums text-neutral-700">
                    {p.supply === "intra_state"
                      ? `CGST ${formatRupees(p.cgstPaise)} + SGST ${formatRupees(p.sgstPaise)}`
                      : `IGST ${formatRupees(p.igstPaise)}`}
                  </td>
                  <td className="py-2 pr-4 text-right font-mono tabular-nums font-medium">
                    {formatRupees(p.totalPaise)}
                  </td>
                  <td className="py-2 text-right whitespace-nowrap">
                    <Button disabled={busy !== null} onClick={() => void buy(p.packId)}>
                      Pay {formatRupees(p.totalPaise)}
                    </Button>
                    {p.bankTransferEligible ? (
                      <Button
                        variant="secondary"
                        className="ml-2"
                        disabled={busy !== null}
                        onClick={() => void bankTransfer(p.packId)}
                      >
                        Bank transfer
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Credit lots">
        {view.lots.length === 0 ? (
          <p className="text-sm text-neutral-700">No credits yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-neutral-600">
              <tr>
                <th className="py-2 font-medium">Source</th>
                <th className="py-2 text-right font-medium">Remaining</th>
                <th className="py-2 text-right font-medium">Expires</th>
              </tr>
            </thead>
            <tbody>
              {view.lots.map((l) => (
                <tr key={l.id} className="border-t border-neutral-100">
                  <td className="py-2">{SOURCE_LABELS[l.source] ?? l.source}</td>
                  <td className="py-2 text-right font-mono tabular-nums">
                    {formatCredits(l.remaining)}
                  </td>
                  <td className="py-2 text-right">{istDate(l.expiresAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="Invoices">
        {view.invoices.length === 0 ? (
          <p className="text-sm text-neutral-700">No invoices yet.</p>
        ) : (
          <table className="w-full text-sm" data-testid="invoices">
            <thead className="text-left text-xs text-neutral-600">
              <tr>
                <th className="py-2 font-medium">Number</th>
                <th className="py-2 font-medium">Type</th>
                <th className="py-2 font-medium">Date</th>
                <th className="py-2 text-right font-medium">Total</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {view.invoices.map((i) => (
                <tr key={i.id} className="border-t border-neutral-100">
                  <td className="py-2 font-mono">{i.number}</td>
                  <td className="py-2">
                    {i.type === "tax_invoice" ? "Tax invoice" : "Proforma"}
                  </td>
                  <td className="py-2">{istDate(i.issuedAt)}</td>
                  <td className="py-2 text-right font-mono tabular-nums">
                    {formatRupees(i.totalPaise)}
                  </td>
                  <td className="py-2 text-right">
                    <a
                      className="text-accent-700 underline"
                      href={`/api/invoices/${i.id}/pdf`}
                    >
                      Download PDF
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="History">
        {view.ledger.length === 0 ? (
          <p className="text-sm text-neutral-700">No activity yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-neutral-600">
              <tr>
                <th className="py-2 font-medium">Date</th>
                <th className="py-2 font-medium">Activity</th>
                <th className="py-2 text-right font-medium">Credits</th>
                <th className="py-2 text-right font-medium">Balance after</th>
              </tr>
            </thead>
            <tbody>
              {view.ledger.map((e) => (
                <tr key={e.seq} className="border-t border-neutral-100">
                  <td className="py-2">{istDate(e.createdAt)}</td>
                  <td className="py-2">{ENTRY_LABELS[e.entryType] ?? e.entryType}</td>
                  <td className="py-2 text-right font-mono tabular-nums">
                    {formatCredits(e.amount)}
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums">
                    {formatCredits(e.balanceAfter)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
