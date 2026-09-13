"use client";

/**
 * A paid action without files (dashboard add-on, commentary): choose tier and delivery, get the
 * exact price from the server, confirm, hold credits, then hand the held job to `onHeld`
 * (SPEC §12, §23). Nothing is charged until the user confirms.
 */

import { useState } from "react";

import { Alert, Button } from "@/components/ui";
import { ACTION_LABELS, DELIVERY_LABELS, formatCredits, TIER_LABELS } from "@/lib/actions";
import { api, newIdempotencyKey } from "@/lib/client-api";

type Tier = keyof typeof TIER_LABELS;
type Delivery = keyof typeof DELIVERY_LABELS;

interface CreatedJob {
  jobId: string;
  priceCredits: string;
  quote: { credits: string; expiresAt: string } | null;
  available: string;
}

const ZERO_SIZE = {
  files: 0,
  sheets: 0,
  columns: 0,
  rows: 0,
  distinctLedgerValues: 0,
  referenceMisSheets: 0,
};

export function PaidJobButton({
  companyId,
  type,
  label,
  deliveries,
  onHeld,
}: {
  companyId: string;
  type: "dashboard_addon" | "commentary";
  label: string;
  deliveries: readonly Delivery[];
  onHeld: (jobId: string, delivery: Delivery) => Promise<void>;
}) {
  const [tier, setTier] = useState<Tier>("professional");
  const [delivery, setDelivery] = useState<Delivery>(deliveries[0] ?? "standard");
  const [job, setJob] = useState<CreatedJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const price = async () => {
    setBusy(true);
    setError(null);
    const r = await api<CreatedJob>("/api/jobs", {
      body: { companyId, type, tier, delivery, size: ZERO_SIZE, fingerprints: {} },
      idempotencyKey: newIdempotencyKey(),
    });
    setBusy(false);
    if (r.ok) setJob(r.data);
    else setError(r.message);
  };

  const confirm = async (j: CreatedJob) => {
    setBusy(true);
    setError(null);
    const hold = await api(
      j.quote === null ? `/api/jobs/${j.jobId}/confirm` : `/api/jobs/${j.jobId}/accept-quote`,
      { body: {}, idempotencyKey: newIdempotencyKey() },
    );
    if (!hold.ok) {
      setBusy(false);
      setError(hold.message);
      return;
    }
    try {
      await onHeld(j.jobId, delivery);
      setJob(null);
    } finally {
      setBusy(false);
    }
  };

  const credits = job?.quote?.credits ?? job?.priceCredits ?? "0";
  return (
    <div className="flex flex-col gap-3">
      {job === null ? (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col text-sm">
            <span className="text-neutral-700">Intelligence tier</span>
            <select
              className="h-9 rounded-md border border-neutral-300 px-2"
              value={tier}
              onChange={(e) => {
                setTier(e.target.value as Tier);
              }}
            >
              {(Object.keys(TIER_LABELS) as Tier[]).map((t) => (
                <option key={t} value={t}>
                  {TIER_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          {deliveries.length > 1 ? (
            <label className="flex flex-col text-sm">
              <span className="text-neutral-700">Delivery</span>
              <select
                className="h-9 rounded-md border border-neutral-300 px-2"
                value={delivery}
                onChange={(e) => {
                  setDelivery(e.target.value as Delivery);
                }}
              >
                {deliveries.map((d) => (
                  <option key={d} value={d}>
                    {DELIVERY_LABELS[d]}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <Button onClick={() => void price()} disabled={busy}>
            {busy ? "Pricing…" : label}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <dl className="grid max-w-md grid-cols-2 gap-y-2 text-sm" data-testid="job-price">
            <dt className="text-neutral-600">Action</dt>
            <dd className="text-right font-medium">{ACTION_LABELS[type]}</dd>
            <dt className="text-neutral-600">Intelligence tier</dt>
            <dd className="text-right font-medium">{TIER_LABELS[tier]}</dd>
            <dt className="text-neutral-600">Delivery</dt>
            <dd className="text-right font-medium">{DELIVERY_LABELS[delivery]}</dd>
            <dt className="text-neutral-600">{job.quote === null ? "Price" : "Quote"}</dt>
            <dd className="text-right font-medium tabular-nums">{formatCredits(credits)} credits</dd>
            <dt className="text-neutral-600">Available after</dt>
            <dd className="text-right tabular-nums">
              {formatCredits((BigInt(job.available) - BigInt(credits)).toString())}
            </dd>
          </dl>
          {BigInt(job.available) < BigInt(credits) ? (
            <Alert tone="warning">
              Not enough credits.{" "}
              <a href="/wallet" className="underline">
                Buy credits
              </a>{" "}
              to continue.
            </Alert>
          ) : null}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => {
                setJob(null);
              }}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void confirm(job)}
              disabled={busy || BigInt(job.available) < BigInt(credits)}
            >
              {busy ? "Working…" : `Confirm — ${formatCredits(credits)} credits`}
            </Button>
          </div>
        </div>
      )}
      {error === null ? null : <Alert tone="error">{error}</Alert>}
    </div>
  );
}
