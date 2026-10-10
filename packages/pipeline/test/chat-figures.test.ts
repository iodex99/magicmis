/**
 * What a Deep answer's figures are made of (ADR 0077): the month column the server computes so the
 * model never subtracts year-to-date balances itself, and the rule that keeps a large amount from
 * being taken for a mobile number while a number cast out of a ledger name is still redacted.
 */

import type { Mapping } from "@magicmis/semantic";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openTestDuck } from "../../ingest/test/duck";
import { chatTables, loadChatTables, runChatQuery, textDigitRuns } from "../src/chat";
import type { Prepared } from "../src/prepare";

const fact = (ledgerKey: string, period: string, closing: bigint) => {
  const parts = ledgerKey.split(" > ");
  return {
    ledgerKey,
    name: parts.at(-1) ?? ledgerKey,
    groupPath: parts.slice(0, -1),
    period,
    opening: null,
    debit: null,
    credit: null,
    closing,
  };
};

const RENT = "Indirect Expenses > Rent";
const BANK = "Current Assets > Bank Accounts > Current A/c";
const PHONE_LEDGER = "Indirect Expenses > Mobile 9876543210 Plan";

function tables(periods: Record<string, readonly [string, bigint][]>) {
  const facts = Object.entries(periods).flatMap(([period, rows]) =>
    rows.map(([key, closing]) => fact(key, period, closing)),
  );
  const mappings = [
    { ledgerKey: RENT, head: "OTHER_EXPENSES" },
    { ledgerKey: BANK, head: "CA_CASH" },
    { ledgerKey: PHONE_LEDGER, head: "OTHER_EXPENSES" },
  ] as unknown as Mapping[];
  return chatTables({ facts, bills: [] } as unknown as Prepared, mappings, (c) => c, {
    fyStartMonth: 4,
    isPnl: (head) => head === "OTHER_EXPENSES",
  });
}

const month = (t: ReturnType<typeof tables>, ledger: string, period: string) =>
  t.balances.find((r) => r[3] === ledger && r[0] === period)?.[9];

describe("the month column", () => {
  it("gives an income or expense ledger its month, not its year to date", () => {
    const t = tables({
      "2025-03": [[RENT, 600n]],
      "2025-04": [[RENT, 50n]],
      "2025-05": [[RENT, 120n]],
    });
    // The first month of the year is its own closing: March's balance belongs to the last year.
    expect(month(t, "Rent", "2025-04")).toBe(50n);
    expect(month(t, "Rent", "2025-05")).toBe(70n);
    // March has no February in the session, so its month is unknown rather than its year to date.
    expect(month(t, "Rent", "2025-03")).toBeNull();
  });

  it("gives any other ledger its change, and null across a missing month", () => {
    const t = tables({
      "2025-04": [[BANK, 1000n]],
      "2025-05": [[BANK, 900n]],
      // June is hidden by the customer: July's change cannot be known.
      "2025-07": [[BANK, 1500n]],
    });
    expect(month(t, "Current A/c", "2025-05")).toBe(-100n);
    expect(month(t, "Current A/c", "2025-07")).toBeNull();
  });
});

describe("figures and identifiers in a Deep result", () => {
  let duck: Awaited<ReturnType<typeof openTestDuck>> | undefined;
  const t = tables({
    "2025-06": [
      [BANK, 7_374_941_000n],
      [PHONE_LEDGER, 100n],
    ],
  });
  beforeAll(async () => {
    duck = await openTestDuck();
    await loadChatTables(duck, t);
  });
  afterAll(() => {
    duck?.close();
  });
  const run = (sql: string) => {
    if (duck === undefined) throw new Error("duck not open");
    return runChatQuery(duck, sql, {
      maxRows: 50,
      maxBytes: 16_384,
      timeoutMs: 10_000,
      // An Indian mobile number: ten digits starting 6 to 9.
      redactText: (s) =>
        Promise.resolve(s.replace(/(?<!\d)[6-9]\d{9}(?!\d)/gu, "MOBILE_x")),
      textDigits: textDigitRuns(t),
    });
  };

  it("shows seventy-three crore as a figure, not as a mobile number", async () => {
    const r = await run(
      "SELECT closing_paise FROM balances WHERE period = '2025-06' AND head = 'CA_CASH'",
    );
    expect(r).toMatchObject({ status: "ok", rows: [["7374941000"]] });
  });

  it("still redacts a number cast out of a ledger name", async () => {
    const r = await run(
      "SELECT CAST(regexp_extract(ledger, '[0-9]+') AS BIGINT) AS n FROM balances WHERE ledger LIKE 'Mobile%'",
    );
    // Whether the guard allows the extraction or not, the digits never leave as they are.
    if (r.status === "ok") expect(r.rows).toEqual([["[withheld]"]]);
    // Nor does a piece of them, under a name that says money (ADR 0091).
    const piece = await run(
      "SELECT CAST(substr(regexp_extract(ledger, '[0-9]+'), 1, 4) AS BIGINT) AS amount_paise FROM balances WHERE ledger LIKE 'Mobile%'",
    );
    if (piece.status === "ok") expect(piece.rows).toEqual([["[withheld]"]]);
    const text = await run("SELECT ledger FROM balances WHERE ledger LIKE 'Mobile%'");
    expect(text).toMatchObject({ status: "ok", rows: [["Mobile MOBILE_x Plan"]] });
  });
});
