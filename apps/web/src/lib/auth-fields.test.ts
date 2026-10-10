import { describe, expect, it } from "vitest";

import { businessNameField, signupBodySchema } from "./auth-fields";

// ADR 0091: what the sign-up and finish forms show under the business name is written for a
// person, never Zod's own "Too small: expected string to have >=2 characters".
describe("the business name on sign-up and finish", () => {
  const message = (input: unknown): string | undefined =>
    businessNameField.safeParse(input).error?.issues[0]?.message;

  it("says plainly what is missing", () => {
    expect(message("")).toBe("Enter your business name: at least 2 characters.");
    expect(message("  A ")).toBe("Enter your business name: at least 2 characters.");
    expect(message(undefined)).toBe("Enter your business name.");
    expect(message("x".repeat(201))).toBe("Keep the business name to 200 characters.");
  });

  it("still applies the package's own rule after its own", () => {
    expect(businessNameField.parse("  Northwind & Co ")).toBe("Northwind & Co");
    // Not printable on an invoice: the account package's message, not a length one.
    expect(message("株式会社")).toMatch(/cannot be used here/u);
  });

  it("is what sign-up parses, so the route reports it against the field", () => {
    const parsed = signupBodySchema.safeParse({
      email: "owner@example.test",
      password: "Correct-Horse-42",
      businessName: "A",
      acceptTerms: true,
      acceptPrivacy: true,
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(["businessName"]);
    expect(parsed.error?.issues[0]?.message).toMatch(/^Enter your business name/u);
  });
});
