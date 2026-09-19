"use client";

import { periodLabel } from "@magicmis/render-dashboard";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ReauthForm } from "@/components/ReauthForm";
import { Alert, Button, DataTable, EmptyState, Td, Th, Tr } from "@/components/ui";
import { api } from "@/lib/client-api";
import { removeUpload } from "@/lib/uploads";

export interface CompanyFileRow {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly uploadedAt: string;
  /** False for a file that arrived but could not be read. */
  readonly usable: boolean;
  /** Months this file fed, oldest first. Empty until a run has read it. */
  readonly periods: readonly string[];
  readonly onDashboard: boolean;
  /** How many times the file has been decrypted, and the last time and reason (ADR 0047). */
  readonly reads: number;
  readonly lastRead: { readonly purpose: string; readonly at: string } | null;
}

const bytes = (n: number): string =>
  n >= 1_048_576
    ? `${(n / 1_048_576).toFixed(1)} MB`
    : n >= 1024
      ? `${(n / 1024).toFixed(0)} KB`
      : `${n.toString()} B`;

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

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

/**
 * The company's stored files (ADR 0047): kept until their owner deletes them, each with the
 * months it fed, a tick for whether those months are on the dashboard, the record of every time
 * it was opened, and the owner's own way to take it back or delete it.
 */
export function CompanyFiles({ files }: { files: readonly CompanyFileRow[] }) {
  const router = useRouter();
  const [list, setList] = useState(files);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // A download needs the password confirmed first (it is the company's raw books). The file
  // asked for is remembered, so confirming goes straight on to it.
  const [wanted, setWanted] = useState<string | null>(null);

  const download = async (id: string) => {
    setError(null);
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
      setList((l) => l.filter((f) => f.id !== id));
      router.refresh();
    } catch {
      setError("That file could not be deleted. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const tick = async (id: string, onDashboard: boolean) => {
    setError(null);
    setList((l) => l.map((f) => (f.id === id ? { ...f, onDashboard } : f)));
    const r = await api(`/api/uploads/${id}`, { method: "PATCH", body: { onDashboard } });
    if (!r.ok) {
      setList((l) =>
        l.map((f) => (f.id === id ? { ...f, onDashboard: !onDashboard } : f)),
      );
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
      {error === null ? null : <Alert tone="error">{error}</Alert>}
      {wanted === null ? null : (
        <div className="mx-5 rounded-xl border border-neutral-200/80 bg-raised p-4">
          <ReauthForm
            actionLabel="download this file"
            onGranted={() => {
              void download(wanted);
            }}
          />
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
            <Th />
          </>
        }
      >
        {list.map((f) => (
          <Tr key={f.id}>
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
            <Td className="font-medium text-neutral-900">
              {f.name}
              <span className="block text-[0.75rem] font-normal text-neutral-500">
                {f.usable ? "Added" : "Could not be read · added"} {day(f.uploadedAt)}
              </span>
            </Td>
            <Td className="text-neutral-700">{monthsLabel(f.periods)}</Td>
            <Td numeric>{bytes(f.size)}</Td>
            <Td className="text-[0.8125rem] text-neutral-600">
              {f.lastRead === null ? (
                "Never"
              ) : (
                <>
                  {f.reads.toString()} {f.reads === 1 ? "time" : "times"}
                  <span className="block text-[0.75rem] text-neutral-500">
                    Last for {PURPOSE[f.lastRead.purpose] ?? f.lastRead.purpose},{" "}
                    {day(f.lastRead.at)}
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
                Download
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon="trash"
                disabled={busy !== null}
                onClick={() => void remove(f.id)}
              >
                {busy === f.id ? "Deleting…" : "Delete"}
              </Button>
            </Td>
          </Tr>
        ))}
      </DataTable>
    </div>
  );
}
