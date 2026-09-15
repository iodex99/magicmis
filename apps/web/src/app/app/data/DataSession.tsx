"use client";

import { useEffect, useRef, useState } from "react";
import * as Comlink from "comlink";

import { Icon } from "@/components/Icon";
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

export function DataSession({
  sessionKey,
  developerMode,
}: {
  sessionKey: string;
  developerMode: boolean;
}) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<readonly FileSummary[]>([]);
  const [progress, setProgress] = useState<Record<string, IngestProgress>>({});
  const [busy, setBusy] = useState(false);
  const [inspection, setInspection] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

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
      await client.configure(config.data.limits, config.data.caps, developerMode);
      setFiles(await client.summaries());
      setReady(true);
    })();
    return () => {
      effect.cancelled = true;
    };
  }, [sessionKey, developerMode]);

  async function add(list: FileList | null) {
    if (list === null || list.length === 0) return;
    setBusy(true);
    setError(null);
    const client = ingestClient();
    const onProgress = Comlink.proxy((p: IngestProgress) => {
      setProgress((prev) => ({ ...prev, [p.name]: p }));
    });
    try {
      await client.addFiles([...list], onProgress);
      setFiles(await client.summaries());
    } catch {
      setError("Files could not be processed. Reload the page and try again.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function clear() {
    await clearIngestSession();
    setFiles([]);
    setProgress({});
    setInspection(null);
    const client = ingestClient();
    const config = await api<{
      limits: IngestLimits;
      caps: { sampleRowsPerSheet: number; distinctValuesPerColumn: number };
    }>("/api/ingest/config");
    if (config.ok)
      await client.configure(config.data.limits, config.data.caps, developerMode);
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
          <div
            className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-neutral-200 bg-neutral-25 px-6 py-8 text-center transition-colors hover:border-accent-300"
            onDragOver={(e) => {
              e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              void add(e.dataTransfer.files);
            }}
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent-50 text-accent-600">
              <Icon name="upload" size={20} />
            </span>
            <label
              htmlFor="source-files"
              className="text-[0.9375rem] font-semibold text-neutral-900"
            >
              Excel or CSV exports (.xlsx, .xlsm, .xls, .csv)
            </label>
            <input
              ref={input}
              id="source-files"
              type="file"
              multiple
              accept=".xlsx,.xlsm,.xls,.csv"
              disabled={!ready || busy}
              onChange={(e) => void add(e.target.files)}
              className="text-[0.8125rem] text-neutral-600 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-accent-600 file:px-3.5 file:py-2 file:text-[0.8125rem] file:font-medium file:text-white hover:file:bg-accent-700"
            />
            <p className="text-[0.75rem] text-neutral-500">
              Drag files here, or choose them. Macros are never run.
            </p>
          </div>
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
                {developerMode ? <Th /> : null}
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
                {developerMode ? (
                  <Td className="text-right">
                    <button
                      type="button"
                      className="rounded-md px-2 py-1 text-[0.75rem] font-medium text-accent-700 hover:bg-accent-50"
                      onClick={() => {
                        void ingestClient()
                          .inspect(f.fileId)
                          .then(setInspection)
                          .catch(() => {
                            setInspection("Inspection failed.");
                          });
                      }}
                    >
                      Inspect payload
                    </button>
                  </Td>
                ) : null}
              </Tr>
            ))}
          </DataTable>
        )}
      </Panel>

      {developerMode && inspection !== null ? (
        <Panel title="Payload inspector (developer mode)" icon="search">
          <p className="mb-2 text-[0.75rem] text-neutral-500">
            Exactly what a paid action would send for this file, redacted with a preview
            key. Not shown to customers.
          </p>
          <pre
            className="scroll-slim max-h-96 overflow-auto rounded-lg bg-neutral-900 p-3 text-[0.75rem] text-neutral-100"
            data-testid="payload-inspector"
          >
            {inspection}
          </pre>
        </Panel>
      ) : null}
    </div>
  );
}
