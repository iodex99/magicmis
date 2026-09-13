"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type SyntheticEvent } from "react";

import { Alert, AuthShell, Button, Field } from "@/components/ui";
import { api, formText, newIdempotencyKey } from "@/lib/client-api";

import { BackupCodesNotice } from "../BackupCodesNotice";

interface Enrolment {
  factorId: string;
  qrCode: string;
  secret: string;
}

export default function EnrolPage() {
  const router = useRouter();
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    // Strict Mode mounts effects twice in development; enrol only once.
    if (started.current) return;
    started.current = true;
    void api<Enrolment>("/api/auth/mfa/enrol", { method: "POST", body: {} }).then(
      (result) => {
        if (result.ok) setEnrolment(result.data);
        else if (result.error === "already_enrolled") router.replace("/sign-in/mfa");
        else if (result.error === "not_signed_in") router.replace("/sign-in");
        else setMessage(result.message);
      },
    );
  }, [router]);

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (enrolment === null) return;
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setMessage(null);
    const result = await api<{ status: string; backupCodes: string[] | null }>(
      "/api/auth/mfa/verify",
      {
        idempotencyKey: newIdempotencyKey(),
        body: { factorId: enrolment.factorId, code: formText(form, "code").trim() },
      },
    );
    setSubmitting(false);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    if (result.data.backupCodes) setCodes(result.data.backupCodes);
    else router.replace("/app");
  }

  if (codes !== null) {
    return (
      <AuthShell title="Save your backup codes">
        <BackupCodesNotice
          codes={codes}
          onDone={() => {
            router.replace("/app");
          }}
        />
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Set up two-factor authentication">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-neutral-700">
          Two-factor authentication is required. Scan this code with an authenticator app
          such as Google Authenticator or Microsoft Authenticator, then enter the 6-digit
          code it shows.
        </p>
        {message ? <Alert tone="error">{message}</Alert> : null}
        {enrolment ? (
          <>
            <img
              src={enrolment.qrCode}
              alt="QR code for your authenticator app"
              width={180}
              height={180}
              className="self-center"
            />
            <p className="text-xs text-neutral-600">
              Can't scan? Enter this key manually:{" "}
              <code className="font-mono" data-testid="totp-secret">
                {enrolment.secret}
              </code>
            </p>
            <form
              onSubmit={(e) => {
                void onSubmit(e);
              }}
              className="flex flex-col gap-4"
              noValidate
            >
              <Field
                id="code"
                name="code"
                label="6-digit code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
              />
              <Button type="submit" disabled={submitting}>
                {submitting ? "Verifying…" : "Verify and continue"}
              </Button>
            </form>
          </>
        ) : message === null ? (
          <p className="text-sm text-neutral-600">Preparing your QR code…</p>
        ) : null}
      </div>
    </AuthShell>
  );
}
