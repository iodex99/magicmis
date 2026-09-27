"use client";

import { useEffect, useRef, useState } from "react";

import { formatCredits, formatMoney } from "@/lib/actions";
import { PRODUCT_NAME } from "@/lib/brand";
import { loadCheckout, type RazorpayConstructor } from "@/lib/checkout";
import { api, newIdempotencyKey } from "@/lib/client-api";

import { Alert, Button, Panel } from "./ui";

import type { WalletView } from "@/lib/billing";

/**
 * Buying credits without leaving the screen that needs them (ADR 0027, R-57).
 *
 * Leaving a run loses the files chosen on the screen, so "go to the Wallet and come back"
 * costs a setup its thirteen months of uploads. The purchase happens here instead; the CSP
 * allows Razorpay on this path for that reason and no other (`proxy.ts`).
 *
 * `onCredited` fires once the webhook has actually granted the credits, so the caller can
 * re-price and let the run proceed. Nothing about the job is touched here.
 */
export function BuyCreditsInline({
  need,
  businessName,
  onCredited,
}: {
  /** Credits the waiting action needs, so the smallest covering pack can be offered. */
  need: bigint;
  businessName: string;
  onCredited: () => void;
}) {
  const [view, setView] = useState<WalletView | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    tone: "info" | "success" | "error";
    text: string;
  } | null>(null);

  /**
   * False once this card is gone from the screen.
   *
   * The confirmation poll below runs for half a minute after the payment window closes, and
   * the reader is free to leave in the middle of it. Without this it keeps asking the
   * server for a wallet nobody is looking at, and calls `onCredited` into a run that no
   * longer exists. The payment itself is unaffected — the webhook grants the credits
   * server-side whether or not anyone is watching.
   */
  /** Prices in whatever the account is billed in (ADR 0030), never assumed rupees. */
  const money = (minor: string) => formatMoney(view?.currency ?? "INR", minor);

  const live = useRef<boolean>(true);
  // Read through a call: a bare `live.current` check stays narrowed across every await
  // that follows it, so the later guards would be compiled away as "always true".
  const isLive = () => live.current;
  useEffect(() => {
    live.current = true;
    const load = () =>
      void api<WalletView>("/api/wallet").then((r) => {
        if (!isLive()) return;
        if (r.ok) setView(r.data);
        else setNotice({ tone: "error", text: r.message });
      });
    load();
    // Billing details are added in another tab (below), so that this one keeps its files or its
    // message. Coming back to this tab looks again, and the packs are simply there (ADR 0049).
    window.addEventListener("focus", load);
    return () => {
      live.current = false;
      window.removeEventListener("focus", load);
    };
  }, []);

  async function buy(packId: string) {
    setBusy(true);
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
      setBusy(false);
      setNotice({ tone: "error", text: created.message });
      return;
    }
    let Razorpay: RazorpayConstructor;
    try {
      Razorpay = await loadCheckout();
    } catch {
      setBusy(false);
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
          if (!isLive()) return;
          if (!verified.ok) {
            setBusy(false);
            setNotice({ tone: "error", text: verified.message });
            return;
          }
          setNotice({
            tone: "info",
            text: "Payment received. Confirming with the payment provider…",
          });
          // The webhook grants the credits; poll briefly, then hand back.
          for (let i = 0; i < 20 && isLive(); i += 1) {
            await new Promise((r) => setTimeout(r, 1500));
            if (!isLive()) return;
            const next = await api<WalletView>("/api/wallet");
            if (
              next.ok &&
              next.data.purchases.find((p) => p.id === created.data.purchaseId)
                ?.status === "credited"
            ) {
              setBusy(false);
              setNotice({ tone: "success", text: "Credits added. You can run it now." });
              onCredited();
              return;
            }
          }
          if (!isLive()) return;
          setBusy(false);
          setNotice({
            tone: "info",
            text: "Payment received. Credits appear as soon as the provider confirms it — usually within a few minutes.",
          });
        })();
      },
      modal: {
        ondismiss: () => {
          setBusy(false);
        },
      },
    });
    checkout.on("payment.failed", (response) => {
      setBusy(false);
      setNotice({
        tone: "error",
        text: response.error.description ?? "The payment failed. No credits were added.",
      });
    });
    checkout.open();
  }

  if (view !== null && !view.billingReady) {
    return (
      <Alert tone="info" title="One thing first: where to invoice you">
        We ask once, before your first purchase, because tax depends on it.{" "}
        {/* A new tab, deliberately. In this one it would replace the page, and with it the
            files or the message this panel promises to keep. */}
        <a
          href="/wallet"
          target="_blank"
          rel="noopener"
          className="font-medium underline"
          data-testid="billing-first"
        >
          Add it in the Wallet
        </a>{" "}
        (opens in a new tab). Everything here stays as it is, and the credit packs appear
        when you come back.
      </Alert>
    );
  }

  // The smallest pack that covers the shortfall, then the next one up as an alternative.
  const covering = (view?.packs ?? []).filter(
    (p) => BigInt(p.credits) + BigInt(p.bonusCredits) >= need,
  );
  const offered =
    covering.length > 0 ? covering.slice(0, 2) : (view?.packs.slice(-1) ?? []);

  return (
    <Panel title="Add credits" icon="wallet" padding="sm">
      <div className="flex flex-col gap-3">
        {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
        <p className="text-[0.8125rem] text-neutral-600">
          You need {formatCredits(need.toString())} more. Buying here keeps your files
          loaded.
        </p>
        {view === null ? (
          <p className="text-[0.8125rem] text-neutral-500">Loading packs…</p>
        ) : (
          offered.map((p, i) => (
            <Button
              key={p.packId}
              variant={i === 0 ? "primary" : "secondary"}
              disabled={busy}
              onClick={() => void buy(p.packId)}
              className="w-full"
            >
              {formatCredits(p.credits)}
              {p.bonusCredits === "0"
                ? ""
                : ` + ${formatCredits(p.bonusCredits)} bonus`}{" "}
              — {money(p.totalMinor)}
            </Button>
          ))
        )}
        <p className="text-[0.75rem] text-neutral-500">
          {/* A sale outside India is a zero-rated export, and the document is an export
              invoice, not a tax invoice (ADR 0030, ADR 0057). The Wallet already said this
              correctly; the inline top-up did not. */}
          {(view?.currency ?? "INR") === "INR"
            ? "Includes GST. A tax invoice is issued the moment the payment is confirmed."
            : "No tax added. An invoice is issued the moment the payment is confirmed."}
        </p>
      </div>
    </Panel>
  );
}
