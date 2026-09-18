/** ADR 0046: one chat box. Which priced action a message is, decided by rules the customer can see. */

import { describe, expect, it } from "vitest";

import { detectIntent } from "../src/intent";

describe("detectIntent", () => {
  it.each([
    "Add a box comparing revenue with last year",
    "make a comparison box for gross margin and EBITDA",
    "Can you please add a chart of costs for the last six months?",
    "show me a graph of revenue against last year",
    "I want a KPI card for staff cost as a share of revenue",
    "create a formula for revenue per day and put it on the dashboard",
    "rename the first card to Sales",
    "Remove the waterfall",
    "delete working capital",
    "move the cash card to the top",
    "make the revenue chart wider",
    "turn the costs chart into a table",
    "Let's build a trend line of profit",
    "put debtor days next to the cash box",
    "Put a chart of the three biggest cost lines for the last six months under the KPIs",
    "Add revenue per day to the dashboard",
    "hide the working capital table",
  ])("a change to the dashboard: %s", (text) => {
    expect(detectIntent(text)).toBe("dashboard");
  });

  it.each([
    "Why did revenue fall in May?",
    "What does the revenue chart show?",
    "how is the gross margin card calculated",
    "Which ledgers drove the change in other expenses?",
    "Compare revenue with last year",
    "revenue this month",
    "Is the dashboard up to date?",
    "explain the waterfall chart",
    "can you explain why the table shows a loss",
    "tell me about debtor days",
    "What formula is used for EBITDA?",
    "add up the costs for me",
    // Other parts of the product, and things said about the dashboard rather than to it.
    "delete my account",
    "delete last month's files",
    "remove this company",
    "give me a summary of the dashboard",
    "show me the dashboard for March",
    "can you show the dashboard in millions",
    "show me a table of the top customers",
    "I need the revenue for April",
    "call the bank balance out for me",
    "remove the duplicate entries from the data",
    "",
    "   ",
  ])("a question: %s", (text) => {
    expect(detectIntent(text)).toBe("ask");
  });

  it("is not moved by case, spacing or politeness", () => {
    expect(detectIntent("  PLEASE   Could you ADD   a Chart of Revenue ")).toBe(
      "dashboard",
    );
    expect(detectIntent("Please, what is revenue?")).toBe("ask");
  });
});
