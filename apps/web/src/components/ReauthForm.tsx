"use client";

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
    else setMessage(result.message);
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
