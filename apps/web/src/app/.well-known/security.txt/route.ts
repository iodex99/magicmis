import { absoluteUrl } from "@/lib/seo";
import { legalFacts } from "@/lib/server/legal";

/**
 * RFC 9116 — where a researcher who finds something reports it
 * (https://www.rfc-editor.org/rfc/rfc9116). `Contact` and `Expires` are the two required
 * fields.
 *
 * The contact is the support address from configuration, the same one the legal pages print.
 * Until the owner has set a real one (R-02) this answers 404: a security.txt with a
 * placeholder address is worse than none, because reports sent to it vanish.
 */
export const dynamic = "force-dynamic";

const VALID_FOR_DAYS = 180;

export async function GET(): Promise<Response> {
  const { supportEmail } = await legalFacts();
  if (supportEmail === null) return new Response("Not found", { status: 404 });

  const expires = new Date(Date.now() + VALID_FOR_DAYS * 86_400_000);
  const canonical = absoluteUrl("/.well-known/security.txt");
  const body = [
    `Contact: mailto:${supportEmail}`,
    `Expires: ${expires.toISOString()}`,
    "Preferred-Languages: en",
    ...(canonical.startsWith("http") ? [`Canonical: ${canonical}`] : []),
    "",
  ].join("\n");
  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=86400",
    },
  });
}
