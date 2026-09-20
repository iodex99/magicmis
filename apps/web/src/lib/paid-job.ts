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

export interface QuoteResult {
  readonly kind: "quote";
  readonly jobId: string;
  readonly credits: string;
  /** Null for a quote raised part-way through a run, whose expiry the run does not report. */
  readonly expiresAt: string | null;
  /** True when a run paused part-way for this quote, rather than being quoted up front. */
  readonly resumed?: boolean;
}

export type StartResult =
  | { readonly kind: "held"; readonly jobId: string }
  | QuoteResult
  /** `quote`: the quote that was being accepted when the wallet fell short, to return to. */
  | { readonly kind: "short"; readonly need: bigint; readonly quote?: QuoteResult }
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

/** The exact gap the server reported, which beats anything the browser can work out. */
const shortfallOf = (fields: Record<string, string>, fallback: bigint): bigint => {
  const raw = fields["shortfall"];
  if (raw === undefined || !/^\d+$/u.test(raw)) return fallback > 0n ? fallback : 1n;
  const n = BigInt(raw);
  return n > 0n ? n : 1n;
};

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
    /*
     * Only a job that has not started is cancelled here (ADR 0053).
     *
     * Cancelling a run that paused for a quote would be the worst thing we could do to it:
     * `cancelLike` captures the cancel-after-AI fee and moves the job to a terminal state, so
     * the customer is charged for a job that delivered nothing and the stages already paid for
     * are thrown away. A paused run stays in `needs_quote` with its checkpoint, the quote is
     * handed back to the caller, and topping up lets the same quote be accepted (ADR 0049).
     */
    if (path === "confirm") cancel(jobId);
    return { kind: "short", need: shortfallOf(r.fields, credits - available) };
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
