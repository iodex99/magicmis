/**
 * Zod → the JSON Schema subset structured outputs accept (verified 2026-09-13,
 * https://platform.claude.com/docs/en/build-with-claude/structured-outputs):
 * `additionalProperties: false` on every object; no `minimum`/`maximum`/`multipleOf`,
 * `minLength`/`maxLength`, `pattern`, array bounds beyond `minItems` 0 or 1, or recursion.
 *
 * Constraints dropped here are still enforced: the full Zod schema validates the response,
 * and a violation triggers the single repair attempt.
 */

import { z } from "zod";

const DROP = new Set([
  "$schema",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
  "propertyNames",
  "default",
]);

const SUPPORTED_FORMATS = new Set([
  "date-time",
  "time",
  "date",
  "duration",
  "email",
  "hostname",
  "uri",
  "ipv4",
  "ipv6",
  "uuid",
]);

function sanitise(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitise);
  if (node === null || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (DROP.has(key)) continue;
    if (key === "format" && (typeof value !== "string" || !SUPPORTED_FORMATS.has(value)))
      continue;
    if (key === "minItems" && typeof value === "number" && value > 1) {
      out[key] = 1;
      continue;
    }
    out[key] = sanitise(value);
  }
  if (out["type"] === "object") {
    out["additionalProperties"] = false;
    const props = out["properties"];
    if (props && typeof props === "object") out["required"] = Object.keys(props);
  }
  return out;
}

export function structuredOutputSchema(schema: z.ZodType): Record<string, unknown> {
  // `io: "output"` describes what the model must produce; optional fields become nullable-required
  // at the Zod level in stage schemas, since structured outputs require every property.
  const json = z.toJSONSchema(schema, {
    target: "draft-7",
    io: "output",
    unrepresentable: "throw",
  });
  return sanitise(json) as Record<string, unknown>;
}

/** Digits are forbidden in model prose: every figure comes from the engine (SPEC §2.7, §14). */
export const proseNoDigits = z
  .string()
  .refine((s) => !/[0-9]/u.test(s), "must not contain digits");
