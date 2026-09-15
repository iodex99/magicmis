"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type SyntheticEvent } from "react";

import { Alert, AuthShell, Button, Field } from "@/components/ui";
import { api, formText } from "@/lib/client-api";

function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setMessage(null);
    const result = await api<{ next: "app" }>("/api/auth/sign-in", {
      body: { email: formText(form, "email"), password: formText(form, "password") },
    });
    setSubmitting(false);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    // Only same-origin relative paths, or a crafted ?next= would bounce a fresh session
    // to another site.
    const next = params.get("next") ?? "";
    const safe = next.startsWith("/") && !next.startsWith("//");
    router.replace(safe ? next : "/app");
  }

  return (
    <form
      onSubmit={(e) => {
        void onSubmit(e);
      }}
      className="flex flex-col gap-4"
      noValidate
    >
      {params.get("verification") === "failed" ? (
        <Alert tone="error">
          That verification link is invalid or has expired. Sign in to request a new one.
        </Alert>
      ) : null}
      {message ? <Alert tone="error">{message}</Alert> : null}
      <Field
        id="email"
        name="email"
        type="email"
        label="Email"
        autoComplete="email"
        required
      />
      <Field
        id="password"
        name="password"
        type="password"
        label="Password"
        autoComplete="current-password"
        required
      />
      <Button type="submit" disabled={submitting} size="lg" className="mt-1 w-full">
        {submitting ? "Signing in…" : "Continue"}
      </Button>
    </form>
  );
}

export default function SignInPage() {
  return (
    <AuthShell
      title="Sign in"
      description="Welcome back."
      footer={
        <>
          No account?{" "}
          <Link href="/sign-up" className="font-medium text-accent-700 hover:underline">
            Create one
          </Link>
        </>
      }
    >
      <Suspense>
        <SignInForm />
      </Suspense>
    </AuthShell>
  );
}
