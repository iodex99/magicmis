import "server-only";

import {
  BillingError,
  listInvoices,
  listPackQuotes,
  listPurchases,
  RazorpayGateway,
  type PaymentGateway,
} from "@magicmis/billing";
import type { Currency } from "@magicmis/core/money";
import { walletSummary } from "@magicmis/wallet";

import { db } from "./db";
import { serverEnv } from "./env";

let gateway: PaymentGateway | undefined;

export function paymentGateway(): PaymentGateway {
  const env = serverEnv();
  gateway ??= new RazorpayGateway(env.RAZORPAY_KEY_ID, env.RAZORPAY_KEY_SECRET);
  return gateway;
}

export interface WalletView {
  /**
   * False until the account has a billing country, and for India a GSTIN or state. Neither
   * the currency nor the tax treatment can be guessed from nothing, so packs cannot be
   * quoted until they are known — the Wallet asks inline rather than the sign-up form
   * asking up front (migration 0034, ADR 0030).
   */
  readonly billingReady: boolean;
  readonly balance: string;
  readonly held: string;
  readonly available: string;
  readonly lots: readonly {
    id: string;
    source: string;
    remaining: string;
    granted: string;
  }[];
  /**
   * What the account is billed in: INR for India, USD for everywhere else (ADR 0030).
   * Every pack amount below is integer minor units of it.
   *
   * Null until the billing country is known, which is the same moment `billingReady`
   * becomes true — before that there are no packs to price and no currency to price them
   * in, and defaulting to one would show a visitor abroad a rupee figure.
   */
  readonly currency: Currency | null;
  readonly packs: readonly {
    packId: string;
    credits: string;
    bonusCredits: string;
    taxableMinor: string;
    supply: "intra_state" | "inter_state" | "export";
    ratePercent: string;
    cgstMinor: string;
    sgstMinor: string;
    igstMinor: string;
    totalMinor: string;
    bankTransferEligible: boolean;
  }[];
  readonly purchases: readonly {
    id: string;
    method: string;
    status: string;
    credits: string;
    bonusCredits: string;
    currency: Currency;
    totalMinor: string;
    createdAt: string;
  }[];
  readonly invoices: readonly {
    id: string;
    type: string;
    number: string;
    issuedAt: string;
    currency: Currency;
    totalMinor: string;
  }[];
  readonly ledger: readonly {
    seq: string;
    entryType: string;
    amount: string;
    balanceAfter: string;
    createdAt: string;
  }[];
}

/** Everything the Wallet page shows, as JSON-safe strings (bigints never cross to the client). */
export async function walletView(accountId: string): Promise<WalletView> {
  const pool = db();
  /**
   * Packs can only be quoted once GST place of supply is known (SPEC §13), and billing
   * details are collected at the first purchase (migration 0034). Ask the thing that
   * decides rather than re-deriving its rule here: `accountTax` refuses with
   * `BILLING_STATE_UNKNOWN`, and that refusal is what the Wallet renders its form for.
   */
  let billingReady = true;
  const quoting = listPackQuotes(pool, { accountId }).catch((error: unknown) => {
    // Assigned while the other queries are still in flight; read only after the await
    // below, by which time this handler has certainly run.
    if (error instanceof BillingError && error.code === "BILLING_STATE_UNKNOWN") {
      billingReady = false;
      return [];
    }
    throw error;
  });

  const [summary, quotes, purchases, invoices, ledger] = await Promise.all([
    walletSummary(pool, accountId),
    quoting,
    listPurchases(pool, accountId),
    listInvoices(pool, accountId),
    pool.query<{
      seq_text: string;
      entry_type: string;
      amount: string;
      balance_after: string;
      created_at: Date;
    }>(
      `select seq::text as seq_text, entry_type, amount::text as amount,
              balance_after::text as balance_after, created_at
       from public.credit_ledger where account_id = $1 order by seq desc limit 50`,
      [accountId],
    ),
  ]);
  return {
    billingReady,
    balance: summary.balance.toString(),
    held: summary.held.toString(),
    available: summary.available.toString(),
    lots: summary.lots.map((l) => ({
      id: l.id,
      source: l.source,
      remaining: l.remaining.toString(),
      granted: l.granted.toString(),
    })),
    // Taken from the quotes rather than queried again: they were all priced in the
    // account's currency, so if there are any, that is it.
    currency: quotes[0]?.currency ?? null,
    packs: quotes.map((p) => ({
      packId: p.packId,
      credits: p.credits.toString(),
      bonusCredits: p.bonusCredits.toString(),
      taxableMinor: p.tax.taxableMinor.toString(),
      supply: p.tax.supply,
      ratePercent: p.tax.ratePercent,
      cgstMinor: p.tax.cgstMinor.toString(),
      sgstMinor: p.tax.sgstMinor.toString(),
      igstMinor: p.tax.igstMinor.toString(),
      totalMinor: p.tax.totalMinor.toString(),
      bankTransferEligible: p.bankTransferEligible,
    })),
    purchases: purchases.map((p) => ({
      id: p.id,
      method: p.method,
      status: p.status,
      credits: p.credits.toString(),
      bonusCredits: p.bonusCredits.toString(),
      currency: p.currency,
      totalMinor: p.totalMinor.toString(),
      createdAt: p.createdAt.toISOString(),
    })),
    invoices: invoices.map((i) => ({
      id: i.id,
      type: i.type,
      number: i.number,
      issuedAt: i.issuedAt.toISOString(),
      currency: i.totals.currency,
      totalMinor: i.totals.total_minor,
    })),
    ledger: ledger.rows.map((r) => ({
      seq: r.seq_text,
      entryType: r.entry_type,
      amount: r.amount,
      balanceAfter: r.balance_after,
      createdAt: r.created_at.toISOString(),
    })),
  };
}
