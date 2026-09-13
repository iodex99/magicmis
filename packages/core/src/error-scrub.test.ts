import { describe, expect, it } from "vitest";

import { errorReportingDefaults, maskMessage, scrubErrorEvent } from "./error-scrub";

/** A realistic event with customer data in every place an SDK might put it. */
const leaky = {
  event_id: "abc",
  level: "error",
  release: "web@1.2.3",
  environment: "production",
  message: "Capture failed for owner@firm.example: balance 1,00,000.50",
  exception: {
    values: [
      {
        type: "WalletError",
        value:
          "insufficient credits: available 4999 for PARTY_9f3a1c2e4b5d, PAN ABCDE1234F",
        stacktrace: {
          frames: [
            {
              filename: "/app/packages/wallet/src/wallet.ts",
              function: "captureReservation",
              lineno: 481,
              colno: 11,
              in_app: true,
              context_line: 'const note = "Sharma Traders owes 12,500";',
              pre_context: ["secret source"],
              vars: { balance: "100000", email: "owner@firm.example" },
            },
          ],
        },
      },
    ],
  },
  request: {
    url: "https://app.example/api/jobs/1/complete",
    data: '{"snapshot":{"ledgerBalances":[["Rent",120000]]}}',
    cookies: { "sb-access-token": "eyJ..." },
    headers: { authorization: "Bearer x", cookie: "a=b" },
    query_string: "email=owner@firm.example",
  },
  user: { id: "u1", email: "owner@firm.example", ip_address: "1.2.3.4" },
  extra: { prompt: "<data>Rent 120000</data>", aiResponse: "Revenue rose" },
  breadcrumbs: [{ message: "fetch /api/chat/messages question=What was revenue" }],
  contexts: {
    runtime: { name: "node", version: "v22.18.0" },
    os: { name: "Linux" },
    trace: { data: { "db.statement": "select * from snapshots where ..." } },
    state: { redux: { balance: 100000 } },
  },
  tags: { service: "worker", note: "account 7a1f2c3d-1111-2222-3333-444455556666" },
};

describe("error report scrubbing (SPEC §30)", () => {
  it("keeps what locates a bug and drops every place customer data can hide", () => {
    const out = scrubErrorEvent(leaky) as Record<string, unknown>;
    const text = JSON.stringify(out);

    for (const secret of [
      "owner@firm.example",
      "1,00,000",
      "4999",
      "PARTY_9f3a1c2e4b5d",
      "ABCDE1234F",
      "Sharma Traders",
      "ledgerBalances",
      "sb-access-token",
      "Bearer",
      "1.2.3.4",
      "<data>",
      "Revenue rose",
      "question=",
      "db.statement",
      "redux",
      "7a1f2c3d-1111",
      "secret source",
    ])
      expect(text, secret).not.toContain(secret);

    for (const key of ["request", "user", "extra", "breadcrumbs"])
      expect(out[key]).toBeUndefined();
    expect(out).toMatchObject({
      level: "error",
      release: "web@1.2.3",
      environment: "production",
      message: "Capture failed for [email]: balance #",
      contexts: { runtime: { name: "node", version: "v22.18.0" }, os: { name: "Linux" } },
      tags: { service: "worker", note: "account [id]" },
      exception: {
        values: [
          {
            type: "WalletError",
            value: "insufficient credits: available # for [token], PAN [pan]",
            stacktrace: {
              frames: [
                {
                  filename: "/app/packages/wallet/src/wallet.ts",
                  function: "captureReservation",
                  lineno: 481,
                  colno: 11,
                  in_app: true,
                },
              ],
            },
          },
        ],
      },
    });
  });

  it("masks keys and truncates long messages; never mutates the input", () => {
    expect(maskMessage("key sk-ant-api03-abcdef and sb_secret_xyz123")).toBe(
      "key [secret] and [secret]",
    );
    expect(maskMessage("x".repeat(1000))).toHaveLength(300);
    const before = JSON.stringify(leaky);
    scrubErrorEvent(leaky);
    expect(JSON.stringify(leaky)).toBe(before);
  });

  it("sets SDK defaults that send no PII, no transactions and no breadcrumbs", () => {
    expect(errorReportingDefaults.sendDefaultPii).toBe(false);
    expect(errorReportingDefaults.tracesSampleRate).toBe(0);
    expect(errorReportingDefaults.maxBreadcrumbs).toBe(0);
    expect(errorReportingDefaults.beforeSendTransaction()).toBeNull();
  });
});
