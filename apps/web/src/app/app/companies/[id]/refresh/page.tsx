import { redirect } from "next/navigation";

/**
 * GET /app/companies/:id/refresh — the monthly reminder linked here, and the page is `/run`
 * ("Add a file"). Links already in inboxes keep working (ADR 0086). Ownership is checked where it
 * lands, so nothing is learned here about a company that is not the reader's.
 */
export default async function RefreshPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<never> {
  const { id } = await params;
  redirect(`/app/companies/${encodeURIComponent(id)}/run`);
}
