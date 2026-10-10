"use client";

import { useEffect, useState } from "react";

import { Drawer } from "@/components/Drawer";
import { ReauthForm } from "@/components/ReauthForm";
import { Alert, Button, SelectField } from "@/components/ui";
import { api, newIdempotencyKey } from "@/lib/client-api";

interface Limits {
  defaultDays: number;
  maxDays: number;
}

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

/**
 * Share this board (ADR 0090): a link to the board as it stands now, as of the month on screen,
 * read-only, for anyone who holds it until it expires or is withdrawn. The link is shown once —
 * only a hash of it is kept — so it is copied here or a new one is made.
 *
 * It is the saved board: a Range or Compare the owner is reading with is a view, never saved
 * (ADR 0064), so it is not part of the copy either, and the drawer says so while one is set
 * rather than letting the owner expect the reader to see what they see (ADR 0091).
 */
export function ShareBoard({
  companyId,
  month,
  monthLabel,
  lensSet,
  open,
  onClose,
}: {
  companyId: string;
  month: string;
  monthLabel: string;
  /** Whether the owner is reading the board through Range or Compare right now. */
  lensSet: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const [limits, setLimits] = useState<Limits | null>(null);
  const [days, setDays] = useState<number | null>(null);
  const [withWriting, setWithWriting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{ url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState<boolean | null>(false);
  // A link is made only with the password confirmed just now (ADR 0091).
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMade(null);
    setError(null);
    setCopied(false);
    setConfirming(false);
    void api<{ limits: Limits }>(`/api/companies/${companyId}/shares`).then((r) => {
      if (!r.ok) {
        setError(r.message);
        return;
      }
      setLimits(r.data.limits);
      setDays((d) => d ?? r.data.limits.defaultDays);
    });
  }, [open, companyId]);

  const choices =
    limits === null
      ? []
      : [...new Set([7, 30, limits.defaultDays, limits.maxDays])]
          .filter((d) => d <= limits.maxDays)
          .sort((a, b) => a - b);

  const create = async () => {
    if (days === null) return;
    setBusy(true);
    setError(null);
    const r = await api<{ path: string; expiresAt: string }>(
      `/api/companies/${companyId}/shares`,
      {
        body: { period: month, withWriting, days },
        idempotencyKey: newIdempotencyKey(),
      },
    );
    setBusy(false);
    if (!r.ok) {
      if (r.error === "reauth_required") setConfirming(true);
      else setError(r.message);
      return;
    }
    setMade({
      url: `${window.location.origin}${r.data.path}`,
      expiresAt: r.data.expiresAt,
    });
  };

  return (
    <Drawer open={open} label="Share this board" onClose={onClose}>
      <div className="flex flex-col gap-4" data-testid="share-drawer">
        <div>
          <h2 className="text-[1.0625rem] font-semibold text-neutral-900">
            Share this board
          </h2>
          <p className="mt-1 text-[0.8125rem] leading-relaxed text-neutral-600">
            Anyone with the link sees this board as you saved it, as of {monthLabel}: read
            only, with every figure&rsquo;s working, and no chat, files or workbooks. It
            is a copy, so it does not change when the books do. Each opening is counted on
            Files and settings, where you can withdraw the link at any time.
          </p>
          {lensSet ? (
            <p
              className="mt-2 text-[0.8125rem] leading-relaxed text-neutral-800"
              data-testid="share-as-saved"
            >
              It opens as saved, not with the Range and Compare you are reading it with
              now.
            </p>
          ) : null}
        </div>
        {confirming ? (
          <ReauthForm
            actionLabel="share this board"
            onGranted={() => {
              setConfirming(false);
              void create();
            }}
          />
        ) : made === null ? (
          <>
            <label className="flex items-start gap-3 text-[0.875rem] text-neutral-800">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-accent-600"
                checked={withWriting}
                onChange={(e) => {
                  setWithWriting(e.target.checked);
                }}
                data-testid="share-with-writing"
              />
              <span>
                Include the commentary and where to act for {monthLabel}, if they have
                been written
              </span>
            </label>
            <SelectField
              id="share-days"
              label="The link works for"
              value={days === null ? "" : days.toString()}
              disabled={limits === null}
              onChange={(e) => {
                setDays(Number.parseInt(e.target.value, 10));
              }}
            >
              {choices.map((d) => (
                <option key={d} value={d.toString()}>
                  {d.toString()} days
                </option>
              ))}
            </SelectField>
            {error === null ? null : <Alert tone="error">{error}</Alert>}
            <div>
              <Button
                icon="external"
                onClick={() => void create()}
                disabled={busy || days === null}
                data-testid="share-create"
              >
                {busy ? "Making the link…" : "Make a link"}
              </Button>
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-3" data-testid="share-made">
            <div className="flex items-stretch gap-2">
              <input
                readOnly
                value={made.url}
                aria-label="The link"
                className="min-w-0 flex-1 rounded-lg border border-neutral-200 bg-neutral-25 px-3 py-2 text-[0.8125rem] text-neutral-800"
                data-testid="share-url"
                onFocus={(e) => {
                  e.target.select();
                }}
              />
              <Button
                variant="secondary"
                onClick={() => {
                  navigator.clipboard.writeText(made.url).then(
                    () => {
                      setCopied(true);
                    },
                    // A browser that refuses the clipboard: the link is selected to copy by hand.
                    () => {
                      setCopied(null);
                    },
                  );
                }}
              >
                {copied === true ? "Copied" : "Copy"}
              </Button>
            </div>
            {copied === null ? (
              <p className="text-[0.8125rem] text-neutral-600" role="status">
                This browser would not copy it. Select the link above and copy it
                yourself.
              </p>
            ) : null}
            <p className="text-[0.8125rem] leading-relaxed text-neutral-600">
              It works until {day(made.expiresAt)}. Copy it now: it is not shown again,
              because only a fingerprint of it is kept. Lost it? Make another.
            </p>
            <div>
              <Button
                variant="secondary"
                onClick={() => {
                  setMade(null);
                  setCopied(false);
                }}
              >
                Make another link
              </Button>
            </div>
            <a
              href={`/app/companies/${companyId}/manage#shares`}
              className="text-[0.8125rem] font-medium text-accent-700 underline underline-offset-2"
            >
              See how often your links were opened, and withdraw them
            </a>
          </div>
        )}
      </div>
    </Drawer>
  );
}
