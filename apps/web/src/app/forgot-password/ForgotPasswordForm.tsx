"use client";

import Link from "next/link";
import { useState, type SyntheticEvent } from "react";

import { Alert, AuthShell, Button, Field } from "@/components/ui";
import { api } from "@/lib/client-api";

/**
 * Forgot password (SPEC §8: "Password reset by email"; ADR 0043).
 *
 * Also how an account created through Google or Apple gets a password: the link that arrives
 * sets one. The screen says the same thing whether or not the address has an account, because
 * the server does. Once sent it names the address and offers to send again or to use another,
 * rather than ending on "try again" with the form gone (ADR 0091).
 */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [again, setAgain] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);

  async function send(address: string): Promise<boolean> {
    setSubmitting(true);
    setMessage(null);
    setFieldError(undefined);
    const result = await api<{ status: string }>("/api/auth/forgot", {
      body: { email: address },
    });
    setSubmitting(false);
    if (result.ok) return true;
    if (result.fields["email"] !== undefined) {
      setFieldError(result.fields["email"]);
      document.getElementById("email")?.focus();
    } else setMessage(result.message);
    return false;
  }

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = email.trim();
    if (await send(address)) {
      setSentTo(address);
      setAgain(false);
    }
  }

  return (
    <AuthShell
      title={sentTo === null ? "Reset your password" : "Check your email"}
      description={
        sentTo === null
          ? "Enter your account's email address and we will send you a link to set a new one."
          : "If that address has an account, a link to set a new password is on its way."
      }
      footer={
        <Link href="/sign-in" className="font-medium text-accent-700 hover:underline">
          Back to sign in
        </Link>
      }
    >
      {sentTo !== null ? (
        <div
          className="flex flex-col gap-3 text-sm text-neutral-600"
          data-testid="reset-sent"
        >
          <p>
            It went to{" "}
            <strong className="font-semibold break-all text-neutral-900">{sentTo}</strong>
            . The link works once and expires within the hour.
          </p>
          <p>No email after a few minutes? Check your spam folder, or send it again.</p>
          {again ? (
            <Alert tone="success">Sent again. It can take a minute to arrive.</Alert>
          ) : null}
          {message ? <Alert tone="error">{message}</Alert> : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              size="sm"
              icon="mail"
              disabled={submitting}
              onClick={() => {
                void send(sentTo).then((sent) => {
                  setAgain(sent);
                });
              }}
              data-testid="reset-send-again"
            >
              {submitting ? "Sending…" : "Send it again"}
            </Button>
            <button
              type="button"
              className="text-[0.8125rem] font-medium text-accent-700 hover:underline"
              onClick={() => {
                setSentTo(null);
                setAgain(false);
                setMessage(null);
              }}
            >
              Use a different address
            </button>
          </div>
        </div>
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
            autoFocus
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
            }}
            error={fieldError}
          />
          <Button type="submit" disabled={submitting} size="lg" className="mt-1 w-full">
            {submitting ? "Sending…" : "Send the link"}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
