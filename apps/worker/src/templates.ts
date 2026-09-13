/**
 * Email templates (SPEC §29): plain, branded, and never carrying financial figures from
 * customer data. Payloads hold ids and labels only; anything needed beyond that is looked
 * up by the sender (e.g. the invoice PDF attachment).
 *
 * TODO(review): R-23 — email wording pending product and legal review.
 */

import { PRODUCT_NAME } from "@magicmis/core/brand";
import { formatIstDate } from "@magicmis/core/time";
import { z } from "zod";

export interface RenderedEmail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  /** The sender attaches this invoice's PDF. */
  readonly attachInvoiceId?: string;
}

export interface TemplateContext {
  readonly appUrl: string;
}

const escapeHtml = (s: string): string =>
  s.replace(
    /[&<>"']/gu,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

function email(
  subject: string,
  paragraphs: readonly string[],
  ctx: TemplateContext,
  link?: { label: string; path: string },
): RenderedEmail {
  const url = link === undefined ? null : new URL(link.path, ctx.appUrl).toString();
  const text = [
    ...paragraphs,
    ...(url === null || link === undefined ? [] : [`${link.label}: ${url}`]),
    "",
    `— ${PRODUCT_NAME}`,
  ].join("\n\n");
  const html = [
    `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px;line-height:1.5;color:#1f1f23;max-width:560px">`,
    `<p style="font-weight:600;font-size:16px">${escapeHtml(PRODUCT_NAME)}</p>`,
    ...paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`),
    url === null || link === undefined
      ? ""
      : `<p><a href="${escapeHtml(url)}">${escapeHtml(link.label)}</a></p>`,
    `</div>`,
  ].join("");
  return { subject: `${subject} — ${PRODUCT_NAME}`, text, html };
}

const IF_NOT_YOU =
  "If this was not you, change your password and contact support immediately.";

const deviceSchema = z.object({
  device: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
});
const invoiceSchema = z.object({ invoiceId: z.uuid(), purchaseId: z.uuid() });
const lotExpirySchema = z.object({
  credits: z.string().regex(/^\d+$/u),
  expires_at: z.string(),
  days: z.number().int(),
});

/** Returns null for a type with no template: the row is suppressed, not retried forever. */
export function renderNotification(
  type: string,
  payload: unknown,
  ctx: TemplateContext,
): RenderedEmail | null {
  switch (type) {
    case "security.new_device_login": {
      const p = deviceSchema.safeParse(payload);
      const d = p.success ? p.data : {};
      const where = [d.city, d.country]
        .filter((x): x is string => typeof x === "string" && x !== "")
        .join(", ");
      return email(
        "New sign-in to your account",
        [
          `Your account was signed in from a new device${d.device ? ` (${d.device})` : ""}${where === "" ? "" : ` near ${where}`}.`,
          "Signing in there ended any other session.",
          IF_NOT_YOU,
        ],
        ctx,
        { label: "Review sign-in history", path: "/settings/security" },
      );
    }
    case "security.mfa_reset_with_backup_code":
      return email(
        "Two-factor authentication was reset",
        [
          "A backup code was used to reset two-factor authentication on your account.",
          IF_NOT_YOU,
        ],
        ctx,
        {
          label: "Security settings",
          path: "/settings/security",
        },
      );
    case "security.backup_codes_regenerated":
      return email(
        "Backup codes regenerated",
        [
          "New backup codes were generated for your account. Your previous codes no longer work.",
          IF_NOT_YOU,
        ],
        ctx,
        {
          label: "Security settings",
          path: "/settings/security",
        },
      );
    case "security.password_changed":
      return email(
        "Your password was changed",
        ["The password for your account was changed.", IF_NOT_YOU],
        ctx,
        { label: "Security settings", path: "/settings/security" },
      );
    case "security.email_changed":
      return email(
        "Your sign-in email was changed",
        ["The email address used to sign in to your account was changed.", IF_NOT_YOU],
        ctx,
        {
          label: "Security settings",
          path: "/settings/security",
        },
      );
    case "invoice_issued": {
      const p = invoiceSchema.safeParse(payload);
      if (!p.success) return null;
      return {
        ...email(
          "Payment received — your tax invoice",
          [
            "Thank you. Your credits have been added to your wallet.",
            "Your tax invoice is attached and can also be downloaded from the Wallet page.",
          ],
          ctx,
          {
            label: "Open wallet",
            path: "/wallet",
          },
        ),
        attachInvoiceId: p.data.invoiceId,
      };
    }
    case "proforma_issued": {
      const p = invoiceSchema.safeParse(payload);
      if (!p.success) return null;
      return {
        ...email(
          "Your proforma invoice for bank transfer",
          [
            "Your proforma invoice with our bank details is attached. Quote the proforma number as the transfer reference.",
            "Credits are added and a tax invoice issued once we confirm receipt.",
          ],
          ctx,
          { label: "Open wallet", path: "/wallet" },
        ),
        attachInvoiceId: p.data.invoiceId,
      };
    }
    case "billing.lot_expiry_notice": {
      const p = lotExpirySchema.safeParse(payload);
      if (!p.success) return null;
      const on = formatIstDate(new Date(p.data.expires_at));
      return email(
        `Credits expire in ${p.data.days.toString()} days`,
        [
          `${p.data.credits} credits in your wallet expire on ${on}. Unused credits cannot be refunded after expiry.`,
        ],
        ctx,
        {
          label: "Open wallet",
          path: "/wallet",
        },
      );
    }
    default:
      return null;
  }
}
