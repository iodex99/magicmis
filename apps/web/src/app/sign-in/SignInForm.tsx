"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type SyntheticEvent } from "react";

import { safeNextPath } from "@magicmis/accounts/redirect";

import { ProviderButtons } from "@/components/ProviderButtons";
import { Alert, AuthShell, Button, Field } from "@/components/ui";
import { api, formText } from "@/lib/client-api";
import type { OAuthProvider } from "@/lib/server/oauth";

function Form({ providers }: { providers: readonly OAuthProvider[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setMessage(null);
    const result = await api<{ next: "app" | "finish" }>("/api/auth/sign-in", {
      body: { email: formText(form, "email"), password: formText(form, "password") },
    });
    setSubmitting(false);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    // Only same-origin relative paths, or a crafted ?next= would bounce a freshly signed-in
    // session to another site. The shared guard is the same one /auth/callback uses.
    router.replace(
      result.data.next === "finish"
        ? "/sign-up/finish"
        : safeNextPath(params.get("next"), "/app"),
    );
  }

  return (
    <>
      <ProviderButtons providers={providers} next={params.get("next") ?? undefined} />
      <form
        onSubmit={(e) => {
          void onSubmit(e);
        }}
        className="flex flex-col gap-4"
        noValidate
      >
        {params.get("verification") === "failed" ? (
          <Alert tone="error">
            That verification link is invalid or has expired. Sign in to request a new
            one.
          </Alert>
        ) : null}
        {params.get("provider") === "unavailable" ? (
          <Alert tone="error">
            That sign-in option is not available right now. Use your email and password.
          </Alert>
        ) : null}
        {params.get("reset") === "done" ? (
          <Alert tone="success">Your password is set. Sign in with it to continue.</Alert>
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
        <p className="text-center text-[0.8125rem]">
          <Link
            href="/forgot-password"
            className="text-neutral-500 hover:text-accent-700"
          >
            Forgot your password?
          </Link>
        </p>
      </form>
    </>
  );
}

export function SignInScreen({ providers }: { providers: readonly OAuthProvider[] }) {
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
        <Form providers={providers} />
      </Suspense>
    </AuthShell>
  );
}
