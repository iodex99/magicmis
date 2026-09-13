"use client";

/**
 * Page-side handle on the ingestion worker, and session hygiene (SPEC §15): raw data is
 * cleared on sign-out, on "Clear session data", when a new session starts, and — best
 * effort — when the tab closes.
 */

import * as Comlink from "comlink";

import type { IngestApi } from "./types";

const OPFS_DIR = "mis-ingest";
let worker: Worker | null = null;
let remote: Comlink.Remote<IngestApi> | null = null;

export function ingestClient(): Comlink.Remote<IngestApi> {
  if (remote === null) {
    worker = new Worker(new URL("./ingest.worker.ts", import.meta.url), {
      type: "module",
      name: "ingest",
    });
    remote = Comlink.wrap<IngestApi>(worker);
  }
  return remote;
}

/** Temporary OPFS storage, if any was used, removed in full. */
async function clearOpfs(): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(OPFS_DIR, { recursive: true });
  } catch {
    // Absent directory, or OPFS unavailable: nothing to clear.
  }
}

/** Terminate the worker (dropping DuckDB and every parsed grid) and clear OPFS temp. */
export async function clearIngestSession(): Promise<void> {
  if (remote !== null) {
    try {
      await remote.clear();
    } catch {
      /* the worker may already be gone */
    }
  }
  worker?.terminate();
  worker = null;
  remote = null;
  await clearOpfs();
}

let installed = false;

/** Tab close: terminate synchronously; the browser discards worker memory with it. */
export function installTabCloseHygiene(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("pagehide", () => {
    worker?.terminate();
    worker = null;
    remote = null;
    void clearOpfs();
  });
}

const SESSION_MARK = "mis.ingest.session";

/** New session start: if this tab belongs to a different session than last time, clear first. */
export async function clearIfNewSession(sessionKey: string): Promise<void> {
  try {
    if (sessionStorage.getItem(SESSION_MARK) !== sessionKey) {
      await clearIngestSession();
      sessionStorage.setItem(SESSION_MARK, sessionKey);
    }
  } catch {
    await clearIngestSession();
  }
}
