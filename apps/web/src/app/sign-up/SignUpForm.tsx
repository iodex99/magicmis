"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type SyntheticEvent } from "react";

import { ProviderButtons } from "@/components/ProviderButtons";
import { Alert, AuthShell, Button, Field } from "@/components/ui";
import { api, formText, newIdempotencyKey } from "@/lib/client-api";
import type { OAuthProvider } from "@/lib/server/oauth";

/**
 * Sign-up (SPEC §8).
 *
 * Four things: who you are, a password, what to call your business, and one consent.
 * The billing address and GSTIN used to live here — nine further fields, all of them for
 * a tax invoice nobody had asked for yet. They are now collected at the first purchase,
 * which is where GST place of supply is actually needed (migration 0034).
 */
export function SignUpScreen({ providers }: { providers: readonly OAuthProvider[] }) {
  const router = useRouter();
  const [fields, setFields] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const idempotencyKey = useRef(newIdempotencyKey());

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => formText(form, name);
    setSubmitting(true);
    setMessage(null);

    // One tick, two documents: each consent is still recorded with its own version.
    const accepted = form.get("accept") === "on";
    const result = await api<{ status: string }>("/api/auth/sign-up", {
      idempotencyKey: idempotencyKey.current,
      body: {
        email: text("email"),
        password: text("password"),
        businessName: text("businessName"),
        acceptTerms: accepted,
        acceptPrivacy: accepted,
      },
    });
    setSubmitting(false);

    if (result.ok) {
      router.push("/sign-up/check-email");
      return;
    }
    setFields(result.fields);
    setMessage(result.message);
    // A failed attempt may be corrected and resubmitted; that is a new request.
    idempotencyKey.current = newIdempotencyKey();
  }

  const consentError = fields["acceptTerms"] ?? fields["acceptPrivacy"];

  return (
    <AuthShell
      moment="join"
      title="Create your account"
      description="Free to create. You buy credits when you are ready to run something."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/sign-in" className="font-medium text-accent-700 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <ProviderButtons providers={providers} />
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
          label="Work email"
          placeholder="you@firm.com"
          autoComplete="email"
          autoFocus
          required
          error={fields["email"]}
        />
        <Field
          id="password"
          name="password"
          type="password"
          label="Password"
          autoComplete="new-password"
          required
          hint="At least 12 characters, with upper- and lower-case letters and a digit."
          error={fields["password"]}
        />
        <Field
          id="businessName"
          name="businessName"
          label="Business name"
          placeholder="Northwind & Co"
          autoComplete="organization"
          required
          hint="Goes on your invoices. You can change it later."
          error={fields["businessName"]}
        />

        {/* TODO(review): R-10/R-11 — link targets are placeholder legal pages until drafted. */}
        <label className="flex items-start gap-2.5 text-[0.8125rem] text-neutral-700">
          <input
            type="checkbox"
            name="accept"
            className="mt-0.5 h-4 w-4 accent-[#5846d2]"
          />
          <span>
            I accept the{" "}
            <Link href="/legal/terms" className="font-medium text-accent-700 underline">
              Terms
            </Link>{" "}
            and the{" "}
            <Link href="/legal/privacy" className="font-medium text-accent-700 underline">
              Privacy notice
            </Link>
            .
          </span>
        </label>
        {consentError === undefined ? null : (
          <p className="-mt-2 text-[0.75rem] font-medium text-negative">{consentError}</p>
        )}

        <Button type="submit" disabled={submitting} size="lg" className="mt-1 w-full">
          {submitting ? "Creating account…" : "Create account"}
        </Button>
        <p className="text-center text-[0.75rem] text-neutral-500">
          Next: confirm your email, and you are in.
        </p>
      </form>
    </AuthShell>
  );
}
