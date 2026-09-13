"use client";

export function SignOutButton() {
  return (
    <button
      type="button"
      className="text-sm text-neutral-700 underline-offset-2 hover:underline"
      onClick={() => {
        void fetch("/api/auth/sign-out", { method: "POST" }).finally(() => {
          window.location.assign("/signed-out");
        });
      }}
    >
      Sign out
    </button>
  );
}
