/**
 * Fingerprints (SPEC §15): SHA-256 of file bytes, and a per-sheet header signature over
 * normalised header names, inferred column types and the detected report type. The signature
 * is what next month's upload is matched against, so it must ignore cosmetic changes (case,
 * punctuation, spacing) and change when structure changes.
 */

import { normaliseHeader } from "./header";
import type { ColumnType } from "./infer";

const hex = (buf: ArrayBuffer): string =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function sha256Hex(bytes: Uint8Array | string): Promise<string> {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  // Copy into a fresh ArrayBuffer: WebCrypto rejects views over SharedArrayBuffer.
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return hex(await crypto.subtle.digest("SHA-256", copy));
}

export interface SignatureInput {
  readonly headers: readonly string[];
  readonly types: readonly ColumnType[];
  readonly reportType: string;
}

export function canonicalSignature(input: SignatureInput): string {
  const columns = input.headers
    .map((h, i) => ({ h: normaliseHeader(h), t: input.types[i] ?? "text" }))
    .filter((c) => !(c.h.startsWith("column ") && c.t === "empty"));
  return JSON.stringify({ r: input.reportType, c: columns.map((c) => `${c.h}:${c.t}`) });
}

export async function headerSignature(input: SignatureInput): Promise<string> {
  return sha256Hex(canonicalSignature(input));
}
