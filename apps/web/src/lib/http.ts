import "server-only";

import {
  requireAccount,
  type AccountContext,
  type AccountRefusal,
} from "@magicmis/accounts";
import {
  abandonIdempotent,
  beginIdempotent,
  completeIdempotent,
  idempotencyKeySchema,
  requestHash,
} from "@magicmis/db/idempotency";
import type { ChainValue } from "@magicmis/core/hashchain";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import type { z } from "zod";

import { db } from "./db";
import { supabaseForRequest } from "./supabase/server";

/** Every error response has a stable code and says what to do next (SPEC §32). */
export interface ApiError {
  readonly error: string;
  readonly message: string;
  readonly fields?: Record<string, string>;
}

export function apiError(
  status: number,
  error: string,
  message: string,
  fields?: Record<string, string>,
) {
  return NextResponse.json<ApiError>(
    fields ? { error, message, fields } : { error, message },
    {
      status,
      headers: { "cache-control": "no-store" },
    },
  );
}

export function ok<T>(body: T, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

const REFUSAL: Record<AccountRefusal, { status: number; message: string }> = {
  invalid_claims: { status: 401, message: "Your session has ended. Sign in again." },
  no_account: { status: 401, message: "Sign in to continue." },
  account_not_active: {
    status: 403,
    message: "This account is not active. Contact support to restore access.",
  },
  mfa_required: {
    status: 401,
    message: "Complete two-factor authentication to continue.",
  },
  session_not_claimed: { status: 401, message: "Sign in again to continue." },
  session_superseded: {
    status: 401,
    message: "You were signed out because this account signed in elsewhere.",
  },
};

export async function requestMeta(): Promise<{ ip: string | null; userAgent: string }> {
  const h = await headers();
  // Vercel sets x-forwarded-for; the first entry is the client. Locally it may be absent.
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip =
    forwarded !== undefined && forwarded !== ""
      ? forwarded
      : (h.get("x-real-ip") ?? null);
  return { ip, userAgent: h.get("user-agent") ?? "" };
}

export async function currentClaims(): Promise<unknown> {
  const supabase = await supabaseForRequest();
  const { data, error } = await supabase.auth.getClaims();
  if (error !== null || data === null) return null;
  return data.claims;
}

/** Authenticate and authorise, or produce the refusal response. */
export async function withAccount(
  handler: (account: AccountContext) => Promise<Response>,
): Promise<Response> {
  const decision = await requireAccount(db(), await currentClaims());
  if (!decision.ok) {
    const refusal = REFUSAL[decision.reason];
    return apiError(refusal.status, decision.reason, refusal.message);
  }
  return handler(decision.account);
}

export async function parseJson<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<
  { ok: true; data: z.infer<S>; raw: unknown } | { ok: false; response: Response }
> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return {
      ok: false,
      response: apiError(400, "invalid_json", "The request body is not valid JSON."),
    };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join(".") || "_";
      fields[path] ??= issue.message;
    }
    return {
      ok: false,
      response: apiError(
        422,
        "validation_failed",
        "Check the highlighted fields and try again.",
        fields,
      ),
    };
  }
  return { ok: true, data: parsed.data, raw };
}

/**
 * Wrap a mutating handler in Idempotency-Key semantics (SPEC §4).
 *
 * `containsSecret` responses are never stored and never replayed (migration 0013).
 */
export async function idempotent(
  request: Request,
  scope: string,
  body: unknown,
  run: () => Promise<{ status: number; body: unknown; containsSecret?: boolean }>,
): Promise<Response> {
  const parsedKey = idempotencyKeySchema.safeParse(
    request.headers.get("idempotency-key"),
  );
  if (!parsedKey.success) {
    return apiError(
      400,
      "idempotency_key_required",
      "This request needs an Idempotency-Key header. Reload the page and try again.",
    );
  }
  const key = parsedKey.data;
  const pool = db();
  const begin = await beginIdempotent(pool, scope, key, requestHash(body as ChainValue));

  switch (begin.state) {
    case "replay":
      return ok(begin.body, begin.status);
    case "replay_refused":
      return apiError(
        409,
        "already_processed",
        "This request was already completed. Its result is not shown again for security.",
      );
    case "conflict":
      return apiError(
        422,
        "idempotency_conflict",
        "This request key was already used for a different request.",
      );
    case "in_progress":
      return apiError(
        409,
        "in_progress",
        "This request is still being processed. Wait a moment and refresh.",
      );
    case "new":
      break;
  }

  try {
    const result = await run();
    await completeIdempotent(pool, scope, key, result);
    return ok(result.body, result.status);
  } catch (error) {
    await abandonIdempotent(pool, scope, key);
    throw error;
  }
}
