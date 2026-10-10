"use client";

import { useState, type ReactNode } from "react";

import { Button } from "./ui";

/**
 * The sample dashboards' Pause button (WCAG 2.2.2, ADR 0091). The rows already stop under a
 * mouse; this is the same stop for a keyboard, a screen reader or a finger, which have no hover.
 * It sets one class on the rows' wrapper and the stylesheet does the rest, so the drift itself
 * stays one CSS animation (ADR 0051). Under reduced motion nothing moves, so it is not shown.
 */
export function MarqueePause({ children }: { children: ReactNode }) {
  const [paused, setPaused] = useState(false);
  return (
    <>
      <div className="mx-auto mb-4 flex w-full max-w-[1120px] justify-end px-6 motion-reduce:hidden">
        <Button
          variant="secondary"
          size="sm"
          icon={paused ? "play" : "pause"}
          // The label says what pressing does; no aria-pressed, which would read a flipping
          // label as "Play, pressed".
          onClick={() => {
            setPaused((p) => !p);
          }}
          data-testid="carousel-pause"
        >
          {paused ? "Play" : "Pause"}
        </Button>
      </div>
      <div className={`flex flex-col gap-5 ${paused ? "marquee-paused" : ""}`}>
        {children}
      </div>
    </>
  );
}
