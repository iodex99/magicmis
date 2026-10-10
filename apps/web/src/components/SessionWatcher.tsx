"use client";

import { useEffect } from "react";

/**
 * SPEC §8: "The old tab shows 'You were signed out because this account signed in
 * elsewhere.'"
 *
 * Checks when the tab regains focus and on a slow interval. Any API call from a
 * superseded tab also redirects (client-api.ts); this covers a tab that is merely open.
 *
 * A session that has simply ended sends the reader to sign in and back to the page they were
 * on (ADR 0091), as the server-rendered pages already do (`accountOrRedirect`). The sign-in
 * form accepts only a same-origin path for it (`safeNextPath`).
 */
export function SessionWatcher() {
  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const response = await fetch("/api/account/session", { cache: "no-store" });
        const body = (await response.json()) as { status?: string };
        if (cancelled) return;
        if (body.status === "session_superseded")
          window.location.assign("/signed-out?reason=elsewhere");
        else if (body.status !== "active")
          window.location.assign(
            `/sign-in?next=${encodeURIComponent(window.location.pathname + window.location.search)}`,
          );
      } catch {
        // Offline: try again on the next focus or tick.
      }
    }
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(() => void check(), 60_000);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
    };
  }, []);
  return null;
}
