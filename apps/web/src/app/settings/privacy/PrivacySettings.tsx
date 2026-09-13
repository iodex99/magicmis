"use client";

import { formatIstDateTime } from "@magicmis/core/time";
import Link from "next/link";
import { useEffect, useState, type SyntheticEvent } from "react";

import { ReauthForm } from "@/components/ReauthForm";
import { Alert, Button, Field, Panel } from "@/components/ui";
import { api, formText, newIdempotencyKey } from "@/lib/client-api";

interface ExportRow {
  id: string;
  status: "queued" | "ready" | "failed" | "expired";
  requestedAt: string;
  expiresAt: string | null;
}

const STATUS_LABEL: Record<ExportRow["status"], string> = {
  queued: "Being prepared",
  ready: "Ready",
  failed: "Failed — request again",
  expired: "Link expired",
};

export function PrivacySettings({ email }: { email: string }) {
  const [exports, setExports] = useState<ExportRow[] | null>(null);
  const [notice, setNotice] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const [requesting, setRequesting] = useState(false);
  // SPEC §8: requesting and downloading an export both need a fresh re-authentication.
  const [exportAction, setExportAction] = useState<
    { kind: "request" } | { kind: "download"; id: string } | null
  >(null);
  const [deleteStep, setDeleteStep] = useState<"idle" | "reauth" | "confirm">("idle");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function load() {
    const r = await api<{ exports: ExportRow[] }>("/api/account/export");
    if (r.ok) setExports(r.data.exports);
  }

  useEffect(() => {
    void load();
  }, []);

  async function requestExport() {
    setRequesting(true);
    const r = await api<{ id: string }>("/api/account/export", {
      body: {},
      idempotencyKey: newIdempotencyKey(),
    });
    setRequesting(false);
    setNotice(
      r.ok
        ? {
            tone: "success",
            text: "Your export is being prepared. We will email you when it is ready to download.",
          }
        : { tone: "error", text: r.message },
    );
    void load();
  }

  async function deleteAccount(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setDeleteError(null);
    const r = await api<{ status: string }>("/api/account/delete", {
      body: { confirmEmail: formText(form, "confirmEmail") },
      idempotencyKey: newIdempotencyKey(),
    });
    if (r.ok) window.location.assign("/signed-out?reason=deleted");
    else setDeleteError(r.fields["confirmEmail"] ?? r.message);
  }

  return (
    <div className="flex flex-col gap-6">
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}

      <Panel title="Export your data">
        <p className="mb-3 max-w-2xl text-sm text-neutral-700">
          A JSON file with your profile, companies, their stored memory and monthly
          snapshots, jobs, credit ledger, invoices and consent records. Your source files
          are never stored on our servers, so they are not included. The download link
          works only while you are signed in, and for a limited time.
        </p>
        {exportAction === null ? (
          <Button
            variant="secondary"
            onClick={() => {
              setExportAction({ kind: "request" });
            }}
            disabled={requesting}
          >
            Request export
          </Button>
        ) : (
          <ReauthForm
            actionLabel={
              exportAction.kind === "request" ? "export your data" : "download your data"
            }
            onGranted={() => {
              const action = exportAction;
              setExportAction(null);
              if (action.kind === "request") void requestExport();
              else window.location.assign(`/api/account/export/${action.id}`);
            }}
          />
        )}
        {exports === null || exports.length === 0 ? null : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm" data-testid="exports">
              <thead className="text-left text-neutral-600">
                <tr>
                  <th className="py-2 pr-4 font-medium">Requested (IST)</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Available until (IST)</th>
                  <th className="py-2 pr-4 font-medium" />
                </tr>
              </thead>
              <tbody>
                {exports.map((e) => (
                  <tr key={e.id} className="border-t border-neutral-100">
                    <td className="num py-1.5 pr-4 text-left">
                      {formatIstDateTime(new Date(e.requestedAt))}
                    </td>
                    <td className="py-1.5 pr-4">{STATUS_LABEL[e.status]}</td>
                    <td className="num py-1.5 pr-4 text-left">
                      {e.status === "ready" && e.expiresAt !== null
                        ? formatIstDateTime(new Date(e.expiresAt))
                        : ""}
                    </td>
                    <td className="py-1.5 pr-4">
                      {e.status === "ready" ? (
                        <button
                          type="button"
                          className="underline"
                          onClick={() => {
                            setExportAction({ kind: "download", id: e.id });
                          }}
                        >
                          Download
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Delete a company">
        <p className="text-sm text-neutral-700">
          Open the company and use Delete company. Its memory fee stops at once and its
          data is permanently destroyed after the purge period.{" "}
          <Link href="/app" className="underline">
            Go to companies
          </Link>
        </p>
      </Panel>

      <Panel title="Delete your account">
        <div className="flex max-w-2xl flex-col gap-3 text-sm text-neutral-700">
          <p>
            Your account closes immediately and you are signed out. All companies and
            their stored data are permanently destroyed after the purge period, and cannot
            be recovered. Unused credits are forfeited. Invoices and credit records are
            kept for the statutory retention period with personal details removed.
          </p>
          <p>Export your data first if you want a copy.</p>
          {deleteStep === "idle" ? (
            <div>
              <Button
                variant="danger"
                onClick={() => {
                  setDeleteStep("reauth");
                }}
              >
                Delete account
              </Button>
            </div>
          ) : deleteStep === "reauth" ? (
            <ReauthForm
              actionLabel="delete your account"
              onGranted={() => {
                setDeleteStep("confirm");
              }}
            />
          ) : (
            <form
              onSubmit={(e) => {
                void deleteAccount(e);
              }}
              className="flex max-w-sm flex-col gap-3"
              noValidate
            >
              <Field
                id="confirmEmail"
                name="confirmEmail"
                type="email"
                label={`Type ${email} to confirm`}
                autoComplete="off"
                error={deleteError ?? undefined}
                required
              />
              <Button type="submit" variant="danger">
                Permanently delete my account
              </Button>
            </form>
          )}
        </div>
      </Panel>
    </div>
  );
}
