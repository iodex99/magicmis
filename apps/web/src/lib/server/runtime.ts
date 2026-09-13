import "server-only";

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { LocalKeyWrapper, type KeyWrapper } from "@magicmis/crypto";
import { KmsKeyWrapper } from "@magicmis/crypto/kms";
import { SupabaseOutputStore, type OutputStore } from "@magicmis/jobs";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { appPublicEnv, serverEnv } from "../env";

/**
 * Server runtime for company memory and outputs (ADR 0008, ADR 0021).
 *
 * - Key wrapper: AWS KMS in every deployed environment. `KEY_WRAPPER=local` with
 *   `LOCAL_MASTER_KEY` is accepted only when `NEXT_PUBLIC_ENVIRONMENT=development`.
 * - Output store: the private Supabase Storage bucket `outputs`. `OUTPUT_STORE=local` writes
 *   sealed files under `.data/outputs`, again development only (the local stack runs without
 *   the storage service).
 */

const localSchema = z.object({
  KEY_WRAPPER: z.enum(["kms", "local"]).default("kms"),
  LOCAL_MASTER_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "base64 of 32 bytes")
    .optional(),
  OUTPUT_STORE: z.enum(["supabase", "local"]).default("supabase"),
});

let wrapper: KeyWrapper | undefined;
let store: OutputStore | undefined;

function runtimeEnv() {
  const env = localSchema.parse(process.env);
  const development = appPublicEnv().NEXT_PUBLIC_ENVIRONMENT === "development";
  if ((env.KEY_WRAPPER === "local" || env.OUTPUT_STORE === "local") && !development) {
    throw new Error("local key wrapper and output store are allowed only in development");
  }
  return env;
}

export function keyWrapper(): KeyWrapper {
  if (wrapper !== undefined) return wrapper;
  const env = runtimeEnv();
  if (env.KEY_WRAPPER === "local") {
    if (env.LOCAL_MASTER_KEY === undefined)
      throw new Error("LOCAL_MASTER_KEY is required for the local key wrapper");
    wrapper = LocalKeyWrapper.fromBase64(env.LOCAL_MASTER_KEY);
  } else {
    const s = serverEnv();
    wrapper = new KmsKeyWrapper(s.KMS_MASTER_KEY_ID, { region: s.AWS_REGION });
  }
  return wrapper;
}

class LocalFileOutputStore implements OutputStore {
  constructor(private readonly root: string) {}
  private file(p: string): string {
    const resolved = path.resolve(this.root, p);
    if (!resolved.startsWith(path.resolve(this.root)))
      throw new Error("path escapes the output root");
    return resolved;
  }
  async put(p: string, bytes: Buffer): Promise<void> {
    const f = this.file(p);
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, bytes, { flag: "wx" });
  }
  get(p: string): Promise<Buffer> {
    return readFile(this.file(p));
  }
  async remove(paths: readonly string[]): Promise<void> {
    for (const p of paths) await rm(this.file(p), { force: true });
  }
}

let bucketChecked = false;

export async function outputStore(): Promise<OutputStore> {
  if (store !== undefined) return store;
  const env = runtimeEnv();
  if (env.OUTPUT_STORE === "local") {
    store = new LocalFileOutputStore(path.resolve(process.cwd(), ".data", "outputs"));
    return store;
  }
  const client = createClient(
    appPublicEnv().NEXT_PUBLIC_SUPABASE_URL,
    serverEnv().SUPABASE_SECRET_KEY,
    {
      auth: { persistSession: false },
    },
  );
  if (!bucketChecked) {
    // storage-js 2.116.0: getBucket(id) and createBucket(id, { public }).
    const existing = await client.storage.getBucket("outputs");
    if (existing.error !== null) {
      const created = await client.storage.createBucket("outputs", { public: false });
      if (created.error !== null && !/already exists/iu.test(created.error.message))
        throw new Error(created.error.message);
    }
    bucketChecked = true;
  }
  store = new SupabaseOutputStore(client.storage.from("outputs"));
  return store;
}
