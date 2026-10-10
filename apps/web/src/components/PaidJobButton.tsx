"use client";

/**
 * A paid action without files (dashboard add-on, dashboard refresh): one press holds the credits
 * and hands the held job to `onHeld` (ADR 0033). A quote over the AI cost cap is shown and must
 * be accepted first (locked decision 6); a wallet that cannot cover it says so and holds nothing,
 * and is topped up right here (ADR 0049, ADR 0091) rather than sent to the Wallet and back.
 */

import { useState } from "react";

import { Alert, Button } from "@/components/ui";
import { formatCredits } from "@/lib/actions";
import { istLabelled } from "@/lib/job-display";
import { acceptQuote, startPaidJob, type StartResult } from "@/lib/paid-job";

import { BuyCreditsInline } from "./BuyCreditsInline";
import type { IconName } from "./Icon";

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
  busyLabel = "Working…",
  icon,
  onHeld,
}: {
  companyId: string;
  type: "dashboard_addon" | "dashboard_refresh";
  label: string;
  busyLabel?: string;
  icon?: IconName;
  onHeld: (jobId: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [stopped, setStopped] = useState<Exclude<StartResult, { kind: "held" }> | null>(
    null,
  );

  const settle = async (result: StartResult) => {
    if (result.kind !== "held") {
      setStopped(result);
      return;
    }
    setStopped(null);
    await onHeld(result.jobId);
  };

  const start = async () => {
    setBusy(true);
    try {
      await settle(
        await startPaidJob({
          companyId,
          type,
          tier: "professional",
          delivery: "standard",
          size: ZERO_SIZE,
          fingerprints: {},
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {stopped?.kind === "quote" ? (
        <Alert tone="warning" title="This one needs a quote">
          <p>
            It needs more analysis than the standard price covers:{" "}
            <strong className="tabular-nums">{formatCredits(stopped.credits)}</strong>{" "}
            credits
            {stopped.expiresAt === null
              ? "."
              : `, held until ${istLabelled(new Date(stopped.expiresAt))}.`}
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void acceptQuote(stopped.jobId, stopped.credits)
                  .then(settle)
                  .finally(() => {
                    setBusy(false);
                  });
              }}
            >
              Accept and continue
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setStopped(null);
              }}
            >
              Not now
            </Button>
          </div>
        </Alert>
      ) : (
        <Button
          onClick={() => void start()}
          disabled={busy}
          {...(icon === undefined ? {} : { icon })}
        >
          {busy ? busyLabel : label}
        </Button>
      )}
      {stopped?.kind === "short" ? (
        <>
          <p className="text-[0.8125rem] text-neutral-600">
            Not enough credits for this. Nothing has been charged.
          </p>
          <BuyCreditsInline
            need={stopped.need}
            onCredited={() => {
              // Back to the quote that was waiting, if there was one; else the button.
              setStopped(stopped.quote ?? null);
            }}
          />
        </>
      ) : null}
      {stopped?.kind === "error" ? <Alert tone="error">{stopped.message}</Alert> : null}
    </div>
  );
}
