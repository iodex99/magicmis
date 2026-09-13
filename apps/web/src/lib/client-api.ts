"use client";

/**
 * Browser-side API calls. Every mutating call carries an Idempotency-Key (SPEC §4), made
 * once per logical submission so a double-click or network retry is one effect.
 */

export interface ApiFailure {
  readonly ok: false;
  readonly status: number;
  readonly error: string;
  readonly message: string;
  readonly fields: Record<string, string>;
}

export type ApiResult<T> = { readonly ok: true; readonly data: T } | ApiFailure;

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

/**
 * A text field from a submitted form. `FormData.get` can return a File for file inputs;
 * those are never read as text here.
 */
export function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; idempotencyKey?: string } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.idempotencyKey) headers["idempotency-key"] = init.idempotencyKey;

  let response: Response;
  try {
    response = await fetch(path, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return {
      ok: false,
      status: 0,
      error: "network",
      message: "Could not reach the server. Check your connection and try again.",
      fields: {},
    };
  }

  const payload: unknown = await response.json().catch(() => null);
  if (response.ok) return { ok: true, data: payload as T };

  const body = (payload ?? {}) as {
    error?: string;
    message?: string;
    fields?: Record<string, string>;
  };
  // SPEC §8: an old tab learns it was superseded and says so plainly.
  if (body.error === "session_superseded" && typeof window !== "undefined") {
    window.location.assign("/signed-out?reason=elsewhere");
  }
  return {
    ok: false,
    status: response.status,
    error: body.error ?? "unknown",
    message: body.message ?? "Something went wrong. Try again.",
    fields: body.fields ?? {},
  };
}
