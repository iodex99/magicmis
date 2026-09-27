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
import { listedPacks, packWorth } from "./server/packs";

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
  /**
   * The packs at their list price before tax, for an account that has not yet said where to
   * invoice it (ADR 0050). Tax and the total depend on that; what is for sale does not, and the
   * Wallet must never open on a form with nothing to buy in sight. Empty once `packs` is priced.
   */
  readonly listed: {
    readonly currency: Currency;
    readonly packs: readonly {
      packId: string;
      name: string | null;
      credits: string;
      bonusCredits: string;
      priceMinor: string;
      worth: string;
    }[];
  } | null;
  readonly packs: readonly {
    packId: string;
    name: string | null;
    /** What the pack covers in the customer's own terms, from the live price book. */
    worth: string;
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
export async function walletView(
  accountId: string,
  /** The currency to list packs in until the billing country settles it (`visitorCurrency`). */
  listCurrency: Currency,
): Promise<WalletView> {
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

  const [summary, quotes, worth, purchases, invoices, ledger] = await Promise.all([
    walletSummary(pool, accountId),
    quoting,
    packWorth(pool),
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
  // Read through a call: the flag is set inside the catch above, which the compiler cannot see,
  // so a bare read is narrowed to its initial `true`.
  const ready = ((): boolean => billingReady)();
  const listed = ready
    ? null
    : {
        currency: listCurrency,
        packs: (await listedPacks(pool, listCurrency)).map((p) => ({
          ...p,
          worth: worth(BigInt(p.credits) + BigInt(p.bonusCredits)),
        })),
      };
  return {
    billingReady,
    listed,
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
      name: p.name,
      worth: worth(p.credits + p.bonusCredits),
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
