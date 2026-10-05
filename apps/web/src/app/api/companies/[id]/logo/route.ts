import { z } from "zod";

import { db } from "@/lib/db";
import { apiError, ok, withAccount } from "@/lib/http";
import { checkLogo, megabytes } from "@/lib/logo";
import {
  clearCompanyLogo,
  logoLimits,
  readCompanyLogo,
  setCompanyLogo,
} from "@/lib/server/logo";
import { keyWrapper } from "@/lib/server/runtime";
import { readBinaryBody } from "@/lib/server/uploads";

type Ctx = { params: Promise<{ id: string }> };

const notFound = () => apiError(404, "company_not_found", "Company not found.");

/**
 * GET /api/companies/:id/logo — the company's logo, for its own signed-in owner only.
 *
 * Asked for by version (`?v=`), and that version is immutable: a replaced logo gets a new one, so
 * the browser may keep this for good and only an upload costs a key unwrap. The type is the one the
 * server read from the bytes, and the response may not be sniffed into anything else.
 */
export async function GET(request: Request, context: Ctx): Promise<Response> {
  return withAccount(async (account) => {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) return notFound();
    const logo = await readCompanyLogo(db(), keyWrapper(), {
      accountId: account.accountId,
      companyId: id,
    });
    if (logo === null)
      return apiError(404, "logo_not_found", "This company has no logo.");
    const asked = new URL(request.url).searchParams.get("v");
    return new Response(new Uint8Array(logo.bytes), {
      status: 200,
      headers: {
        "content-type": logo.type,
        "content-length": logo.bytes.byteLength.toString(),
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
        "cache-control":
          asked === logo.version
            ? "private, max-age=31536000, immutable"
            : "private, no-store",
      },
    });
  });
}

/**
 * PUT /api/companies/:id/logo — the logo as raw bytes: JPG, PNG or WebP, within the configured
 * size. Replacing is the same as setting, so a retry leaves the same logo on the company; it
 * creates no row and needs no idempotency key (ADR 0059).
 */
export async function PUT(request: Request, context: Ctx): Promise<Response> {
  return withAccount(async (account) => {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) return notFound();
    const pool = db();
    const limits = await logoLimits(pool);
    const body = await readBinaryBody(request, limits.maxBytes, () =>
      apiError(
        413,
        "logo_too_large",
        `A logo can be at most ${megabytes(limits.maxBytes)}. Save it smaller and try again.`,
      ),
    );
    if (!body.ok) return body.response;
    const checked = checkLogo(body.bytes, limits);
    if (!checked.ok) return apiError(422, checked.code, checked.message);
    const version = await setCompanyLogo(pool, keyWrapper(), {
      accountId: account.accountId,
      companyId: id,
      type: checked.type,
      bytes: body.bytes,
    });
    if (version === null) return notFound();
    return ok({ url: `/api/companies/${id}/logo?v=${version}` });
  });
}

/** DELETE /api/companies/:id/logo — takes the logo off; the company name stands alone again. */
export async function DELETE(_request: Request, context: Ctx): Promise<Response> {
  return withAccount(async (account) => {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) return notFound();
    const cleared = await clearCompanyLogo(db(), {
      accountId: account.accountId,
      companyId: id,
    });
    return cleared ? ok({ removed: true }) : notFound();
  });
}
