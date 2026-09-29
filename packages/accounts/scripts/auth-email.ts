/**
 * Set up and check the production Auth email (R-22, ADR 0073): sign-up confirmations and password
 * resets, sent through Resend.
 *
 *   pnpm --filter @magicmis/accounts auth-email            # check, changes nothing
 *   pnpm --filter @magicmis/accounts auth-email --apply    # set, then check
 *
 * Needs, in the environment (never printed):
 *   SUPABASE_ACCESS_TOKEN   a personal access token with auth config read (and write, to apply)
 *   SUPABASE_PROJECT_REF    the production project's reference
 *   APP_URL                 the production origin, e.g. https://app.example.com
 *   AUTH_EMAIL_FROM         the From address, on the domain verified in Resend
 *   AUTH_EMAILS_PER_HOUR    how many auth emails the project may send in an hour
 *   RESEND_API_KEY          --apply only: a Resend key with sending access
 *
 * The templates and subjects come from supabase/templates and supabase/config.toml, the minimum
 * password length from config.toml, and the sender name from the product name, so production
 * cannot drift from what the local stack and its tests run.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { PRODUCT_NAME } from "@magicmis/core/brand";

import {
  authEmailPatch,
  authEmailProblems,
  authEmailSettingsProblems,
  type AuthEmailSettings,
} from "../src/auth-email";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const API = "https://api.supabase.com/v1";

function need(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") throw new Error(`${name} is required`);
  return value.trim();
}

/** A value from supabase/config.toml's own section, read without a TOML dependency. */
function tomlValue(toml: string, section: string, key: string): string {
  const start = toml.indexOf(`[${section}]`);
  if (start < 0) throw new Error(`config.toml has no [${section}]`);
  const rest = toml.slice(start + section.length + 2);
  const body = rest.slice(0, rest.search(/^\[/mu) < 0 ? undefined : rest.search(/^\[/mu));
  const match = new RegExp(`^${key}\\s*=\\s*"?([^"\\n]*)"?\\s*$`, "mu").exec(body);
  if (match?.[1] === undefined) throw new Error(`config.toml [${section}] has no ${key}`);
  return match[1];
}

async function settings(): Promise<AuthEmailSettings> {
  const toml = await readFile(path.join(ROOT, "supabase", "config.toml"), "utf8");
  const template = async (name: "confirmation" | "recovery") => ({
    subject: tomlValue(toml, `auth.email.template.${name}`, "subject"),
    content: await readFile(
      path.join(ROOT, "supabase", "templates", `${name}.html`),
      "utf8",
    ),
  });
  return {
    appUrl: need("APP_URL").replace(/\/+$/u, ""),
    from: need("AUTH_EMAIL_FROM"),
    senderName: PRODUCT_NAME,
    emailsPerHour: Number.parseInt(need("AUTH_EMAILS_PER_HOUR"), 10),
    passwordMinLength: Number.parseInt(
      tomlValue(toml, "auth", "minimum_password_length"),
      10,
    ),
    templates: {
      confirmation: await template("confirmation"),
      recovery: await template("recovery"),
    },
  };
}

async function api(
  method: "GET" | "PATCH",
  body?: unknown,
): Promise<Record<string, unknown>> {
  const response = await fetch(
    `${API}/projects/${need("SUPABASE_PROJECT_REF")}/config/auth`,
    {
      method,
      headers: {
        Authorization: `Bearer ${need("SUPABASE_ACCESS_TOKEN")}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
  if (!response.ok)
    // The status only: an error body could echo what was sent, which includes the SMTP password.
    throw new Error(
      `Management API ${method} failed with HTTP ${response.status.toString()}`,
    );
  return (await response.json()) as Record<string, unknown>;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { apply: { type: "boolean", default: false } },
  });
  const wanted = await settings();
  const invalid = authEmailSettingsProblems(wanted);
  if (invalid.length > 0) throw new Error(invalid.join("; "));

  if (values.apply) {
    await api("PATCH", authEmailPatch(wanted, need("RESEND_API_KEY")));
    console.warn("Applied. Checking what the project now holds…");
  }
  const problems = authEmailProblems(await api("GET"), wanted);
  if (problems.length === 0) {
    console.warn(
      `Auth email is ready: sent through Resend from ${wanted.from}, up to ${wanted.emailsPerHour.toString()} an hour, links to ${wanted.appUrl}.`,
    );
    return;
  }
  for (const p of problems) console.warn(`- ${p}`);
  console.warn(`${problems.length.toString()} problem(s). Run with --apply to set them.`);
  process.exitCode = 1;
}

await main();
