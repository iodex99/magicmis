"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { api, newIdempotencyKey } from "@/lib/client-api";

import { Alert, Button } from "./ui";

interface ConsentState {
  processing: { current: boolean };
}

/**
 * SPEC §31 first-upload notice: before the account's first upload (and again whenever the
 * processing notice version changes), show how files are processed and record acceptance.
 * Children — the file pickers — render only once the current version is accepted.
 *
 * TODO(review): R-11 — notice wording pending legal review.
 */
export function ProcessingNotice({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"loading" | "needed" | "accepted" | "error">(
    "loading",
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void api<{ consents: ConsentState }>("/api/account/consents").then((r) => {
      if (!r.ok) setState("error");
      else setState(r.data.consents.processing.current ? "accepted" : "needed");
    });
  }, []);

  async function accept() {
    setSaving(true);
    const r = await api<{ consents: ConsentState }>("/api/account/consents", {
      body: { document: "processing" },
      idempotencyKey: newIdempotencyKey(),
    });
    setSaving(false);
    if (r.ok && r.data.consents.processing.current) setState("accepted");
    else setState("error");
  }

  if (state === "accepted") return <>{children}</>;
  if (state === "loading") return <p className="text-sm text-neutral-600">Loading…</p>;
  if (state === "error")
    return (
      <Alert tone="error">
        We could not load the processing notice. Reload the page to try again.
      </Alert>
    );
  return (
    <div
      className="flex flex-col gap-3 rounded-md border border-neutral-300 bg-neutral-50 p-4 text-sm text-neutral-800"
      data-testid="processing-notice"
    >
      <p className="font-medium text-neutral-900">How your files are processed</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>Files are read in this browser. They are not uploaded to our servers.</li>
        <li>
          Before anything is sent, names, PAN, GSTIN, bank details and similar identifiers
          are replaced with tokens in your browser.
        </li>
        <li>
          Only structural profiles, a small capped sample of redacted rows, and computed
          totals are sent — and only for a paid action you start.
        </li>
        <li>
          AI requests are processed by Anthropic as our subprocessor. Company memory is
          stored encrypted until you delete the company or your account.
        </li>
      </ul>
      <p>
        Read the full{" "}
        <Link href="/legal/privacy" className="underline">
          privacy notice
        </Link>
        .
      </p>
      <div>
        <Button onClick={() => void accept()} disabled={saving}>
          I understand — continue
        </Button>
      </div>
    </div>
  );
}
