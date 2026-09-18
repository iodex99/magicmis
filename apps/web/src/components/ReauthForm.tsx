"use client";

import Link from "next/link";
import { useState, type SyntheticEvent } from "react";

import { api, formText } from "@/lib/client-api";

import { Alert, Button, Field } from "./ui";

/**
 * SPEC §8 re-authentication: the password again, before a sensitive action. On success
 * the server grants a short window bound to this session; `onGranted` then lets the
 * caller perform its action.
 *
 * With no second factor (ADR 0028) this is the last gate before something irreversible,
 * so it is asked for every time and never remembered beyond that window.
 */
export function ReauthForm({
  actionLabel,
  onGranted,
}: {
  actionLabel: string;
  onGranted: () => void;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [noPassword, setNoPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setMessage(null);
    const result = await api<{ status: string }>("/api/account/reauth", {
      body: { password: formText(form, "password") },
    });
    setSubmitting(false);
    if (result.ok) onGranted();
    else if (result.error === "password_not_set") setNoPassword(true);
    else setMessage(result.message);
  }

  // ADR 0043: an account that signs in with Google or Apple has nothing to type here. The
  // emailed link sets a password, and opening it is itself the confirmation being asked for.
  if (noPassword) {
    return (
      <div
        className="flex flex-col gap-3 text-sm text-neutral-600"
        data-testid="no-password"
      >
        <p>
          This account signs in with Google or Apple and has no password yet. To{" "}
          {actionLabel}, set one first: we will email you a link.
        </p>
        <Link
          href="/forgot-password"
          className="font-medium text-accent-700 hover:underline"
        >
          Email me the link
        </Link>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        void onSubmit(e);
      }}
      className="flex flex-col gap-3"
      noValidate
    >
      <p className="text-sm text-neutral-600">Confirm it's you to {actionLabel}.</p>
      {message ? <Alert tone="error">{message}</Alert> : null}
      <Field
        id="reauth-password"
        name="password"
        type="password"
        label="Current password"
        autoComplete="current-password"
        required
      />
      <Button type="submit" disabled={submitting}>
        {submitting ? "Checking…" : "Confirm"}
      </Button>
    </form>
  );
}
