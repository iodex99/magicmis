"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type SyntheticEvent } from "react";

import { Alert, AuthShell, Button, Field } from "@/components/ui";
import { api, formText } from "@/lib/client-api";

/**
 * Set a new password, reached from the emailed link (SPEC §8, ADR 0043).
 *
 * Opening the link changes nothing: the token rides in the address and is only spent when
 * this form is submitted, together with the new password. Arriving without one — or with one
 * that has been used or has lapsed — leads to asking for another.
 */
function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get("token_hash");
  const [message, setMessage] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [expired, setExpired] = useState(token === null || token === "");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setMessage(null);
    setFieldError(undefined);
    const result = await api<{ next: "app" }>("/api/auth/reset", {
      body: { tokenHash: token, newPassword: formText(form, "password") },
    });
    setSubmitting(false);
    if (result.ok) {
      router.replace("/app");
      return;
    }
    if (result.error === "link_expired") setExpired(true);
    else if (result.status === 403) router.replace("/sign-in?reset=done");
    else {
      setFieldError(result.fields["newPassword"]);
      setMessage(result.message);
    }
  }

  if (expired) {
    return (
      <div className="flex flex-col gap-3 text-sm text-neutral-600">
        <Alert tone="error">That link has expired or has already been used.</Alert>
        <Link
          href="/forgot-password"
          className="font-medium text-accent-700 hover:underline"
        >
          Send me a new link
        </Link>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        void onSubmit(e);
      }}
      className="flex flex-col gap-4"
      noValidate
    >
      {message ? <Alert tone="error">{message}</Alert> : null}
      <Field
        id="password"
        name="password"
        type="password"
        label="New password"
        autoComplete="new-password"
        hint="At least 12 characters, with upper- and lower-case letters and a digit."
        error={fieldError}
        required
      />
      <Button type="submit" disabled={submitting} size="lg" className="mt-1 w-full">
        {submitting ? "Saving…" : "Set password"}
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthShell
      title="Set a new password"
      description="Choose the password you will sign in with from now on."
    >
      <Suspense>
        <ResetForm />
      </Suspense>
    </AuthShell>
  );
}
