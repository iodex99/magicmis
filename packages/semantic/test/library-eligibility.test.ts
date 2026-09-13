import { describe, expect, it } from "vitest";

import { GLOBAL_LIBRARY_SEED } from "../src/library";
import { libraryIneligibleReason } from "../src/library-eligibility";
import { normaliseName } from "../src/normalise";

const reason = (raw: string) => libraryIneligibleReason(normaliseName(raw));

describe("global library eligibility (SPEC §18)", () => {
  it("accepts generic accounting heads", () => {
    for (const name of [
      "Courier Charges",
      "Rent A/c",
      "Bank Charges",
      "Staff Welfare Expenses",
      "TDS Payable on Rent",
      "Freight Outward",
    ])
      expect(reason(name), name).toBeNull();
  });

  it("accepts most of the seeded library, so the vocabulary matches real heads", () => {
    const names = GLOBAL_LIBRARY_SEED.flatMap((e) => [e.name, ...e.aliases]);
    const eligible = names.filter((n) => libraryIneligibleReason(n) === null);
    expect(eligible.length / names.length).toBeGreaterThan(0.8);
  });

  it("rejects redaction tokens, parties, people and numbered accounts", () => {
    expect(reason("PARTY_9f3a1c2e4b5d")).toBe("redaction_token");
    expect(reason("Rent PERSON_0123456789ab")).toBe("redaction_token");
    expect(reason("Sharma Traders Pvt Ltd")).toBe("person_or_party");
    expect(reason("M/s Gupta Enterprises")).toBe("person_or_party");
    expect(reason("Shri Ramesh Kumar Salary")).toBe("person_or_party");
    expect(reason("Loan from Mr Mehta")).toBe("person_or_party");
    expect(reason("HDFC Bank 50100234567891")).toBe("digits");
    expect(reason("Anita Desai")).toBe("not_accounting_vocabulary");
    expect(reason("")).toBe("empty");
    expect(
      reason(
        "rent for the ground floor office and the warehouse near the railway station",
      ),
    ).toBe("too_long");
  });
});
