"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type SyntheticEvent } from "react";

import { Alert, AuthShell, Button, Field } from "@/components/ui";
import { api, formText, newIdempotencyKey } from "@/lib/client-api";

function VerifyForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void api<{ enrolled: boolean; factorId?: string }>("/api/auth/mfa/factor").then(
      (result) => {
        if (!result.ok) {
          router.replace("/sign-in");
          return;
        }
        if (!result.data.enrolled || result.data.factorId === undefined)
          router.replace("/sign-in/enrol");
        else setFactorId(result.data.factorId);
      },
    );
  }, [router]);

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (factorId === null) return;
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setMessage(null);
    const result = await api<{ status: string }>("/api/auth/mfa/verify", {
      idempotencyKey: newIdempotencyKey(),
      body: { factorId, code: formText(form, "code").trim() },
    });
    setSubmitting(false);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    const next = params.get("next");
    router.replace(
      next && next.startsWith("/") && !next.startsWith("//") ? next : "/app",
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
        id="code"
        name="code"
        label="6-digit code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        required
      />
      <Button
        type="submit"
        disabled={submitting || factorId === null}
        size="lg"
        className="mt-1 w-full"
      >
        {submitting ? "Verifying…" : "Verify"}
      </Button>
    </form>
  );
}

export default function MfaPage() {
  return (
    <AuthShell
      title="Two-factor authentication"
      description="Enter the 6-digit code from your authenticator app."
      footer={
        <>
          Lost your authenticator?{" "}
          <Link
            href="/sign-in/recover"
            className="font-medium text-accent-700 hover:underline"
          >
            Use a backup code
          </Link>
        </>
      }
    >
      <Suspense>
        <VerifyForm />
      </Suspense>
    </AuthShell>
  );
}
