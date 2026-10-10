import { redirect } from "next/navigation";

/**
 * GET /app/companies — the company list lives at /app. The archive and purge emails linked here,
 * and links already in inboxes keep doing so (ADR 0086).
 */
export default function CompaniesPage(): never {
  redirect("/app");
}
