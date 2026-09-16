/**
 * Where a `?next=` may send someone (SPEC §8, §30).
 *
 * Both the sign-in form and the email callback carry the reader onward after
 * authenticating, and both take that destination from a query parameter an attacker can
 * write. A freshly authenticated session bounced to another origin is a phishing handoff,
 * so only same-origin absolute paths are honoured and anything else falls back.
 *
 * `startsWith("/")` is not the test. `//evil.example` is protocol-relative, and browsers
 * read `/\evil.example` the same way: a single leading slash followed by a backslash is
 * still a network-path reference. The safe shape is a leading `/` that is not followed by
 * another slash or backslash, then only characters that can appear in one of our routes.
 */
const SAFE_PATH = /^\/(?![/\\])[\w\-/]*$/u;

export function isSafeNextPath(raw: string | null | undefined): boolean {
  return typeof raw === "string" && SAFE_PATH.test(raw);
}

/** The requested path when it is safe to use, otherwise `fallback`. */
export function safeNextPath(raw: string | null | undefined, fallback: string): string {
  return isSafeNextPath(raw) && typeof raw === "string" ? raw : fallback;
}
