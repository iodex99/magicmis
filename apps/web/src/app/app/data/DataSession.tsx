"use client";

import { useEffect, useRef, useState } from "react";
import * as Comlink from "comlink";

import { Alert, Button, Panel } from "@/components/ui";
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

      <Panel title="Add files">
        <div
          className="flex flex-col items-start gap-3 rounded-md border border-dashed border-neutral-300 p-6"
          onDragOver={(e) => {
            e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            void add(e.dataTransfer.files);
          }}
        >
          <label htmlFor="source-files" className="text-sm font-medium text-neutral-800">
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
            className="text-sm"
          />
          <p className="text-xs text-neutral-600">
            Drag files here, or choose them. Macros are never run.
          </p>
        </div>
        {inFlight.length > 0 ? (
          <ul
            className="mt-4 flex flex-col gap-2 text-sm"
            aria-live="polite"
            data-testid="ingest-progress"
          >
            {inFlight.map((p) => (
              <li key={p.name} className="flex items-center gap-3">
                <span className="w-64 truncate">{p.name}</span>
                {p.stage === "error" ? (
                  <span className="text-negative">{p.message}</span>
                ) : (
                  <progress
                    max={100}
                    value={p.percent}
                    className="h-2 w-48"
                    aria-label={`${p.name} progress`}
                  />
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </Panel>

      <Panel title="Loaded in this session">
        {files.length === 0 ? (
          <p className="text-sm text-neutral-700">No files loaded.</p>
        ) : (
          <table className="w-full text-sm" data-testid="loaded-files">
            <thead className="text-left text-xs text-neutral-600">
              <tr>
                <th className="py-2 font-medium">File</th>
                <th className="py-2 text-right font-medium">Size</th>
                <th className="py-2 text-right font-medium">Sheets</th>
                <th className="py-2 text-right font-medium">Rows</th>
                {developerMode ? <th className="py-2" /> : null}
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.fileId} className="border-t border-neutral-100">
                  <td className="py-2">{f.name}</td>
                  <td className="py-2 text-right tabular-nums">{bytes(f.size)}</td>
                  <td className="py-2 text-right tabular-nums">{f.sheets.length}</td>
                  <td className="py-2 text-right tabular-nums">
                    {f.sheets.map((s) => formatCount(s.rows.toString())).join(" / ")}
                  </td>
                  {developerMode ? (
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        className="text-xs text-accent-700 underline"
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
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="mt-4">
          <Button variant="secondary" onClick={() => void clear()} disabled={busy}>
            Clear session data
          </Button>
        </div>
      </Panel>

      {developerMode && inspection !== null ? (
        <Panel title="Payload inspector (developer mode)">
          <p className="mb-2 text-xs text-neutral-600">
            Exactly what a paid action would send for this file, redacted with a preview
            key. Not shown to customers.
          </p>
          <pre
            className="max-h-96 overflow-auto rounded bg-neutral-50 p-3 text-xs"
            data-testid="payload-inspector"
          >
            {inspection}
          </pre>
        </Panel>
      ) : null}
    </div>
  );
}
