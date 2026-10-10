"use client";

import { GST_STATE_CODES } from "@magicmis/accounts/state-codes";
import { countryOptions } from "@magicmis/core/country";
import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from "react";

import { Alert, Button, Field, Panel, SelectField } from "@/components/ui";
import { api, formText, newIdempotencyKey } from "@/lib/client-api";

interface Profile {
  email: string;
  businessName: string;
  gstin: string | null;
  billingAddress: {
    line1: string;
    line2?: string;
    city: string;
    country: string;
    postalCode: string;
    /** India only. */
    stateCode?: string;
  } | null;
}

/**
 * The account's billing details: the name and address printed on every invoice (ADR 0030).
 *
 * The same details the Wallet asks for at a first purchase, under the same name (ADR 0091). Until
 * an address is saved the country starts where the request came from, as the Wallet's does, and
 * only an Indian address is asked for a GSTIN and a state — a GST state preselected for everyone
 * else, or silently for an Indian buyer who never chose one, decided their tax.
 */
export function ProfileForm({ visitorCountry }: { visitorCountry: string | null }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  /** Drives the currency, the GST fields and the invoice shape (ADR 0030). */
  const [country, setCountry] = useState(() =>
    visitorCountry !== null && countryOptions().some((c) => c.code === visitorCountry)
      ? visitorCountry
      : "US",
  );
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const key = useRef(newIdempotencyKey());
  const isIndia = country === "IN";

  const load = useCallback(() => {
    setFailed(null);
    void api<Profile>("/api/account/profile").then((r) => {
      if (!r.ok) {
        setFailed(r.message);
        return;
      }
      setProfile(r.data);
      // Without this the select snaps back to the default on every visit, and saving again
      // would quietly move an account's billing country.
      const saved = r.data.billingAddress?.country;
      if (saved !== undefined && saved !== "") setCountry(saved);
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (n: string) => formText(form, n);
    setSaving(true);
    setNotice(null);
    const result = await api<{ status: string }>("/api/account/profile", {
      method: "PATCH",
      idempotencyKey: key.current,
      body: {
        businessName: text("businessName"),
        // Only an Indian business has a GSTIN to give; elsewhere none is sent.
        gstin: isIndia ? text("gstin") : "",
        billingAddress: {
          line1: text("line1"),
          ...(text("line2") ? { line2: text("line2") } : {}),
          city: text("city"),
          country,
          postalCode: text("postalCode"),
          ...(isIndia ? { stateCode: text("stateCode") } : {}),
        },
      },
    });
    setSaving(false);
    key.current = newIdempotencyKey();
    if (result.ok) {
      setFields({});
      setNotice({ tone: "success", text: "Billing details saved." });
    } else {
      setFields(result.fields);
      setNotice({ tone: "error", text: result.message });
    }
  }

  if (profile === null)
    return (
      <Panel title="Billing details" icon="document">
        {failed === null ? (
          <p className="text-sm text-neutral-500">Loading…</p>
        ) : (
          <div className="flex flex-col items-start gap-3">
            <Alert tone="error">Your billing details could not be loaded. {failed}</Alert>
            <Button variant="secondary" size="sm" onClick={load}>
              Try again
            </Button>
          </div>
        )}
      </Panel>
    );
  const address = profile.billingAddress;

  return (
    <Panel
      title="Billing details"
      icon="document"
      description={
        isIndia
          ? "The name and address on every invoice. The GSTIN is optional, and we take it exactly as you enter it."
          : "The name and address on every invoice."
      }
    >
      <form
        onSubmit={(e) => {
          void onSubmit(e);
        }}
        className="flex max-w-lg flex-col gap-4"
        noValidate
      >
        {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
        <p className="rounded-lg bg-neutral-50 px-3 py-2 text-[0.8125rem] text-neutral-600">
          Signed in as{" "}
          <span className="font-medium text-neutral-900">{profile.email}</span>
        </p>
        <Field
          id="businessName"
          name="businessName"
          label="Business name"
          defaultValue={profile.businessName}
          error={fields["businessName"]}
        />
        {isIndia ? (
          <Field
            id="gstin"
            name="gstin"
            label="GSTIN (optional)"
            defaultValue={profile.gstin ?? ""}
            error={fields["gstin"]}
          />
        ) : null}
        <Field
          id="line1"
          name="line1"
          label="Address line 1"
          defaultValue={address?.line1 ?? ""}
          error={fields["billingAddress.line1"]}
        />
        <Field
          id="line2"
          name="line2"
          label="Address line 2 (optional)"
          defaultValue={address?.line2 ?? ""}
        />
        <SelectField
          id="country"
          name="country"
          label="Country"
          value={country}
          onChange={(e) => {
            setCountry(e.currentTarget.value);
          }}
          hint="Decides the billing currency and whether tax is added."
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
            id="city"
            name="city"
            label="City"
            defaultValue={address?.city ?? ""}
            error={fields["billingAddress.city"]}
          />
          <Field
            id="postalCode"
            name="postalCode"
            label={isIndia ? "PIN code" : "Postal code (if you have one)"}
            inputMode={isIndia ? "numeric" : "text"}
            defaultValue={address?.postalCode ?? ""}
            error={fields["billingAddress.postalCode"]}
          />
        </div>
        {isIndia ? (
          <SelectField
            id="stateCode"
            name="stateCode"
            label="State"
            defaultValue={address?.stateCode ?? ""}
            hint="Decides whether GST is charged as CGST + SGST or as IGST."
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
          // The statute is on the invoice; a buyer abroad needs the consequence (ADR 0091).
          <p className="text-[0.8125rem] text-neutral-500">
            Billed in US dollars. We add no tax. Your invoice records it as an export of
            services.
          </p>
        )}
        <Button type="submit" className="w-fit" icon="check" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </form>
    </Panel>
  );
}
