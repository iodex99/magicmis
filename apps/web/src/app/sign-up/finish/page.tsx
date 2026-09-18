"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type SyntheticEvent } from "react";

import { Alert, AuthShell, Button, Field } from "@/components/ui";
import { api, formText } from "@/lib/client-api";

/**
 * The second half of signing up with Google or Apple (ADR 0043).
 *
 * The provider has said who this is. What it cannot say is what the business is called or
 * whether its owner accepts the terms — the same two things the password form asks — so they
 * are asked here, once, before there is an account at all.
 */
export default function FinishSignUpPage() {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const accepted = form.get("accept") === "on";
    if (!accepted) {
      setMessage("Accept the Terms and the Privacy notice to continue.");
      return;
    }
    setSubmitting(true);
    setMessage(null);
    const result = await api<{ next: "app" }>("/api/auth/finish", {
      body: {
        businessName: formText(form, "businessName"),
        acceptTerms: true,
        acceptPrivacy: true,
      },
    });
    setSubmitting(false);
    if (!result.ok) {
      setFields(result.fields);
      setMessage(result.message);
      return;
    }
    router.replace("/app");
  }

  return (
    <AuthShell
      moment="join"
      title="One last thing"
      description="You are signed in. Tell us what to call your business and you are done."
      footer={
        <>
          Wrong account?{" "}
          <Link href="/sign-in" className="font-medium text-accent-700 hover:underline">
            Sign in a different way
          </Link>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          void onSubmit(e);
        }}
        className="flex flex-col gap-4"
        noValidate
      >
        {message ? <Alert tone="error">{message}</Alert> : null}
        <Field
          id="businessName"
          name="businessName"
          label="Business name"
          placeholder="Northwind & Co"
          hint="Goes on your invoices. You can change it later."
          error={fields["businessName"]}
          required
        />
        <label className="flex items-start gap-2.5 text-[0.8125rem] text-neutral-700">
          <input type="checkbox" name="accept" className="mt-0.5" />
          <span>
            I accept the{" "}
            <Link
              href="/legal/terms"
              className="text-accent-700 underline"
              target="_blank"
            >
              Terms
            </Link>{" "}
            and the{" "}
            <Link
              href="/legal/privacy"
              className="text-accent-700 underline"
              target="_blank"
            >
              Privacy notice
            </Link>
            .
          </span>
        </label>
        <Button type="submit" disabled={submitting} size="lg" className="mt-1 w-full">
          {submitting ? "Creating…" : "Create account"}
        </Button>
      </form>
    </AuthShell>
  );
}
