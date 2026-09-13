/**
 * Worker environment (SPEC §4: validated at boot; the process refuses to start otherwise).
 * The worker needs only the database, email and the public app URL for links.
 */

import {
  EnvValidationError,
  publicEnvSchema,
  serverEnvSchema,
} from "@magicmis/core/config";
import { z } from "zod";

export const workerEnvSchema = serverEnvSchema
  .pick({
    NODE_ENV: true,
    DATABASE_URL: true,
    RESEND_API_KEY: true,
    EMAIL_FROM: true,
    LOG_LEVEL: true,
    SENTRY_DSN: true,
  })
  .extend({
    APP_URL: publicEnvSchema.shape.NEXT_PUBLIC_APP_URL,
    // The admin console, linked from the daily margin email (SPEC §26).
    ADMIN_URL: publicEnvSchema.shape.NEXT_PUBLIC_APP_URL.optional(),
    // Optional: output storage for purges (SPEC §28). Without it, purge still destroys the key.
    NEXT_PUBLIC_SUPABASE_URL: publicEnvSchema.shape.NEXT_PUBLIC_SUPABASE_URL.optional(),
    SUPABASE_SECRET_KEY: serverEnvSchema.shape.SUPABASE_SECRET_KEY.optional(),
    // Commentary batches (SPEC §14): the worker calls Anthropic and opens job checkpoints.
    ANTHROPIC_API_KEY: serverEnvSchema.shape.ANTHROPIC_API_KEY.optional(),
    APP_ENVIRONMENT: publicEnvSchema.shape.NEXT_PUBLIC_ENVIRONMENT.default("production"),
    KEY_WRAPPER: z.enum(["kms", "local"]).default("kms"),
    LOCAL_MASTER_KEY: z.string().optional(),
    KMS_MASTER_KEY_ID: serverEnvSchema.shape.KMS_MASTER_KEY_ID.optional(),
    KMS_PREVIOUS_MASTER_KEY_ID: serverEnvSchema.shape.KMS_PREVIOUS_MASTER_KEY_ID,
    AWS_REGION: serverEnvSchema.shape.AWS_REGION.optional(),
  })
  .superRefine((env, ctx) => {
    if (env.KEY_WRAPPER === "local" && env.APP_ENVIRONMENT !== "development")
      ctx.addIssue({
        code: "custom",
        path: ["KEY_WRAPPER"],
        message: "local key wrapper is allowed only in development",
      });
  });

export type WorkerEnv = ReturnType<typeof workerEnvSchema.parse>;

export function loadWorkerEnv(
  source: Record<string, string | undefined> = process.env,
): WorkerEnv {
  const result = workerEnvSchema.safeParse({
    ...source,
    APP_URL: source["APP_URL"] ?? source["NEXT_PUBLIC_APP_URL"],
  });
  if (result.success) return result.data;
  throw new EnvValidationError(
    [...new Set(result.error.issues.map((i) => i.path.join(".")))].sort(),
  );
}
