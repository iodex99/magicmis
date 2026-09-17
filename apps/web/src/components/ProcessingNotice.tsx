"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { api, newIdempotencyKey } from "@/lib/client-api";

import { Icon } from "./Icon";
import { Alert, Button } from "./ui";

interface ConsentState {
  processing: { current: boolean };
}

/**
 * SPEC §31 first-upload notice: before the account's first upload (and again whenever the
 * processing notice version changes), show how files are processed and record acceptance.
 * Children — the file pickers — render only once the current version is accepted.
 *
 * Every line here is a shorter statement of something the privacy notice and the terms say
 * in full; change them together.
 *
 * TODO(review): R-11, R-12 — notice wording pending legal review.
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
  if (state === "loading") return <p className="text-sm text-neutral-500">Loading…</p>;
  if (state === "error")
    return (
      <Alert tone="error">
        We could not load the processing notice. Reload the page to try again.
      </Alert>
    );
  return (
    <div
      className="flex flex-col gap-3 rounded-xl border border-accent-100 bg-accent-50/60 p-5 text-[0.8125rem] text-neutral-700"
      data-testid="processing-notice"
    >
      <p className="flex items-center gap-2 text-[0.9375rem] font-semibold text-neutral-900">
        <Icon name="shield" size={17} className="text-accent-600" />
        How your files are processed
      </p>
      <ul className="list-disc space-y-1.5 pl-5 leading-relaxed">
        <li>
          Your files are opened in this browser. They are not uploaded to our servers.
        </li>
        <li>
          Before anything leaves the browser, names and identifiers — party and employee
          names, tax and registration numbers, bank details, emails and phone numbers —
          are replaced with tokens. The key that restores them stays here.
        </li>
        <li>
          Only for an action you confirm and pay for, our server receives a description of
          the files&rsquo; structure, a small limited sample of redacted rows and computed
          totals.
        </li>
        <li>
          AI requests are processed by Anthropic as our subprocessor, and are not used to
          train its models.
        </li>
        <li>
          The company&rsquo;s memory — mapping, templates and monthly figures — is kept
          encrypted under its own key until you delete the company or your account.
        </li>
        <li>
          If the files contain other people&rsquo;s personal data, you remain responsible
          for it and we process it on your behalf.
        </li>
      </ul>
      <p>
        Details are in the{" "}
        <Link href="/legal/privacy" className="font-medium text-accent-700 underline">
          privacy notice
        </Link>{" "}
        and section 7 of the{" "}
        <Link
          href="/legal/terms#processing"
          className="font-medium text-accent-700 underline"
        >
          terms
        </Link>
        .
      </p>
      <div>
        <Button onClick={() => void accept()} disabled={saving} icon="check">
          I understand — continue
        </Button>
      </div>
    </div>
  );
}
