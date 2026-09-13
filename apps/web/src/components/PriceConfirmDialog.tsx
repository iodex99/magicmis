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
      className="w-full max-w-md rounded-lg border border-neutral-200 p-6 backdrop:bg-neutral-900/30"
      aria-labelledby="price-confirm-title"
    >
      <h2
        id="price-confirm-title"
        className="mb-4 text-base font-semibold text-neutral-900"
      >
        Confirm price
      </h2>
      <dl className="mb-4 grid grid-cols-2 gap-y-2 text-sm" data-testid="price-confirm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-neutral-600">{label}</dt>
            <dd className="text-right font-medium tabular-nums text-neutral-900">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {preview && !preview.sufficient ? (
        <Alert tone="warning">
          Not enough credits.{" "}
          <a href="/wallet" className="underline">
            Buy credits
          </a>{" "}
          to continue.
        </Alert>
      ) : null}
      <div className="mt-6 flex justify-end gap-2">
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
    </dialog>
  );
}
