/**
 * Dashboard memory (SPEC §24.2). The dashboard spec lives in the company blueprint; every change is
 * a new, immutable blueprint version:
 *
 * - `dashboard_addon` (a paid job) stores the default spec.
 * - A confirmed JSON Patch stores the patched spec, with a pointer to the version it was made from.
 * - Undo stores the spec of that parent version again, with the parent's own pointer, so repeated
 *   undo walks back through the edit history instead of toggling between two versions.
 *
 * Patches from UI controls are not charged: the dashboard was paid for, and a layout edit reads no
 * data. Patches from chat arrive through a charged chat message (SPEC §27).
 */

import type { KeyWrapper } from "@magicmis/crypto";
import { withTransaction } from "@magicmis/db/tx";
import {
  latestBlueprint,
  storeBlueprint,
  type BlueprintParts,
} from "@magicmis/engine/server";
import {
  DEFAULT_DASHBOARD,
  dashboardSpecSchema,
  patchDashboard,
  type DashboardSpec,
} from "@magicmis/render-dashboard";
import type { Pool } from "pg";
import { z } from "zod";

import { captureDelivered, finish } from "./settle";
import { queueNotification } from "./notify";
import { lockJob, transition } from "./states";

export class DashboardError extends Error {
  constructor(
    readonly code:
      | "no_blueprint"
      | "no_dashboard"
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

const storedSchema = z.object({
  spec: dashboardSpecSchema,
  parentVersion: z.number().int().positive().nullable(),
});
export type StoredDashboard = z.infer<typeof storedSchema>;

export interface CompanyDashboard {
  readonly blueprintVersion: number;
  readonly spec: DashboardSpec;
  readonly canUndo: boolean;
}

async function current(
  pool: Pool,
  wrapper: KeyWrapper,
  scope: { accountId: string; companyId: string },
  version?: number,
) {
  const blueprint = await latestBlueprint(pool, wrapper, {
    ...scope,
    ...(version === undefined ? {} : { version }),
  });
  if (blueprint === null)
    throw new DashboardError(
      "no_blueprint",
      "Set up this company before adding a dashboard.",
    );
  const stored = storedSchema.safeParse(blueprint.parts.dashboardSpec);
  return { blueprint, stored: stored.success ? stored.data : null };
}

async function storeDashboard(
  pool: Pool,
  wrapper: KeyWrapper,
  scope: { accountId: string; companyId: string; jobId: string | null },
  parts: BlueprintParts,
  dashboard: StoredDashboard,
): Promise<number> {
  const b = await storeBlueprint(pool, wrapper, {
    ...scope,
    parts: { ...parts, dashboardSpec: dashboard },
  });
  return b.version;
}

/** The company's current dashboard, or null when none was added. */
export async function companyDashboard(
  pool: Pool,
  wrapper: KeyWrapper,
  scope: { accountId: string; companyId: string },
): Promise<CompanyDashboard | null> {
  const blueprint = await latestBlueprint(pool, wrapper, scope);
  const stored = storedSchema.safeParse(blueprint?.parts.dashboardSpec);
  if (blueprint === null || !stored.success) return null;
  return {
    blueprintVersion: blueprint.version,
    spec: stored.data.spec,
    canUndo: stored.data.parentVersion !== null,
  };
}

/**
 * Delivers a reserved `dashboard_addon` job: stores the default dashboard as a new blueprint version
 * (once, recorded in the checkpoint), captures and completes. There is no AI stage.
 */
export async function completeDashboardAddon(
  pool: Pool,
  wrapper: KeyWrapper,
  input: { accountId: string; jobId: string; now?: Date },
): Promise<{ captured: bigint; blueprintVersion: number }> {
  const now = input.now ?? new Date();
  const job = await withTransaction(pool, async (tx) => {
    const locked = await lockJob(tx, input.jobId, input.accountId);
    if (locked.type !== "dashboard_addon" || locked.company_id === null)
      throw new DashboardError("wrong_job", "This is not a dashboard job.");
    if (locked.state === "reserved") await transition(tx, locked, "rendering");
    else if (locked.state !== "rendering" && locked.state !== "completed")
      throw new DashboardError(
        "wrong_job",
        "Confirm the price before adding the dashboard.",
      );
    return locked;
  });
  const companyId = job.company_id ?? "";
  const scope = { accountId: input.accountId, companyId };

  let version = job.stage_checkpoints["blueprint_version"] as number | undefined;
  if (version === undefined) {
    const { blueprint, stored } = await current(pool, wrapper, scope);
    version =
      stored === null
        ? await storeDashboard(
            pool,
            wrapper,
            { ...scope, jobId: job.id },
            blueprint.parts,
            { spec: DEFAULT_DASHBOARD, parentVersion: null },
          )
        : blueprint.version;
    await pool.query(
      `update public.jobs set stage_checkpoints = stage_checkpoints || $2::jsonb where id = $1`,
      [job.id, JSON.stringify({ blueprint_version: version })],
    );
  }
  if (job.state === "completed")
    return { captured: BigInt(job.captured_credits ?? "0"), blueprintVersion: version };

  const captured = await captureDelivered(pool, job, now);
  await queueNotification(pool, {
    accountId: input.accountId,
    type: "job.completed",
    payload: { job_id: job.id, company_id: companyId, job_type: job.type },
    dedupeKey: `completed:${job.id}`,
  });
  await finish(pool, job, "completed", captured);
  return { captured, blueprintVersion: version };
}

/** Previews a patch against the current dashboard without storing anything. */
export async function previewDashboardPatch(
  pool: Pool,
  wrapper: KeyWrapper,
  input: {
    accountId: string;
    companyId: string;
    baseVersion: number;
    operations: unknown;
  },
): Promise<{ spec: DashboardSpec }> {
  const { blueprint, stored } = await current(pool, wrapper, input);
  if (stored === null)
    throw new DashboardError("no_dashboard", "This company has no dashboard yet.");
  if (blueprint.version !== input.baseVersion)
    throw new DashboardError(
      "stale",
      "The dashboard changed since you opened it. Reload and try again.",
    );
  const result = patchDashboard(stored.spec, input.operations);
  if (!result.ok)
    throw new DashboardError(
      "invalid_patch",
      "That change would make the dashboard invalid.",
      result.errors,
    );
  return { spec: result.spec };
}

/** Applies a confirmed patch as a new blueprint version. */
export async function applyDashboardPatch(
  pool: Pool,
  wrapper: KeyWrapper,
  input: {
    accountId: string;
    companyId: string;
    baseVersion: number;
    operations: unknown;
  },
): Promise<CompanyDashboard> {
  const { spec } = await previewDashboardPatch(pool, wrapper, input);
  const { blueprint } = await current(pool, wrapper, input);
  const version = await storeDashboard(
    pool,
    wrapper,
    { accountId: input.accountId, companyId: input.companyId, jobId: null },
    blueprint.parts,
    {
      spec,
      parentVersion: input.baseVersion,
    },
  );
  return { blueprintVersion: version, spec, canUndo: true };
}

/** Restores the dashboard the current one was made from, as a new blueprint version. */
export async function undoDashboard(
  pool: Pool,
  wrapper: KeyWrapper,
  input: { accountId: string; companyId: string; baseVersion: number },
): Promise<CompanyDashboard> {
  const { blueprint, stored } = await current(pool, wrapper, input);
  if (stored === null)
    throw new DashboardError("no_dashboard", "This company has no dashboard yet.");
  if (blueprint.version !== input.baseVersion)
    throw new DashboardError(
      "stale",
      "The dashboard changed since you opened it. Reload and try again.",
    );
  if (stored.parentVersion === null)
    throw new DashboardError(
      "nothing_to_undo",
      "There is no earlier dashboard to go back to.",
    );
  const parent = await current(pool, wrapper, input, stored.parentVersion);
  if (parent.stored === null)
    throw new DashboardError(
      "nothing_to_undo",
      "There is no earlier dashboard to go back to.",
    );
  const version = await storeDashboard(
    pool,
    wrapper,
    { accountId: input.accountId, companyId: input.companyId, jobId: null },
    blueprint.parts,
    parent.stored,
  );
  return {
    blueprintVersion: version,
    spec: parent.stored.spec,
    canUndo: parent.stored.parentVersion !== null,
  };
}
