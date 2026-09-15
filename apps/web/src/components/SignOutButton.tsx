"use client";

import { clearIngestSession } from "@/lib/ingest/client";

import { Icon } from "./Icon";

export function SignOutButton() {
  return (
    <button
      type="button"
      aria-label="Sign out"
      title="Sign out"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-ink-700 hover:text-white"
      onClick={() => {
        // SPEC §15: raw data is cleared on sign-out, before the session ends.
        void clearIngestSession()
          .then(() => fetch("/api/auth/sign-out", { method: "POST" }))
          .finally(() => {
            window.location.assign("/signed-out");
          });
      }}
    >
      <Icon name="logout" size={16} />
    </button>
  );
}
