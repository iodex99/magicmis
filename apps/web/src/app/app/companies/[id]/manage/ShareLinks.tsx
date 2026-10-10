"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Alert, Badge, Button } from "@/components/ui";
import { api } from "@/lib/client-api";

export interface ShareRow {
  readonly id: string;
  readonly monthLabel: string;
  readonly withWriting: boolean;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
  readonly views: number;
  /** Each moment written on the server, in IST and labelled so (ADR 0091). */
  readonly createdLabel: string;
  readonly expiresLabel: string;
  readonly revokedLabel: string | null;
  readonly lastViewedLabel: string | null;
}

/**
 * The company's shared links (ADR 0090): which board each shows, how long it works, how often it
 * has been opened and when last, and a way to withdraw it at once. Who opened it is not known:
 * there is no account behind a link, and nothing about the reader is kept.
 *
 * Withdrawing is for good, so it asks first and says so (ADR 0091). A link is shown only when it
 * is made, because only its hash is kept; this list says that too, since it is where an owner
 * comes looking for one to send again.
 */
export function ShareLinks({
  companyId,
  shares,
  now,
}: {
  companyId: string;
  shares: readonly ShareRow[];
  now: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (shares.length === 0)
    return (
      <p className="text-[0.8125rem] text-neutral-500" data-testid="share-links-empty">
        No links yet. Share a board from its Share button; each link appears here.
      </p>
    );

  const withdraw = async (id: string) => {
    setBusy(id);
    setError(null);
    const r = await api(`/api/companies/${companyId}/shares`, {
      method: "DELETE",
      body: { id },
    });
    setBusy(null);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setConfirming(null);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[0.8125rem] text-neutral-600">
        A link is shown once, when it is made: only a coded fingerprint of it is kept. To
        send one again, make a new link from the board&rsquo;s Share button and withdraw
        the old one here.
      </p>
      {error === null ? null : <Alert tone="error">{error}</Alert>}
      <ul
        className="flex flex-col divide-y divide-neutral-100 rounded-xl border border-neutral-200/80"
        data-testid="share-links"
      >
        {shares.map((s) => {
          const state =
            s.revokedAt !== null
              ? { label: "Withdrawn", tone: "neutral" as const }
              : s.expiresAt <= now
                ? { label: "Expired", tone: "neutral" as const }
                : { label: "Open", tone: "positive" as const };
          const board = `The board as of ${s.monthLabel}`;
          return (
            <li
              key={s.id}
              className="flex flex-col gap-2 px-4 py-3"
              data-testid="share-link"
            >
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[0.875rem] font-medium text-neutral-900">
                    {board}
                    {s.withWriting ? ", with what was written about it" : ""}
                  </p>
                  <p className="text-[0.75rem] text-neutral-500">
                    Made {s.createdLabel} ·{" "}
                    {s.revokedLabel !== null
                      ? `withdrawn ${s.revokedLabel}`
                      : `works until ${s.expiresLabel}`}{" "}
                    · opened{" "}
                    <span className="num" data-testid="share-views">
                      {s.views.toString()}
                    </span>{" "}
                    {s.views === 1 ? "time" : "times"}
                    {s.lastViewedLabel === null ? "" : `, last ${s.lastViewedLabel}`}
                  </p>
                </div>
                <Badge tone={state.tone}>{state.label}</Badge>
                {state.label === "Open" && confirming !== s.id ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => {
                      setError(null);
                      setConfirming(s.id);
                    }}
                    data-testid="share-withdraw"
                  >
                    Withdraw<span className="sr-only"> the link to {board}</span>
                  </Button>
                ) : null}
              </div>
              {state.label === "Open" && confirming === s.id ? (
                <div
                  className="flex flex-col gap-2 rounded-lg border border-neutral-200/80 bg-raised p-3 text-[0.8125rem]"
                  role="group"
                  aria-label={`Withdraw the link to ${board}`}
                >
                  <p className="text-neutral-700">
                    Anyone holding this link stops being able to open it at once. A
                    withdrawn link cannot be opened again; to share the board later, make
                    a new one.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => void withdraw(s.id)}
                      data-testid="share-withdraw-confirm"
                    >
                      {busy === s.id ? "Withdrawing…" : "Withdraw the link"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => {
                        setConfirming(null);
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
