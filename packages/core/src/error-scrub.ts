/**
 * Error-report scrubbing (SPEC §30: "never log file contents, prompts containing data, AI responses, or
 * decrypted blueprint or snapshot content. Sentry scrubbing rules tested").
 *
 * An allowlist, not a denylist: an event keeps only what is needed to find a bug — the exception
 * type, a masked and truncated message, stack frame locations, the release, environment and a
 * few runtime facts. Everything else is dropped:
 * - request bodies, headers, cookies and query strings;
 * - user;
 * - extra and most contexts;
 * - breadcrumbs;
 * - frame source lines and local variables.
 *
 * Messages keep their words but lose figures, emails, identifiers and tokens, so a thrown
 * "balance 1,00,000 for x@y.in" arrives as "balance # for [email]".
 *
 * Typed structurally so this package needs no Sentry dependency; wire it as `beforeSend`.
 */

const MAX_MESSAGE = 300;
const MAX_FRAMES = 50;

export function maskMessage(message: string): string {
  return message
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gu, "[email]")
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu,
      "[id]",
    )
    .replace(
      /\b(?:PAN|AADHAAR|UAN|IFSC|BANKAC|GSTIN|EMAIL|MOBILE|PERSON|PARTY|SENSITIVE)_[0-9a-f]{12}\b/gu,
      "[token]",
    )
    .replace(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/gu, "[pan]")
    .replace(/(?:sk-ant-|sb_secret_|rzp_(?:live|test)_|re_)[\w-]+/gu, "[secret]")
    .replace(/[-+]?\d[\d,.]*/gu, "#")
    .slice(0, MAX_MESSAGE);
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

function scrubFrame(frame: unknown): Json | null {
  if (!isObject(frame)) return null;
  const out: Json = {};
  for (const key of [
    "filename",
    "module",
    "function",
    "lineno",
    "colno",
    "in_app",
  ] as const)
    if (frame[key] !== undefined) out[key] = frame[key];
  return out;
}

function scrubException(value: unknown): Json | null {
  if (!isObject(value)) return null;
  const out: Json = {};
  const type = str(value["type"]);
  if (type !== undefined) out["type"] = type.slice(0, 100);
  const message = str(value["value"]);
  if (message !== undefined) out["value"] = maskMessage(message);
  const stack = value["stacktrace"];
  if (isObject(stack) && Array.isArray(stack["frames"]))
    out["stacktrace"] = {
      frames: stack["frames"]
        .slice(-MAX_FRAMES)
        .map(scrubFrame)
        .filter((f) => f !== null),
    };
  return out;
}

/** Returns a new event holding only allowlisted, masked fields. Never returns the input object. */
export function scrubErrorEvent<E extends object>(event: E): E {
  const e = event as Json;
  const out: Json = {};
  for (const key of [
    "event_id",
    "timestamp",
    "platform",
    "level",
    "release",
    "environment",
    "type",
  ] as const)
    if (e[key] !== undefined) out[key] = e[key];
  const message = str(e["message"]);
  if (message !== undefined) out["message"] = maskMessage(message);
  const exception = e["exception"];
  if (isObject(exception) && Array.isArray(exception["values"]))
    out["exception"] = {
      values: exception["values"].map(scrubException).filter((v) => v !== null),
    };
  const contexts = e["contexts"];
  if (isObject(contexts)) {
    const kept: Json = {};
    for (const key of ["runtime", "os"] as const)
      if (isObject(contexts[key])) kept[key] = contexts[key];
    out["contexts"] = kept;
  }
  // Tags are ours alone (service, route template) — values are masked in case one ever carries data.
  const tags = e["tags"];
  if (isObject(tags))
    out["tags"] = Object.fromEntries(
      Object.entries(tags).flatMap(([k, v]) =>
        typeof v === "string" ? [[k, maskMessage(v)]] : [],
      ),
    );
  return out as E;
}

/** Shared SDK options: no PII, no tracing, no breadcrumbs, every event scrubbed. */
export const errorReportingDefaults = {
  sendDefaultPii: false,
  tracesSampleRate: 0,
  maxBreadcrumbs: 0,
  beforeSend: <E extends object>(event: E): E => scrubErrorEvent(event),
  beforeSendTransaction: (): null => null,
} as const;
