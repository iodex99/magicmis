import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  authEmailPatch,
  authEmailProblems,
  authEmailSettingsProblems,
  RESEND_SMTP,
  type AuthEmailSettings,
} from "../src/auth-email";

// R-22, ADR 0073: without custom SMTP a customer never receives a confirmation or a reset email.
// The command checks a production project against these; the tests check the judgement itself.

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

async function realSettings(): Promise<AuthEmailSettings> {
  const html = (name: string) =>
    readFile(path.join(ROOT, "supabase", "templates", `${name}.html`), "utf8");
  return {
    appUrl: "https://app.example.com",
    from: "no-reply@example.com",
    senderName: "Magic MIS",
    emailsPerHour: 100,
    passwordMinLength: 12,
    templates: {
      confirmation: {
        subject: "Confirm your email address",
        content: await html("confirmation"),
      },
      recovery: { subject: "Set a new password", content: await html("recovery") },
    },
  };
}

/** What the project holds after the patch is applied (the password is never read back). */
function applied(s: AuthEmailSettings): Record<string, unknown> {
  const { smtp_pass: _hidden, ...rest } = authEmailPatch(s, "re_test_key");
  return rest;
}

describe("the production auth email settings", () => {
  it("accept the repository's own templates, which are the token-hash ones", async () => {
    expect(authEmailSettingsProblems(await realSettings())).toEqual([]);
  });

  it("refuse settings that could not work", async () => {
    const s = await realSettings();
    expect(
      authEmailSettingsProblems({ ...s, appUrl: "http://app.example.com" }),
    ).toHaveLength(1);
    expect(
      authEmailSettingsProblems({ ...s, appUrl: "https://app.example.com/" }),
    ).toHaveLength(1);
    expect(authEmailSettingsProblems({ ...s, from: "admin@email.com" })).toHaveLength(1);
    expect(authEmailSettingsProblems({ ...s, emailsPerHour: 0 })).toHaveLength(1);
    expect(
      authEmailSettingsProblems({
        ...s,
        templates: {
          ...s.templates,
          recovery: {
            subject: "Reset",
            content: "<a href='{{ .ConfirmationURL }}'>reset</a>",
          },
        },
      }),
    ).toEqual([
      "the recovery template must be the token-hash one from supabase/templates",
    ]);
  });

  it("send Resend's SMTP, our sender, our templates and confirmation on", async () => {
    const s = await realSettings();
    const patch = authEmailPatch(s, "re_test_key");
    expect(patch).toMatchObject({
      smtp_host: RESEND_SMTP.host,
      smtp_port: "465",
      smtp_user: "resend",
      smtp_pass: "re_test_key",
      smtp_admin_email: "no-reply@example.com",
      smtp_sender_name: "Magic MIS",
      rate_limit_email_sent: 100,
      site_url: "https://app.example.com",
      uri_allow_list: "https://app.example.com/auth/callback",
      mailer_autoconfirm: false,
      password_min_length: 12,
      security_update_password_require_reauthentication: true,
      mailer_subjects_recovery: "Set a new password",
    });
    expect(patch["mailer_templates_recovery_content"]).toContain("{{ .TokenHash }}");
  });

  it("find nothing wrong with a project that holds them", async () => {
    const s = await realSettings();
    expect(authEmailProblems(applied(s), s)).toEqual([]);
  });

  it("say plainly why a fresh project sends customers nothing", async () => {
    const s = await realSettings();
    // A new hosted project: Supabase's own mailer, 2 an hour, team addresses only.
    const fresh = {
      smtp_host: null,
      smtp_admin_email: null,
      rate_limit_email_sent: 2,
      site_url: "http://localhost:3000",
      mailer_autoconfirm: false,
    };
    const problems = authEmailProblems(fresh, s);
    expect(problems[0]).toMatch(/no custom SMTP.*two an hour/u);
    expect(problems.some((p) => p.includes("2 auth emails an hour"))).toBe(true);
    expect(problems.some((p) => p.includes("site URL"))).toBe(true);
  });

  it("catch each setting that has drifted on its own", async () => {
    const s = await realSettings();
    const ok = applied(s);
    const drifted: [string, unknown, RegExp][] = [
      ["rate_limit_email_sent", 30, /30 auth emails an hour, fewer than 100/u],
      ["mailer_autoconfirm", true, /confirmation is off/u],
      ["smtp_port", "587", /port is not 465/u],
      [
        "smtp_admin_email",
        "noreply@other.example",
        /not sent from no-reply@example.com/u,
      ],
      [
        "uri_allow_list",
        "https://app.example.com/other",
        /auth\/callback is not an allowed/u,
      ],
      [
        "mailer_templates_recovery_content",
        "<p>old</p>",
        /reset email is not the token-hash/u,
      ],
      ["password_min_length", 8, /shorter than 12/u],
    ];
    for (const [field, value, message] of drifted) {
      const problems = authEmailProblems({ ...ok, [field]: value }, s);
      expect(problems, field).toHaveLength(1);
      expect(problems[0], field).toMatch(message);
    }
  });
});
