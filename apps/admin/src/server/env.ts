/**
 * Admin console environment (SPEC §4, §26). Validated at first use; invalid config refuses.
 *
 * The allowlist lives in the environment, not the database: an attacker who can write to
 * the database still cannot mint an admin.
 */

import {
  EnvValidationError,
  publicEnvSchema,
  serverEnvSchema,
} from "@magicmis/core/config";
import { z } from "zod";

const emailList = z
  .string()
  .min(3)
  .refine(
    (v) => v.split(",").every((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(e.trim())),
    "comma-separated email addresses",
  );

export const adminEnvSchema = z
  .object({
    NODE_ENV: serverEnvSchema.shape.NODE_ENV,
    /** The deployment, not the build mode: `next start` locally is still development. */
    APP_ENVIRONMENT: publicEnvSchema.shape.NEXT_PUBLIC_ENVIRONMENT,
    DATABASE_URL: serverEnvSchema.shape.DATABASE_URL,
    LOG_LEVEL: serverEnvSchema.shape.LOG_LEVEL,
    ADMIN_ALLOWED_EMAILS: emailList,
    /** Optional: comma-separated client IPs. Unset means no IP restriction. */
    ADMIN_IP_ALLOWLIST: z.string().optional(),
    /** `kms` in production (ADR 0008); `local` only for development and tests. */
    KEY_WRAPPER: z.enum(["kms", "local"]),
    LOCAL_MASTER_KEY: z
      .string()
      .refine((v) => Buffer.from(v, "base64").length === 32, "base64 of 32 bytes")
      .optional(),
    KMS_MASTER_KEY_ID: serverEnvSchema.shape.KMS_MASTER_KEY_ID.optional(),
    AWS_REGION: serverEnvSchema.shape.AWS_REGION.optional(),
  })
  .superRefine((env, ctx) => {
    if (env.KEY_WRAPPER === "local") {
      if (env.APP_ENVIRONMENT !== "development") {
        ctx.addIssue({
          code: "custom",
          path: ["KEY_WRAPPER"],
          message: "local key wrapper is allowed only in development",
        });
      }
      if (env.LOCAL_MASTER_KEY === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["LOCAL_MASTER_KEY"],
          message: "required for the local key wrapper",
        });
      }
    } else {
      if (env.KMS_MASTER_KEY_ID === undefined)
        ctx.addIssue({
          code: "custom",
          path: ["KMS_MASTER_KEY_ID"],
          message: "required",
        });
      if (env.AWS_REGION === undefined)
        ctx.addIssue({ code: "custom", path: ["AWS_REGION"], message: "required" });
    }
  });

export type AdminEnv = z.infer<typeof adminEnvSchema>;

export function loadAdminEnv(
  source: Record<string, string | undefined> = process.env,
): AdminEnv {
  const result = adminEnvSchema.safeParse(source);
  if (result.success) return result.data;
  throw new EnvValidationError(
    [...new Set(result.error.issues.map((i) => i.path.join(".") || "<root>"))].sort(),
  );
}
