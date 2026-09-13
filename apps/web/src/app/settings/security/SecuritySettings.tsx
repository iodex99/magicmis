"use client";

import { formatIstDateTime } from "@magicmis/core/time";
import { useEffect, useState, type SyntheticEvent } from "react";

import { ReauthForm } from "@/components/ReauthForm";
import { Alert, Button, Field, Panel } from "@/components/ui";
import { api, formText, newIdempotencyKey } from "@/lib/client-api";

import { BackupCodesNotice } from "../../sign-in/BackupCodesNotice";

interface LoginEvent {
  type: string;
  ip: string | null;
  location: string | null;
  device: string | null;
  newDevice: boolean;
  at: string;
}

const EVENT_LABEL: Record<string, string> = {
  login: "Signed in",
  logout: "Signed out",
  failed: "Failed sign-in",
  session_revoked: "Earlier session ended by a new sign-in",
  reauth: "Identity confirmed",
  reauth_failed: "Identity confirmation failed",
  locked_out: "Locked after repeated failures",
  mfa_failed: "Incorrect backup code",
  mfa_reset_with_backup_code: "Authenticator reset with a backup code",
  backup_codes_regenerated: "Backup codes regenerated",
  password_changed: "Password changed",
  email_changed: "Email changed",
  mfa_enrolled: "Authenticator set up",
};

type Pending = "regenerate" | "password" | null;

export function SecuritySettings() {
  const [events, setEvents] = useState<LoginEvent[] | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [granted, setGranted] = useState<Pending>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [notice, setNotice] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);

  async function load() {
    const [history, backup] = await Promise.all([
      api<{ events: LoginEvent[] }>("/api/account/login-history"),
      api<{ remaining: number }>("/api/account/backup-codes"),
    ]);
    if (history.ok) setEvents(history.data.events);
    if (backup.ok) setRemaining(backup.data.remaining);
  }

  useEffect(() => {
    void load();
  }, []);

  async function regenerate() {
    const result = await api<{ backupCodes: string[] }>("/api/account/backup-codes", {
      body: {},
      idempotencyKey: newIdempotencyKey(),
    });
    setPending(null);
    setGranted(null);
    if (result.ok) setCodes(result.data.backupCodes);
    else setNotice({ tone: "error", text: result.message });
  }

  async function changePassword(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await api<{ status: string }>("/api/account/password", {
      body: { newPassword: formText(form, "newPassword") },
      idempotencyKey: newIdempotencyKey(),
    });
    if (result.ok) {
      setPending(null);
      setGranted(null);
      setNotice({ tone: "success", text: "Your password has been changed." });
      void load();
    } else {
      setNotice({ tone: "error", text: result.fields["newPassword"] ?? result.message });
    }
  }

  if (codes !== null) {
    return (
      <Panel title="New backup codes">
        <BackupCodesNotice
          codes={codes}
          onDone={() => {
            setCodes(null);
            void load();
          }}
        />
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}

      <Panel title="Backup codes">
        <p className="mb-3 text-sm text-neutral-700">
          <span className="num">{remaining ?? "—"}</span> unused backup codes remain.
        </p>
        {pending === "regenerate" && granted !== "regenerate" ? (
          <ReauthForm
            actionLabel="regenerate your backup codes"
            onGranted={() => {
              setGranted("regenerate");
              void regenerate();
            }}
          />
        ) : (
          <Button
            variant="secondary"
            onClick={() => {
              setPending("regenerate");
            }}
          >
            Regenerate backup codes
          </Button>
        )}
      </Panel>

      <Panel title="Password">
        {pending !== "password" ? (
          <Button
            variant="secondary"
            onClick={() => {
              setPending("password");
            }}
          >
            Change password
          </Button>
        ) : granted !== "password" ? (
          <ReauthForm
            actionLabel="change your password"
            onGranted={() => {
              setGranted("password");
            }}
          />
        ) : (
          <form
            onSubmit={(e) => {
              void changePassword(e);
            }}
            className="flex max-w-sm flex-col gap-3"
            noValidate
          >
            <Field
              id="newPassword"
              name="newPassword"
              type="password"
              label="New password"
              autoComplete="new-password"
              hint="At least 12 characters, with upper- and lower-case letters and a digit."
              required
            />
            <Button type="submit">Save new password</Button>
          </form>
        )}
      </Panel>

      <Panel title="Sign-in history">
        {events === null ? (
          <p className="text-sm text-neutral-600">Loading…</p>
        ) : events.length === 0 ? (
          <p className="text-sm text-neutral-600">No sign-in activity yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white text-left text-neutral-600">
                <tr>
                  <th className="py-2 pr-4 font-medium">When (IST)</th>
                  <th className="py-2 pr-4 font-medium">Event</th>
                  <th className="py-2 pr-4 font-medium">Device</th>
                  <th className="py-2 pr-4 font-medium">IP address</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e, i) => (
                  <tr
                    key={`${e.at}-${String(i)}`}
                    className="border-t border-neutral-100"
                  >
                    <td className="num py-1.5 pr-4 text-left">
                      {formatIstDateTime(new Date(e.at))}
                    </td>
                    <td className="py-1.5 pr-4">
                      {EVENT_LABEL[e.type] ?? e.type}
                      {e.newDevice ? (
                        <span className="ml-2 rounded-sm bg-warning-subtle px-1.5 text-xs text-warning">
                          New device
                        </span>
                      ) : null}
                    </td>
                    <td className="py-1.5 pr-4">{e.device ?? "—"}</td>
                    <td className="num py-1.5 pr-4 text-left">{e.ip ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
