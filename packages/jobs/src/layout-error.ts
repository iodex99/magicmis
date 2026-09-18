/**
 * What can go wrong reading or changing a company's saved layout: its dashboard and its MIS
 * template, both kept in the blueprint. Its own module so the completion step, the dashboard and
 * the template edits can all throw it without importing one another.
 */
export class DashboardError extends Error {
  constructor(
    readonly code:
      | "no_blueprint"
      | "no_dashboard"
      /** Saved, but it does not parse. Never treated as "not saved" (ADR 0045). */
      | "unreadable"
      | "stale"
      | "invalid_patch"
      | "nothing_to_undo"
      | "wrong_job",
    message: string,
    readonly errors: readonly string[] = [],
  ) {
    super(message);
    this.name = "DashboardError";
  }
}
