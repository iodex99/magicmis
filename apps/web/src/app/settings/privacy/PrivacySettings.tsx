"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type SyntheticEvent } from "react";

import { ReauthForm } from "@/components/ReauthForm";
import { Alert, Button, Field, Panel } from "@/components/ui";
import { formatCredits } from "@/lib/actions";
import { api, formText, newIdempotencyKey } from "@/lib/client-api";
import { istLabelled } from "@/lib/job-display";

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

/** How often a queued export is looked at again while the page is open (ADR 0091). */
const EXPORT_POLL_MS = 15_000;

export function PrivacySettings({
  email,
  fingerprintDays,
  purgeDays,
  balance,
}: {
  email: string;
  /** How long a one-way fingerprint of the email is kept after deletion (ADR 0072). */
  fingerprintDays: number;
  /** `lifecycle.deletion_purge_delay_days`, said as a number rather than "the purge period". */
  purgeDays: number;
  /** The credits deleting the account gives up, as a decimal string (ADR 0091). */
  balance: string;
}) {
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

  const load = useCallback(async () => {
    const r = await api<{ exports: ExportRow[] }>("/api/account/export");
    if (r.ok) setExports(r.data.exports);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // An export being prepared is built within minutes by a scheduled task; the list looks again
  // on its own until none is waiting, rather than saying "Being prepared" until a reload.
  const waiting = exports?.some((e) => e.status === "queued") ?? false;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      void load();
    }, EXPORT_POLL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [waiting, load]);

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
            text: "Your export is being prepared, usually within a few minutes. We will email you when it is ready, and it appears below.",
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

      <Panel title="Export your data" icon="download">
        <p className="mb-4 max-w-2xl text-sm text-neutral-600">
          A JSON file with your profile, your companies with how each is set up and the
          figures of every month, your runs, credit history, invoices and consent records,
          and every file kept for each company with each time it was opened and why. The
          files themselves are downloaded from each company&rsquo;s Files and settings
          page. The download link works only while you are signed in, and for a limited
          time.
        </p>
        {exportAction === null ? (
          <Button
            variant="secondary"
            icon="download"
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
            onCancel={() => {
              setExportAction(null);
            }}
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
            <table className="w-full border-collapse text-sm" data-testid="exports">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-[0.6875rem] font-semibold tracking-[0.06em] text-neutral-500 uppercase">
                  <th className="py-2 pr-4">Requested</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Available until</th>
                  <th className="py-2 pr-4">
                    <span className="sr-only">Download</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {exports.map((e) => (
                  <tr key={e.id} className="border-b border-neutral-100 last:border-0">
                    <td className="py-2 pr-4 text-[0.8125rem] whitespace-nowrap text-neutral-900">
                      {istLabelled(new Date(e.requestedAt))}
                    </td>
                    <td className="py-2 pr-4">{STATUS_LABEL[e.status]}</td>
                    <td className="py-2 pr-4 text-[0.8125rem] whitespace-nowrap text-neutral-900">
                      {e.status === "ready" && e.expiresAt !== null
                        ? istLabelled(new Date(e.expiresAt))
                        : ""}
                    </td>
                    <td className="py-2 pr-4">
                      {e.status === "ready" ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[0.8125rem] font-medium text-accent-700 hover:bg-accent-50"
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

      <Panel title="Delete a company" icon="archive">
        <p className="text-sm text-neutral-600">
          Open the company&rsquo;s Files and settings and use Delete company. Its memory
          fee stops at once, any link to its board stops working, and its files and
          everything built from them are destroyed {purgeDays.toString()}{" "}
          {purgeDays === 1 ? "day" : "days"} later.{" "}
          <Link href="/app" className="font-medium text-accent-700 hover:underline">
            Go to companies
          </Link>
        </p>
      </Panel>

      <Panel title="Delete your account" icon="trash">
        <div className="flex max-w-2xl flex-col gap-3 text-sm text-neutral-600">
          <p>
            Your account closes immediately and you are signed out. Every company, with
            its files and everything built from them, is permanently destroyed{" "}
            {purgeDays.toString()} {purgeDays === 1 ? "day" : "days"} later and cannot be
            recovered.{" "}
            {balance === "0" ? (
              "No credits are left in your wallet to give up."
            ) : (
              <>
                The{" "}
                <span className="num font-medium text-neutral-900">
                  {formatCredits(balance)}
                </span>{" "}
                credits in your wallet are given up; credits are not refundable.
              </>
            )}{" "}
            Invoices and credit records are kept for the statutory retention period with
            personal details removed. A one-way coded fingerprint of your email address —
            not the address — is kept for {fingerprintDays} days, only so welcome credits
            are not given to the same mailbox twice, and then erased.
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
              onCancel={() => {
                setDeleteStep("idle");
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
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" variant="danger">
                  Permanently delete my account
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setDeleteStep("idle");
                    setDeleteError(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </div>
      </Panel>
    </div>
  );
}
