/**
 * Snapshot upload payload (SPEC §20): at job completion the browser sends ledger × period balances
 * and the metric store, keyed by tokenised ledger keys, plus aggregate-only validation results.
 * The server validates, encrypts under the company DEK and stores a new version.
 */

import { z } from "zod";

import { metricStoreSchema } from "./store";

const paise = z.string().regex(/^-?\d{1,20}$/u);

export const snapshotPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u),
  engineVersion: z.string().min(1).max(40),
  sourceFingerprint: z.string().min(1).max(200),
  ledgerBalances: z
    .array(
      z.object({
        ledgerKey: z.string().min(1).max(2000),
        head: z.string().min(1).max(40),
        period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u),
        closing: paise,
        movement: paise.nullable(),
      }),
    )
    .max(200_000),
  metricStore: metricStoreSchema,
  validationResults: z.array(
    z.object({
      id: z.string(),
      status: z.enum(["pass", "fail", "not_applicable"]),
      severity: z.enum(["blocking", "warning"]),
      failureClass: z.enum(["data_fault", "platform_fault"]),
      amounts: z.record(z.string(), paise.or(z.string().regex(/^\d+$/u))),
    }),
  ),
});
export type SnapshotPayload = z.infer<typeof snapshotPayloadSchema>;

export class SnapshotTooLarge extends Error {
  constructor(
    readonly bytes: number,
    readonly limit: number,
  ) {
    super(`snapshot is ${bytes.toString()} bytes; the limit is ${limit.toString()}`);
    this.name = "SnapshotTooLarge";
  }
}

/** Parses and size-checks a snapshot upload (cap from `ai.payload_caps.snapshot_bytes`). */
export function parseSnapshotUpload(json: string, limitBytes: number): SnapshotPayload {
  const bytes = new TextEncoder().encode(json).length;
  if (bytes > limitBytes) throw new SnapshotTooLarge(bytes, limitBytes);
  return snapshotPayloadSchema.parse(JSON.parse(json));
}
