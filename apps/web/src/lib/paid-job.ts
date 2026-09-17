"use client";

/**
 * Starting a paid action in one step (ADR 0033).
 *
 * The customer presses the button for what they want and the credits are held; there is no
 * price preview in between. Two things still stop a start, because they must: a wallet that
 * cannot cover the action (nothing is held), and an estimate over the AI cost cap, which needs
 * the customer to accept a quote first (locked decision 6).
 */

import { api, newIdempotencyKey } from "./client-api";

export type StartResult =
  | { readonly kind: "held"; readonly jobId: string }
  | {
      readonly kind: "quote";
      readonly jobId: string;
      readonly credits: string;
      readonly expiresAt: string;
    }
  | { readonly kind: "short"; readonly need: bigint }
  | { readonly kind: "error"; readonly message: string };

interface CreatedJob {
  jobId: string;
  priceCredits: string;
  quote: { credits: string; expiresAt: string } | null;
  available: string;
}

const cancel = (jobId: string) =>
  void api(`/api/jobs/${jobId}/cancel`, {
    body: {},
    idempotencyKey: newIdempotencyKey(),
  });

async function hold(
  jobId: string,
  path: "confirm" | "accept-quote",
  credits: bigint,
  available: bigint,
): Promise<StartResult> {
  const r = await api(`/api/jobs/${jobId}/${path}`, {
    body: {},
    idempotencyKey: newIdempotencyKey(),
  });
  if (r.ok) return { kind: "held", jobId };
  if (r.status === 402) {
    cancel(jobId);
    return { kind: "short", need: credits > available ? credits - available : 1n };
  }
  return { kind: "error", message: r.message };
}

/** Create the job and hold its credits. */
export async function startPaidJob(body: Record<string, unknown>): Promise<StartResult> {
  const created = await api<CreatedJob>("/api/jobs", {
    body,
    idempotencyKey: newIdempotencyKey(),
  });
  if (!created.ok) return { kind: "error", message: created.message };
  const job = created.data;
  if (job.quote !== null)
    return {
      kind: "quote",
      jobId: job.jobId,
      credits: job.quote.credits,
      expiresAt: job.quote.expiresAt,
    };
  const price = BigInt(job.priceCredits);
  const available = BigInt(job.available);
  if (available < price) {
    cancel(job.jobId);
    return { kind: "short", need: price - available };
  }
  return hold(job.jobId, "confirm", price, available);
}

/** Accept a quote the customer has seen, which holds its credits. */
export async function acceptQuote(jobId: string, credits: string): Promise<StartResult> {
  return hold(jobId, "accept-quote", BigInt(credits), 0n);
}
