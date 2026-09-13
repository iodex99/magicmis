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
  /**
   * Supabase publishable key (`sb_publishable_…`). Designed to be public; RLS is what
   * protects the data. The legacy JWT anon key is deprecated by the end of 2026
   * (https://supabase.com/docs/guides/api/api-keys, verified 2026-09-13) and not accepted.
   */
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .regex(/^sb_publishable_[A-Za-z0-9_-]+$/u),
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
  /**
   * Supabase secret key (`sb_secret_…`): bypasses RLS, server only. Used for Auth admin
   * calls such as removing TOTP factors during backup-code recovery. The legacy
   * service_role JWT is deprecated and not accepted.
   */
  SUPABASE_SECRET_KEY: z.string().regex(/^sb_secret_[A-Za-z0-9_-]+$/u),

  ANTHROPIC_API_KEY: nonEmpty,

  RAZORPAY_KEY_ID: nonEmpty,
  RAZORPAY_KEY_SECRET: nonEmpty,
  RAZORPAY_WEBHOOK_SECRET: nonEmpty,

  /**
   * AWS KMS key that wraps the per-company and per-account DEKs (SPEC §10, ADR 0008).
   * A key ARN or an `alias/...` name. It must live in AWS_REGION.
   */
  KMS_MASTER_KEY_ID: z
    .string()
    .regex(/^(arn:aws:kms:[a-z0-9-]+:\d{12}:(key|alias)\/.+|alias\/.+)$/u),
  /**
   * Pinned explicitly, never inferred. Vercel sets AWS_REGION to the function's execution
   * region, which can change under failover and would send KMS calls to a region where
   * the key does not exist (ADR 0008).
   */
  AWS_REGION: z.string().regex(/^[a-z]{2}-[a-z]+-\d$/u),
  /**
   * IAM role assumed through Vercel OIDC federation, so no long-lived AWS access key
   * exists anywhere. Optional because the worker's container host may supply its own
   * ambient role instead (ADR 0008).
   */
  AWS_ROLE_ARN: z
    .string()
    .regex(/^arn:aws:iam::\d{12}:role\/.+$/u)
    .optional(),

  /** Resend API key (ADR 0010, superseding 0007). */
  RESEND_API_KEY: z.string().regex(/^re_[A-Za-z0-9_]+$/u),
  /**
   * Sender for every SPEC §29 email, e.g. `Product <noreply@mail.example.com>`. A bare
   * address is accepted too. Must be on a domain verified in Resend.
   */
  EMAIL_FROM: z
    .string()
    .regex(/^([^<>]+<[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+>|[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+)$/u),

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

function parseOrThrow<T>(
  schema: z.ZodType<T>,
  source: Record<string, string | undefined>,
): T {
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
