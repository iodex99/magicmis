"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { BuyCreditsInline } from "@/components/BuyCreditsInline";
import { Alert, Button, Panel } from "@/components/ui";
import { formatCredits } from "@/lib/actions";
import { api, newIdempotencyKey } from "@/lib/client-api";

import type { Closed } from "./run-context";

/**
 * A company that cannot take a file, said before the drop zone (ADR 0091).
 *
 * It used to let the customer upload a year of files and refuse at the button, with a sentence
 * about a memory fee that the badge ("Paused — add credits") did not explain and nothing on the
 * page let them pay. Now the state is said first, with what opens it again offered in place: the
 * credits for a paused company's fee, or the restore for an archived one (SPEC §28).
 */
export function ClosedCompany({
  companyId,
  closed,
  businessName,
}: {
  companyId: string;
  closed: Closed;
  businessName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [short, setShort] = useState<bigint | null>(null);
  const [topped, setTopped] = useState(false);

  if (closed.kind === "paused") {
    const need = BigInt(closed.owed) - BigInt(closed.available);
    return (
      <Panel title="This company is paused" icon="pause">
        <div className="flex max-w-2xl flex-col gap-3" data-testid="company-paused">
          <p className="text-sm leading-relaxed text-neutral-700">
            Its monthly memory fee could not be taken from your wallet, so files cannot be
            added and nothing can run until it is paid. Its dashboard, figures and files
            are all kept.
          </p>
          {need > 0n && !topped ? (
            <BuyCreditsInline
              need={need}
              businessName={businessName}
              onCredited={() => {
                setTopped(true);
              }}
            />
          ) : (
            <Alert tone="info">
              Your wallet now covers the {formatCredits(closed.owed)} credits owed. The
              fee is taken at the next daily check, overnight, and the company opens again
              on its own; add the file then.
            </Alert>
          )}
        </div>
      </Panel>
    );
  }

  if (closed.kind === "archived") {
    const restore = async () => {
      setBusy(true);
      setError(null);
      const r = await api<{ restored: boolean; credits: string }>(
        `/api/companies/${companyId}/restore`,
        { body: {}, idempotencyKey: newIdempotencyKey() },
      );
      setBusy(false);
      if (r.ok) {
        router.refresh();
        return;
      }
      if (r.status === 402 && closed.restoreCredits !== null) {
        const gap = BigInt(closed.restoreCredits) - BigInt(closed.available);
        setShort(gap > 0n ? gap : 1n);
        return;
      }
      setError(r.message);
    };
    return (
      <Panel title="This company is archived" icon="archive">
        <div className="flex max-w-2xl flex-col gap-3" data-testid="company-archived">
          <p className="text-sm leading-relaxed text-neutral-700">
            It was archived after its memory fee went unpaid. Restoring it opens it again
            with everything it had
            {closed.restoreCredits === null
              ? "."
              : `, for ${formatCredits(closed.restoreCredits)} credits: the restore and this month's memory fee.`}
          </p>
          {error === null ? null : <Alert tone="error">{error}</Alert>}
          {short !== null ? (
            <BuyCreditsInline
              need={short}
              businessName={businessName}
              onCredited={() => {
                setShort(null);
              }}
            />
          ) : (
            <div>
              <Button icon="refresh" disabled={busy} onClick={() => void restore()}>
                {busy
                  ? "Restoring…"
                  : closed.restoreCredits === null
                    ? "Restore this company"
                    : `Restore for ${formatCredits(closed.restoreCredits)} credits`}
              </Button>
            </div>
          )}
        </div>
      </Panel>
    );
  }

  return (
    <Panel title="This company is closed" icon="lock">
      <p className="text-sm text-neutral-600">
        Files cannot be added to it. Open your companies to choose another.
      </p>
    </Panel>
  );
}
