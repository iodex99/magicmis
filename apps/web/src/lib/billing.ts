import "server-only";

import {
  BillingError,
  listInvoices,
  listPackQuotes,
  listPurchases,
  RazorpayGateway,
  type PaymentGateway,
} from "@magicmis/billing";
import { readConfig } from "@magicmis/db/config";
import { walletSummary } from "@magicmis/wallet";
import { z } from "zod";

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
   * False until the account has a GSTIN or a billing state. GST place of supply cannot be
   * guessed, so packs cannot be quoted until one is known — the Wallet asks for it inline
   * rather than the sign-up form asking for it up front (migration 0034).
   */
  readonly billingReady: boolean;
  readonly balance: string;
  readonly held: string;
  readonly available: string;
  readonly lotValidityMonths: number;
  readonly lots: readonly {
    id: string;
    source: string;
    remaining: string;
    expiresAt: string;
  }[];
  readonly packs: readonly {
    packId: string;
    credits: string;
    bonusCredits: string;
    taxablePaise: string;
    supply: "intra_state" | "inter_state";
    ratePercent: string;
    cgstPaise: string;
    sgstPaise: string;
    igstPaise: string;
    totalPaise: string;
    bankTransferEligible: boolean;
  }[];
  readonly purchases: readonly {
    id: string;
    method: string;
    status: string;
    credits: string;
    bonusCredits: string;
    totalPaise: string;
    createdAt: string;
  }[];
  readonly invoices: readonly {
    id: string;
    type: string;
    number: string;
    issuedAt: string;
    totalPaise: string;
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

  const [validity, summary, quotes, purchases, invoices, ledger] = await Promise.all([
    readConfig(pool, "wallet.lot_validity_months", z.number().int().positive()),
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
    lotValidityMonths: validity,
    lots: summary.lots.map((l) => ({
      id: l.id,
      source: l.source,
      remaining: l.remaining.toString(),
      expiresAt: l.expiresAt.toISOString(),
    })),
    packs: quotes.map((p) => ({
      packId: p.packId,
      credits: p.credits.toString(),
      bonusCredits: p.bonusCredits.toString(),
      taxablePaise: p.gst.taxablePaise.toString(),
      supply: p.gst.supply,
      ratePercent: p.gst.ratePercent,
      cgstPaise: p.gst.cgstPaise.toString(),
      sgstPaise: p.gst.sgstPaise.toString(),
      igstPaise: p.gst.igstPaise.toString(),
      totalPaise: p.gst.totalPaise.toString(),
      bankTransferEligible: p.bankTransferEligible,
    })),
    purchases: purchases.map((p) => ({
      id: p.id,
      method: p.method,
      status: p.status,
      credits: p.credits.toString(),
      bonusCredits: p.bonusCredits.toString(),
      totalPaise: p.totalPaise.toString(),
      createdAt: p.createdAt.toISOString(),
    })),
    invoices: invoices.map((i) => ({
      id: i.id,
      type: i.type,
      number: i.number,
      issuedAt: i.issuedAt.toISOString(),
      totalPaise: i.totals.total_paise,
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
