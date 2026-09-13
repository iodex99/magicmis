import { errorReportingDefaults } from "@magicmis/core/error-scrub";

/**
 * Server-side error reporting (SPEC §5 Sentry with PII scrubbing, §30). Initialised only when
 * SENTRY_DSN is set, only in the Node.js runtime, and every event passes the allowlist scrubber
 * (`@magicmis/core/error-scrub`). There is no browser SDK and no session replay: the browser
 * shows customer financial data, which must never leave in an error report (ADR 0024).
 *
 * Shape per https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/ and the Next.js
 * instrumentation convention (node_modules/next/dist/docs/01-app/02-guides/instrumentation.md),
 * verified against @sentry/nextjs 10.74.0 typings.
 */
export async function register(): Promise<void> {
  const dsn = process.env["SENTRY_DSN"];
  if (process.env["NEXT_RUNTIME"] !== "nodejs" || dsn === undefined || dsn === "") return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.init({
    dsn,
    environment: process.env["NEXT_PUBLIC_ENVIRONMENT"] ?? "production",
    ...errorReportingDefaults,
  });
}

export async function onRequestError(
  ...args: Parameters<typeof import("@sentry/nextjs").captureRequestError>
): Promise<void> {
  const dsn = process.env["SENTRY_DSN"];
  if (dsn === undefined || dsn === "") return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(...args);
}
