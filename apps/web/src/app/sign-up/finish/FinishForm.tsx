"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type SyntheticEvent } from "react";

import { Alert, AuthShell, Button, Field } from "@/components/ui";
import { api, formText } from "@/lib/client-api";

/**
 * The second half of signing up with Google or Apple (ADR 0043), and of a password sign-up whose
 * confirmation link was opened in another browser (ADR 0071).
 *
 * The provider, or the link, has said who owns the address. What it cannot say is what the
 * business is called or whether its owner accepts the terms — the same things the password form
 * asks — so they are asked here, once. After a link opened in another browser the password chosen
 * at sign-up has been destroyed, because nothing shows that whoever chose it owns the mailbox, so
 * the owner sets their own here too.
 */
export function FinishForm({ askPassword }: { askPassword: boolean }) {
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
      document.getElementById("accept")?.focus();
      return;
    }
    setSubmitting(true);
    setMessage(null);
    const result = await api<{ next: "app" }>("/api/auth/finish", {
      body: {
        businessName: formText(form, "businessName"),
        ...(askPassword ? { password: formText(form, "password") } : {}),
        acceptTerms: true,
        acceptPrivacy: true,
      },
    });
    setSubmitting(false);
    if (!result.ok) {
      setFields(result.fields);
      setMessage(result.message);
      // Focus lands on the first field to fix, which reads its message out (ADR 0091).
      const first = ["password", "businessName"].find(
        (n) => result.fields[n] !== undefined,
      );
      if (first !== undefined) document.getElementById(first)?.focus();
      return;
    }
    router.replace("/app");
  }

  return (
    <AuthShell
      // Past the first step: the address is already proven (ADR 0091).
      moment="finish"
      title="One last thing"
      description={
        askPassword
          ? "Your email address is confirmed. Choose your password and tell us what to call your business, and you are done."
          : "You are signed in. Tell us what to call your business and you are done."
      }
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
        {askPassword ? (
          <Field
            id="password"
            name="password"
            type="password"
            label="Choose your password"
            autoComplete="new-password"
            required
            hint="At least 12 characters, with upper- and lower-case letters and a digit. You can use the one you chose when you signed up."
            error={fields["password"]}
          />
        ) : null}
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
          <input id="accept" type="checkbox" name="accept" className="mt-0.5" />
          <span>
            I accept the{" "}
            <Link
              href="/legal/terms"
              className="text-accent-700 underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Terms
            </Link>{" "}
            and the{" "}
            <Link
              href="/legal/privacy"
              className="text-accent-700 underline"
              target="_blank"
              rel="noopener noreferrer"
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
