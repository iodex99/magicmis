import { gridFromText, profileSheet } from "@magicmis/ingest";
import {
  gstinCheckCharacter,
  synthesiseAadhaarForFixtures,
  verhoeffCheckDigit,
} from "@magicmis/core/identifiers";
import { describe, expect, it } from "vitest";

import { columnSensitivity, findValueSpans } from "../src/detectors";
import { buildOutboundSheet, inspectPayload } from "../src/payload";
import { assertNoRawIdentifiers, Redactor } from "../src/redactor";
import { normaliseForToken, Tokeniser, TOKEN_HEX_LENGTH } from "../src/tokens";

// Fixed test keys: synthetic, never used anywhere else.
const KEY_A = new Uint8Array(32).fill(7);
const KEY_B = new Uint8Array(32).fill(9);

const GSTIN = (() => {
  const body = "27AAACN1234K1Z";
  return body + gstinCheckCharacter(body);
})();
const AADHAAR = synthesiseAadhaarForFixtures("23456789012");
const NOT_AADHAAR = (() => {
  const good = AADHAAR;
  const last = Number.parseInt(good.slice(-1), 10);
  return good.slice(0, -1) + ((last + 1) % 10).toString();
})();

const types = (text: string) => findValueSpans(text).map((s) => s.type);

describe("value detectors: positive cases", () => {
  it.each([
    ["PAN AAACN1234K on file", "PAN"],
    [`GSTIN ${GSTIN}`, "GSTIN"],
    [`Aadhaar ${AADHAAR}`, "AADHAAR"],
    [
      `Aadhaar ${AADHAAR.slice(0, 4)} ${AADHAAR.slice(4, 8)} ${AADHAAR.slice(8)}`,
      "AADHAAR",
    ],
    ["IFSC HDFC0001234", "IFSC"],
    ["mail accounts.team@example.test", "EMAIL"],
    ["call 9876543210", "MOBILE"],
    ["call +91 98765 43210", "MOBILE"],
    ["call 09876543210", "MOBILE"],
  ])("%s → %s", (text, type) => {
    expect(types(text)).toEqual([type]);
  });

  it("tokenises a GSTIN as a GSTIN, not as the PAN inside it", () => {
    expect(types(`Buyer ${GSTIN}`)).toEqual(["GSTIN"]);
  });
});

describe("value detectors: negative and false-positive cases", () => {
  it.each([
    "Invoice INV/2025-26/000123",
    "SI/25-26/0042",
    "Amount 1,00,000.00",
    "Amount 123456789012.50",
    `Amount ${AADHAAR}.00`,
    `Amount 1,${AADHAAR}`,
    `Twelve digits failing Verhoeff ${NOT_AADHAAR}`,
    "Starts with one 123456789012",
    "Voucher 1234567890",
    "Phone-like amount 98,76,54,321.00",
    "Batch AAACN1234",
    "lower case aaacn1234k",
    "HDFC1001234 has no zero in the fifth position",
    "no-at-sign.example.test",
  ])("%s → nothing", (text) => {
    expect(types(text)).toEqual([]);
  });

  it("confirms the non-Aadhaar specimen really fails Verhoeff", () => {
    expect(verhoeffCheckDigit(NOT_AADHAAR.slice(0, 11)).toString()).not.toBe(
      NOT_AADHAAR.slice(-1),
    );
  });
});

describe("column detectors", () => {
  it("trusts UAN and bank account digits only in labelled columns", () => {
    expect(columnSensitivity("UAN", "payroll")).toBe("UAN");
    expect(columnSensitivity("Bank A/c No.", "payroll")).toBe("BANKAC");
    expect(columnSensitivity("Account Number", "other")).toBe("BANKAC");
    expect(columnSensitivity("Voucher No.", "other")).toBeNull();
    expect(columnSensitivity("Amount", "other")).toBeNull();
  });

  it("finds person-name columns in payroll sheets by header", () => {
    for (const h of ["Name", "Employee Name", "Emp Name", "Staff"])
      expect(columnSensitivity(h, "payroll"), h).toBe("PERSON");
    expect(columnSensitivity("Name", "other")).toBeNull();
    expect(columnSensitivity("Employee Name", "other")).toBe("PERSON");
  });
});

describe("tokens (SPEC §17)", () => {
  it("are stable across months, casing and spacing, and differ by key and type", async () => {
    const a = await Tokeniser.fromKey(KEY_A);
    const b = await Tokeniser.fromKey(KEY_B);
    const t1 = await a.token("PARTY", "Northwind Hardware Stores");
    expect(t1).toMatch(
      new RegExp(`^PARTY_[0-9a-f]{${TOKEN_HEX_LENGTH.toString()}}$`, "u"),
    );
    expect(await a.token("PARTY", "  NORTHWIND   hardware stores ")).toBe(t1);
    expect(await a.token("PARTY", "Northwind Hardware Stores.")).toBe(t1);
    expect(await b.token("PARTY", "Northwind Hardware Stores")).not.toBe(t1);
    expect(await a.token("PERSON", "Northwind Hardware Stores")).not.toBe(
      t1.replace("PARTY", "PERSON"),
    );
    expect(normaliseForToken("MOBILE", "+91 98765-43210")).toBe(
      normaliseForToken("MOBILE", "09876543210"),
    );
  });

  it("has no collisions across 100,000 distinct values at the chosen length", async () => {
    const t = await Tokeniser.fromKey(KEY_A);
    const seen = new Set<string>();
    for (let i = 0; i < 100_000; i += 1)
      seen.add(await t.token("PARTY", `Synthetic Party ${i.toString()}`));
    expect(seen.size).toBe(100_000);
    // Birthday bound for this run: n²/2^(bits+1) ≈ 1.8e-5.
  }, 120_000);
});

describe("redactor", () => {
  it("replaces identifiers and registered party names in text, and rehydrates only in this session", async () => {
    const r = await Redactor.create(KEY_A);
    r.registerParties(["Northwind Hardware Stores", "Harbor Logistics"]);
    const out = await r.redactText(
      `Received from Northwind Hardware Stores (${GSTIN}), UTR ref, contact 9876543210`,
    );
    expect(out).not.toContain("Northwind");
    expect(out).not.toContain(GSTIN);
    expect(out).not.toContain("9876543210");
    const partyToken = /PARTY_[0-9a-f]{12}/u.exec(out)?.[0] ?? "";
    expect(r.rehydrate(partyToken)).toEqual({ name: "Northwind Hardware Stores" });
    expect(r.rehydrate("PARTY_000000000000")).toEqual({
      name: null,
      hint: "name not in loaded files",
    });
    expect(await r.redactText("Paid against SI/25-26/0001 amount 1,18,000.00")).toBe(
      "Paid against SI/25-26/0001 amount 1,18,000.00",
    );
  });

  it("leaves typed cells alone and tokenises user-marked sensitive columns", async () => {
    const r = await Redactor.create(KEY_A);
    expect(
      await r.redactCell("9876543210", {
        header: "Amount",
        sheetKind: "other",
        typed: true,
      }),
    ).toBe("9876543210");
    expect(
      await r.redactCell("Project Falcon", {
        header: "Remarks",
        sheetKind: "other",
        userSensitive: true,
      }),
    ).toMatch(/^SENSITIVE_/u);
    expect(
      await r.redactCell("123456789012", { header: "UAN", sheetKind: "payroll" }),
    ).toMatch(/^UAN_/u);
    expect(
      await r.redactCell("50100012345678", {
        header: "Bank A/c No.",
        sheetKind: "payroll",
      }),
    ).toMatch(/^BANKAC_/u);
    expect(
      await r.redactCell("50100012345678", { header: "Voucher No.", sheetKind: "other" }),
    ).toBe("50100012345678");
  });

  it("refuses to let a payload with a raw identifier through", () => {
    expect(() => {
      assertNoRawIdentifiers(JSON.stringify({ note: "AAACN1234K" }));
    }).toThrow(/PAN/u);
    expect(() => {
      assertNoRawIdentifiers(JSON.stringify({ note: "PAN_1a2b3c4d5e6f" }));
    }).not.toThrow();
  });
});

describe("outbound payload and inspector", () => {
  it("sends capped, redacted samples and no title lines", async () => {
    const grid = gridFromText("Pay Sheet", [
      ["Synthetic Components Manufacturing Ltd"],
      ["Pay Sheet"],
      ["1-Apr-25 to 30-Apr-25"],
      ["Employee Name", "PAN", "UAN", "Bank A/c No.", "Basic", "Net Pay"],
      ...Array.from({ length: 30 }, (_, i) => [
        `Employee ${i.toString()} Rao`,
        `AAAPR${(1000 + i).toString()}K`,
        (100000000000 + i).toString(),
        (50100000000000 + i).toString(),
        "18,000.00",
        "15,840.00",
      ]),
    ]);
    const profile = await profileSheet(grid);
    const redactor = await Redactor.create(KEY_A);
    const payload = await buildOutboundSheet({
      fileId: "f1",
      grid,
      profile,
      redactor,
      caps: { sampleRowsPerSheet: 15, distinctValuesPerColumn: 10 },
      sheetKind: "payroll",
      includeDistinctValuesFor: new Set([0]),
    });
    const json = inspectPayload(payload);
    expect(payload.sample).toHaveLength(15);
    expect(payload.period).toEqual({ from: "2025-04-01", to: "2025-04-30" });
    expect(json).not.toContain("Synthetic Components");
    expect(json).not.toContain("Rao");
    expect(json).not.toMatch(/AAAPR\d{4}K/u);
    expect(json).not.toContain("501000000000");
    expect(payload.sample[0]?.slice(4)).toEqual(["18,000.00", "15,840.00"]);
    expect(payload.columns[0]?.values).toHaveLength(10);
    expect(payload.columns[0]?.valuesTruncated).toBe(20);
    expect(redactor.stats().collisions).toBe(0);
  });
});
