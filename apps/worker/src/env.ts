/**
 * Worker environment (SPEC §4: validated at boot; the process refuses to start otherwise).
 * The worker needs only the database, email and the public app URL for links.
 */

import {
  EnvValidationError,
  publicEnvSchema,
  serverEnvSchema,
} from "@magicmis/core/config";

export const workerEnvSchema = serverEnvSchema
  .pick({
    NODE_ENV: true,
    DATABASE_URL: true,
    RESEND_API_KEY: true,
    EMAIL_FROM: true,
    LOG_LEVEL: true,
  })
  .extend({
    APP_URL: publicEnvSchema.shape.NEXT_PUBLIC_APP_URL,
    // Optional: output storage for purges (SPEC §28). Without it, purge still destroys the key.
    NEXT_PUBLIC_SUPABASE_URL: publicEnvSchema.shape.NEXT_PUBLIC_SUPABASE_URL.optional(),
    SUPABASE_SECRET_KEY: serverEnvSchema.shape.SUPABASE_SECRET_KEY.optional(),
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
