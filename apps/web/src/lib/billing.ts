import "server-only";

import {
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
  const [validity, summary, packs, purchases, invoices, ledger] = await Promise.all([
    readConfig(pool, "wallet.lot_validity_months", z.number().int().positive()),
    walletSummary(pool, accountId),
    listPackQuotes(pool, { accountId }),
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
    packs: packs.map((p) => ({
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
