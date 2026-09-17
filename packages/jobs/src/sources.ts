/**
 * Uploaded source files (ADR 0032).
 *
 * A file arrives in chunks small enough for a serverless request body. Each chunk is sealed
 * under the company's data key before it is stored, so the store only ever holds ciphertext
 * and destroying the company key shreds the files with the rest of the company's memory. The
 * row holds a name, a size and counts — nothing from inside the file.
 *
 * Every upload expires (`sources.retention_days`) and `purgeExpiredUploads` removes the stored
 * chunks after that, whether or not a job used them.
 */

import { readConfig } from "@magicmis/db/config";
import type { KeyWrapper } from "@magicmis/crypto";
import { openForCompany, sealForCompany } from "@magicmis/engine/server";
import type { Pool } from "pg";
import { z } from "zod";

import type { OutputStore } from "./settle";

export class UploadError extends Error {
  constructor(
    readonly code:
      | "upload_not_found"
      | "file_too_large"
      | "chunk_out_of_range"
      | "chunk_too_large"
      | "upload_incomplete"
      | "upload_not_ready",
    message: string,
  ) {
    super(message);
    this.name = "UploadError";
  }
}

export interface UploadRow {
  readonly id: string;
  readonly accountId: string;
  readonly companyId: string;
  readonly fileName: string;
  readonly byteSize: number;
  readonly chunkCount: number;
  readonly chunksStored: number;
  readonly status: "uploading" | "ready" | "refused";
  readonly refusal: string | null;
  readonly sheetCount: number | null;
  readonly rowCount: number | null;
}

const chunkPath = (u: { accountId: string; companyId: string; id: string }, i: number) =>
  `${u.accountId}/${u.companyId}/sources/${u.id}/${i.toString()}.bin`;

const n = z.number().int().positive();

export async function uploadLimits(pool: Pool) {
  const [chunkBytes, maxFileBytes, retentionDays] = await Promise.all([
    readConfig(pool, "sources.chunk_bytes", n),
    readConfig(pool, "sources.max_file_bytes", n),
    readConfig(pool, "sources.retention_days", n),
  ]);
  return { chunkBytes, maxFileBytes, retentionDays };
}

export async function createUpload(
  pool: Pool,
  input: {
    accountId: string;
    companyId: string;
    fileName: string;
    byteSize: number;
    now?: Date;
  },
): Promise<{ uploadId: string; chunkBytes: number; chunkCount: number }> {
  const limits = await uploadLimits(pool);
  if (input.byteSize > limits.maxFileBytes)
    throw new UploadError("file_too_large", "This file is larger than the upload limit.");
  const company = await pool.query(
    `select 1 from companies where id = $1 and account_id = $2 and deleted_at is null`,
    [input.companyId, input.accountId],
  );
  if (company.rows.length === 0)
    throw new UploadError("upload_not_found", "Company not found.");
  const chunkCount = Math.max(1, Math.ceil(input.byteSize / limits.chunkBytes));
  const now = input.now ?? new Date();
  const expires = new Date(now.getTime() + limits.retentionDays * 86_400_000);
  const r = await pool.query<{ id: string }>(
    `insert into source_uploads (account_id, company_id, file_name, byte_size, chunk_count, expires_at, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $7) returning id`,
    [
      input.accountId,
      input.companyId,
      input.fileName.slice(0, 255),
      input.byteSize,
      chunkCount,
      expires,
      now,
    ],
  );
  return { uploadId: r.rows[0]?.id ?? "", chunkBytes: limits.chunkBytes, chunkCount };
}

export async function getUpload(
  pool: Pool,
  accountId: string,
  uploadId: string,
): Promise<UploadRow> {
  const r = await pool.query<{
    id: string;
    account_id: string;
    company_id: string;
    file_name: string;
    byte_size: string;
    chunk_count: number;
    chunks_stored: number;
    status: UploadRow["status"];
    refusal: string | null;
    sheet_count: number | null;
    row_count: string | null;
  }>(
    `select id, account_id, company_id, file_name, byte_size::text as byte_size, chunk_count, cardinality(stored_chunks) as chunks_stored,
            status, refusal, sheet_count, row_count::text as row_count
     from source_uploads where id = $1 and account_id = $2 and deleted_at is null`,
    [uploadId, accountId],
  );
  const u = r.rows[0];
  if (u === undefined) throw new UploadError("upload_not_found", "Upload not found.");
  return {
    id: u.id,
    accountId: u.account_id,
    companyId: u.company_id,
    fileName: u.file_name,
    byteSize: Number.parseInt(u.byte_size, 10),
    chunkCount: u.chunk_count,
    chunksStored: u.chunks_stored,
    status: u.status,
    refusal: u.refusal,
    sheetCount: u.sheet_count,
    rowCount: u.row_count === null ? null : Number.parseInt(u.row_count, 10),
  };
}

/** Seal and store one chunk. Chunks may arrive in any order; a retried chunk replaces itself. */
export async function storeChunk(
  pool: Pool,
  wrapper: KeyWrapper,
  store: OutputStore,
  input: { accountId: string; uploadId: string; index: number; bytes: Buffer },
): Promise<{ chunksStored: number; complete: boolean }> {
  const upload = await getUpload(pool, input.accountId, input.uploadId);
  const { chunkBytes } = await uploadLimits(pool);
  if (
    !Number.isInteger(input.index) ||
    input.index < 0 ||
    input.index >= upload.chunkCount
  )
    throw new UploadError("chunk_out_of_range", "That part of the file is out of range.");
  if (input.bytes.length > chunkBytes)
    throw new UploadError("chunk_too_large", "That part of the file is too large.");
  const sealed = await sealForCompany(pool, wrapper, {
    accountId: upload.accountId,
    companyId: upload.companyId,
    purpose: "source_chunk",
    id: `${upload.id}:${input.index.toString()}`,
    plaintext: input.bytes,
  });
  const p = chunkPath(upload, input.index);
  await store.remove([p]);
  await store.put(p, sealed, "application/octet-stream");
  const r = await pool.query<{ chunks_stored: number }>(
    `update source_uploads
        set stored_chunks = case when $2 = any(stored_chunks) then stored_chunks
                                 else array_append(stored_chunks, $2) end,
            updated_at = now()
      where id = $1 returning cardinality(stored_chunks) as chunks_stored`,
    [upload.id, input.index],
  );
  const stored = r.rows[0]?.chunks_stored ?? 0;
  return { chunksStored: stored, complete: stored >= upload.chunkCount };
}

/** The whole file, decrypted, for the server pipeline. */
export async function loadUploadBytes(
  pool: Pool,
  wrapper: KeyWrapper,
  store: OutputStore,
  input: { accountId: string; uploadId: string },
): Promise<{ upload: UploadRow; bytes: Buffer }> {
  const upload = await getUpload(pool, input.accountId, input.uploadId);
  if (upload.chunksStored < upload.chunkCount)
    throw new UploadError("upload_incomplete", "This file has not finished uploading.");
  const parts: Buffer[] = [];
  for (let i = 0; i < upload.chunkCount; i += 1) {
    const sealed = await store.get(chunkPath(upload, i));
    parts.push(
      await openForCompany(pool, wrapper, {
        accountId: upload.accountId,
        companyId: upload.companyId,
        purpose: "source_chunk",
        id: `${upload.id}:${i.toString()}`,
        sealed,
      }),
    );
  }
  const bytes = Buffer.concat(parts);
  if (bytes.length !== upload.byteSize)
    throw new UploadError("upload_incomplete", "This file did not upload completely.");
  return { upload, bytes };
}

export async function finishUpload(
  pool: Pool,
  input: {
    accountId: string;
    uploadId: string;
    outcome:
      | { status: "ready"; sheets: number; rows: number }
      | { status: "refused"; refusal: string };
  },
): Promise<void> {
  const o = input.outcome;
  await pool.query(
    `update source_uploads set status = $3, refusal = $4, sheet_count = $5, row_count = $6, updated_at = now()
     where id = $1 and account_id = $2`,
    [
      input.uploadId,
      input.accountId,
      o.status,
      o.status === "refused" ? o.refusal : null,
      o.status === "ready" ? o.sheets : null,
      o.status === "ready" ? o.rows : null,
    ],
  );
}

async function removeUploadObjects(store: OutputStore, upload: UploadRow): Promise<void> {
  const paths: string[] = [];
  for (let i = 0; i < upload.chunkCount; i += 1) paths.push(chunkPath(upload, i));
  await store.remove(paths);
}

export async function deleteUpload(
  pool: Pool,
  store: OutputStore,
  input: { accountId: string; uploadId: string },
): Promise<void> {
  const upload = await getUpload(pool, input.accountId, input.uploadId);
  await removeUploadObjects(store, upload);
  await pool.query(
    `update source_uploads set deleted_at = now(), updated_at = now() where id = $1`,
    [upload.id],
  );
}

/**
 * Remove stored chunks of every expired upload, and of every upload whose company was deleted
 * (its key is already destroyed; this clears the ciphertext too). Run by the worker hourly.
 */
export async function purgeExpiredUploads(
  pool: Pool,
  store: OutputStore,
  now: Date = new Date(),
): Promise<number> {
  const r = await pool.query<{ id: string; account_id: string }>(
    `select u.id, u.account_id from source_uploads u
     where u.deleted_at is null
       and (u.expires_at <= $1
            or exists (select 1 from companies c where c.id = u.company_id and c.deleted_at is not null))
     limit 500`,
    [now],
  );
  for (const row of r.rows) {
    await deleteUpload(pool, store, { accountId: row.account_id, uploadId: row.id });
  }
  return r.rows.length;
}
