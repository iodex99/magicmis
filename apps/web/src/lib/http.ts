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
import { readConfig } from "@magicmis/db/config";
import type { ChainValue } from "@magicmis/core/hashchain";
import { clientIp } from "@magicmis/core/security-headers";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "./db";
import { rateLimited } from "./server/ratelimit";
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
  session_not_claimed: { status: 401, message: "Sign in again to continue." },
  session_superseded: {
    status: 401,
    message: "You were signed out because this account signed in elsewhere.",
  },
};

export async function requestMeta(): Promise<{ ip: string | null; userAgent: string }> {
  const h = await headers();
  // Only proxy-added values; never a client-settable header (SPEC §30).
  return { ip: clientIp((name) => h.get(name)), userAgent: h.get("user-agent") ?? "" };
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
  // SPEC §30: a per-IP ceiling on the authenticated API, before any account lookup.
  const { ip } = await requestMeta();
  const limited = await rateLimited("api_per_ip", ip ?? "unknown");
  if (limited !== null) return limited;
  const decision = await requireAccount(db(), await currentClaims());
  if (!decision.ok) {
    const refusal = REFUSAL[decision.reason];
    return apiError(refusal.status, decision.reason, refusal.message);
  }
  return handler(decision.account);
}

/**
 * Read a JSON body, refusing it above `api.max_json_body_bytes` — or a route's own limit derived from
 * its config (SPEC §7, §30). The stream is read incrementally and abandoned as soon as it passes the
 * limit, so an oversize body is never buffered.
 */
export async function readJsonBody(
  request: Request,
  options: { maxBytes?: number; tooLargeMessage?: string } = {},
): Promise<{ ok: true; raw: unknown } | { ok: false; response: Response }> {
  const max =
    options.maxBytes ??
    (await readConfig(db(), "api.max_json_body_bytes", z.number().int().positive()));
  const tooLarge = () =>
    apiError(
      413,
      "payload_too_large",
      options.tooLargeMessage ?? "The request is larger than the allowed size.",
    );
  // A cross-site form can post `text/plain` without a preflight, and a body that happens to
  // parse as JSON would then be acted on as if the page had sent it. Requiring the JSON
  // content type forces a preflight the browser will not grant to another origin.
  const type = (request.headers.get("content-type") ?? "")
    .split(";")[0]
    ?.trim()
    .toLowerCase();
  if (type !== "application/json") {
    return {
      ok: false,
      response: apiError(
        415,
        "unsupported_media_type",
        "Send the request body as application/json.",
      ),
    };
  }
  const declared = request.headers.get("content-length");
  if (declared !== null && /^\d+$/u.test(declared) && BigInt(declared) > BigInt(max))
    return { ok: false, response: tooLarge() };
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (request.body !== null) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        return { ok: false, response: tooLarge() };
      }
      chunks.push(value);
    }
  }
  try {
    return {
      ok: true,
      raw: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown,
    };
  } catch {
    return {
      ok: false,
      response: apiError(400, "invalid_json", "The request body is not valid JSON."),
    };
  }
}

export async function parseJson<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<
  { ok: true; data: z.infer<S>; raw: unknown } | { ok: false; response: Response }
> {
  const body = await readJsonBody(request);
  if (!body.ok) return body;
  const raw = body.raw;
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
