"use client";

import { useEffect, useState } from "react";

import { Icon } from "./Icon";

/**
 * Light or dark (ADR 0034).
 *
 * The choice is kept in a plain cookie and read by the server on the next request, so the page
 * arrives already in the right theme instead of flashing white first. Nothing is stored about the
 * reader beyond this one word, and it is not sent anywhere else.
 *
 * There is no "follow the system" setting on purpose: the server renders the first paint and
 * cannot know the operating system's preference, and guessing it in a script after paint is the
 * flash this avoids.
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const [dark, setDark] = useState(false);

  // The server has already applied the attribute; this only mirrors it into the button's label.
  useEffect(() => {
    setDark(document.documentElement.dataset["theme"] === "dark");
  }, []);

  const choose = (next: "light" | "dark") => {
    document.documentElement.dataset["theme"] = next;
    document.cookie = `theme=${next}; path=/; max-age=31536000; samesite=lax`;
    setDark(next === "dark");
  };

  return (
    <button
      type="button"
      onClick={() => {
        choose(dark ? "light" : "dark");
      }}
      aria-pressed={dark}
      title={dark ? "Switch to light" : "Switch to dark"}
      data-print="hide"
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-ink-700 hover:text-white ${className}`}
    >
      <Icon name={dark ? "sun" : "moon"} size={15} />
      <span className="sr-only">{dark ? "Switch to light" : "Switch to dark"}</span>
    </button>
  );
}
