"use client";

import { useState } from "react";

import { Alert, Button } from "@/components/ui";

/**
 * Shows freshly issued backup codes exactly once. They are never stored in plaintext and
 * the response that carried them is never replayed (SPEC §8, migration 0013), so leaving
 * this screen without saving them means regenerating later.
 */
export function BackupCodesNotice({
  codes,
  onDone,
}: {
  codes: string[];
  onDone: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <Alert tone="warning">
        Save these backup codes now. Each works once, and they will not be shown again.
        Use one if you lose access to your authenticator app.
      </Alert>
      <ol
        className="grid grid-cols-2 gap-1.5 rounded-xl border border-neutral-200 bg-neutral-25 p-3"
        data-testid="backup-codes"
      >
        {codes.map((code) => (
          <li
            key={code}
            className="rounded-md bg-white px-2.5 py-1.5 text-center font-mono text-[0.8125rem] tracking-wide text-neutral-900 ring-1 ring-neutral-200"
          >
            {code}
          </li>
        ))}
      </ol>
      <Button
        type="button"
        variant="secondary"
        icon={copied ? "check" : "document"}
        onClick={() => {
          void navigator.clipboard.writeText(codes.join("\n")).then(() => {
            setCopied(true);
          });
        }}
      >
        {copied ? "Copied" : "Copy codes"}
      </Button>
      <label className="flex items-center gap-2.5 text-[0.8125rem] text-neutral-700">
        <input
          type="checkbox"
          checked={confirmed}
          className="h-4 w-4 accent-[#5846d2]"
          onChange={(e) => {
            setConfirmed(e.target.checked);
          }}
        />
        I have saved my backup codes somewhere safe.
      </label>
      <Button
        type="button"
        disabled={!confirmed}
        size="lg"
        className="w-full"
        onClick={onDone}
      >
        Continue
      </Button>
    </div>
  );
}
