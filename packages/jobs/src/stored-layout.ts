/**
 * Reading a company's saved layout out of its blueprint: the dashboard, and the MIS template.
 *
 * One rule, in one place (ADR 0045): **absent is null; present but unreadable is thrown.** A
 * caller that took "unreadable" for "absent" would do what it does for a company with nothing
 * saved, which is to reach for the product's default, and the default would then be stored as the
 * next version over every table and name the company chose. Throwing stops the action instead and
 * leaves what is saved exactly as it was, where it can still be recovered.
 */

import { dashboardSpecSchema } from "@magicmis/render-dashboard";
import { templateSpecSchema, type TemplateSpec } from "@magicmis/templates";
import { z } from "zod";

import { DashboardError } from "./layout-error";

const storedDashboardSchema = z.object({
  spec: dashboardSpecSchema,
  parentVersion: z.number().int().positive().nullable(),
  dataThrough: z
    .string()
    .regex(/^\d{4}-\d{2}$/u)
    .nullable(),
});
export type StoredDashboard = z.infer<typeof storedDashboardSchema>;

const issues = (error: z.ZodError): string[] =>
  error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);

export function readStoredDashboard(raw: unknown): StoredDashboard | null {
  if (raw === null || raw === undefined) return null;
  const parsed = storedDashboardSchema.safeParse(raw);
  if (!parsed.success)
    throw new DashboardError(
      "unreadable",
      "This company's saved dashboard could not be read. Nothing was changed.",
      issues(parsed.error),
    );
  return parsed.data;
}

export function readStoredTemplate(raw: unknown): TemplateSpec | null {
  if (raw === null || raw === undefined) return null;
  const parsed = templateSpecSchema.safeParse(raw);
  if (!parsed.success)
    throw new DashboardError(
      "unreadable",
      "This company's saved MIS layout could not be read. Nothing was changed.",
      issues(parsed.error),
    );
  return parsed.data;
}
