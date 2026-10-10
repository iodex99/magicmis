"use client";

import { useEffect, useState, type SyntheticEvent } from "react";

import { Alert, Button, Field } from "@/components/ui";
import { api } from "@/lib/client-api";

/**
 * Where the confirmation went, and a way to send it again (ADR 0091). The address comes from
 * this tab's own storage, where the sign-up form left it; a page opened any other way asks for
 * it. Either way the new link comes from `/api/auth/resend` and never from signing up again: a
 * second sign-up leaves the account's browser secret as it was and gives this browser a new
 * one, so the link would treat the browser that signed up as a stranger and destroy the
 * password chosen a minute ago (ADR 0071).
 */
export function ResendEmail() {
  const [stored, setStored] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);

  useEffect(() => {
    try {
      setStored(sessionStorage.getItem("signup-email"));
    } catch {
      setStored(null);
    }
  }, []);

  const resend = async (email: string) => {
    setState("sending");
    setMessage(null);
    setFieldError(undefined);
    const r = await api("/api/auth/resend", { body: { email } });
    if (r.ok) {
      setState("sent");
      return;
    }
    setState("error");
    if (r.fields["email"] !== undefined) {
      setFieldError(r.fields["email"]);
      document.getElementById("resend-email-address")?.focus();
    } else setMessage(r.message);
  };

  const outcome =
    state === "sent" ? (
      <Alert tone="success">Sent again. It can take a minute to arrive.</Alert>
    ) : state === "error" && message !== null ? (
      <Alert tone="error">{message}</Alert>
    ) : null;

  return (
    <div className="flex flex-col gap-3" data-testid="check-email">
      {stored === null ? null : (
        <p>
          It went to{" "}
          <strong className="font-semibold break-all text-neutral-900">{stored}</strong>.
        </p>
      )}
      <p>
        Open it{" "}
        <strong className="font-semibold text-neutral-900">
          in this browser, on this computer
        </strong>
        : that signs you straight in. Opened anywhere else, it still confirms the address,
        and you set your password again there.
      </p>
      {stored === null ? (
        <form
          className="flex flex-col gap-3"
          noValidate
          onSubmit={(event: SyntheticEvent<HTMLFormElement>) => {
            event.preventDefault();
            void resend(typed.trim());
          }}
        >
          <p>
            No email after a few minutes? Check your spam folder, or enter the address you
            signed up with and we will send it again.
          </p>
          {outcome}
          <Field
            id="resend-email-address"
            name="email"
            type="email"
            label="Email"
            autoComplete="email"
            required
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value);
            }}
            error={fieldError}
          />
          <div>
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              icon="mail"
              disabled={state === "sending" || state === "sent" || typed.trim() === ""}
              data-testid="resend-email"
            >
              {state === "sending" ? "Sending…" : "Send the email again"}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-2">
          <p>No email after a few minutes? Check your spam folder, or send it again.</p>
          {outcome}
          <div>
            <Button
              variant="secondary"
              size="sm"
              icon="mail"
              onClick={() => void resend(stored)}
              disabled={state === "sending" || state === "sent"}
              data-testid="resend-email"
            >
              {state === "sending" ? "Sending…" : "Send the email again"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
