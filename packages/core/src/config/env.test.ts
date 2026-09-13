import { describe, expect, it } from "vitest";

import { EnvValidationError, loadPublicEnv, loadServerEnv } from "./env";

const VALID_SERVER = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://localhost:5432/magicmis",
  SUPABASE_SECRET_KEY: "sb_secret_test_key",
  ANTHROPIC_API_KEY: "sk-ant-test-key",
  RAZORPAY_KEY_ID: "rzp_test_id",
  RAZORPAY_KEY_SECRET: "rzp_test_secret",
  RAZORPAY_WEBHOOK_SECRET: "whsec",
  KMS_MASTER_KEY_ID: "alias/magicmis-master",
  AWS_REGION: "ap-south-1",
  RESEND_API_KEY: "re_test_key_123",
  EMAIL_FROM: "noreply@example.com",
} as const;

const VALID_PUBLIC = {
  NEXT_PUBLIC_APP_URL: "https://app.example.com",
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_key",
  NEXT_PUBLIC_ENVIRONMENT: "development",
} as const;

describe("environment validation (SPEC §4 — refuse to start on invalid config)", () => {
  it("accepts a complete configuration", () => {
    expect(loadServerEnv({ ...VALID_SERVER })).toMatchObject({
      DATABASE_URL: VALID_SERVER.DATABASE_URL,
      LOG_LEVEL: "info", // default applied
    });
    expect(loadPublicEnv({ ...VALID_PUBLIC })).toMatchObject(VALID_PUBLIC);
  });

  it("throws rather than starting when a required secret is missing", () => {
    const { ANTHROPIC_API_KEY: _omitted, ...incomplete } = VALID_SERVER;
    expect(() => loadServerEnv(incomplete)).toThrow(EnvValidationError);
  });

  it("throws when a required secret is present but empty", () => {
    expect(() => loadServerEnv({ ...VALID_SERVER, KMS_MASTER_KEY_ID: "" })).toThrow(
      EnvValidationError,
    );
  });

  it("names the offending variables but never echoes their values", () => {
    // A crash log that prints the value of a bad ANTHROPIC_API_KEY has leaked it.
    const secret = "sk-ant-super-secret-value";
    try {
      loadServerEnv({
        ...VALID_SERVER,
        EMAIL_FROM: "not-an-email",
        ANTHROPIC_API_KEY: secret,
      });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const e = error as EnvValidationError;
      expect(e.variables).toContain("EMAIL_FROM");
      expect(e.message).toContain("EMAIL_FROM");
      expect(e.message).not.toContain(secret);
      expect(e.message).not.toContain("not-an-email");
    }
  });

  it("reports every invalid variable at once, not just the first", () => {
    try {
      loadServerEnv({
        ...VALID_SERVER,
        EMAIL_FROM: "bad",
        DATABASE_URL: "",
        SENTRY_DSN: "bad",
      });
      expect.unreachable("should have thrown");
    } catch (error) {
      const e = error as EnvValidationError;
      expect(e.variables).toEqual(
        expect.arrayContaining(["DATABASE_URL", "EMAIL_FROM", "SENTRY_DSN"]),
      );
    }
  });

  it("rejects a malformed URL", () => {
    expect(() =>
      loadPublicEnv({ ...VALID_PUBLIC, NEXT_PUBLIC_APP_URL: "not a url" }),
    ).toThrow(EnvValidationError);
  });

  it("rejects an unknown environment name", () => {
    expect(() =>
      loadPublicEnv({ ...VALID_PUBLIC, NEXT_PUBLIC_ENVIRONMENT: "prod" }),
    ).toThrow(EnvValidationError);
  });

  it("requires a Resend API key of the right shape (ADR 0010)", () => {
    const { RESEND_API_KEY: _omitted, ...withoutKey } = VALID_SERVER;
    expect(() => loadServerEnv(withoutKey)).toThrow(EnvValidationError);
    expect(() => loadServerEnv({ ...VALID_SERVER, RESEND_API_KEY: "not-a-key" })).toThrow(
      EnvValidationError,
    );
  });

  it("accepts EMAIL_FROM with or without a display name", () => {
    expect(() =>
      loadServerEnv({
        ...VALID_SERVER,
        EMAIL_FROM: "Product <noreply@mail.example.com>",
      }),
    ).not.toThrow();
    expect(() =>
      loadServerEnv({ ...VALID_SERVER, EMAIL_FROM: "noreply@example.com" }),
    ).not.toThrow();
    expect(() =>
      loadServerEnv({ ...VALID_SERVER, EMAIL_FROM: "Product <nope>" }),
    ).toThrow(EnvValidationError);
  });

  it("accepts a KMS key ARN or alias, and rejects anything else (ADR 0008)", () => {
    const arn =
      "arn:aws:kms:ap-south-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab";
    expect(() =>
      loadServerEnv({ ...VALID_SERVER, KMS_MASTER_KEY_ID: arn }),
    ).not.toThrow();
    expect(() =>
      loadServerEnv({ ...VALID_SERVER, KMS_MASTER_KEY_ID: "kms-key-1" }),
    ).toThrow(EnvValidationError);
  });

  it("requires AWS_REGION to be pinned rather than inferred (ADR 0008)", () => {
    const { AWS_REGION: _omitted, ...withoutRegion } = VALID_SERVER;
    expect(() => loadServerEnv(withoutRegion)).toThrow(EnvValidationError);
    expect(() => loadServerEnv({ ...VALID_SERVER, AWS_REGION: "mumbai" })).toThrow(
      EnvValidationError,
    );
  });

  it("keeps AWS_ROLE_ARN optional but validates it when present", () => {
    expect(() => loadServerEnv({ ...VALID_SERVER })).not.toThrow();
    expect(() =>
      loadServerEnv({
        ...VALID_SERVER,
        AWS_ROLE_ARN: "arn:aws:iam::111122223333:role/magicmis-web",
      }),
    ).not.toThrow();
    // A user ARN is not a role: assuming it is how long-lived keys creep back in.
    expect(() =>
      loadServerEnv({
        ...VALID_SERVER,
        AWS_ROLE_ARN: "arn:aws:iam::111122223333:user/dev",
      }),
    ).toThrow(EnvValidationError);
  });

  it("keeps SENTRY_DSN optional", () => {
    expect(() => loadServerEnv({ ...VALID_SERVER })).not.toThrow();
    expect(
      loadServerEnv({ ...VALID_SERVER, SENTRY_DSN: "https://x@sentry.io/1" }),
    ).toMatchObject({
      SENTRY_DSN: "https://x@sentry.io/1",
    });
  });

  it("keeps no secret in the public schema (SPEC §30)", () => {
    // Anything server-only appearing in the public schema would ship to the browser.
    const publicKeys = Object.keys(loadPublicEnv({ ...VALID_PUBLIC }));
    for (const key of publicKeys) {
      expect(key.startsWith("NEXT_PUBLIC_"), key).toBe(true);
    }
    expect(publicKeys).not.toContain("ANTHROPIC_API_KEY");
  });
});
