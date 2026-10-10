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

/** A moment that is a deadline, with its zone said: a quote held until then (ADR 0091). */
export const istLabelled = (d: Date): string => `${ist(d)} IST`;

/** A file's size in the unit that reads best, grouped the same way for everyone (ADR 0091). */
export const fileSize = (n: number): string =>
  n >= 1_073_741_824
    ? `${(n / 1_073_741_824).toFixed(1)} GB`
    : n >= 1_048_576
      ? `${(n / 1_048_576).toFixed(1)} MB`
      : `${Math.max(1, Math.ceil(n / 1024)).toString()} KB`;

/**
 * How many months to add, said the same way on every screen that asks for files (ADR 0091). The
 * welcome page said "last month", the setup page "every month you want" and the add-company
 * steps nothing at all, so a first board was often one month with nothing to compare it to.
 */
export const MONTHS_TO_ADD =
  "One trial balance per month, for as many recent months as you have: thirteen puts last year beside every month.";
