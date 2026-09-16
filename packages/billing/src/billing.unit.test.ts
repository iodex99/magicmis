import { createHmac } from "node:crypto";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { csvCell, istMonthRange, minorCell, toCsv } from "./exports";
import { computeGst, halfRate, placeOfSupply } from "./gst";
import {
  formatInvoiceNumber,
  fyLabel,
  fyShortLabel,
  gstFinancialYear,
  InvoiceNumberError,
} from "./invoice-number";
import { winAnsiSafe } from "./pdf";
import {
  RazorpayGateway,
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from "./razorpay";
import { amountInWordsIndian, numberInWordsIndian } from "./words";
import { parsePeriodId } from "@magicmis/core/time";

describe("GST (SPEC §13)", () => {
  it("splits intra-state supply into equal CGST and SGST at half the rate", () => {
    const g = computeGst({
      taxablePaise: 200_000n,
      ratePercent: "18",
      sellerStateCode: "27",
      placeOfSupplyStateCode: "27",
      rounding: "half_up",
    });
    expect(g).toMatchObject({
      supply: "intra_state",
      cgstPaise: 18_000n,
      sgstPaise: 18_000n,
      igstPaise: 0n,
      gstPaise: 36_000n,
      totalPaise: 236_000n,
    });
  });

  it("charges IGST at the full rate across states", () => {
    const g = computeGst({
      taxablePaise: 200_000n,
      ratePercent: "18",
      sellerStateCode: "27",
      placeOfSupplyStateCode: "29",
      rounding: "half_up",
    });
    expect(g).toMatchObject({
      supply: "inter_state",
      cgstPaise: 0n,
      sgstPaise: 0n,
      igstPaise: 36_000n,
      totalPaise: 236_000n,
    });
  });

  it("rounds each tax on its own, so CGST always equals SGST", () => {
    // 9% of ₹0.05 is 0.45 paise → 0 each; 9% of ₹0.06 is 0.54 → 1 each.
    const g = computeGst({
      taxablePaise: 6n,
      ratePercent: "18",
      sellerStateCode: "27",
      placeOfSupplyStateCode: "27",
      rounding: "half_up",
    });
    expect([g.cgstPaise, g.sgstPaise, g.gstPaise]).toEqual([1n, 1n, 2n]);
  });

  it("property: total = taxable + taxes, and intra/inter never mix", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10_000_000_000n }),
        fc.constantFrom("5", "12", "18", "28", "0.25"),
        fc.boolean(),
        (taxable, rate, same) => {
          const g = computeGst({
            taxablePaise: taxable,
            ratePercent: rate,
            sellerStateCode: "27",
            placeOfSupplyStateCode: same ? "27" : "07",
            rounding: "half_up",
          });
          const sumOk = g.cgstPaise + g.sgstPaise + g.igstPaise === g.gstPaise;
          const mixOk = g.igstPaise === 0n || g.cgstPaise + g.sgstPaise === 0n;
          return (
            sumOk &&
            mixOk &&
            g.totalPaise === taxable + g.gstPaise &&
            g.cgstPaise === g.sgstPaise
          );
        },
      ),
    );
  });

  it("halves decimal rates exactly", () => {
    expect(halfRate("18")).toBe("9");
    expect(halfRate("5")).toBe("2.5");
    expect(halfRate("0.25")).toBe("0.125");
    expect(halfRate("28")).toBe("14");
  });

  it("takes place of supply from the GSTIN when given, else the billing state", () => {
    expect(placeOfSupply({ gstin: "29ABCDE1234F1Z5", stateCode: "27" })).toBe("29");
    expect(placeOfSupply({ gstin: null, stateCode: "27" })).toBe("27");
  });
});

describe("invoice numbers (CGST Rule 46(b))", () => {
  const fy = gstFinancialYear(new Date("2027-01-10T06:00:00Z"));

  it("defaults to a 16-character serial", () => {
    const n = formatInvoiceNumber("{series}/{fy_short}/{seq:6}", {
      series: "INV",
      fy,
      seq: 123n,
    });
    expect(n).toBe("INV/26-27/000123");
    expect(n.length).toBe(16);
  });

  it("refuses the SPEC example format, which is 18 characters", () => {
    expect(() =>
      formatInvoiceNumber("{series}/{fy}/{seq:6}", { series: "INV", fy, seq: 123n }),
    ).toThrow(InvoiceNumberError);
  });

  it("refuses characters Rule 46 does not allow and formats without a sequence", () => {
    expect(() =>
      formatInvoiceNumber("INV {seq}", { series: "INV", fy, seq: 1n }),
    ).toThrow(InvoiceNumberError);
    expect(() =>
      formatInvoiceNumber("{series}/{fy}", { series: "INV", fy, seq: 1n }),
    ).toThrow(/no \{seq\}/u);
  });

  it("uses the GST financial year in IST, April to March", () => {
    const lastMomentFy = gstFinancialYear(new Date("2027-03-31T18:29:59Z")); // 23:59:59 IST
    const firstMomentNext = gstFinancialYear(new Date("2027-03-31T18:30:00Z")); // 00:00 IST 1 Apr
    expect(fyLabel(lastMomentFy)).toBe("2026-27");
    expect(fyLabel(firstMomentNext)).toBe("2027-28");
    expect(fyShortLabel(firstMomentNext)).toBe("27-28");
    expect(fyShortLabel(gstFinancialYear(new Date("2099-06-01T00:00:00Z")))).toBe(
      "99-00",
    );
  });
});

describe("amount in words (Indian system)", () => {
  it.each([
    [0n, "Zero"],
    [7n, "Seven"],
    [15n, "Fifteen"],
    [40n, "Forty"],
    [99n, "Ninety Nine"],
    [100n, "One Hundred"],
    [101n, "One Hundred One"],
    [2360n, "Two Thousand Three Hundred Sixty"],
    [100_000n, "One Lakh"],
    [1_18_000n, "One Lakh Eighteen Thousand"],
    [1_00_00_000n, "One Crore"],
    [
      12_34_56_789n,
      "Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine",
    ],
    [1_000_00_00_000n, "One Thousand Crore"],
  ])("%s → %s", (n, words) => {
    expect(numberInWordsIndian(n)).toBe(words);
  });

  it("writes rupees and paise", () => {
    expect(amountInWordsIndian(236_000n)).toBe(
      "Rupees Two Thousand Three Hundred Sixty Only",
    );
    expect(amountInWordsIndian(236_050n)).toBe(
      "Rupees Two Thousand Three Hundred Sixty and Fifty Paise Only",
    );
    expect(amountInWordsIndian(5n)).toBe("Rupees Zero and Five Paise Only");
  });
});

describe("Razorpay signatures", () => {
  const secret = "test_webhook_secret";

  it("verifies a webhook over the raw body, and rejects any change to it", () => {
    const body = '{"event":"payment.captured","payload":{}}';
    const signature = createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyWebhookSignature({ rawBody: body, signature, secret })).toBe(true);
    // Re-serialising the parsed JSON (spacing) breaks it, which is why we verify raw bytes.
    expect(
      verifyWebhookSignature({
        rawBody: JSON.stringify(JSON.parse(body), null, 1),
        signature,
        secret,
      }),
    ).toBe(false);
    expect(verifyWebhookSignature({ rawBody: body, signature: "zz", secret })).toBe(
      false,
    );
    expect(verifyWebhookSignature({ rawBody: body, signature, secret: "" })).toBe(false);
    expect(
      verifyWebhookSignature({ rawBody: body, signature: signature.slice(2), secret }),
    ).toBe(false);
  });

  it("verifies the checkout callback as order_id|payment_id", () => {
    const signature = createHmac("sha256", "key_secret")
      .update("order_ABC|pay_XYZ")
      .digest("hex");
    expect(
      verifyCheckoutSignature({
        orderId: "order_ABC",
        paymentId: "pay_XYZ",
        signature,
        keySecret: "key_secret",
      }),
    ).toBe(true);
    expect(
      verifyCheckoutSignature({
        orderId: "order_ABC",
        paymentId: "pay_OTHER",
        signature,
        keySecret: "key_secret",
      }),
    ).toBe(false);
  });

  it("creates an order with basic auth and an integer paise amount", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fakeFetch = (url: string, init?: RequestInit): Promise<Response> => {
      seen = { url, init: init ?? {} };
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: "order_1",
            amount: 236000,
            currency: "INR",
            status: "created",
          }),
          {
            status: 200,
          },
        ),
      );
    };
    const gw = new RazorpayGateway(
      "rzp_test_key",
      "secret",
      fakeFetch as unknown as typeof fetch,
    );
    const order = await gw.createOrder({
      amountMinor: 236_000n,
      currency: "INR",
      receipt: "r1",
      notes: { purchase_id: "p1" },
    });
    expect(order).toEqual({
      id: "order_1",
      amountMinor: 236_000n,
      currency: "INR",
      status: "created",
    });
    expect(seen?.url).toBe("https://api.razorpay.com/v1/orders");
    expect(seen?.init.body).toBe(
      '{"amount":236000,"currency":"INR","receipt":"r1","notes":{"purchase_id":"p1"}}',
    );
    const headers = seen?.init.headers as Record<string, string>;
    expect(headers["authorization"]).toBe(
      `Basic ${Buffer.from("rzp_test_key:secret").toString("base64")}`,
    );
    // A dollar order must reach Razorpay as dollars. Sending 2900 with "INR" would
    // charge twenty-nine rupees for a twenty-nine dollar pack.
    await gw.createOrder({
      amountMinor: 2_900n,
      currency: "USD",
      receipt: "r2",
      notes: {},
    });
    expect(seen?.init.body).toBe(
      '{"amount":2900,"currency":"USD","receipt":"r2","notes":{}}',
    );

    await expect(
      gw.createOrder({ amountMinor: 99n, currency: "INR", receipt: "r", notes: {} }),
    ).rejects.toThrow(RangeError);
    await expect(
      gw.createOrder({
        amountMinor: 100n,
        currency: "INR",
        receipt: "x".repeat(41),
        notes: {},
      }),
    ).rejects.toThrow(RangeError);
  });
});

describe("CSV exports", () => {
  it("quotes and neutralises formula-like cells", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("@SUM")).toBe("'@SUM");
    expect(toCsv(["a", "b"], [["1", "2"]])).toBe("a,b\r\n1,2\r\n");
  });

  it("renders paise as rupees", () => {
    expect(minorCell("236000")).toBe("2360.00");
    expect(minorCell(5n)).toBe("0.05");
    expect(minorCell("0")).toBe("0.00");
  });

  it("uses IST month boundaries", () => {
    const p = parsePeriodId("2027-04");
    if (p === null) throw new Error("bad period");
    const { from, to } = istMonthRange(p);
    expect(from.toISOString()).toBe("2027-03-31T18:30:00.000Z");
    expect(to.toISOString()).toBe("2027-04-30T18:30:00.000Z");
  });
});

describe("PDF text safety", () => {
  it("keeps Latin-1 and replaces characters Helvetica cannot draw", () => {
    expect(winAnsiSafe("Café Traders")).toBe("Café Traders");
    expect(winAnsiSafe("₹ राम")).toBe("? ???");
  });
});
