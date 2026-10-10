"use client";

import { useState, type SyntheticEvent } from "react";

import { ReauthForm } from "@/components/ReauthForm";
import { Button, Field } from "@/components/ui";
import { api, formText, newIdempotencyKey } from "@/lib/client-api";

/**
 * SPEC §28: deleting stops the memory fee now; data is crypto-shredded after the purge delay.
 * The delay is read from configuration and said as a number (ADR 0091), and so is everything that
 * goes: the files, the figures and workbooks built from them, and any link to the board.
 */
export function DeleteCompany({
  companyId,
  name,
  purgeDays,
}: {
  companyId: string;
  name: string;
  /** `lifecycle.deletion_purge_delay_days`: how long until the company's key is destroyed. */
  purgeDays: number;
}) {
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

  const cancel = () => {
    setStep("idle");
    setError(null);
  };

  return (
    <div className="flex max-w-2xl flex-col gap-3 text-sm text-neutral-700">
      <p>
        The company leaves your list and its monthly memory fee stops at once, and any
        link to its board stops working. After {purgeDays.toString()}{" "}
        {purgeDays === 1 ? "day" : "days"} its key is destroyed, and with it every file
        you added, the figures, dashboard, commentary and chat built from them, and its
        workbooks. This cannot be undone, so download anything you want to keep first.
      </p>
      {step === "reauth" ? (
        <ReauthForm
          actionLabel="delete this company"
          onGranted={() => {
            setStep("confirm");
          }}
          onCancel={cancel}
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
            autoFocus
            error={error ?? undefined}
            required
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="danger">
              Delete this company
            </Button>
            <Button type="button" variant="ghost" onClick={cancel}>
              Cancel
            </Button>
          </div>
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
