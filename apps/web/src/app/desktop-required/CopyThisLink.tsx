"use client";

import { useState } from "react";

import { Button } from "@/components/ui";

/**
 * Copies the address the reader opened, so it can be sent to their computer (ADR 0091). Where
 * the clipboard is refused — an in-app mail browser, a blocked permission — it says so and shows
 * the address to copy by hand, rather than doing nothing.
 */
export function CopyThisLink() {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const [href, setHref] = useState("");
  return (
    <div className="flex w-full flex-col items-center gap-2">
      <Button
        variant="secondary"
        onClick={() => {
          const here = window.location.href;
          setHref(here);
          // `navigator.clipboard` is absent outside a secure context, so check before calling.
          const clipboard = (navigator as Partial<Navigator>).clipboard;
          if (clipboard === undefined) {
            setState("failed");
            return;
          }
          clipboard.writeText(here).then(
            () => {
              setState("copied");
            },
            () => {
              setState("failed");
            },
          );
        }}
      >
        {state === "copied" ? "Copied" : "Copy this link"}
      </Button>
      <p role="status" className="text-[0.8125rem] text-neutral-600">
        {state === "failed"
          ? "This browser would not copy it. Select the address and copy it:"
          : null}
      </p>
      {state === "failed" ? (
        <input
          readOnly
          value={href}
          aria-label="This page's address"
          onFocus={(e) => {
            e.currentTarget.select();
          }}
          className="h-10 w-full rounded-md border border-neutral-200 bg-surface px-3 text-[0.8125rem] text-neutral-900"
        />
      ) : null}
    </div>
  );
}
