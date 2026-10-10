"use client";

import { periodLabel } from "@magicmis/render-dashboard";
import { useRouter } from "next/navigation";
import { Fragment, useState } from "react";

import { ReauthForm } from "@/components/ReauthForm";
import { Alert, Button, DataTable, EmptyState, Td, Th, Tr } from "@/components/ui";
import { api } from "@/lib/client-api";
import { fileSize } from "@/lib/job-display";
import { removeUpload } from "@/lib/uploads";

export interface CompanyFileRow {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly uploadedAt: string;
  /** When it was added, written on the server in IST (ADR 0091). */
  readonly uploadedLabel: string;
  /** False for a file that arrived but could not be read. */
  readonly usable: boolean;
  /** Months this file fed, oldest first. Empty until a run has read it. */
  readonly periods: readonly string[];
  readonly onDashboard: boolean;
  /** How many times the file has been decrypted, and the last time and reason (ADR 0047). */
  readonly reads: number;
  readonly lastRead: {
    readonly purpose: string;
    readonly at: string;
    readonly atLabel: string;
  } | null;
}

/** Why a file was opened, in the owner's words. There is no entry for a person: none can. */
const PURPOSE: Record<string, string> = {
  intake: "counting its sheets on arrival",
  pricing: "sizing a run",
  run: "a run you started",
  chat: "a question you asked",
  download: "your download",
};

/** "Apr 2025 – Mar 2026" for a run of months, a list for a few, a count for many. */
export function monthsLabel(periods: readonly string[]): string {
  if (periods.length === 0) return "Not used in a run yet";
  const sorted = [...periods].sort();
  const first = sorted[0] ?? "";
  const last = sorted.at(-1) ?? "";
  if (sorted.length === 1) return periodLabel(first);
  return `${periodLabel(first)} – ${periodLabel(last)} · ${sorted.length.toString()} months`;
}

/** What deleting this file does to the board, said before it is done (ADR 0091). */
function deleteConsequence(f: CompanyFileRow): string {
  if (f.periods.length === 0)
    return "The file is destroyed and cannot be downloaded again. No figures were built from it.";
  return f.onDashboard
    ? "The file is destroyed and cannot be downloaded again. Figures already built from it stay on the board, and you will no longer be able to hide its months."
    : "The file is destroyed and cannot be downloaded again. Its months stay hidden, and the dashboard's list of files still lets you show them again.";
}

/**
 * The company's stored files (ADR 0047): kept until their owner deletes them, each with the
 * months it fed, a tick for whether those months are on the dashboard, the record of every time
 * it was opened, and the owner's own way to take it back or delete it.
 *
 * What is drawn is the server's list with this visit's changes laid over it, so a refresh after
 * a delete shows what the server holds rather than what this tab believed (ADR 0091).
 */
export function CompanyFiles({ files }: { files: readonly CompanyFileRow[] }) {
  const router = useRouter();
  // Deleted, and ticked or unticked, in this visit; everything else is the server's own word.
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // The file whose deletion is being confirmed, and the one whose download waits on the password.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [wanted, setWanted] = useState<string | null>(null);

  const list = files
    .filter((f) => !removed.has(f.id))
    .map((f) => ({ ...f, onDashboard: ticks[f.id] ?? f.onDashboard }));

  const download = async (id: string) => {
    setError(null);
    setConfirming(null);
    const r = await api(`/api/uploads/${id}?check=1`);
    if (r.ok) {
      setWanted(null);
      window.location.assign(`/api/uploads/${id}`);
    } else if (r.status === 403) setWanted(id);
    else setError(r.message);
  };

  const remove = async (id: string) => {
    setError(null);
    setBusy(id);
    try {
      await removeUpload(id);
      setRemoved((s) => new Set([...s, id]));
      setConfirming(null);
      router.refresh();
    } catch (e) {
      setError(
        e instanceof Error && e.message !== ""
          ? e.message
          : "That file could not be deleted. Try again.",
      );
    } finally {
      setBusy(null);
    }
  };

  const tick = async (id: string, onDashboard: boolean) => {
    setError(null);
    setTicks((t) => ({ ...t, [id]: onDashboard }));
    const r = await api(`/api/uploads/${id}`, { method: "PATCH", body: { onDashboard } });
    if (!r.ok) {
      setTicks((t) => ({ ...t, [id]: !onDashboard }));
      setError(r.message);
    }
  };

  if (list.length === 0)
    return (
      <EmptyState icon="lock" title="No files yet">
        Files you add for this company are kept here, encrypted, until you delete them.
      </EmptyState>
    );
  return (
    <div className="flex flex-col gap-3">
      {error === null ? null : (
        <div className="px-5">
          <Alert tone="error">{error}</Alert>
        </div>
      )}
      <DataTable
        testId="uploaded-files"
        className="px-2 pb-2"
        maxHeight="28rem"
        head={
          <>
            <Th>On dashboard</Th>
            <Th>File</Th>
            <Th>Months</Th>
            <Th numeric>Size</Th>
            <Th>Opened</Th>
            <Th>
              <span className="sr-only">Download or delete</span>
            </Th>
          </>
        }
      >
        {list.map((f) => (
          <Fragment key={f.id}>
            <Tr>
              <Td>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-4 accent-accent-600"
                    checked={f.onDashboard}
                    disabled={f.periods.length === 0}
                    aria-label={`Show ${f.name} on the dashboard`}
                    onChange={(e) => void tick(f.id, e.target.checked)}
                  />
                </label>
              </Td>
              <Td className="min-w-48 font-medium wrap-anywhere text-neutral-900">
                {f.name}
                <span className="block text-[0.75rem] font-normal text-neutral-500">
                  {f.usable ? "Added" : "Could not be read · added"} {f.uploadedLabel}
                </span>
              </Td>
              <Td className="text-neutral-700">{monthsLabel(f.periods)}</Td>
              <Td numeric>{fileSize(f.size)}</Td>
              <Td className="text-[0.8125rem] text-neutral-600">
                {f.lastRead === null ? (
                  "Never"
                ) : (
                  <>
                    {f.reads.toString()} {f.reads === 1 ? "time" : "times"}
                    <span className="block text-[0.75rem] text-neutral-500">
                      Last for {PURPOSE[f.lastRead.purpose] ?? f.lastRead.purpose},{" "}
                      {f.lastRead.atLabel}
                    </span>
                  </>
                )}
              </Td>
              <Td className="text-right whitespace-nowrap">
                <Button
                  variant="ghost"
                  size="sm"
                  icon="download"
                  onClick={() => void download(f.id)}
                >
                  Download<span className="sr-only"> {f.name}</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon="trash"
                  disabled={busy !== null}
                  aria-expanded={confirming === f.id}
                  onClick={() => {
                    setError(null);
                    setWanted(null);
                    setConfirming(f.id);
                  }}
                >
                  Delete<span className="sr-only"> {f.name}</span>
                </Button>
              </Td>
            </Tr>
            {/* Each step opens at its own file's row and names it, inside the table's scroll. */}
            {wanted === f.id ? (
              <tr>
                <td colSpan={6} className="px-3 pb-3">
                  <div className="max-w-md rounded-xl border border-neutral-200/80 bg-raised p-4">
                    <ReauthForm
                      actionLabel={`download ${f.name}`}
                      onGranted={() => {
                        void download(f.id);
                      }}
                      onCancel={() => {
                        setWanted(null);
                      }}
                    />
                  </div>
                </td>
              </tr>
            ) : null}
            {confirming === f.id ? (
              <tr>
                <td colSpan={6} className="px-3 pb-3">
                  <div
                    className="flex max-w-2xl flex-col gap-3 rounded-xl border border-negative/25 bg-negative-subtle p-4 text-sm"
                    role="group"
                    aria-label={`Delete ${f.name}`}
                    data-testid="file-delete-confirm"
                  >
                    <p className="font-semibold wrap-anywhere text-neutral-900">
                      Delete {f.name}?
                    </p>
                    <p className="text-neutral-700">{deleteConsequence(f)}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={busy !== null}
                        onClick={() => void remove(f.id)}
                      >
                        {busy === f.id ? "Deleting…" : "Delete the file"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy !== null}
                        onClick={() => {
                          setConfirming(null);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                </td>
              </tr>
            ) : null}
          </Fragment>
        ))}
      </DataTable>
    </div>
  );
}
