"use client";

import { GST_STATE_CODES } from "@magicmis/accounts/state-codes";
import { countryOptions } from "@magicmis/core/country";
import { useEffect, useRef, useState, type SyntheticEvent } from "react";

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

export function ProfileForm() {
  const [profile, setProfile] = useState<Profile | null>(null);
  /** Drives the currency, the GST fields and the invoice shape (ADR 0030). */
  const [country, setCountry] = useState("IN");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const key = useRef(newIdempotencyKey());

  useEffect(() => {
    void api<Profile>("/api/account/profile").then((r) => {
      if (!r.ok) return;
      setProfile(r.data);
      // Without this the select snaps back to India on every visit, and saving again
      // would quietly move a foreign account's billing country home.
      const saved = r.data.billingAddress?.country;
      if (saved !== undefined && saved !== "") setCountry(saved);
    });
  }, []);

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (n: string) => formText(form, n);
    const result = await api<{ status: string }>("/api/account/profile", {
      method: "PATCH",
      idempotencyKey: key.current,
      body: {
        businessName: text("businessName"),
        gstin: text("gstin"),
        billingAddress: {
          line1: text("line1"),
          ...(text("line2") ? { line2: text("line2") } : {}),
          city: text("city"),
          country,
          postalCode: text("postalCode"),
          ...(country === "IN" ? { stateCode: text("stateCode") } : {}),
        },
      },
    });
    key.current = newIdempotencyKey();
    if (result.ok) {
      setFields({});
      setNotice({ tone: "success", text: "Business profile saved." });
    } else {
      setFields(result.fields);
      setNotice({ tone: "error", text: result.message });
    }
  }

  if (profile === null)
    return (
      <Panel>
        <p className="text-sm text-neutral-500">Loading…</p>
      </Panel>
    );
  const address = profile.billingAddress;

  return (
    <Panel
      title="Invoice details"
      icon="document"
      description="These appear on every tax invoice. GSTIN is optional, and we take it exactly as you enter it."
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
        <Field
          id="gstin"
          name="gstin"
          label="GSTIN (optional)"
          defaultValue={profile.gstin ?? ""}
          error={fields["gstin"]}
        />
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
          hint="Decides the billing currency and whether Indian GST applies."
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
            label={country === "IN" ? "PIN code" : "Postal code"}
            defaultValue={address?.postalCode ?? ""}
            error={fields["billingAddress.postalCode"]}
          />
        </div>
        {country === "IN" ? (
          <SelectField
            id="stateCode"
            name="stateCode"
            label="State"
            defaultValue={address?.stateCode ?? ""}
            hint="Decides whether GST is charged as CGST + SGST or as IGST."
          >
            {Object.entries(GST_STATE_CODES).map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </SelectField>
        ) : (
          <p className="text-[0.8125rem] text-neutral-500">
            Billed in US dollars. No Indian GST applies — an export of services,
            zero-rated under section 16 of the IGST Act.
          </p>
        )}
        <Button type="submit" className="w-fit" icon="check">
          Save
        </Button>
      </form>
    </Panel>
  );
}
