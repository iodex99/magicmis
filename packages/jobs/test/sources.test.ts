import { randomBytes } from "node:crypto";

import { startTestDb, type TestDb } from "@magicmis/db/test-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createUpload,
  deleteUpload,
  getUpload,
  loadUploadBytes,
  purgeExpiredUploads,
  storeChunk,
  UploadError,
} from "../src/sources";
import { accountWithCompany, MemoryOutputStore, wrapper } from "./helpers";

let db: TestDb | undefined;
beforeAll(async () => {
  db = await startTestDb();
  // Small chunks so a test file spans several.
  await db.pool.query(
    `update app_config set value = '1000'::jsonb where key = 'sources.chunk_bytes'`,
  );
}, 180_000);
afterAll(async () => {
  await db?.stop();
});
const pool = () => {
  if (db === undefined) throw new Error("db not started");
  return db.pool;
};

describe("uploaded source files (ADR 0032)", () => {
  it("stores a file in sealed chunks and gives back exactly the bytes sent", async () => {
    const { accountId, companyId } = await accountWithCompany(pool(), 0n);
    const store = new MemoryOutputStore();
    const file = Buffer.concat([
      Buffer.from("Particulars,Debit,Credit\nSundry Debtor Rajesh,100,\n"),
      randomBytes(2500),
    ]);
    const { uploadId, chunkCount, chunkBytes } = await createUpload(pool(), {
      accountId,
      companyId,
      fileName: "tb.csv",
      byteSize: file.length,
    });
    expect(chunkCount).toBe(Math.ceil(file.length / chunkBytes));
    for (let i = 0; i < chunkCount; i += 1) {
      await storeChunk(pool(), wrapper, store, {
        accountId,
        uploadId,
        index: i,
        bytes: file.subarray(i * chunkBytes, (i + 1) * chunkBytes),
      });
    }
    // Only ciphertext at rest: the plaintext never appears in anything stored.
    for (const stored of store.files.values())
      expect(stored.includes(Buffer.from("Sundry Debtor Rajesh"))).toBe(false);

    const loaded = await loadUploadBytes(pool(), wrapper, store, { accountId, uploadId });
    expect(loaded.bytes.equals(file)).toBe(true);
  });

  it("accepts chunks in any order and does not count a retried chunk twice", async () => {
    const { accountId, companyId } = await accountWithCompany(pool(), 0n);
    const store = new MemoryOutputStore();
    const file = randomBytes(2500);
    const { uploadId, chunkCount, chunkBytes } = await createUpload(pool(), {
      accountId,
      companyId,
      fileName: "tb.xlsx",
      byteSize: file.length,
    });
    const part = (i: number) => file.subarray(i * chunkBytes, (i + 1) * chunkBytes);
    const last = chunkCount - 1;
    const first = await storeChunk(pool(), wrapper, store, {
      accountId,
      uploadId,
      index: last,
      bytes: part(last),
    });
    expect(first).toEqual({ chunksStored: 1, complete: false });
    const retried = await storeChunk(pool(), wrapper, store, {
      accountId,
      uploadId,
      index: last,
      bytes: part(last),
    });
    expect(retried.chunksStored).toBe(1);
    for (let i = last - 1; i >= 0; i -= 1)
      await storeChunk(pool(), wrapper, store, {
        accountId,
        uploadId,
        index: i,
        bytes: part(i),
      });
    const loaded = await loadUploadBytes(pool(), wrapper, store, { accountId, uploadId });
    expect(loaded.bytes.equals(file)).toBe(true);
  });

  it("refuses another account, an incomplete file, and a chunk out of range", async () => {
    const owner = await accountWithCompany(pool(), 0n);
    const other = await accountWithCompany(pool(), 0n);
    const store = new MemoryOutputStore();
    const { uploadId } = await createUpload(pool(), {
      accountId: owner.accountId,
      companyId: owner.companyId,
      fileName: "tb.xlsx",
      byteSize: 1500,
    });
    await expect(getUpload(pool(), other.accountId, uploadId)).rejects.toBeInstanceOf(
      UploadError,
    );
    await expect(
      loadUploadBytes(pool(), wrapper, store, { accountId: owner.accountId, uploadId }),
    ).rejects.toMatchObject({ code: "upload_incomplete" });
    await expect(
      storeChunk(pool(), wrapper, store, {
        accountId: owner.accountId,
        uploadId,
        index: 7,
        bytes: Buffer.from("x"),
      }),
    ).rejects.toMatchObject({ code: "chunk_out_of_range" });
    await expect(
      createUpload(pool(), {
        accountId: other.accountId,
        companyId: owner.companyId,
        fileName: "x.csv",
        byteSize: 10,
      }),
    ).rejects.toMatchObject({ code: "upload_not_found" });
  });

  it("purges expired uploads and deletes on request", async () => {
    const { accountId, companyId } = await accountWithCompany(pool(), 0n);
    const store = new MemoryOutputStore();
    const created = await createUpload(pool(), {
      accountId,
      companyId,
      fileName: "old.csv",
      byteSize: 10,
      now: new Date("2020-01-01T00:00:00Z"),
    });
    await storeChunk(pool(), wrapper, store, {
      accountId,
      uploadId: created.uploadId,
      index: 0,
      bytes: Buffer.from("0123456789"),
    });
    expect(store.files.size).toBe(1);
    expect(await purgeExpiredUploads(pool(), store)).toBeGreaterThanOrEqual(1);
    expect(store.files.size).toBe(0);
    await expect(getUpload(pool(), accountId, created.uploadId)).rejects.toBeInstanceOf(
      UploadError,
    );

    const fresh = await createUpload(pool(), {
      accountId,
      companyId,
      fileName: "new.csv",
      byteSize: 3,
    });
    await storeChunk(pool(), wrapper, store, {
      accountId,
      uploadId: fresh.uploadId,
      index: 0,
      bytes: Buffer.from("abc"),
    });
    await deleteUpload(pool(), store, { accountId, uploadId: fresh.uploadId });
    expect(store.files.size).toBe(0);
  });
});
