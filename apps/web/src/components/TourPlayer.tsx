"use client";

import { useEffect, useRef } from "react";

/**
 * The product tour, playing itself when it is looked at (ADR 0041).
 *
 * The recording is silent, so it may autoplay muted; it starts when most of it is on screen
 * and pauses when it leaves, which means a visitor who never scrolls to it never downloads
 * it (`preload="none"`). Someone who has asked for reduced motion gets a still and a play
 * button instead — the controls are always there, so the choice is always theirs.
 */
export function TourPlayer() {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (video === null) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry === undefined) return;
        if (entry.isIntersecting) void video.play().catch(() => undefined);
        else video.pause();
      },
      { threshold: 0.6 },
    );
    observer.observe(video);
    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <video
      ref={ref}
      className="block w-full rounded-xl border border-neutral-200/80 bg-ink-900 shadow-sm"
      controls
      muted
      loop
      playsInline
      preload="none"
      poster="/brand/tour-poster.png"
      width={1600}
      height={900}
      data-testid="tour"
    >
      <source src="/brand/tour.webm" type="video/webm" />
      Your browser cannot play this video. It is a silent tour of the product; the same
      ground is covered in writing on this page.
    </video>
  );
}
