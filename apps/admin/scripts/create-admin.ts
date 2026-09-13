/**
 * Bootstrap an admin (runbook: docs/runbooks/admin-access.md).
 *
 *   ADMIN_EMAIL=ops@example.com pnpm --filter @magicmis/admin create-admin
 *
 * The password is read from stdin (not argv, which lands in shell history). The TOTP secret
 * and otpauth URI are printed once for enrolment in an authenticator app and never again.
 */

import { createInterface } from "node:readline/promises";

import { PRODUCT_NAME } from "@magicmis/core/brand";
import { LocalKeyWrapper } from "@magicmis/crypto";
import { KmsKeyWrapper } from "@magicmis/crypto/kms";
import pg from "pg";

import { loadAdminEnv } from "../src/server/env";
import { createAdmin, parseAllowlist } from "../src/server/identity";

const env = loadAdminEnv();
const email = process.env["ADMIN_EMAIL"] ?? "";
if (email === "") {
  console.error("Set ADMIN_EMAIL.");
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const password = await rl.question("Password (min 14 characters): ");
rl.close();

const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  options: "-c role=service_role",
});
const wrapper =
  env.KEY_WRAPPER === "local"
    ? LocalKeyWrapper.fromBase64(env.LOCAL_MASTER_KEY ?? "")
    : new KmsKeyWrapper(
        env.KMS_MASTER_KEY_ID ?? "",
        env.AWS_REGION === undefined ? {} : { region: env.AWS_REGION },
      );

try {
  const created = await createAdmin(pool, wrapper, {
    email,
    password,
    allowlist: parseAllowlist(env.ADMIN_ALLOWED_EMAILS),
    issuer: `${PRODUCT_NAME} Admin`,
  });
  console.log(`Admin created: ${created.adminId}`);
  console.log("Add this to an authenticator app now; it will not be shown again:");
  console.log(created.otpauthUri);
} finally {
  await pool.end();
}
