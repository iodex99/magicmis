"use client";

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
import { istLabelled } from "@/lib/job-display";

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
  password_changed: "Password changed",
  email_changed: "Email changed",
};

type Pending = "password" | null;

export function SecuritySettings() {
  const [events, setEvents] = useState<LoginEvent[] | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [granted, setGranted] = useState<Pending>(null);
  const [notice, setNotice] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  // A new password the rules refuse is said on its field, not in a banner above the page.
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const cancel = () => {
    setPending(null);
    setGranted(null);
    setPasswordError(null);
  };

  async function load() {
    const history = await api<{ events: LoginEvent[] }>("/api/account/login-history");
    if (history.ok) setEvents(history.data.events);
  }

  useEffect(() => {
    void load();
  }, []);

  async function changePassword(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await api<{ status: string }>("/api/account/password", {
      body: { newPassword: formText(form, "newPassword") },
      idempotencyKey: newIdempotencyKey(),
    });
    if (result.ok) {
      cancel();
      setNotice({ tone: "success", text: "Your password has been changed." });
      void load();
    } else if (result.fields["newPassword"] !== undefined) {
      setPasswordError(result.fields["newPassword"]);
    } else {
      setNotice({ tone: "error", text: result.message });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}

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
            onCancel={cancel}
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
              error={passwordError ?? undefined}
              autoFocus
              required
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit">Save new password</Button>
              <Button type="button" variant="ghost" onClick={cancel}>
                Cancel
              </Button>
            </div>
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
                <Th>When</Th>
                <Th>Event</Th>
                <Th>Device</Th>
                <Th>Where</Th>
                <Th>IP address</Th>
              </>
            }
          >
            {events.map((e, i) => (
              <Tr key={`${e.at}-${String(i)}`}>
                <Td className="text-[0.8125rem] whitespace-nowrap text-neutral-900">
                  {istLabelled(new Date(e.at))}
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
                {/* Where the address places it, roughly: what an owner checks a sign-in by. */}
                <Td>{e.location ?? "—"}</Td>
                <Td className="font-mono text-[0.8125rem]">{e.ip ?? "—"}</Td>
              </Tr>
            ))}
          </DataTable>
        )}
      </Panel>
    </div>
  );
}
