/**
 * Environment validation.
 *
 * SPEC §4: environment variables are validated at boot with Zod, and **the app refuses
 * to start on invalid config**. Not a warning, not a default -- a process that starts
 * with a missing encryption key and discovers it on the first customer request has
 * already failed.
 *
 * SPEC §30: secrets are server-only. The schemas here are split so a client build
 * importing the server schema is a type error rather than a leak.
 */

import { z } from "zod";

const nonEmpty = z.string().min(1);

/** Values safe to expose to the browser. Nothing secret may be added here. */
export const publicEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  /** The anon key is designed to be public; RLS is what protects the data. */
  NEXT_PUBLIC_SUPABASE_ANON_KEY: nonEmpty,
  NEXT_PUBLIC_ENVIRONMENT: z.enum(["development", "staging", "production"]),
});

/**
 * Server-only configuration. Never imported by client code.
 *
 * `ANTHROPIC_API_KEY` lives here and nowhere else -- SPEC §2.9 makes it server-side only,
 * with no generic passthrough.
 */
export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  DATABASE_URL: nonEmpty,
  SUPABASE_SERVICE_ROLE_KEY: nonEmpty,

  ANTHROPIC_API_KEY: nonEmpty,

  RAZORPAY_KEY_ID: nonEmpty,
  RAZORPAY_KEY_SECRET: nonEmpty,
  RAZORPAY_WEBHOOK_SECRET: nonEmpty,

  /** Wraps the per-company and per-account DEKs (SPEC §10). */
  KMS_MASTER_KEY_ID: nonEmpty,

  EMAIL_API_KEY: nonEmpty,
  EMAIL_FROM: z.email(),

  SENTRY_DSN: z.url().optional(),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;

/**
 * Thrown when validation fails. Carries the offending variable names -- never their
 * values, which would put a secret into a log the moment the process crashed.
 */
export class EnvValidationError extends Error {
  readonly variables: readonly string[];

  constructor(variables: readonly string[]) {
    super(
      `Invalid environment configuration. Check: ${variables.join(", ")}. ` +
        `Refusing to start (SPEC §4).`,
    );
    this.name = "EnvValidationError";
    this.variables = variables;
  }
}

function parseOrThrow<T>(schema: z.ZodType<T>, source: Record<string, string | undefined>): T {
  const result = schema.safeParse(source);
  if (result.success) return result.data;

  // Report paths only. A Zod error message can echo the received value.
  const variables = [
    ...new Set(result.error.issues.map((i) => i.path.join(".") || "<root>")),
  ].sort();
  throw new EnvValidationError(variables);
}

export const loadPublicEnv = (
  source: Record<string, string | undefined> = process.env,
): PublicEnv => parseOrThrow(publicEnvSchema, source);

export const loadServerEnv = (
  source: Record<string, string | undefined> = process.env,
): ServerEnv => parseOrThrow(serverEnvSchema, source);
