"use client";

import { GST_STATE_CODES } from "@magicmis/accounts/state-codes";
import { countryOptions } from "@magicmis/core/country";
import { useEffect, useState, type SyntheticEvent } from "react";

import { Alert, Button, Field, Panel, SelectField } from "@/components/ui";
import { api, formText, newIdempotencyKey } from "@/lib/client-api";

/**
 * Billing details, asked for once and only when they are needed.
 *
 * GST place of supply (SPEC §13) decides whether a purchase carries CGST + SGST or IGST,
 * so it must be known before a pack can be quoted — and at no earlier moment. Sign-up used
 * to demand all of this before the account had seen a single screen.
 */
export function BillingDetailsForm({ onSaved }: { onSaved: () => void }) {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /**
   * Defaults to India because that is where most customers are, not because the rest are
   * an afterthought: changing it switches the currency, drops the GST fields and changes
   * the invoice, all of which the reader should see happen.
   */
  const [country, setCountry] = useState("IN");
  const isIndia = country === "IN";
  // Never ask twice for something already given: the business name came in at sign-up.
  const [known, setKnown] = useState<{ businessName: string; gstin: string } | null>(
    null,
  );

  useEffect(() => {
    void api<{ businessName: string; gstin: string | null }>("/api/account/profile").then(
      (r) => {
        setKnown(
          r.ok
            ? { businessName: r.data.businessName, gstin: r.data.gstin ?? "" }
            : { businessName: "", gstin: "" },
        );
      },
    );
  }, []);

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (n: string) => formText(form, n);
    setSaving(true);
    setMessage(null);
    const result = await api<{ status: string }>("/api/account/profile", {
      method: "PATCH",
      idempotencyKey: newIdempotencyKey(),
      body: {
        businessName: text("businessName"),
        gstin: text("gstin"),
        billingAddress: {
          line1: text("line1"),
          ...(text("line2") ? { line2: text("line2") } : {}),
          city: text("city"),
          country,
          postalCode: text("postalCode"),
          // Only sent for India; elsewhere there is no GST state to send.
          ...(country === "IN" ? { stateCode: text("stateCode") } : {}),
        },
      },
    });
    setSaving(false);
    if (result.ok) {
      onSaved();
      return;
    }
    setFields(result.fields);
    setMessage(result.message);
  }

  if (known === null)
    return (
      <Panel title="Where should we invoice this?" icon="document">
        <p className="text-sm text-neutral-500">Loading…</p>
      </Panel>
    );

  return (
    <Panel
      title="Where should we invoice this?"
      icon="document"
      description="Needed once, to work out GST and print your tax invoice. You can change it later in Settings."
    >
      <form
        onSubmit={(e) => {
          void onSubmit(e);
        }}
        className="flex max-w-lg flex-col gap-4"
        noValidate
      >
        {message ? <Alert tone="error">{message}</Alert> : null}
        <Field
          id="billing-businessName"
          name="businessName"
          label="Business name"
          defaultValue={known.businessName}
          required
          error={fields["businessName"]}
        />
        <Field
          id="billing-gstin"
          name="gstin"
          label="GSTIN (optional)"
          defaultValue={known.gstin}
          hint="If you give one, its state decides the place of supply."
          error={fields["gstin"]}
        />
        <Field
          id="billing-line1"
          name="line1"
          label="Address line 1"
          autoComplete="address-line1"
          required
          error={fields["billingAddress.line1"]}
        />
        <Field
          id="billing-line2"
          name="line2"
          label="Address line 2 (optional)"
          autoComplete="address-line2"
        />
        {/*
          The country decides the billing currency and whether GST applies (ADR 0030),
          so it comes before the fields that depend on it rather than after them.
        */}
        <SelectField
          id="billing-country"
          name="country"
          label="Country"
          required
          value={country}
          onChange={(e) => {
            setCountry(e.currentTarget.value);
          }}
          error={fields["billingAddress.country"]}
        >
          {countryOptions().map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </SelectField>
        <div className="grid grid-cols-2 gap-3">
          <Field
            id="billing-city"
            name="city"
            label="City"
            autoComplete="address-level2"
            required
            error={fields["billingAddress.city"]}
          />
          <Field
            id="billing-postalCode"
            name="postalCode"
            label={isIndia ? "PIN code" : "Postal code"}
            inputMode={isIndia ? "numeric" : "text"}
            autoComplete="postal-code"
            required
            error={fields["billingAddress.postalCode"]}
          />
        </div>
        {/* A GST state exists only for an Indian supply; an export has no place of supply. */}
        {isIndia ? (
          <SelectField
            id="billing-stateCode"
            name="stateCode"
            label="State"
            required
            defaultValue=""
            error={fields["billingAddress.stateCode"]}
          >
            <option value="" disabled>
              Choose a state
            </option>
            {Object.entries(GST_STATE_CODES).map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </SelectField>
        ) : (
          <p className="text-[0.8125rem] text-neutral-500">
            Billed in US dollars. No Indian GST applies — this is an export of services,
            zero-rated under section 16 of the IGST Act, and your invoice will say so.
          </p>
        )}
        <Button type="submit" disabled={saving} size="lg" className="w-fit">
          {saving ? "Saving…" : "Save and show prices"}
        </Button>
      </form>
    </Panel>
  );
}
