"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { api } from "@/lib/client-api";

/**
 * Marks the inbox read once it is on screen (ADR 0087), then refreshes so the rail stops
 * counting. The dots on this visit stay as they were: the page was drawn before the mark.
 */
export function MarkRead({ unread, upTo }: { unread: number; upTo: string | null }) {
  const router = useRouter();
  useEffect(() => {
    if (unread === 0 || upTo === null) return;
    void api("/api/account/inbox", { method: "POST", body: { upTo } }).then((r) => {
      if (r.ok) router.refresh();
    });
  }, [unread, upTo, router]);
  return null;
}
