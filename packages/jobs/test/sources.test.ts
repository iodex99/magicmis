import { randomBytes } from "node:crypto";

import { startTestDb, type TestDb } from "@magicmis/db/test-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  companyFiles,
  companyStorage,
  createUpload,
  dashboardFiles,
  deleteUpload,
  finishUpload,
  getUpload,
  hiddenPeriods,
  loadUploadBytes,
  purgeExpiredUploads,
  recordUploadPeriods,
  setUploadOnDashboard,
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

    const loaded = await loadUploadBytes(pool(), wrapper, store, {
      accountId,
      uploadId,
      purpose: "run",
    });
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
    const loaded = await loadUploadBytes(pool(), wrapper, store, {
      accountId,
      uploadId,
      purpose: "run",
    });
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
      loadUploadBytes(pool(), wrapper, store, {
        accountId: owner.accountId,
        uploadId,
        purpose: "run",
      }),
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

  it("purges an upload once an operator's retention period has passed, and deletes on request", async () => {
    const { accountId, companyId } = await accountWithCompany(pool(), 0n);
    const store = new MemoryOutputStore();
    // The default keeps files (ADR 0047). An operator who must set a period still can.
    await pool().query(
      `update app_config set value = '30'::jsonb where key = 'sources.retention_days'`,
    );
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
    await pool().query(
      `update app_config set value = '0'::jsonb where key = 'sources.retention_days'`,
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

describe("files are kept, chosen for the dashboard, and every read is recorded (ADR 0047)", () => {
  async function stored(
    c: { accountId: string; companyId: string },
    store: MemoryOutputStore,
    fileName: string,
    now?: Date,
  ): Promise<string> {
    const { uploadId } = await createUpload(pool(), {
      ...c,
      fileName,
      byteSize: 3,
      ...(now === undefined ? {} : { now }),
    });
    await storeChunk(pool(), wrapper, store, {
      accountId: c.accountId,
      uploadId,
      index: 0,
      bytes: Buffer.from("abc"),
    });
    await finishUpload(pool(), {
      accountId: c.accountId,
      uploadId,
      outcome: { status: "ready", sheets: 1, rows: 1 },
    });
    return uploadId;
  }

  it("caps what one company may keep, counts only what is stored now, and leaves other companies alone", async () => {
    const c = await accountWithCompany(pool(), 0n);
    const store = new MemoryOutputStore();
    await pool().query(
      `update app_config set value = '10'::jsonb where key = 'sources.max_company_bytes'`,
    );
    try {
      const first = await stored(c, store, "a.csv"); // three bytes
      await stored(c, store, "b.csv");
      await stored(c, store, "c.csv");
      await expect(
        createUpload(pool(), { ...c, fileName: "d.csv", byteSize: 2 }),
      ).rejects.toMatchObject({ code: "storage_full" });
      expect(await companyStorage(pool(), c)).toEqual({ bytes: 9, files: 3 });
      // One byte of room is one byte of room.
      await createUpload(pool(), { ...c, fileName: "one.csv", byteSize: 1 });
      // Deleting gives the room back at once.
      await deleteUpload(pool(), store, { accountId: c.accountId, uploadId: first });
      await createUpload(pool(), { ...c, fileName: "d.csv", byteSize: 2 });
      // The cap is per company: another company of any account starts empty.
      const other = await accountWithCompany(pool(), 0n);
      await createUpload(pool(), { ...other, fileName: "x.csv", byteSize: 10 });
    } finally {
      await pool().query(
        `update app_config set value = '2147483648'::jsonb where key = 'sources.max_company_bytes'`,
      );
    }
  });

  it("keeps a file however old it is: there is no expiry to purge it by", async () => {
    const c = await accountWithCompany(pool(), 0n);
    const store = new MemoryOutputStore();
    const uploadId = await stored(c, store, "2019.csv", new Date("2019-04-01T00:00:00Z"));
    const row = await pool().query<{ expires_at: Date | null }>(
      `select expires_at from source_uploads where id = $1`,
      [uploadId],
    );
    expect(row.rows[0]?.expires_at).toBeNull();
    await purgeExpiredUploads(pool(), store);
    expect(store.files.size).toBe(1);
    expect((await getUpload(pool(), c.accountId, uploadId)).fileName).toBe("2019.csv");
  });

  it("still clears the ciphertext of a deleted company, whose key is already gone", async () => {
    const c = await accountWithCompany(pool(), 0n);
    const store = new MemoryOutputStore();
    await stored(c, store, "gone.csv");
    await pool().query(`update companies set deleted_at = now() where id = $1`, [
      c.companyId,
    ]);
    expect(await purgeExpiredUploads(pool(), store)).toBeGreaterThanOrEqual(1);
    expect(store.files.size).toBe(0);
  });

  it("records every decryption with its reason, shows it to the owner, and cannot be edited", async () => {
    const c = await accountWithCompany(pool(), 0n);
    const store = new MemoryOutputStore();
    const uploadId = await stored(c, store, "tb.csv");
    expect((await companyFiles(pool(), c))[0]).toMatchObject({
      reads: 0,
      lastRead: null,
    });

    await loadUploadBytes(pool(), wrapper, store, { ...c, uploadId, purpose: "pricing" });
    await loadUploadBytes(pool(), wrapper, store, {
      ...c,
      uploadId,
      purpose: "download",
    });
    const [file] = await companyFiles(pool(), c);
    expect(file).toMatchObject({ reads: 2, lastRead: { purpose: "download" } });

    // A read that another account attempts is refused before anything is decrypted or logged.
    const other = await accountWithCompany(pool(), 0n);
    await expect(
      loadUploadBytes(pool(), wrapper, store, {
        accountId: other.accountId,
        uploadId,
        purpose: "run",
      }),
    ).rejects.toBeInstanceOf(UploadError);
    expect((await companyFiles(pool(), c))[0]?.reads).toBe(2);

    // There is no purpose for a member of staff, and the log is append-only.
    await expect(
      pool().query(
        `insert into source_upload_reads (upload_id, account_id, company_id, purpose) values ($1, $2, $3, 'staff')`,
        [uploadId, c.accountId, c.companyId],
      ),
    ).rejects.toThrow(/check constraint/u);
    await expect(
      pool().query(`delete from source_upload_reads where upload_id = $1`, [uploadId]),
    ).rejects.toThrow(/append-only/u);
    await expect(
      pool().query(
        `update source_upload_reads set purpose = 'run' where upload_id = $1`,
        [uploadId],
      ),
    ).rejects.toThrow(/append-only/u);
  });

  it("hides a month only when every file that fed it is unticked, and only for that company", async () => {
    const c = await accountWithCompany(pool(), 0n);
    const store = new MemoryOutputStore();
    const april = await stored(c, store, "april.xlsx");
    const aprilAgain = await stored(c, store, "april-ledgers.xlsx");
    const year = await stored(c, store, "year.xlsx");
    const unused = await stored(c, store, "notes.pdf");
    await recordUploadPeriods(pool(), {
      accountId: c.accountId,
      periods: new Map([
        [april, ["2026-04"]],
        [aprilAgain, ["2026-04", "2026-04"]],
        [year, ["2026-02", "2026-03"]],
      ]),
    });
    const hidden = async () => [...(await hiddenPeriods(pool(), c))].sort();
    expect(await hidden()).toEqual([]);
    expect((await getUpload(pool(), c.accountId, aprilAgain)).periods).toEqual([
      "2026-04",
    ]);

    // One of April's two files: April stays, the other file still vouches for it.
    await setUploadOnDashboard(pool(), { ...c, uploadId: april, onDashboard: false });
    expect(await hidden()).toEqual([]);
    await setUploadOnDashboard(pool(), {
      ...c,
      uploadId: aprilAgain,
      onDashboard: false,
    });
    expect(await hidden()).toEqual(["2026-04"]);
    await setUploadOnDashboard(pool(), { ...c, uploadId: year, onDashboard: false });
    expect(await hidden()).toEqual(["2026-02", "2026-03", "2026-04"]);
    // A file that fed nothing hides nothing.
    await setUploadOnDashboard(pool(), { ...c, uploadId: unused, onDashboard: false });
    expect(await hidden()).toEqual(["2026-02", "2026-03", "2026-04"]);

    // Ticking brings a month back. Deleting an unticked file does not: its months stay hidden,
    // it stays listed (as deleted) so they can be shown again on purpose, and then it is gone.
    await setUploadOnDashboard(pool(), { ...c, uploadId: april, onDashboard: true });
    expect(await hidden()).toEqual(["2026-02", "2026-03"]);
    await deleteUpload(pool(), store, { accountId: c.accountId, uploadId: year });
    expect(await hidden()).toEqual(["2026-02", "2026-03"]);
    expect((await companyFiles(pool(), c)).map((f) => f.fileName)).not.toContain(
      "year.xlsx",
    );
    expect(
      (await dashboardFiles(pool(), c)).find((f) => f.fileName === "year.xlsx"),
    ).toMatchObject({ deleted: true, onDashboard: false });
    await setUploadOnDashboard(pool(), { ...c, uploadId: year, onDashboard: true });
    expect(await hidden()).toEqual([]);
    expect((await dashboardFiles(pool(), c)).map((f) => f.fileName)).not.toContain(
      "year.xlsx",
    );

    // Another account cannot tick this account's file, and sees none of its hidden months.
    const other = await accountWithCompany(pool(), 0n);
    await expect(
      setUploadOnDashboard(pool(), {
        accountId: other.accountId,
        uploadId: april,
        onDashboard: false,
      }),
    ).rejects.toBeInstanceOf(UploadError);
    expect([...(await hiddenPeriods(pool(), other))]).toEqual([]);
  });
});
