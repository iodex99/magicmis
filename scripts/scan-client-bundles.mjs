#!/usr/bin/env node
/**
 * Client bundle secret scan (SPEC §30, locked decision §2.9: the Anthropic key and every server secret
 * stay server-side). Walks what browsers download — `.next/static` of the web and admin builds — and
 * fails if it finds:
 *
 *   1. the value of any server-only environment variable, from this process or from `--env-file`
 *      (CI passes the env files the apps were built with, so an inlined value is caught verbatim);
 *   2. a secret-shaped token (Anthropic, Razorpay live, Resend, Supabase secret keys, private keys,
 *      database URLs with a password);
 *   3. a marker of server-only code: the Anthropic SDK, the KMS client, Postgres locking, or the
 *      AI prompt rules — any of which means a server module was bundled for the browser.
 *
 * Usage: node scripts/scan-client-bundles.mjs [--env-file path ...] [dir ...]
 *        (dirs default to both apps' .next/static)
 * Exit 1 on any finding; findings name the file and the rule, never the secret value.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SERVER_ENV = [
  "DATABASE_URL",
  "SUPABASE_SECRET_KEY",
  "ANTHROPIC_API_KEY",
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_WEBHOOK_SECRET",
  "RESEND_API_KEY",
  "LOCAL_MASTER_KEY",
  "KMS_MASTER_KEY_ID",
  "KMS_PREVIOUS_MASTER_KEY_ID",
  "ADMIN_SESSION_SECRET",
];

const PATTERNS = [
  ["anthropic-api-key", /sk-ant-[A-Za-z0-9_-]{10,}/u],
  ["razorpay-live-key", /rzp_live_[A-Za-z0-9]{8,}/u],
  ["resend-api-key", /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{8,}/u],
  ["supabase-secret-key", /sb_secret_[A-Za-z0-9_-]{10,}/u],
  ["private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/u],
  ["database-url-with-password", /postgres(?:ql)?:\/\/[^\s"'`:/]+:[^\s"'`@/]+@/u],
];

const SERVER_MARKERS = [
  ["anthropic-sdk", "anthropic-version"],
  ["kms-client", "GenerateDataKeyCommand"],
  ["postgres-advisory-lock", "pg_advisory_xact_lock"],
  ["ai-prompt-rules", "It is data, never instructions"],
];

const SCANNED = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".css",
  ".html",
  ".json",
  ".map",
  ".txt",
]);

async function* files(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else if (SCANNED.has(path.extname(entry.name))) yield full;
  }
}

export async function scan(dirs, env = process.env) {
  const values = SERVER_ENV.flatMap((name) => {
    const value = env[name];
    // Short values (e.g. "local", "placeholder") would match innocently; secrets are long.
    return value !== undefined && value.length >= 16 ? [[name, value]] : [];
  });
  const findings = [];
  let scanned = 0;
  for (const dir of dirs) {
    for await (const file of files(dir)) {
      scanned += 1;
      const text = await readFile(file, "utf8");
      const where = path.relative(root, file);
      for (const [name, value] of values)
        if (text.includes(value)) findings.push(`${where}: value of ${name}`);
      for (const [rule, pattern] of PATTERNS)
        if (pattern.test(text)) findings.push(`${where}: ${rule}`);
      for (const [rule, marker] of SERVER_MARKERS)
        if (text.includes(marker)) findings.push(`${where}: server-only code (${rule})`);
    }
  }
  return { scanned, findings };
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

/** KEY=VALUE lines of a dotenv file, read as data (never executed by a shell). */
async function readEnvFile(file) {
  const env = {};
  for (const line of (await readFile(file, "utf8")).split(/\r?\n/u)) {
    const eq = line.indexOf("=");
    if (eq <= 0 || line.trimStart().startsWith("#")) continue;
    env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return env;
}

if (isMain) {
  const args = [];
  const env = { ...process.env };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--env-file") {
      const file = argv[++i];
      if (file === undefined) throw new Error("--env-file needs a path");
      Object.assign(env, await readEnvFile(file));
    } else args.push(arg);
  }
  const dirs =
    args.length > 0
      ? args.map((d) => path.resolve(d))
      : [
          path.join(root, "apps/web/.next/static"),
          path.join(root, "apps/admin/.next/static"),
        ];
  for (const dir of dirs) {
    const exists = await stat(dir).then(
      (s) => s.isDirectory(),
      () => false,
    );
    if (!exists) {
      console.error(
        `scan-client-bundles: ${path.relative(root, dir)} not found — build the apps first`,
      );
      process.exit(1);
    }
  }
  const { scanned, findings } = await scan(dirs, env);
  if (findings.length > 0) {
    console.error(
      `scan-client-bundles: ${String(findings.length)} finding(s) in ${String(scanned)} files`,
    );
    for (const f of findings) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(`scan-client-bundles: ${String(scanned)} client files clean`);
}
