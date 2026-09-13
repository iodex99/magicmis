"use client";

import { clearIngestSession } from "@/lib/ingest/client";

export function SignOutButton() {
  return (
    <button
      type="button"
      className="text-sm text-neutral-700 underline-offset-2 hover:underline"
      onClick={() => {
        // SPEC §15: raw data is cleared on sign-out, before the session ends.
        void clearIngestSession()
          .then(() => fetch("/api/auth/sign-out", { method: "POST" }))
          .finally(() => {
            window.location.assign("/signed-out");
          });
      }}
    >
      Sign out
    </button>
  );
}
