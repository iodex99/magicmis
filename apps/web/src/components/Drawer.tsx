"use client";

import { useEffect, type ReactNode } from "react";

/**
 * A panel that slides over the right edge of the workspace, for detail that should not push the
 * dashboard or the conversation aside — a number's lineage, a query's result. Escape closes it.
 */
export function Drawer({
  open,
  onClose,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-label={label}
      className="drawer-in fixed inset-y-0 right-0 z-40 flex w-[26rem] max-w-full flex-col overflow-y-auto border-l border-neutral-200 bg-neutral-25 p-4 shadow-2xl"
    >
      {children}
    </div>
  );
}
