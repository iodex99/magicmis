/**
 * Desktop-only gate (SPEC §2.13, §32): non-desktop user agents get a "desktop required"
 * page; public marketing pages stay responsive.
 *
 * A user-agent check is advisory, not a security control -- a phone can send a desktop
 * user agent. It exists so a CA opening the app on a phone gets a clear explanation
 * instead of a broken dense table, not to keep anyone out.
 *
 * Tablets are treated as non-desktop: the product is designed for long sessions with
 * dense, keyboard-driven tables. iPadOS in desktop mode reports a Macintosh user agent
 * and cannot be told apart; it is allowed through, which is the harmless direction.
 */

const MOBILE_OR_TABLET =
  /\b(Mobi|Mobile|Android|iPhone|iPad|iPod|Windows Phone|BlackBerry|BB10|Opera Mini|IEMobile|Silk|Kindle|webOS)\b/iu;

export function isDesktopUserAgent(userAgent: string | null | undefined): boolean {
  // No user agent at all (curl, health checks) is not a phone; do not gate it.
  if (userAgent === null || userAgent === undefined || userAgent.trim() === "")
    return true;
  return !MOBILE_OR_TABLET.test(userAgent);
}

/**
 * Paths that stay reachable on any device: the marketing site (SPEC §32 keeps it
 * responsive), help, legal pages, the gate page itself, and machine endpoints such as
 * payment webhooks that carry no browser user agent worth judging.
 */
export const DEVICE_AGNOSTIC_PATHS: readonly string[] = [
  "/",
  "/product",
  "/pricing",
  "/how-it-works",
  "/security",
  // Guides people reach from search. A visitor who searched "MIS report format in excel"
  // on a phone must get the guide, not the desktop gate -- that bounce is the whole cost
  // of ranking for it. A test pins this list to the sitemap so a new page cannot miss it.
  "/management-accounts",
  "/mis-report-format",
  "/tally-mis-report",
  "/for-accountants",
  "/ai-mis-report",
  "/mis-in-minutes",
  "/automated-management-accounts",
  "/monthly-financial-reporting",
  "/chat-with-your-mis",
  "/boardroom-ready-mis",
  "/ai-variance-analysis",
  "/ai-management-accounts",
  "/ai-financial-reporting",
  "/mis-dashboard",
  "/what-is-an-mis-report",
  "/board-pack",
  "/month-end-reporting-package",
  "/management-reporting-software",
  "/og",
  "/guides",
  "/help",
  "/legal",
  "/llms.txt",
  "/llms-full.txt",
  "/.well-known",
  "/desktop-required",
  "/api/webhooks",
];

export function isDeviceAgnosticPath(pathname: string): boolean {
  return DEVICE_AGNOSTIC_PATHS.some(
    (p) => pathname === p || (p !== "/" && pathname.startsWith(`${p}/`)),
  );
}
