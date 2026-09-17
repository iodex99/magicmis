"use client";

import { useEffect, useState } from "react";
import * as Comlink from "comlink";

import { FileDropZone } from "@/components/FileDropZone";
import { ProcessingNotice } from "@/components/ProcessingNotice";
import {
  Alert,
  Button,
  DataTable,
  EmptyState,
  Panel,
  Progress,
  Td,
  Th,
  Tr,
} from "@/components/ui";
import { formatCount } from "@/lib/actions";
import { api } from "@/lib/client-api";
import {
  clearIfNewSession,
  clearIngestSession,
  ingestClient,
  installTabCloseHygiene,
} from "@/lib/ingest/client";
import type { FileSummary, IngestProgress } from "@/lib/ingest/types";

import type { IngestLimits } from "@magicmis/ingest";

const bytes = (n: number): string =>
  n >= 1_048_576
    ? `${(n / 1_048_576).toFixed(1)} MB`
    : n >= 1024
      ? `${(n / 1024).toFixed(0)} KB`
      : `${n.toString()} B`;

export function DataSession({ sessionKey }: { sessionKey: string }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<readonly FileSummary[]>([]);
  const [progress, setProgress] = useState<Record<string, IngestProgress>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    installTabCloseHygiene();
    const effect = { cancelled: false };
    void (async () => {
      await clearIfNewSession(sessionKey);
      const config = await api<{
        limits: IngestLimits;
        caps: { sampleRowsPerSheet: number; distinctValuesPerColumn: number };
      }>("/api/ingest/config");
      if (effect.cancelled) return;
      if (!config.ok) {
        setError(config.message);
        return;
      }
      const client = ingestClient();
      await client.configure(
        config.data.limits,
        config.data.caps,
        // This screen inspects files without a company, so there is no setting to read.
        // Day-first is the documented default (SPEC §2.14) and what every Tally export
        // writes; a company's own order is applied on the run screen, where one exists.
        "day_first",
      );
      setFiles(await client.summaries());
      setReady(true);
    })();
    return () => {
      effect.cancelled = true;
    };
  }, [sessionKey]);

  async function add(list: File[]) {
    if (list.length === 0) return;
    setBusy(true);
    setError(null);
    const client = ingestClient();
    const onProgress = Comlink.proxy((p: IngestProgress) => {
      setProgress((prev) => ({ ...prev, [p.name]: p }));
    });
    try {
      await client.addFiles(list, onProgress);
      setFiles(await client.summaries());
    } catch {
      setError("Files could not be processed. Reload the page and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    await clearIngestSession();
    setFiles([]);
    setProgress({});
    const client = ingestClient();
    const config = await api<{
      limits: IngestLimits;
      caps: { sampleRowsPerSheet: number; distinctValuesPerColumn: number };
    }>("/api/ingest/config");
    if (config.ok)
      await client.configure(
        config.data.limits,
        config.data.caps,
        // This screen inspects files without a company, so there is no setting to read.
        // Day-first is the documented default (SPEC §2.14) and what every Tally export
        // writes; a company's own order is applied on the run screen, where one exists.
        "day_first",
      );
  }

  const inFlight = Object.values(progress).filter((p) => p.stage !== "done");

  return (
    <div className="flex flex-col gap-6">
      {error ? <Alert tone="error">{error}</Alert> : null}

      <Panel
        title="Add files"
        icon="upload"
        description="Trial balances, ledgers, registers. Nothing leaves this tab."
      >
        <ProcessingNotice>
          <FileDropZone
            title="Drag your exports here"
            hint="Any format: Excel, CSV, PDF, text or HTML exports from any accounting software. Macros are never run."
            inputLabel="Source files"
            disabled={!ready}
            busy={busy}
            onFiles={add}
          />
        </ProcessingNotice>
        {inFlight.length > 0 ? (
          <ul
            className="mt-4 flex flex-col gap-2 text-sm"
            aria-live="polite"
            data-testid="ingest-progress"
          >
            {inFlight.map((p) => (
              <li key={p.name} className="flex items-center gap-3">
                <span className="w-64 truncate text-[0.8125rem] text-neutral-700">
                  {p.name}
                </span>
                {p.stage === "error" ? (
                  <span className="text-[0.8125rem] text-negative">{p.message}</span>
                ) : (
                  <span className="w-48">
                    <Progress value={p.percent} label={`${p.name} progress`} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </Panel>

      <Panel
        title="Loaded in this session"
        icon="file"
        description="Cleared when you sign out or close the tab."
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon="trash"
            onClick={() => void clear()}
            disabled={busy}
          >
            Clear session data
          </Button>
        }
        padding="none"
      >
        {files.length === 0 ? (
          <EmptyState icon="file" title="No files loaded">
            Add this month&rsquo;s exports above. Until you run a paid action you see only
            names, sizes, sheet counts and row counts.
          </EmptyState>
        ) : (
          <DataTable
            testId="loaded-files"
            className="px-2 pb-2"
            head={
              <>
                <Th>File</Th>
                <Th numeric>Size</Th>
                <Th numeric>Sheets</Th>
                <Th numeric>Rows</Th>
              </>
            }
          >
            {files.map((f) => (
              <Tr key={f.fileId}>
                <Td className="font-medium text-neutral-900">{f.name}</Td>
                <Td numeric>{bytes(f.size)}</Td>
                <Td numeric>{f.sheets.length}</Td>
                <Td numeric>
                  {f.sheets.map((s) => formatCount(s.rows.toString())).join(" / ")}
                </Td>
              </Tr>
            ))}
          </DataTable>
        )}
      </Panel>
    </div>
  );
}
