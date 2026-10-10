import { db } from "@/lib/db";
import { apiError, ok, withAccount } from "@/lib/http";
import { checkLogo, megabytes } from "@/lib/logo";
import {
  brandLogoUrl,
  clearBrandLogo,
  readBrandLogo,
  setBrandLogo,
} from "@/lib/server/brand";
import { logoLimits } from "@/lib/server/logo";
import { keyWrapper } from "@/lib/server/runtime";
import { readBinaryBody } from "@/lib/server/uploads";

/**
 * GET /api/account/brand/logo — the preparer's logo, for its own signed-in owner only
 * (ADR 0087). Asked for by version and immutable for it, like a company's logo (ADR 0080).
 */
export async function GET(request: Request): Promise<Response> {
  return withAccount(async (account) => {
    const logo = await readBrandLogo(db(), keyWrapper(), account.accountId);
    if (logo === null) return apiError(404, "logo_not_found", "There is no logo.");
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
 * PUT /api/account/brand/logo — the logo as raw bytes, judged exactly as a company's is: JPG, PNG
 * or WebP by its own signature, within the configured size and sides. Replacing is setting, so it
 * takes no idempotency key.
 */
export async function PUT(request: Request): Promise<Response> {
  return withAccount(async (account) => {
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
    const version = await setBrandLogo(pool, keyWrapper(), {
      accountId: account.accountId,
      type: checked.type,
      bytes: body.bytes,
    });
    return ok({ url: brandLogoUrl(version) });
  });
}

/** DELETE /api/account/brand/logo — takes the logo off; the name stands alone. */
export async function DELETE(): Promise<Response> {
  return withAccount(async (account) => {
    await clearBrandLogo(db(), account.accountId);
    return ok({ removed: true });
  });
}
