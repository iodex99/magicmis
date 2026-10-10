"use client";

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

import { Icon } from "./Icon";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/**
 * Keeps Tab inside a dialog (ADR 0091): from the last control it goes back to the first, and
 * from the first, with Shift, to the last. Only what is drawn counts, so a control inside a
 * folded `<details>` or a hidden block is skipped rather than given focus nobody can see.
 */
export function keepTabInside(container: HTMLElement, event: KeyboardEvent): void {
  if (event.key !== "Tab") return;
  const items = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.getClientRects().length > 0,
  );
  const first = items[0];
  const last = items.at(-1);
  if (first === undefined || last === undefined) {
    event.preventDefault();
    return;
  }
  const active = document.activeElement;
  const outside = active === container || !container.contains(active);
  if (event.shiftKey && (active === first || outside)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || outside)) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * A panel that slides over the right edge of the workspace, for detail that should not push the
 * dashboard or the conversation aside — a number's lineage, a query's result.
 *
 * It is a modal dialog in every sense a keyboard or a screen reader sees (ADR 0091): focus moves
 * into it when it opens, Tab stays inside it, Escape closes it, and focus goes back to whatever
 * opened it. It draws its own Close, so no drawer can ship with no way out by the mouse — the
 * share drawer did. `closeButton={false}` is only for content that already ends in a Close of
 * its own, such as the lineage panel, so a reader never sees two.
 */
export function Drawer({
  open,
  onClose,
  label,
  closeButton = true,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  /** False only when the content draws its own Close. */
  closeButton?: boolean;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  // Only on opening and closing, never on a re-render: a lineage panel that steps to another
  // figure is the same drawer, and pulling focus back to its top each time would lose the reader.
  useEffect(() => {
    if (!open) return;
    const opener =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus();
    return () => {
      if (opener?.isConnected === true) opener.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div
      ref={panel}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (panel.current !== null) keepTabInside(panel.current, e);
      }}
      className="drawer-in fixed inset-y-0 right-0 z-40 flex w-[26rem] max-w-full flex-col overflow-y-auto border-l border-neutral-200 bg-neutral-25 p-4 shadow-2xl outline-none"
    >
      {closeButton ? (
        <div className="sticky top-0 z-10 -mt-1 -mr-1 mb-1 flex justify-end">
          <button
            type="button"
            aria-label="Close"
            title="Close (Esc)"
            onClick={onClose}
            className="press flex size-8 items-center justify-center rounded-md bg-neutral-25 text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
            data-testid="drawer-close"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      ) : null}
      {children}
    </div>
  );
}
