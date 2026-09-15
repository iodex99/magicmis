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
      <AuthShell
        title="Save your backup codes"
        description="Ten single-use codes. This is the only time they are shown."
      >
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
    <AuthShell
      title="Set up two-factor authentication"
      description="Required on every account. Scan the code with an authenticator app such as Google Authenticator or Microsoft Authenticator, then enter the 6-digit code it shows."
    >
      <div className="flex flex-col gap-4">
        {message ? <Alert tone="error">{message}</Alert> : null}
        {enrolment ? (
          <>
            <div className="flex flex-col items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-25 p-5">
              <img
                src={enrolment.qrCode}
                alt="QR code for your authenticator app"
                width={180}
                height={180}
                className="rounded-lg bg-white p-2"
              />
              <p className="text-center text-[0.75rem] text-neutral-500">
                Can't scan? Enter this key manually
              </p>
              <code
                className="block w-full rounded-md bg-white px-3 py-2 text-center font-mono text-[0.8125rem] break-all text-neutral-900 ring-1 ring-neutral-200"
                data-testid="totp-secret"
              >
                {enrolment.secret}
              </code>
            </div>
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
              <Button type="submit" disabled={submitting} size="lg" className="w-full">
                {submitting ? "Verifying…" : "Verify and continue"}
              </Button>
            </form>
          </>
        ) : message === null ? (
          <p className="text-sm text-neutral-500">Preparing your QR code…</p>
        ) : null}
      </div>
    </AuthShell>
  );
}
