/**
 * The stored shape of a metric value and a metric store (SPEC §20), with nothing but zod behind
 * it, so the browser can check a value without pulling the engine's computation in (ADR 0091).
 */

import { z } from "zod";

export const metricValueSchema = z.object({
  metricId: z.string().min(1).max(120),
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u),
  dims: z.record(z.string(), z.string().max(200)),
  value: z
    .string()
    .regex(/^-?\d+(\.\d{6})?$/u)
    .nullable(),
  nullReason: z.enum(["zero_denominator", "missing_data", "no_prior_period"]).nullable(),
  unit: z.enum(["paise", "percent", "ratio", "days", "count"]),
  formula: z.string().max(500),
  inputs: z.array(z.unknown()).max(50),
});

export const metricStoreSchema = z.object({
  engineVersion: z.string(),
  computedAt: z.string(),
  values: z.array(metricValueSchema),
});
