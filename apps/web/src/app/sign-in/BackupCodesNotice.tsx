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
        className="grid grid-cols-2 gap-2 rounded-md border border-neutral-200 bg-neutral-50 p-4 font-mono text-sm"
        data-testid="backup-codes"
      >
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ol>
      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          void navigator.clipboard.writeText(codes.join("\n")).then(() => {
            setCopied(true);
          });
        }}
      >
        {copied ? "Copied" : "Copy codes"}
      </Button>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => {
            setConfirmed(e.target.checked);
          }}
        />
        I have saved my backup codes somewhere safe.
      </label>
      <Button type="button" disabled={!confirmed} onClick={onDone}>
        Continue
      </Button>
    </div>
  );
}
