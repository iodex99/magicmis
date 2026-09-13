"use client";

import { useState, type SyntheticEvent } from "react";

import { ReauthForm } from "@/components/ReauthForm";
import { Button, Field } from "@/components/ui";
import { api, formText, newIdempotencyKey } from "@/lib/client-api";

/** SPEC §28: deleting stops the memory fee now; data is crypto-shredded after the purge delay. */
export function DeleteCompany({ companyId, name }: { companyId: string; name: string }) {
  const [step, setStep] = useState<"idle" | "reauth" | "confirm">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(null);
    const r = await api<{ deleted: boolean }>(`/api/companies/${companyId}`, {
      method: "DELETE",
      body: { confirmName: formText(form, "confirmName") },
      idempotencyKey: newIdempotencyKey(),
    });
    if (r.ok) window.location.assign("/app");
    else setError(r.fields["confirmName"] ?? r.message);
  }

  return (
    <div className="flex max-w-2xl flex-col gap-3 text-sm text-neutral-700">
      <p>
        The monthly memory fee stops immediately. The company&apos;s stored memory,
        snapshots and workbooks are permanently destroyed after the purge period. This
        cannot be undone.
      </p>
      {step === "reauth" ? (
        <ReauthForm
          actionLabel="delete this company"
          onGranted={() => {
            setStep("confirm");
          }}
        />
      ) : step === "confirm" ? (
        <form
          onSubmit={(e) => {
            void submit(e);
          }}
          className="flex max-w-sm flex-col gap-3"
          noValidate
        >
          <Field
            id="confirmName"
            name="confirmName"
            label={`Type ${name} to confirm`}
            autoComplete="off"
            error={error ?? undefined}
            required
          />
          <Button type="submit" variant="danger">
            Delete this company
          </Button>
        </form>
      ) : (
        <div>
          <Button
            variant="secondary"
            onClick={() => {
              setStep("reauth");
            }}
          >
            Delete company
          </Button>
        </div>
      )}
    </div>
  );
}
