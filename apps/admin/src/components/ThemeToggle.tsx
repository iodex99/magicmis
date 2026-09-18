"use client";

import { useEffect, useState } from "react";

/**
 * Light or dark, the same cookie and the same palette as the customer app (ADR 0034, ADR 0035).
 * The server reads the cookie in the root layout, so the console arrives in the right theme
 * rather than flashing white first.
 */
export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.dataset["theme"] === "dark");
  }, []);

  const label = dark ? "Switch to light" : "Switch to dark";
  return (
    <button
      type="button"
      aria-pressed={dark}
      title={label}
      onClick={() => {
        const next = dark ? "light" : "dark";
        document.documentElement.dataset["theme"] = next;
        document.cookie = `theme=${next}; path=/; max-age=31536000; samesite=lax`;
        setDark(next === "dark");
      }}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-ink-700 hover:text-white"
    >
      <svg
        width={15}
        height={15}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {dark ? (
          <path d="M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-14v2m0 18v-2M3 12h2m14 0h2M5.6 5.6l1.4 1.4m10 10 1.4 1.4m0-12.8-1.4 1.4m-10 10-1.4 1.4" />
        ) : (
          <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
        )}
      </svg>
      <span className="sr-only">{label}</span>
    </button>
  );
}
