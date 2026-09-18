"use client";

import Link from "next/link";
import { useState, type SyntheticEvent } from "react";

import { Alert, AuthShell, Button, Field } from "@/components/ui";
import { api, formText } from "@/lib/client-api";

/**
 * Forgot password (SPEC §8: "Password reset by email"; ADR 0043).
 *
 * Also how an account created through Google or Apple gets a password: the link that arrives
 * sets one. The screen says the same thing whether or not the address has an account, because
 * the server does.
 */
export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setMessage(null);
    const result = await api<{ status: string }>("/api/auth/forgot", {
      body: { email: formText(form, "email") },
    });
    setSubmitting(false);
    if (result.ok) setSent(true);
    else setMessage(result.fields["email"] ?? result.message);
  }

  return (
    <AuthShell
      title={sent ? "Check your email" : "Reset your password"}
      description={
        sent
          ? "If that address has an account, a link to set a new password is on its way."
          : "Enter your account's email address and we will send you a link to set a new one."
      }
      footer={
        <Link href="/sign-in" className="font-medium text-accent-700 hover:underline">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <p className="text-sm text-neutral-600" data-testid="reset-sent">
          The link works once and expires within the hour. No email after a few minutes?
          Check your spam folder, then try again.
        </p>
      ) : (
        <form
          onSubmit={(e) => {
            void onSubmit(e);
          }}
          className="flex flex-col gap-4"
          noValidate
        >
          {message ? <Alert tone="error">{message}</Alert> : null}
          <Field
            id="email"
            name="email"
            type="email"
            label="Email"
            autoComplete="email"
            required
          />
          <Button type="submit" disabled={submitting} size="lg" className="mt-1 w-full">
            {submitting ? "Sending…" : "Send the link"}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
