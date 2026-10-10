import type { BadgeTone } from "@/components/ui";

/** Job states as words a customer can act on (SPEC §32: no raw identifiers in the UI). */
export const JOB_STATE: Record<string, { label: string; tone: BadgeTone }> = {
  completed: { label: "Completed", tone: "positive" },
  failed: { label: "Failed", tone: "negative" },
  cancelled: { label: "Cancelled", tone: "muted" },
  paused: { label: "Paused", tone: "warning" },
  awaiting_confirmation: { label: "Awaiting confirmation", tone: "warning" },
  awaiting_review: { label: "Waiting on a question", tone: "warning" },
  running: { label: "Running", tone: "accent" },
  queued: { label: "Queued", tone: "accent" },
  expired: { label: "Expired", tone: "muted" },
  needs_quote: { label: "Needs a quote", tone: "warning" },
  quote_accepted: { label: "Quote accepted", tone: "accent" },
  failed_data: { label: "Failed — check the data", tone: "negative" },
  failed_platform: { label: "Failed — our fault", tone: "negative" },
};

/** A job state that is not one of the above still reads as words, never as its identifier. */
export function jobState(state: string): { label: string; tone: BadgeTone } {
  return JOB_STATE[state] ?? { label: "In progress", tone: "accent" };
}

/** A moment as an Indian reader writes it (store UTC, display IST, locked decision 14). */
export const ist = (d: Date): string =>
  d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
