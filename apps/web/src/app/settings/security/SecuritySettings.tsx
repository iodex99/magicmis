"use client";

import { formatIstDateTime } from "@magicmis/core/time";
import { useEffect, useState, type SyntheticEvent } from "react";

import { ReauthForm } from "@/components/ReauthForm";
import {
  Alert,
  Badge,
  Button,
  DataTable,
  EmptyState,
  Field,
  Panel,
  Td,
  Th,
  Tr,
} from "@/components/ui";
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

      <Panel
        title="Backup codes"
        icon="key"
        description="Single-use codes that sign you in if you lose your authenticator. Regenerating invalidates the old set."
      >
        <p className="mb-4 flex items-center gap-2 text-sm text-neutral-700">
          <Badge tone={remaining !== null && remaining <= 3 ? "warning" : "neutral"}>
            {remaining ?? "—"} remaining
          </Badge>
          unused backup codes.
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

      <Panel title="Password" icon="lock">
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

      <Panel
        title="Sign-in history"
        icon="clock"
        description="Every sign-in, sign-out and identity confirmation on this account."
        padding="none"
      >
        {events === null ? (
          <p className="px-5 py-6 text-sm text-neutral-500">Loading…</p>
        ) : events.length === 0 ? (
          <EmptyState icon="clock" title="No sign-in activity yet">
            Sign-ins appear here as soon as they happen, with the device and IP address
            they came from.
          </EmptyState>
        ) : (
          <DataTable
            className="px-2 pb-2"
            maxHeight="26rem"
            head={
              <>
                <Th>When (IST)</Th>
                <Th>Event</Th>
                <Th>Device</Th>
                <Th>IP address</Th>
              </>
            }
          >
            {events.map((e, i) => (
              <Tr key={`${e.at}-${String(i)}`}>
                <Td className="font-mono text-[0.8125rem] whitespace-nowrap text-neutral-900">
                  {formatIstDateTime(new Date(e.at))}
                </Td>
                <Td>
                  {EVENT_LABEL[e.type] ?? e.type}
                  {e.newDevice ? (
                    <Badge tone="warning" className="ml-2">
                      New device
                    </Badge>
                  ) : null}
                </Td>
                <Td>{e.device ?? "—"}</Td>
                <Td className="font-mono text-[0.8125rem]">{e.ip ?? "—"}</Td>
              </Tr>
            ))}
          </DataTable>
        )}
      </Panel>
    </div>
  );
}
