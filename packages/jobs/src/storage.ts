/**
 * Output storage on Supabase Storage (SPEC §24.1: "encrypted to Storage with the retention expiry").
 * Files arrive already sealed under the company data key; the bucket is private and only the
 * service role touches it.
 *
 * Written against `@supabase/storage-js` 2.116.0's declarations (`from(bucket).upload(path, body,
 * { contentType, upsert })`, `.download(path)` → `{ data: Blob | null, error }`,
 * `.remove(paths)`), typed structurally here so this package does not depend on the SDK.
 */

import type { OutputStore } from "./settle";

interface StorageError {
  readonly message: string;
}

export interface StorageBucket {
  upload(
    path: string,
    body: Uint8Array,
    options: { contentType: string; upsert: boolean },
  ): PromiseLike<{ error: StorageError | null }>;
  download(path: string): PromiseLike<{ data: Blob | null; error: StorageError | null }>;
  remove(paths: string[]): PromiseLike<{ error: StorageError | null }>;
}

export class StorageFailure extends Error {
  constructor(operation: string, message: string) {
    super(`storage ${operation} failed: ${message}`);
    this.name = "StorageFailure";
  }
}

export class SupabaseOutputStore implements OutputStore {
  constructor(private readonly bucket: StorageBucket) {}

  async put(path: string, bytes: Buffer, contentType: string): Promise<void> {
    const { error } = await this.bucket.upload(path, new Uint8Array(bytes), {
      contentType,
      upsert: false,
    });
    if (error !== null) throw new StorageFailure("upload", error.message);
  }

  async get(path: string): Promise<Buffer> {
    const { data, error } = await this.bucket.download(path);
    if (error !== null || data === null)
      throw new StorageFailure("download", error?.message ?? "no data");
    return Buffer.from(await data.arrayBuffer());
  }

  async remove(paths: readonly string[]): Promise<void> {
    if (paths.length === 0) return;
    const { error } = await this.bucket.remove([...paths]);
    if (error !== null) throw new StorageFailure("remove", error.message);
  }
}
