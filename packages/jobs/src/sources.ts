/**
 * Uploaded source files (ADR 0032).
 *
 * A file arrives in chunks small enough for a serverless request body. Each chunk is sealed
 * under the company's data key before it is stored, so the store only ever holds ciphertext
 * and destroying the company key shreds the files with the rest of the company's memory. The
 * row holds a name, a size and counts — nothing from inside the file.
 *
 * **Files are kept** (ADR 0047): `sources.retention_days` is 0, which means no expiry, and a file
 * stays until its owner deletes it or deletes the company (which destroys the key it is sealed
 * under). An operator who must set a period still can; `purgeExpiredUploads` honours it.
 *
 * **Every decryption is recorded** in `source_upload_reads` with why it happened. There is no
 * purpose for "a member of staff" because no such path exists: nothing in the admin console or
 * the worker opens a file. The customer sees the record beside each file.
 *
 * A file also remembers **which months it fed** and whether it is **ticked for the dashboard**;
 * `hiddenPeriods` turns the ticks into the months the dashboard leaves out.
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
  /** Months this file fed, set by the run that read it. Empty until a run has. */
  readonly periods: readonly string[];
  /** The customer's tick: whether this file's months are shown on the dashboard. */
  readonly onDashboard: boolean;
}

/** Why a stored file was decrypted. Recorded on every read; shown to the file's owner. */
export type ReadPurpose = "intake" | "pricing" | "run" | "chat" | "download";

const chunkPath = (u: { accountId: string; companyId: string; id: string }, i: number) =>
  `${u.accountId}/${u.companyId}/sources/${u.id}/${i.toString()}.bin`;

const n = z.number().int().positive();
/** Zero: files are kept until their owner deletes them. */
const days = z.number().int().nonnegative();

export async function uploadLimits(pool: Pool) {
  const [chunkBytes, maxFileBytes, retentionDays] = await Promise.all([
    readConfig(pool, "sources.chunk_bytes", n),
    readConfig(pool, "sources.max_file_bytes", n),
    readConfig(pool, "sources.retention_days", days),
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
  const expires =
    limits.retentionDays === 0
      ? null
      : new Date(now.getTime() + limits.retentionDays * 86_400_000);
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
    periods: string[];
    on_dashboard: boolean;
  }>(
    `select id, account_id, company_id, file_name, byte_size::text as byte_size, chunk_count, cardinality(stored_chunks) as chunks_stored,
            status, refusal, sheet_count, row_count::text as row_count, periods, on_dashboard
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
    periods: u.periods,
    onDashboard: u.on_dashboard,
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
  input: {
    accountId: string;
    uploadId: string;
    /** Why it is being opened. Written to the read log before a byte is decrypted. */
    purpose: ReadPurpose;
    jobId?: string | null;
  },
): Promise<{ upload: UploadRow; bytes: Buffer }> {
  const upload = await getUpload(pool, input.accountId, input.uploadId);
  if (upload.chunksStored < upload.chunkCount)
    throw new UploadError("upload_incomplete", "This file has not finished uploading.");
  // Recorded first: a read that failed half way still happened as far as its owner is concerned.
  await pool.query(
    `insert into source_upload_reads (upload_id, account_id, company_id, purpose, job_id)
     values ($1, $2, $3, $4, $5)`,
    [upload.id, upload.accountId, upload.companyId, input.purpose, input.jobId ?? null],
  );
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

/** What a run learnt about its files: the months each one fed. Replaces what was recorded before. */
export async function recordUploadPeriods(
  pool: Pool,
  input: { accountId: string; periods: ReadonlyMap<string, readonly string[]> },
): Promise<void> {
  for (const [uploadId, periods] of input.periods)
    await pool.query(
      `update source_uploads set periods = $3, updated_at = now()
       where id = $1 and account_id = $2 and deleted_at is null`,
      [uploadId, input.accountId, [...new Set(periods)].sort()],
    );
}

/** The customer's tick. A view filter: nothing is read, computed or charged. */
export async function setUploadOnDashboard(
  pool: Pool,
  input: { accountId: string; uploadId: string; onDashboard: boolean },
): Promise<void> {
  const r = await pool.query(
    // A deleted file's row remains, and so does its tick: see `hiddenPeriods`.
    `update source_uploads set on_dashboard = $3, updated_at = now()
     where id = $1 and account_id = $2`,
    [input.uploadId, input.accountId, input.onDashboard],
  );
  if (r.rowCount !== 1) throw new UploadError("upload_not_found", "Upload not found.");
}

export interface CompanyFile {
  readonly id: string;
  readonly fileName: string;
  readonly byteSize: number;
  readonly uploadedAt: Date;
  /** Null: kept until deleted. */
  readonly expiresAt: Date | null;
  /** False for a file that arrived but could not be read. It is still stored, and still its owner's to delete. */
  readonly usable: boolean;
  readonly periods: readonly string[];
  readonly onDashboard: boolean;
  /** How many times it has been decrypted, and the last time and reason. */
  readonly reads: number;
  readonly lastRead: { readonly purpose: ReadPurpose; readonly at: Date } | null;
}

/** A company's stored files, newest first, each with its own read record. */
export async function companyFiles(
  pool: Pool,
  input: { accountId: string; companyId: string },
): Promise<CompanyFile[]> {
  const r = await pool.query<{
    id: string;
    file_name: string;
    byte_size: string;
    created_at: Date;
    expires_at: Date | null;
    status: string;
    periods: string[];
    on_dashboard: boolean;
    reads: string;
    last_purpose: ReadPurpose | null;
    last_at: Date | null;
  }>(
    `select u.id, u.file_name, u.byte_size::text as byte_size, u.created_at, u.expires_at, u.status,
            u.periods, u.on_dashboard,
            (select count(*) from source_upload_reads r where r.upload_id = u.id)::text as reads,
            l.purpose as last_purpose, l.read_at as last_at
     from source_uploads u
     left join lateral (
       select purpose, read_at from source_upload_reads r
        where r.upload_id = u.id order by read_at desc, id desc limit 1
     ) l on true
     where u.company_id = $1 and u.account_id = $2 and u.deleted_at is null and u.status <> 'uploading'
     order by u.created_at desc, u.file_name
     limit 500`,
    [input.companyId, input.accountId],
  );
  return r.rows.map((u) => ({
    id: u.id,
    fileName: u.file_name,
    byteSize: Number.parseInt(u.byte_size, 10),
    uploadedAt: u.created_at,
    expiresAt: u.expires_at,
    usable: u.status === "ready",
    periods: u.periods,
    onDashboard: u.on_dashboard,
    reads: Number.parseInt(u.reads, 10),
    lastRead:
      u.last_purpose === null || u.last_at === null
        ? null
        : { purpose: u.last_purpose, at: u.last_at },
  }));
}

/**
 * The months the dashboard leaves out: those fed only by files the customer has unticked. A month
 * that any ticked file fed stays, and so does a month no stored file accounts for (it came from a
 * file from before files recorded their months) — there is no tick to honour.
 *
 * **Deleting a file does not change what is hidden.** The bytes go; the row, its months and its
 * tick stay. Otherwise unticking a bad April and then deleting it to be safe would bring April's
 * figures back, with no file left to check them against. The dashboard still lists it, as
 * deleted, so the months can be shown again on purpose.
 */
export async function hiddenPeriods(
  pool: Pool,
  input: { accountId: string; companyId: string },
): Promise<Set<string>> {
  const r = await pool.query<{ period: string }>(
    `select p.period
     from source_uploads u cross join lateral unnest(u.periods) as p(period)
     where u.company_id = $1 and u.account_id = $2
     group by p.period
     having bool_and(not u.on_dashboard)`,
    [input.companyId, input.accountId],
  );
  return new Set(r.rows.map((x) => x.period));
}

/** The files that decide what the dashboard shows: every one a run read, deleted or not. */
export async function dashboardFiles(
  pool: Pool,
  input: { accountId: string; companyId: string },
): Promise<
  {
    id: string;
    fileName: string;
    periods: string[];
    onDashboard: boolean;
    deleted: boolean;
  }[]
> {
  const r = await pool.query<{
    id: string;
    file_name: string;
    periods: string[];
    on_dashboard: boolean;
    deleted: boolean;
  }>(
    `select id, file_name, periods, on_dashboard, deleted_at is not null as deleted
     from source_uploads
     where company_id = $1 and account_id = $2 and cardinality(periods) > 0
       -- A deleted file is listed only while it is hiding something; ticked, it is just gone.
       and (deleted_at is null or not on_dashboard)
     order by created_at desc, file_name limit 500`,
    [input.companyId, input.accountId],
  );
  return r.rows.map((u) => ({
    id: u.id,
    fileName: u.file_name,
    periods: u.periods,
    onDashboard: u.on_dashboard,
    deleted: u.deleted,
  }));
}
