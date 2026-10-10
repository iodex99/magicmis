"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Alert, Badge, Button } from "@/components/ui";
import { api } from "@/lib/client-api";

export interface ShareRow {
  readonly id: string;
  readonly monthLabel: string;
  readonly withWriting: boolean;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
  readonly views: number;
  readonly lastViewedAt: string | null;
}

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

/**
 * The company's shared links (ADR 0090): which board each shows, how long it works, how often it
 * has been opened and when last, and a way to withdraw it at once. Who opened it is not known:
 * there is no account behind a link, and nothing about the reader is kept.
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
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-3">
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
          return (
            <li
              key={s.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3"
              data-testid="share-link"
            >
              <div className="min-w-0 flex-1">
                <p className="text-[0.875rem] font-medium text-neutral-900">
                  The board as of {s.monthLabel}
                  {s.withWriting ? ", with what was written about it" : ""}
                </p>
                <p className="text-[0.75rem] text-neutral-500">
                  Made {day(s.createdAt)} ·{" "}
                  {s.revokedAt !== null
                    ? `withdrawn ${day(s.revokedAt)}`
                    : `works until ${day(s.expiresAt)}`}{" "}
                  · opened{" "}
                  <span className="num" data-testid="share-views">
                    {s.views.toString()}
                  </span>{" "}
                  {s.views === 1 ? "time" : "times"}
                  {s.lastViewedAt === null ? "" : `, last on ${day(s.lastViewedAt)}`}
                </p>
              </div>
              <Badge tone={state.tone}>{state.label}</Badge>
              {state.label === "Open" ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => void withdraw(s.id)}
                  data-testid="share-withdraw"
                >
                  {busy === s.id ? "Withdrawing…" : "Withdraw"}
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
