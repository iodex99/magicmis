/**
 * The production Auth email settings (R-22, ADR 0073): what the hosted project must be set to for
 * sign-up confirmations and password resets to reach customers at all.
 *
 * Without custom SMTP, Supabase's own mailer sends only to the project team's addresses, two an
 * hour; every other address fails with "Email address not authorized". With custom SMTP it allows
 * thirty an hour until that is raised. Verified 2026-09-29:
 *  - https://supabase.com/docs/guides/auth/auth-smtp
 *  - https://resend.com/docs/send-with-smtp (host smtp.resend.com, user "resend", the API key as
 *    the password, port 465 implicit TLS; a verified sending domain is required)
 *  - https://supabase.com/docs/reference/api/v1-update-auth-service-config (field names)
 *
 * Pure: builds the change and judges a fetched configuration. The command that talks to the
 * Management API is `scripts/auth-email.ts`.
 */

export const RESEND_SMTP = {
  host: "smtp.resend.com",
  port: "465",
  user: "resend",
} as const;

export interface AuthEmailSettings {
  /** The production app's origin, https and without a trailing slash. */
  readonly appUrl: string;
  /** The From address, on a domain verified in Resend. */
  readonly from: string;
  readonly senderName: string;
  /** Auth emails the project may send in an hour, across every customer. */
  readonly emailsPerHour: number;
  readonly passwordMinLength: number;
  readonly templates: {
    readonly confirmation: { readonly subject: string; readonly content: string };
    readonly recovery: { readonly subject: string; readonly content: string };
  };
}

/** Why settings cannot be used, or nothing. Checked before anything is sent anywhere. */
export function authEmailSettingsProblems(s: AuthEmailSettings): string[] {
  const problems: string[] = [];
  if (!/^https:\/\/[^/\s]+$/u.test(s.appUrl))
    problems.push("the app URL must be https://host with no path or trailing slash");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(s.from) || s.from === "admin@email.com")
    problems.push(
      "the From address must be a real address on your verified sending domain",
    );
  if (!Number.isInteger(s.emailsPerHour) || s.emailsPerHour < 1)
    problems.push("the hourly email limit must be a whole number above zero");
  for (const [name, t] of Object.entries(s.templates)) {
    if (t.subject.trim() === "") problems.push(`the ${name} email has no subject`);
    if (!t.content.includes("{{ .TokenHash }}"))
      problems.push(
        `the ${name} template must be the token-hash one from supabase/templates`,
      );
  }
  return problems;
}

/** The PATCH body for `/v1/projects/{ref}/config/auth`. */
export function authEmailPatch(
  s: AuthEmailSettings,
  resendApiKey: string,
): Record<string, string | number | boolean> {
  return {
    site_url: s.appUrl,
    // The only link the product sends back to itself through Auth: the confirmation and the
    // Google or Apple return both land here (ADR 0043, ADR 0071).
    uri_allow_list: `${s.appUrl}/auth/callback`,
    // SPEC §8: an address is confirmed before it signs in.
    mailer_autoconfirm: false,
    smtp_host: RESEND_SMTP.host,
    smtp_port: RESEND_SMTP.port,
    smtp_user: RESEND_SMTP.user,
    smtp_pass: resendApiKey,
    smtp_admin_email: s.from,
    smtp_sender_name: s.senderName,
    rate_limit_email_sent: s.emailsPerHour,
    password_min_length: s.passwordMinLength,
    security_update_password_require_reauthentication: true,
    mailer_subjects_confirmation: s.templates.confirmation.subject,
    mailer_templates_confirmation_content: s.templates.confirmation.content,
    mailer_subjects_recovery: s.templates.recovery.subject,
    mailer_templates_recovery_content: s.templates.recovery.content,
  };
}

const text = (v: unknown): string =>
  typeof v === "string" ? v : typeof v === "number" ? v.toString() : "";

/**
 * Everything about a fetched configuration that would stop, slow or misdirect a customer's
 * confirmation or reset email. Empty when the project is ready.
 */
export function authEmailProblems(
  actual: Readonly<Record<string, unknown>>,
  s: AuthEmailSettings,
): string[] {
  const problems: string[] = [];
  if (text(actual["smtp_host"]) !== RESEND_SMTP.host)
    problems.push(
      "no custom SMTP: Supabase's own mailer sends only to your team's addresses, two an hour, so customers get no confirmation or reset email",
    );
  else {
    if (text(actual["smtp_port"]) !== RESEND_SMTP.port)
      problems.push(`SMTP port is not ${RESEND_SMTP.port}`);
    if (text(actual["smtp_user"]) !== RESEND_SMTP.user)
      problems.push(`SMTP user is not "${RESEND_SMTP.user}"`);
  }
  if (text(actual["smtp_admin_email"]) !== s.from)
    problems.push(`emails are not sent from ${s.from}`);
  if (text(actual["smtp_sender_name"]) !== s.senderName)
    problems.push(`emails are not signed "${s.senderName}"`);
  const rate = actual["rate_limit_email_sent"];
  if (typeof rate !== "number" || rate < s.emailsPerHour)
    problems.push(
      `the project may send ${typeof rate === "number" ? rate.toString() : "an unknown number of"} auth emails an hour, fewer than ${s.emailsPerHour.toString()}`,
    );
  if (text(actual["site_url"]) !== s.appUrl)
    problems.push(`the site URL is not ${s.appUrl}, so links in emails point elsewhere`);
  if (
    !text(actual["uri_allow_list"])
      .split(",")
      .map((u) => u.trim())
      .includes(`${s.appUrl}/auth/callback`)
  )
    problems.push(`${s.appUrl}/auth/callback is not an allowed redirect`);
  if (actual["mailer_autoconfirm"] !== false)
    problems.push("email confirmation is off: addresses would sign in unproven");
  const length = actual["password_min_length"];
  if (typeof length !== "number" || length < s.passwordMinLength)
    problems.push(
      `passwords may be shorter than ${s.passwordMinLength.toString()} characters`,
    );
  if (actual["security_update_password_require_reauthentication"] !== true)
    problems.push("changing a password does not ask for the current one");
  const t = s.templates;
  if (text(actual["mailer_subjects_confirmation"]) !== t.confirmation.subject)
    problems.push("the confirmation email's subject is not ours");
  if (text(actual["mailer_templates_confirmation_content"]) !== t.confirmation.content)
    problems.push(
      "the confirmation email is not the token-hash template from supabase/templates",
    );
  if (text(actual["mailer_subjects_recovery"]) !== t.recovery.subject)
    problems.push("the reset email's subject is not ours");
  if (text(actual["mailer_templates_recovery_content"]) !== t.recovery.content)
    problems.push(
      "the reset email is not the token-hash template from supabase/templates",
    );
  return problems;
}
