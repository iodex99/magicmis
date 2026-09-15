"use client";

import { useEffect, useRef, useState } from "react";

import {
  ACTION_LABELS,
  DELIVERY_LABELS,
  TIER_LABELS,
  formatCredits,
  type ActionKeyLabel,
} from "@/lib/actions";
import { api } from "@/lib/client-api";

import { Icon } from "./Icon";
import { Alert, Button } from "./ui";

interface Preview {
  credits: string;
  available: string;
  availableAfter: string;
  sufficient: boolean;
  priceBookVersion: number;
}

/**
 * The price confirmation shown before every paid action (SPEC §12): action, tier, delivery
 * mode, exact credits, available balance and balance after. Nothing is charged until the
 * user confirms. The price is fetched from the server; the client never computes it.
 */
export function PriceConfirmDialog({
  open,
  actionKey,
  tier,
  delivery,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  actionKey: ActionKeyLabel;
  tier: keyof typeof TIER_LABELS;
  delivery: keyof typeof DELIVERY_LABELS;
  onConfirm: (preview: Preview) => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = dialog.current;
    if (el === null) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPreview(null);
    setError(null);
    void api<Preview>("/api/pricing/preview", {
      body: { actionKey, tier, delivery },
    }).then((r) => {
      if (cancelled) return;
      if (r.ok) setPreview(r.data);
      else setError(r.message);
    });
    return () => {
      cancelled = true;
    };
  }, [open, actionKey, tier, delivery]);

  const rows: [string, string][] = [
    ["Action", ACTION_LABELS[actionKey]],
    ["Intelligence tier", TIER_LABELS[tier]],
    ["Delivery", DELIVERY_LABELS[delivery]],
    ["Price", preview ? `${formatCredits(preview.credits)} credits` : "…"],
    ["Available now", preview ? formatCredits(preview.available) : "…"],
    ["Available after", preview ? formatCredits(preview.availableAfter) : "…"],
  ];

  return (
    <dialog
      ref={dialog}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      className="w-full max-w-md rounded-2xl border border-neutral-200/80 p-0 shadow-xl backdrop:bg-ink-900/40"
      aria-labelledby="price-confirm-title"
    >
      <div className="p-6">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-50 text-accent-600">
          <Icon name="wallet" size={18} />
        </span>
        <h2
          id="price-confirm-title"
          className="mt-3 text-[1.0625rem] font-semibold text-neutral-900"
        >
          Confirm price
        </h2>
        <p className="mt-1 text-[0.8125rem] text-neutral-500">
          Nothing is charged until you confirm.
        </p>
      </div>
      <dl
        className="grid grid-cols-2 gap-y-2.5 border-y border-neutral-100 bg-neutral-25 px-6 py-4 text-sm"
        data-testid="price-confirm"
      >
        {rows.map(([label, value], i) => (
          <div key={label} className="contents">
            <dt className={i === 3 ? "font-medium text-neutral-900" : "text-neutral-500"}>
              {label}
            </dt>
            <dd className="num font-medium text-neutral-900">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="p-6">
        {error ? <Alert tone="error">{error}</Alert> : null}
        {preview && !preview.sufficient ? (
          <Alert tone="warning" title="Not enough credits">
            <a href="/wallet" className="font-medium underline">
              Buy credits
            </a>{" "}
            to continue. Nothing has been charged.
          </Alert>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            disabled={preview === null || !preview.sufficient}
            onClick={() => {
              if (preview) onConfirm(preview);
            }}
          >
            {preview ? `Confirm — ${formatCredits(preview.credits)} credits` : "Confirm"}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
