"use client";

import Link from "next/link";
import { useState, type SyntheticEvent } from "react";

import { Alert, AuthShell, Button, Field } from "@/components/ui";
import { api, formText } from "@/lib/client-api";

export default function RecoverPage() {
  const [message, setMessage] = useState<{
    tone: "error" | "success";
    text: string;
  } | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    const result = await api<{ message: string }>("/api/auth/backup-code", {
      body: { code: formText(form, "code") },
    });
    setSubmitting(false);
    if (result.ok) {
      setDone(true);
      setMessage({ tone: "success", text: result.data.message });
    } else {
      setMessage({ tone: "error", text: result.message });
    }
  }

  return (
    <AuthShell title="Use a backup code">
      <div className="flex flex-col gap-4">
        {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
        {done ? (
          <Link
            href="/sign-in"
            className="inline-flex h-9 w-fit items-center rounded-md bg-accent-600 px-4 text-sm font-medium text-white"
          >
            Sign in again
          </Link>
        ) : (
          <form
            onSubmit={(e) => {
              void onSubmit(e);
            }}
            className="flex flex-col gap-4"
            noValidate
          >
            <p className="text-sm text-neutral-700">
              Enter one of the backup codes you saved when you set up two-factor
              authentication. Your old authenticator will be removed and you will set up a
              new one.
            </p>
            <Field
              id="code"
              name="code"
              label="Backup code"
              placeholder="XXXX-XXXX"
              autoComplete="off"
              required
            />
            <Button type="submit" disabled={submitting}>
              {submitting ? "Checking…" : "Use backup code"}
            </Button>
            {/* SPEC §8: no automated recovery bypasses 2FA; the fallback is a manual, verified process. */}
            <p className="text-xs text-neutral-600">
              No backup codes? Contact support from your registered business email.
              Recovery requires verification of your business details.
            </p>
          </form>
        )}
      </div>
    </AuthShell>
  );
}
