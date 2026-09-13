/**
 * Dashboard edits (SPEC §24.2): RFC 6902 operations from `@magicmis/core/json-patch`, with the
 * result validated against the dashboard spec schema.
 */

import { patchDocument } from "@magicmis/core/json-patch";

import { dashboardSpecSchema, type DashboardSpec } from "./spec";

export {
  applyJsonPatch,
  PatchError,
  patchOperationSchema,
  patchSchema,
  type PatchOperation,
} from "@magicmis/core/json-patch";

export type DashboardPatchResult =
  | { readonly ok: true; readonly spec: DashboardSpec }
  | { readonly ok: false; readonly errors: readonly string[] };

/** Validates the operations, applies them, and validates the resulting spec. */
export function patchDashboard(
  spec: DashboardSpec,
  operations: unknown,
): DashboardPatchResult {
  const r = patchDocument(spec, operations, dashboardSpecSchema);
  return r.ok ? { ok: true, spec: r.value } : r;
}
