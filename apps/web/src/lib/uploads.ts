"use client";

import { api } from "./client-api";

/**
 * Upload one file to a company in chunks (ADR 0032).
 *
 * Chunks are sized by the server to fit a serverless request body, sent in order, and retried a
 * few times each so a dropped connection costs one chunk rather than the whole file.
 */

export interface UploadedFile {
  readonly uploadId: string;
  readonly name: string;
  readonly size: number;
  readonly sheets: number | null;
  readonly rows: number | null;
  /** Why the file cannot be used, and what to export instead; null when it was read. */
  readonly refused: string | null;
}

export type UploadResult =
  | { ok: true; file: UploadedFile }
  /** `cancelled`: stopped by its owner, and whatever had arrived was deleted (ADR 0091). */
  | { ok: false; message: string; cancelled?: true };

export async function uploadFile(
  companyId: string,
  file: File,
  onProgress: (fraction: number) => void,
  /**
   * A file removed while it uploads stops cleanly (ADR 0091): the parts in flight are abandoned,
   * no more are sent, and the upload is deleted on the server rather than left as a kept file
   * nobody can see on this screen.
   */
  signal?: AbortSignal,
): Promise<UploadResult> {
  const created = await api<{ uploadId: string; chunkBytes: number; chunkCount: number }>(
    `/api/companies/${companyId}/uploads`,
    {
      body: { fileName: file.name, byteSize: file.size },
      // One key per file per attempt: a retry of this call returns the upload it already
      // started rather than starting a second one against the company's cap (ADR 0059).
      idempotencyKey: crypto.randomUUID(),
    },
  );
  if (!created.ok) return { ok: false, message: created.message };
  const { uploadId, chunkBytes, chunkCount } = created.data;
  const cancelled = async (): Promise<UploadResult> => {
    await removeUpload(uploadId).catch(() => undefined);
    return { ok: false, message: "Removed.", cancelled: true };
  };
  if (signal?.aborted === true) return cancelled();

  // Three parts at a time; the server stores each independently. Progress reaches 90% when
  // every part is in, and 100% only once the server has read the file.
  let done = 0;
  // Held in an object so the checks after the parallel lanes read its current value.
  const state: { failure: string | null } = { failure: null };
  const stopped = () => signal?.aborted === true;
  const sendPart = async (i: number): Promise<void> => {
    const part = file.slice(i * chunkBytes, Math.min(file.size, (i + 1) * chunkBytes));
    let sent = false;
    for (let attempt = 0; attempt < 3 && !sent && !stopped(); attempt += 1) {
      try {
        const response = await fetch(`/api/uploads/${uploadId}/chunks/${i.toString()}`, {
          method: "PUT",
          headers: { "content-type": "application/octet-stream" },
          body: part,
          credentials: "same-origin",
          cache: "no-store",
          ...(signal === undefined ? {} : { signal }),
        });
        if (response.ok) sent = true;
        else if (response.status < 500) {
          const body = (await response.json().catch(() => null)) as {
            message?: string;
          } | null;
          state.failure = body?.message ?? "This file could not be uploaded.";
          return;
        }
      } catch {
        // Network blip: retried below. An abort lands here too, and the loop stops on it.
      }
    }
    if (stopped()) return;
    if (!sent) {
      state.failure =
        "The upload was interrupted. Check your connection, then press Retry or add the file again.";
      return;
    }
    done += 1;
    onProgress((done / chunkCount) * 0.9);
  };
  let next = 0;
  const lane = async () => {
    while (next < chunkCount && state.failure === null && !stopped()) {
      const i = next;
      next += 1;
      await sendPart(i);
    }
  };
  await Promise.all([lane(), lane(), lane()]);
  // Every lane has stopped, so nothing is still on its way when the upload is deleted.
  if (stopped()) return cancelled();
  if (state.failure !== null) return { ok: false, message: state.failure };

  const read = await api<UploadedFile>(`/api/uploads/${uploadId}/complete`, { body: {} });
  if (stopped()) return cancelled();
  if (!read.ok) return { ok: false, message: read.message };
  // A refused file carries no counts; normalise so the page never reads a missing value.
  return {
    ok: true,
    file: {
      ...read.data,
      sheets: read.data.sheets ?? null,
      rows: read.data.rows ?? null,
      refused: read.data.refused ?? null,
    },
  };
}

/**
 * Deletes an upload, and throws with the server's reason when it was refused (ADR 0091): `api`
 * reports a refusal rather than throwing, so a caller that waited on this alone showed a file as
 * deleted that never was.
 */
export async function removeUpload(uploadId: string): Promise<void> {
  const r = await api(`/api/uploads/${uploadId}`, { method: "DELETE" });
  if (!r.ok) throw new Error(r.message);
}
