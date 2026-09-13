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

const jobPayloadSchema = z.object({
  job_id: z.uuid(),
  failure_class: z.string().optional(),
  expires_at: z.string().optional(),
});
const companyPayloadSchema = z.object({
  company_id: z.uuid(),
  company_name: z.string().max(200),
  days: z.number().int().optional(),
});

function withJob(
  payload: unknown,
  render: (p: z.infer<typeof jobPayloadSchema>) => RenderedEmail,
): RenderedEmail | null {
  const p = jobPayloadSchema.safeParse(payload);
  return p.success ? render(p.data) : null;
}

function withCompany(
  payload: unknown,
  render: (p: z.infer<typeof companyPayloadSchema>) => RenderedEmail,
): RenderedEmail | null {
  const p = companyPayloadSchema.safeParse(payload);
  return p.success ? render(p.data) : null;
}

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
    case "job.awaiting_review":
      return withJob(payload, (p) =>
        email(
          "Your mappings are ready to review",
          [
            "A job is waiting for you to confirm how your ledgers map to the MIS. Nothing is computed until you confirm.",
            "The credits for this job stay reserved while it waits.",
          ],
          ctx,
          { label: "Review mappings", path: `/app/jobs/${p.job_id}` },
        ),
      );
    case "job.review_expiring":
      return withJob(payload, (p) =>
        email(
          "Your mapping review expires soon",
          [
            `The reservation for this job expires on ${formatIstDate(new Date(p.expires_at ?? ""))}. If it expires after analysis has run, the cancellation fee applies.`,
          ],
          ctx,
          { label: "Review mappings", path: `/app/jobs/${p.job_id}` },
        ),
      );
    case "job.completed":
      return withJob(payload, (p) =>
        email(
          "Your MIS is ready",
          ["The job has completed. Your workbook is ready to download."],
          ctx,
          {
            label: "Open the job",
            path: `/app/jobs/${p.job_id}`,
          },
        ),
      );
    case "job.failed":
      return withJob(payload, (p) =>
        email(
          "A job could not be completed",
          [
            p.failure_class === "platform_fault"
              ? "The job stopped because of a problem on our side. No credits were charged."
              : "The job stopped because of a problem in the uploaded data. The diagnostic report explains what failed and how to fix it.",
          ],
          ctx,
          { label: "See what happened", path: `/app/jobs/${p.job_id}` },
        ),
      );
    case "job.quote_offered":
      return withJob(payload, (p) =>
        email(
          "A quote is waiting for your approval",
          [
            "This job needs more analysis than the standard price covers. Review the quote before it expires; nothing is charged unless you accept.",
          ],
          ctx,
          { label: "Review the quote", path: `/app/jobs/${p.job_id}` },
        ),
      );
    case "billing.memory_fee_debited":
      return withCompany(payload, (p) =>
        email(
          "Company memory fee debited",
          [`The monthly memory fee for ${p.company_name} was debited from your wallet.`],
          ctx,
          {
            label: "Open wallet",
            path: "/wallet",
          },
        ),
      );
    case "billing.memory_fee_failed":
      return withCompany(payload, (p) =>
        email(
          "Company memory fee could not be debited",
          [
            `Your wallet did not have enough credits for the monthly memory fee for ${p.company_name}. Buy credits to keep the company active.`,
          ],
          ctx,
          { label: "Buy credits", path: "/wallet" },
        ),
      );
    case "billing.low_balance_before_fee":
      return withCompany(payload, (p) =>
        email(
          "Low balance before your memory fee",
          [
            `The monthly memory fee for ${p.company_name} is due in ${String(p.days ?? "")} days and your available credits will not cover it.`,
          ],
          ctx,
          { label: "Buy credits", path: "/wallet" },
        ),
      );
    case "lifecycle.grace":
      return withCompany(payload, (p) =>
        email(
          "Company in grace period",
          [
            `${p.company_name} is in its grace period. You can view outputs and history, but new jobs and chat are paused until the fee is paid.`,
          ],
          ctx,
          { label: "Buy credits", path: "/wallet" },
        ),
      );
    case "lifecycle.archive_notice":
      return withCompany(payload, (p) =>
        email(
          "Company will be archived",
          [
            `${p.company_name} will be archived in ${String(p.days ?? "")} days unless the memory fee is paid.`,
          ],
          ctx,
          { label: "Buy credits", path: "/wallet" },
        ),
      );
    case "lifecycle.archived":
      return withCompany(payload, (p) =>
        email(
          "Company archived",
          [
            `${p.company_name} has been archived. It can be restored for the restore price plus the current month's fee.`,
          ],
          ctx,
          {
            label: "Open companies",
            path: "/app/companies",
          },
        ),
      );
    case "lifecycle.purge_notice":
      return withCompany(payload, (p) =>
        email(
          "Company data will be permanently deleted",
          [
            `${p.company_name} and all its stored data will be permanently deleted in ${String(p.days ?? "")} days.`,
          ],
          ctx,
          { label: "Open companies", path: "/app/companies" },
        ),
      );
    case "lifecycle.purged":
      return withCompany(payload, (p) =>
        email(
          "Company data deleted",
          [
            `All stored data for ${p.company_name} has been permanently deleted and cannot be recovered.`,
          ],
          ctx,
        ),
      );
    case "reminder.monthly_refresh":
      return withCompany(payload, (p) =>
        email(
          "Time for this month's MIS",
          [`Upload this month's files for ${p.company_name} to refresh its MIS.`],
          ctx,
          {
            label: "Refresh now",
            path: `/app/companies/${p.company_id}/refresh`,
          },
        ),
      );
    case "security.break_glass": {
      // SPEC §26: the account holder is told whenever support opens their data.
      const p = z
        .object({ reason: z.string().max(500), expires_at: z.string() })
        .safeParse(payload);
      if (!p.success) return null;
      return email(
        "Support accessed your account data",
        [
          `Our support team was granted temporary access to your company data until ${formatIstDate(new Date(p.data.expires_at))}.`,
          `Reason given: ${p.data.reason}`,
          "Every view is recorded. If you did not ask for help, contact us immediately.",
        ],
        ctx,
      );
    }
    case "account.deletion_scheduled": {
      const p = z.object({ purge_after: z.string() }).safeParse(payload);
      if (!p.success) return null;
      return email(
        "Your account is scheduled for deletion",
        [
          `Your account has been closed. Its company data will be permanently deleted on ${formatIstDate(new Date(p.data.purge_after))}.`,
          "Invoices and credit records are kept for the statutory retention period.",
        ],
        ctx,
      );
    }
    case "account.export_ready": {
      // SPEC §10: the link opens only for the signed-in owner and stops working at expiry.
      const p = z
        .object({ export_id: z.uuid(), expires_at: z.string() })
        .safeParse(payload);
      if (!p.success) return null;
      return email(
        "Your data export is ready",
        [
          `The export you requested is ready to download until ${formatIstDate(new Date(p.data.expires_at))}.`,
          "You will need to sign in to download it. If you did not request it, change your password and contact support.",
        ],
        ctx,
        { label: "Download export", path: "/settings/privacy" },
      );
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
