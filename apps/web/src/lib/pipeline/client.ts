"use client";

import * as Comlink from "comlink";

import type { PipelineApi } from "./types";

let worker: Worker | null = null;
let remote: Comlink.Remote<PipelineApi> | null = null;

export function pipelineClient(): Comlink.Remote<PipelineApi> {
  if (remote === null) {
    worker = new Worker(new URL("./pipeline.worker.ts", import.meta.url), {
      type: "module",
      name: "pipeline",
    });
    remote = Comlink.wrap<PipelineApi>(worker);
  }
  return remote;
}

/** Drops every file, grid, token and DuckDB table held for the job (SPEC §15 session hygiene). */
export async function clearPipeline(): Promise<void> {
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
}
