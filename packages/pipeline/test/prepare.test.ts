import { randomBytes, randomUUID } from "node:crypto";

import { buildFixtureSet } from "@magicmis/fixtures";
import { Redactor } from "@magicmis/redact";
import { describe, expect, it } from "vitest";

import { prepare, type PipelineFile } from "../src/prepare";
import { priorFacts } from "../src/run";

const set = buildFixtureSet({ companies: ["trading"], months: 3 });
const asFile = (name: string): PipelineFile => {
  const f = set.files.find((x) => x.name === name);
  if (f === undefined) throw new Error(`no fixture ${name}`);
  return { fileId: randomUUID(), name: name.split("/").pop() ?? name, bytes: f.bytes() };
};

describe("prepare", () => {
  it("tokenises party ledgers before building facts, with stable tokens across months", async () => {
    const redactor = await Redactor.create(randomBytes(32));
    const april = await prepare(
      [asFile("trading/clean/trial_balance_2025-04.xlsx")],
      redactor,
    );
    const may = await prepare(
      [asFile("trading/clean/trial_balance_2025-05.xlsx")],
      redactor,
    );
    const parties = (p: typeof april) =>
      p.facts.filter((f) => f.groupPath.includes("Sundry Debtors")).map((f) => f.name);
    expect(parties(april).length).toBeGreaterThan(0);
    expect(parties(april).every((n) => /^PARTY_[0-9a-f]{12}$/u.test(n))).toBe(true);
    expect(parties(may)).toEqual(parties(april));
    expect(redactor.rehydrate(parties(april)[0] ?? "").name).not.toBeNull();
  });

  it("reports counts-only size descriptors and a monthly-stable sheet signature", async () => {
    const redactor = await Redactor.create(randomBytes(32));
    const april = await prepare(
      [asFile("trading/clean/trial_balance_2025-04.xlsx")],
      redactor,
    );
    const may = await prepare(
      [asFile("trading/clean/trial_balance_2025-05.xlsx")],
      redactor,
    );
    expect(april.fingerprints).toEqual(may.fingerprints);
    expect(Object.keys(april.fingerprints)).toEqual(["trial_balance:0"]);
    expect(april.size).toMatchObject({ files: 1, sheets: 1 });
    expect(april.size.distinctLedgerValues).toBe(
      new Set(april.facts.map((f) => f.ledgerKey)).size,
    );
    expect(april.available.has("balances")).toBe(true);
    expect(april.unrecognised).toEqual([]);
  });

  it("recognises bills and pay sheets and tokenises their people and parties", async () => {
    const redactor = await Redactor.create(randomBytes(32));
    const bills = set.files.find(
      (f) => f.report === "bills_receivable" && f.variant === "clean",
    );
    const pay = set.files.find((f) => f.report === "pay_sheet" && f.variant === "clean");
    if (bills === undefined || pay === undefined) throw new Error("fixtures missing");
    const p = await prepare([asFile(bills.name), asFile(pay.name)], redactor);
    expect(p.available).toEqual(new Set(["bills_receivable", "pay_sheet"]));
    expect(p.bills[0]?.lines.every((l) => l.party.startsWith("PARTY_"))).toBe(true);
    expect(p.pay[0]?.lines.every((l) => l.employee.startsWith("PERSON_"))).toBe(true);
  });
});

describe("priorFacts", () => {
  it("turns stored snapshot balances into facts for periods not loaded now, keeping their heads", () => {
    const { facts, mappings } = priorFacts(
      [
        {
          ledgerKey: "sales accounts > sales hardware",
          head: "REV_PRODUCTS",
          period: "2025-04",
          closing: "-100",
        },
        {
          ledgerKey: "sales accounts > sales hardware",
          head: "REV_PRODUCTS",
          period: "2025-05",
          closing: "-250",
        },
      ],
      new Set(["2025-05"]),
    );
    expect(facts.map((f) => [f.period, f.closing, f.groupPath])).toEqual([
      ["2025-04", -100n, ["sales accounts"]],
    ]);
    expect(mappings).toEqual([
      expect.objectContaining({
        ledgerKey: "sales accounts > sales hardware",
        head: "REV_PRODUCTS",
      }),
    ]);
  });
});
