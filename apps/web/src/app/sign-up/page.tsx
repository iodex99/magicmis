"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type SyntheticEvent } from "react";

import { GST_STATE_CODES } from "@magicmis/accounts/state-codes";

import { Alert, AuthShell, Button, Field } from "@/components/ui";
import { api, formText, newIdempotencyKey } from "@/lib/client-api";

export default function SignUpPage() {
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

    const result = await api<{ status: string }>("/api/auth/sign-up", {
      idempotencyKey: idempotencyKey.current,
      body: {
        email: text("email"),
        password: text("password"),
        businessName: text("businessName"),
        gstin: text("gstin"),
        billingAddress: {
          line1: text("line1"),
          ...(text("line2") ? { line2: text("line2") } : {}),
          city: text("city"),
          pincode: text("pincode"),
          stateCode: text("stateCode"),
        },
        acceptTerms: form.get("acceptTerms") === "on",
        acceptPrivacy: form.get("acceptPrivacy") === "on",
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

  return (
    <AuthShell title="Create your account">
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
          autoComplete="email"
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
          autoComplete="organization"
          required
          error={fields["businessName"]}
        />
        <Field
          id="gstin"
          name="gstin"
          label="GSTIN (optional)"
          hint="Used for place of supply on your tax invoices."
          error={fields["gstin"]}
        />

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-medium text-neutral-800">
            Billing address
          </legend>
          <Field
            id="line1"
            name="line1"
            label="Address line 1"
            autoComplete="address-line1"
            required
            error={fields["billingAddress.line1"]}
          />
          <Field
            id="line2"
            name="line2"
            label="Address line 2 (optional)"
            autoComplete="address-line2"
          />
          <div className="grid grid-cols-2 gap-3">
            <Field
              id="city"
              name="city"
              label="City"
              autoComplete="address-level2"
              required
              error={fields["billingAddress.city"]}
            />
            <Field
              id="pincode"
              name="pincode"
              label="PIN code"
              inputMode="numeric"
              autoComplete="postal-code"
              required
              error={fields["billingAddress.pincode"]}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="stateCode" className="text-sm font-medium text-neutral-800">
              State
            </label>
            <select
              id="stateCode"
              name="stateCode"
              required
              defaultValue=""
              className="h-9 rounded-md border border-neutral-300 bg-white px-2 text-sm"
            >
              <option value="" disabled>
                Choose a state
              </option>
              {Object.entries(GST_STATE_CODES).map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
            {fields["billingAddress.stateCode"] ? (
              <p className="text-xs text-negative">
                {fields["billingAddress.stateCode"]}
              </p>
            ) : null}
          </div>
        </fieldset>

        {/* TODO(review): R-10/R-11 — link targets are placeholder legal pages until drafted. */}
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="acceptTerms" className="mt-0.5" />
          <span>
            I accept the{" "}
            <Link href="/legal/terms" className="underline">
              Terms
            </Link>
            .
          </span>
        </label>
        {fields["acceptTerms"] ? (
          <p className="-mt-3 text-xs text-negative">{fields["acceptTerms"]}</p>
        ) : null}
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="acceptPrivacy" className="mt-0.5" />
          <span>
            I have read the{" "}
            <Link href="/legal/privacy" className="underline">
              Privacy notice
            </Link>
            .
          </span>
        </label>
        {fields["acceptPrivacy"] ? (
          <p className="-mt-3 text-xs text-negative">{fields["acceptPrivacy"]}</p>
        ) : null}

        <Button type="submit" disabled={submitting}>
          {submitting ? "Creating account…" : "Create account"}
        </Button>
        <p className="text-sm text-neutral-600">
          Already have an account?{" "}
          <Link href="/sign-in" className="underline">
            Sign in
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
