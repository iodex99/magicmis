import "server-only";

import { UploadError } from "@magicmis/jobs";

import { apiError } from "../http";

/** Upload failures as plain responses that say what to do next. */
export function uploadErrorResponse(error: unknown): Response | null {
  if (!(error instanceof UploadError)) return null;
  const status =
    error.code === "upload_not_found"
      ? 404
      : error.code === "file_too_large" || error.code === "chunk_too_large"
        ? 413
        : 409;
  return apiError(status, error.code, error.message);
}

/**
 * The raw body of a chunk, read incrementally and abandoned past the limit, so an oversize part
 * is never buffered.
 */
export async function readBinaryBody(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; bytes: Buffer } | { ok: false; response: Response }> {
  const tooLarge = () =>
    apiError(413, "chunk_too_large", "That part of the file is too large.");
  const declared = request.headers.get("content-length");
  if (
    declared !== null &&
    /^\d+$/u.test(declared) &&
    Number.parseInt(declared, 10) > maxBytes
  )
    return { ok: false, response: tooLarge() };
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (request.body !== null) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return { ok: false, response: tooLarge() };
      }
      chunks.push(value);
    }
  }
  return { ok: true, bytes: Buffer.concat(chunks) };
}
