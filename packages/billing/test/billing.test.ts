import { createHmac, randomUUID } from "node:crypto";

import { startTestDb, type TestDb } from "@magicmis/db/test-harness";
import { walletSummary } from "@magicmis/wallet";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { accountingCsv } from "../src/exports";
import { issueInvoice, listInvoices, loadInvoice } from "../src/invoice";
import { renderInvoicePdf } from "../src/pdf";
import {
  BillingError,
  createRazorpayPurchase,
  handleRazorpayWebhook,
  listPackQuotes,
  listPurchases,
  markBankTransferReceived,
  quotePack,
  reconcileRazorpayPurchases,
  requestBankTransfer,
} from "../src/purchases";
import type {
  CreateOrderInput,
  GatewayOrder,
  GatewayPayment,
  PaymentGateway,
} from "../src/razorpay";

let db: TestDb | undefined;
beforeAll(async () => {
  db = await startTestDb();
}, 180_000);
afterAll(async () => {
  await db?.stop();
});
function pool() {
  if (db === undefined) throw new Error("test database was not started");
  return db.pool;
}

// Config rows take effect from migration time (the real clock), so test instants are
// after it. 2027-01-10 is in GST FY 2026-27.
const NOW = new Date("2027-01-10T06:00:00Z");
const SECRET = "whsec_test_only";

class FakeGateway implements PaymentGateway {
  calls: CreateOrderInput[] = [];
  /** Payments Razorpay would report per order, for reconciliation tests. */
  payments = new Map<string, GatewayPayment[]>();
  fetchOrderPayments(orderId: string): Promise<GatewayPayment[]> {
    return Promise.resolve(this.payments.get(orderId) ?? []);
  }
  createOrder(input: CreateOrderInput): Promise<GatewayOrder> {
    this.calls.push(input);
    return Promise.resolve({
      id: `order_${randomUUID().replaceAll("-", "").slice(0, 14)}`,
      amountPaise: input.amountPaise,
      currency: "INR",
      status: "created",
    });
  }
}

async function account(stateCode = "27", gstin: string | null = null): Promise<string> {
  const r = await pool().query<{ id: string }>(
    `insert into accounts (auth_user_id, email, business_name, gstin, billing_address, state_code)
     values (gen_random_uuid(), $1, 'Synthetic Traders Pvt Ltd', $2, $3, $4) returning id`,
    [
      `${randomUUID()}@example.test`,
      gstin,
      JSON.stringify({
        line1: "1 Test Road",
        city: "Pune",
        pincode: "411001",
        stateCode,
      }),
      stateCode,
    ],
  );
  return r.rows[0]?.id ?? "";
}

async function packId(pricePaise: bigint): Promise<string> {
  const r = await pool().query<{ id: string }>(
    `select id from credit_packs where price_paise_ex_gst = $1 and active`,
    [pricePaise.toString()],
  );
  const id = r.rows[0]?.id;
  if (id === undefined) throw new Error(`no seeded pack at ${pricePaise.toString()}`);
  return id;
}

function webhook(
  event: string,
  orderId: string,
  amount: bigint,
  paymentId = `pay_${randomUUID().slice(0, 8)}`,
) {
  const rawBody = JSON.stringify({
    entity: "event",
    event,
    contains: ["payment"],
    payload: {
      payment: {
        entity: {
          id: paymentId,
          amount: Number.parseInt(amount.toString(), 10),
          currency: "INR",
          status: "captured",
          order_id: orderId,
        },
      },
    },
    created_at: 1_800_000_000,
  });
  return {
    rawBody,
    signature: createHmac("sha256", SECRET).update(rawBody).digest("hex"),
    eventId: `evt_${randomUUID()}`,
    secret: SECRET,
    now: NOW,
  };
}

describe("pack quotes", () => {
  it("shows ex-GST price with the GST line, by place of supply", async () => {
    const intra = await quotePack(pool(), {
      accountId: await account("27"),
      packId: await packId(500_000n),
      now: NOW,
    });
    expect(intra.gst).toMatchObject({
      supply: "intra_state",
      cgstPaise: 45_000n,
      sgstPaise: 45_000n,
      totalPaise: 590_000n,
    });
    expect(intra).toMatchObject({
      credits: 5000n,
      bonusCredits: 250n,
      bankTransferEligible: false,
    });

    const inter = await listPackQuotes(pool(), {
      accountId: await account("29"),
      now: NOW,
    });
    expect(inter).toHaveLength(6);
    expect(inter.every((q) => q.gst.supply === "inter_state")).toBe(true);
    expect(
      inter.filter((q) => q.bankTransferEligible).map((q) => q.gst.taxablePaise),
    ).toEqual([2_500_000n, 5_000_000n, 10_000_000n]);
  });

  it("refuses to quote before the billing state is known, and quotes once it is", async () => {
    // Billing details moved from sign-up to the first purchase (migration 0034), so an
    // account can exist without a state. GST place of supply is never guessed.
    const r = await pool().query<{ id: string }>(
      `insert into accounts (auth_user_id, email, business_name, state_code)
       values (gen_random_uuid(), $1, 'Synthetic Traders Pvt Ltd', null) returning id`,
      [`${randomUUID()}@example.test`],
    );
    const accountId = r.rows[0]?.id ?? "";

    await expect(listPackQuotes(pool(), { accountId, now: NOW })).rejects.toMatchObject({
      code: "BILLING_STATE_UNKNOWN",
    });

    // A GSTIN alone is enough: its first two digits are the place of supply (SPEC §13).
    await pool().query(`update accounts set gstin = $2 where id = $1`, [
      accountId,
      "29AAGCB7383J1Z4",
    ]);
    const quotes = await listPackQuotes(pool(), { accountId, now: NOW });
    expect(quotes).toHaveLength(6);
    expect(quotes.every((q) => q.gst.supply === "inter_state")).toBe(true);
  });
});

describe("Razorpay purchase → webhook → credits and invoice (SPEC §13)", () => {
  it("credits exactly once, issues a Rule 46 invoice, and renders a PDF", async () => {
    const accountId = await account("27");
    const gateway = new FakeGateway();
    const order = await createRazorpayPurchase(pool(), gateway, {
      accountId,
      packId: await packId(1_000_000n),
      idempotencyKey: randomUUID(),
      now: NOW,
    });
    expect(order.amountPaise).toBe(1_180_000n);
    expect(gateway.calls[0]?.receipt).toBe(order.purchaseId);

    // No credits before the webhook: the checkout callback grants nothing.
    expect((await walletSummary(pool(), accountId)).balance).toBe(0n);

    const captured = webhook("payment.captured", order.orderId, order.amountPaise);
    expect(await handleRazorpayWebhook(pool(), captured)).toEqual({
      status: "processed",
      outcome: "credited",
    });

    // The same event again, and the order.paid event for the same payment.
    expect(await handleRazorpayWebhook(pool(), captured)).toEqual({
      status: "duplicate",
    });
    expect(
      await handleRazorpayWebhook(pool(), {
        ...webhook("order.paid", order.orderId, order.amountPaise),
        now: NOW,
      }),
    ).toEqual({ status: "processed", outcome: "already_credited" });

    const wallet = await walletSummary(pool(), accountId);
    expect(wallet.balance).toBe(10_750n); // 10,000 + 750 bonus

    const lots = await pool().query<{
      source: string;
      credits_granted: string;
      expires_at: Date;
    }>(
      `select source, credits_granted::text, expires_at from credit_lots where account_id = $1 order by source`,
      [accountId],
    );
    expect(lots.rows.map((l) => [l.source, l.credits_granted])).toEqual([
      ["bonus", "750"],
      ["purchase", "10000"],
    ]);
    expect(lots.rows[0]?.expires_at.getTime()).toBe(lots.rows[1]?.expires_at.getTime());

    const [invoice, ...more] = await listInvoices(pool(), accountId);
    expect(more).toHaveLength(0);
    if (invoice === undefined) throw new Error("no invoice");
    expect(invoice.type).toBe("tax_invoice");
    expect(invoice.number).toMatch(/^INV\/26-27\/\d{6}$/u);
    expect(invoice.placeOfSupplyStateName).toBe("Maharashtra");
    expect(invoice.totals).toMatchObject({
      taxable_paise: "1000000",
      cgst_paise: "90000",
      sgst_paise: "90000",
      igst_paise: "0",
      total_paise: "1180000",
      cgst_rate_percent: "9",
      total_in_words: "Rupees Eleven Thousand Eight Hundred Only",
    });

    const purchases = await listPurchases(pool(), accountId);
    expect(purchases[0]?.status).toBe("credited");
    expect(purchases[0]?.razorpayPaymentId).toMatch(/^pay_/u);

    const pdf = await renderInvoicePdf(invoice);
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");
    const again = await renderInvoicePdf(
      (await loadInvoice(pool(), { invoiceId: invoice.id, accountId })) ?? invoice,
    );
    expect(Buffer.from(again).equals(Buffer.from(pdf))).toBe(true);
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);

    // Another account cannot load it.
    expect(
      await loadInvoice(pool(), { invoiceId: invoice.id, accountId: await account() }),
    ).toBeNull();
  });

  it("is idempotent per purchase request: the same key never creates a second order", async () => {
    const accountId = await account();
    const gateway = new FakeGateway();
    const key = randomUUID();
    const input = {
      accountId,
      packId: await packId(200_000n),
      idempotencyKey: key,
      now: NOW,
    };
    const a = await createRazorpayPurchase(pool(), gateway, input);
    const b = await createRazorpayPurchase(pool(), gateway, input);
    expect(b).toEqual(a);
    expect(gateway.calls).toHaveLength(1);
  });

  it("credits once under concurrent delivery of different events for one payment", async () => {
    const accountId = await account("07");
    const order = await createRazorpayPurchase(pool(), new FakeGateway(), {
      accountId,
      packId: await packId(200_000n),
      idempotencyKey: randomUUID(),
      now: NOW,
    });
    const paymentId = "pay_concurrent1";
    const results = await Promise.all([
      handleRazorpayWebhook(
        pool(),
        webhook("payment.captured", order.orderId, order.amountPaise, paymentId),
      ),
      handleRazorpayWebhook(
        pool(),
        webhook("order.paid", order.orderId, order.amountPaise, paymentId),
      ),
      handleRazorpayWebhook(
        pool(),
        webhook("payment.captured", order.orderId, order.amountPaise, paymentId),
      ),
    ]);
    expect(
      results.filter((r) => r.status === "processed" && r.outcome === "credited"),
    ).toHaveLength(1);
    expect((await walletSummary(pool(), accountId)).balance).toBe(2000n);
    const invoices = await listInvoices(pool(), accountId);
    expect(invoices).toHaveLength(1);
    expect(invoices[0]?.totals.supply).toBe("inter_state");
    expect(invoices[0]?.totals.igst_paise).toBe("36000");
  });

  it("rejects forged, malformed and mismatched webhooks without crediting", async () => {
    const accountId = await account();
    const order = await createRazorpayPurchase(pool(), new FakeGateway(), {
      accountId,
      packId: await packId(200_000n),
      idempotencyKey: randomUUID(),
      now: NOW,
    });
    const good = webhook("payment.captured", order.orderId, order.amountPaise);
    expect(
      await handleRazorpayWebhook(pool(), { ...good, signature: "00".repeat(32) }),
    ).toEqual({
      status: "invalid_signature",
    });
    expect(await handleRazorpayWebhook(pool(), { ...good, secret: "other" })).toEqual({
      status: "invalid_signature",
    });

    const short = webhook("payment.captured", order.orderId, order.amountPaise - 1n);
    expect(await handleRazorpayWebhook(pool(), short)).toEqual({
      status: "processed",
      outcome: "amount_mismatch",
    });

    const unknown = webhook("payment.captured", "order_doesnotexist", 236_000n);
    expect(await handleRazorpayWebhook(pool(), unknown)).toEqual({
      status: "processed",
      outcome: "unknown_order",
    });

    const garbage = "not json";
    expect(
      await handleRazorpayWebhook(pool(), {
        ...good,
        rawBody: garbage,
        signature: createHmac("sha256", SECRET).update(garbage).digest("hex"),
      }),
    ).toEqual({ status: "malformed" });

    expect((await walletSummary(pool(), accountId)).balance).toBe(0n);
    // The genuine event still credits afterwards.
    expect(await handleRazorpayWebhook(pool(), good)).toEqual({
      status: "processed",
      outcome: "credited",
    });
  });
});

describe("invoice numbering", () => {
  it("is gapless and unique under concurrent issue, and a rollback returns its number", async () => {
    const accountId = await account();
    const pack = await packId(200_000n);
    const orders = [];
    for (let i = 0; i < 20; i += 1) {
      orders.push(
        await createRazorpayPurchase(pool(), new FakeGateway(), {
          accountId,
          packId: pack,
          idempotencyKey: randomUUID(),
          now: NOW,
        }),
      );
    }

    // A transaction that takes a number and rolls back must not leave a gap.
    const client = await pool().connect();
    try {
      await client.query("begin");
      const p = (await listPurchases(client, accountId))[0];
      if (p === undefined) throw new Error("no purchase");
      await issueInvoice(client, { purchase: p, type: "tax_invoice", now: NOW });
      await client.query("rollback");
    } finally {
      client.release();
    }

    await Promise.all(
      orders.map((o) =>
        handleRazorpayWebhook(
          pool(),
          webhook("payment.captured", o.orderId, o.amountPaise),
        ),
      ),
    );

    const r = await pool().query<{ number: string }>(
      `select number from invoices where type = 'tax_invoice' and financial_year = '2026-27' order by number`,
    );
    const seqs = r.rows.map((x) => Number.parseInt(x.number.slice(-6), 10));
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, i) => i + 1));
  });
});

describe("bank transfer (SPEC §13)", () => {
  it("issues a proforma, then credits on admin receipt with a UTR, exactly once", async () => {
    const accountId = await account("27");
    const adminId = randomUUID();

    await expect(
      requestBankTransfer(pool(), {
        accountId,
        packId: await packId(1_000_000n),
        idempotencyKey: randomUUID(),
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "BANK_TRANSFER_NOT_ELIGIBLE" });

    const key = randomUUID();
    const { purchase, proforma } = await requestBankTransfer(pool(), {
      accountId,
      packId: await packId(2_500_000n),
      idempotencyKey: key,
      now: NOW,
    });
    expect(proforma?.type).toBe("proforma");
    expect(proforma?.number).toMatch(/^PRO\/26-27\/\d{6}$/u);
    expect(proforma?.totals.bank_details).not.toBeNull();
    expect(proforma?.totals.valid_until).toBe("2027-01-25T06:00:00.000Z");
    expect(purchase.status).toBe("pending");
    // Same request again: no second proforma.
    expect(
      (
        await requestBankTransfer(pool(), {
          accountId,
          packId: await packId(2_500_000n),
          idempotencyKey: key,
          now: NOW,
        })
      ).proforma,
    ).toBeNull();
    expect((await walletSummary(pool(), accountId)).balance).toBe(0n);

    await expect(
      markBankTransferReceived(pool(), {
        purchaseId: purchase.id,
        utr: "bad utr",
        adminId,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(BillingError);

    const utr = `UTR${randomUUID().replaceAll("-", "").slice(0, 13).toUpperCase()}`;
    const first = await markBankTransferReceived(pool(), {
      purchaseId: purchase.id,
      utr,
      adminId,
      now: NOW,
    });
    expect(first.status).toBe("credited");
    expect(
      (
        await markBankTransferReceived(pool(), {
          purchaseId: purchase.id,
          utr,
          adminId,
          now: NOW,
        })
      ).status,
    ).toBe("already_credited");
    expect((await walletSummary(pool(), accountId)).balance).toBe(27_500n);

    const docs = await listInvoices(pool(), accountId);
    expect(docs.map((d) => d.type).sort()).toEqual(["proforma", "tax_invoice"]);
    const proformaDoc = docs.find((d) => d.type === "proforma");
    if (proformaDoc === undefined) throw new Error("no proforma");
    const pdf = await renderInvoicePdf(proformaDoc);
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);

    const audit = await pool().query<{ action: string; actor_type: string }>(
      `select action, actor_type from audit_log where target_id = $1 order by seq`,
      [purchase.id],
    );
    expect(audit.rows.map((a) => a.action)).toEqual([
      "billing.bank_transfer_requested",
      "billing.bank_transfer_received",
      "billing.purchase_credited",
    ]);
    expect(audit.rows[2]?.actor_type).toBe("admin");

    // A UTR can settle only one purchase.
    const other = await requestBankTransfer(pool(), {
      accountId,
      packId: await packId(2_500_000n),
      idempotencyKey: randomUUID(),
      now: NOW,
    });
    await expect(
      markBankTransferReceived(pool(), {
        purchaseId: other.purchase.id,
        utr,
        adminId,
        now: NOW,
      }),
    ).rejects.toThrow(/purchases_bank_utr_idx/u);
  });
});

describe("accounting exports", () => {
  it("produces each monthly CSV with the month's invoices", async () => {
    const month = new Date().toISOString().slice(0, 7);
    // Invoices were issued with issued_at = NOW (2027-01); ledger rows carry the real clock.
    const register = await accountingCsv(pool(), "invoice_register", "2027-01");
    expect(register.split("\r\n")[0]).toBe(
      "invoice_number,type,date_ist,buyer_name,buyer_gstin,place_of_supply_code,taxable_inr,cgst_inr,sgst_inr,igst_inr,total_inr",
    );
    expect(register).toContain("INV/26-27/000001");
    const gst = await accountingCsv(pool(), "gst_summary", "2027-01");
    expect(gst).toMatch(/^intra_state,27,Maharashtra,/mu);
    expect(gst).toMatch(/^inter_state,07,Delhi,/mu);
    const sold = await accountingCsv(pool(), "credits_sold", "2027-01");
    expect(sold.split("\r\n").length).toBeGreaterThan(3);
    const outstanding = await accountingCsv(pool(), "outstanding_credits", month);
    expect(outstanding).toMatch(/^TOTAL,\d+,$/mu);
    await expect(accountingCsv(pool(), "credits_consumed", "2027-13")).rejects.toThrow(
      RangeError,
    );
  });
});

describe("Razorpay reconciliation when webhooks never arrive (R-51)", () => {
  it("credits a captured payment through the webhook path once, leaves unpaid and mismatched orders alone", async () => {
    const gateway = new FakeGateway();
    const buy = async () => {
      const accountId = await account("27");
      const order = await createRazorpayPurchase(pool(), gateway, {
        accountId,
        packId: await packId(1_000_000n),
        idempotencyKey: randomUUID(),
        now: NOW,
      });
      return { accountId, order };
    };
    const paid = await buy();
    const unpaid = await buy();
    const wrong = await buy();
    const payments = (orderId: string, amountPaise: bigint): GatewayPayment[] => [
      {
        id: "pay_failedattempt",
        amountPaise,
        currency: "INR",
        status: "failed",
        orderId,
      },
      {
        id: `pay_${randomUUID().slice(0, 8)}`,
        amountPaise,
        currency: "INR",
        status: "captured",
        orderId,
      },
    ];
    gateway.payments.set(
      paid.order.orderId,
      payments(paid.order.orderId, paid.order.amountPaise),
    );
    gateway.payments.set(wrong.order.orderId, payments(wrong.order.orderId, 100n));

    // Too early: the webhook still has time to arrive.
    const early = await reconcileRazorpayPurchases(
      pool(),
      gateway,
      new Date(NOW.getTime() + 5 * 60_000),
    );
    expect(early.credited).toBe(0);

    const later = new Date(NOW.getTime() + 45 * 60_000);
    const run = await reconcileRazorpayPurchases(pool(), gateway, later);
    expect(run.credited).toBeGreaterThanOrEqual(1);
    expect(run.amountMismatches).toBeGreaterThanOrEqual(1);
    expect((await walletSummary(pool(), paid.accountId)).balance).toBe(10_750n);
    expect((await walletSummary(pool(), unpaid.accountId)).balance).toBe(0n);
    expect((await walletSummary(pool(), wrong.accountId)).balance).toBe(0n);
    const [invoice] = await listInvoices(pool(), paid.accountId);
    expect(invoice?.type).toBe("tax_invoice");
    const audited = await pool().query(
      `select count(*)::int as n from audit_log where action = 'billing.purchase_reconciled' and target_id = $1`,
      [paid.order.purchaseId],
    );
    expect(audited.rows[0]).toEqual({ n: 1 });

    // Again, and then the late webhook: nothing is credited twice.
    await reconcileRazorpayPurchases(pool(), gateway, new Date(later.getTime() + 60_000));
    expect(
      await handleRazorpayWebhook(
        pool(),
        webhook("payment.captured", paid.order.orderId, paid.order.amountPaise),
      ),
    ).toEqual({ status: "processed", outcome: "already_credited" });
    expect((await walletSummary(pool(), paid.accountId)).balance).toBe(10_750n);
    expect(await listInvoices(pool(), paid.accountId)).toHaveLength(1);
  });
});
