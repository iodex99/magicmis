"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Alert, Button, Field } from "@/components/ui";
import { api, formText, newIdempotencyKey } from "@/lib/client-api";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function NewCompanyForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="flex max-w-md flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        setBusy(true);
        void api<{ companyId: string }>("/api/companies", {
          body: {
            name: formText(form, "name"),
            fyStartMonth: Number.parseInt(formText(form, "fyStartMonth"), 10),
          },
          idempotencyKey: newIdempotencyKey(),
        }).then((r) => {
          setBusy(false);
          if (!r.ok) {
            setError(r.message);
            setFields(r.fields);
            return;
          }
          router.push(`/app/companies/${r.data.companyId}/run`);
        });
      }}
    >
      {error === null ? null : <Alert tone="error">{error}</Alert>}
      <Field
        id="company-name"
        name="name"
        label="Company name"
        required
        minLength={2}
        maxLength={120}
        error={fields["name"]}
      />
      <label className="flex flex-col gap-1 text-sm font-medium text-neutral-800">
        Financial year starts in
        <select
          name="fyStartMonth"
          defaultValue="4"
          className="h-9 rounded-md border border-neutral-300 bg-white px-2 text-sm"
        >
          {MONTHS.map((m, i) => (
            <option key={m} value={(i + 1).toString()}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" disabled={busy}>
        {busy ? "Adding…" : "Add company"}
      </Button>
    </form>
  );
}
