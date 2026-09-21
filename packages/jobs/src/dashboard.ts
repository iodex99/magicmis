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
 *
 * Data: a dashboard shows months up to `dataThrough`, the latest month it was paid for. A monthly
 * refresh stores a new month for the Excel MIS; the dashboard moves to it only through a paid
 * `dashboard_refresh` (SPEC §2.3, §23 refresh flow step 5). Edits and undo never change it.
 */

import type { KeyWrapper } from "@magicmis/crypto";
import { withTransaction } from "@magicmis/db/tx";
import {
  BlueprintConflict,
  latestBlueprint,
  storeBlueprint,
  type BlueprintParts,
} from "@magicmis/engine/server";
import {
  DEFAULT_DASHBOARD,
  patchDashboard,
  type DashboardSpec,
} from "@magicmis/render-dashboard";
import type { Pool } from "pg";

import type { AiTransport } from "@magicmis/ai";

import { firstDashboardSpec } from "./first-dashboard";
import { DashboardError } from "./layout-error";
import { releasingOnLayoutFault } from "./layout-fault";
import { readStoredDashboard, type StoredDashboard } from "./stored-layout";
import { captureDelivered, finish } from "./settle";
import { queueNotification } from "./notify";
import { lockJob, transition } from "./states";

export interface CompanyDashboard {
  readonly blueprintVersion: number;
  readonly spec: DashboardSpec;
  readonly canUndo: boolean;
  /** The latest month the dashboard may show. */
  readonly dataThrough: string | null;
}

const latestPeriod = async (pool: Pool, companyId: string): Promise<string | null> =>
  (
    await pool.query<{ period: string | null }>(
      `select max(period) as period from public.snapshots where company_id = $1`,
      [companyId],
    )
  ).rows[0]?.period ?? null;

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
  return { blueprint, stored: readStoredDashboard(blueprint.parts.dashboardSpec) };
}

async function storeDashboard(
  pool: Pool,
  wrapper: KeyWrapper,
  scope: { accountId: string; companyId: string; jobId: string | null },
  from: { version: number; parts: BlueprintParts },
  dashboard: StoredDashboard,
): Promise<number> {
  try {
    const b = await storeBlueprint(pool, wrapper, {
      ...scope,
      parts: { ...from.parts, dashboardSpec: dashboard },
      basedOn: from.version,
    });
    return b.version;
  } catch (error) {
    // Everything but the dashboard is copied from the version that was read. If another version
    // landed meanwhile (a renamed MIS row, a run finishing), writing would put the old one back.
    if (error instanceof BlueprintConflict)
      throw new DashboardError(
        "stale",
        "This company's layout changed a moment ago. Reload and try again.",
      );
    throw error;
  }
}

/**
 * A paid job is not failed because an edit landed while it was writing: it reads the newer
 * version and writes again on top of it, so neither change is lost.
 */
export async function retryStale<T>(work: () => Promise<T>, attempts = 4): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      const stale = error instanceof DashboardError && error.code === "stale";
      if (!stale || attempt >= attempts) throw error;
    }
  }
}

/**
 * The company's current dashboard, or null when none was added. Throws `unreadable` for one that
 * was saved and does not parse; that is not the same thing as none.
 */
export async function companyDashboard(
  pool: Pool,
  wrapper: KeyWrapper,
  scope: { accountId: string; companyId: string },
): Promise<CompanyDashboard | null> {
  const blueprint = await latestBlueprint(pool, wrapper, scope);
  if (blueprint === null) return null;
  const stored = readStoredDashboard(blueprint.parts.dashboardSpec);
  if (stored === null) return null;
  return {
    blueprintVersion: blueprint.version,
    spec: stored.spec,
    canUndo: stored.parentVersion !== null,
    dataThrough: stored.dataThrough,
  };
}

/**
 * Delivers a reserved dashboard job, once (recorded in the checkpoint), then captures and completes;
 * there is no AI stage. `dashboard_addon` stores the default dashboard through the latest month;
 * `dashboard_refresh` moves an existing dashboard to the latest month. Either is a new version.
 */
export async function completeDashboardAddon(
  pool: Pool,
  wrapper: KeyWrapper,
  input: {
    accountId: string;
    jobId: string;
    now?: Date;
    /** Present only where a first dashboard may be chosen for the company (ADR 0056). */
    transport?: AiTransport | null;
  },
): Promise<{ captured: bigint; blueprintVersion: number }> {
  const now = input.now ?? new Date();
  const job = await withTransaction(pool, async (tx) => {
    const locked = await lockJob(tx, input.jobId, input.accountId);
    if (
      (locked.type !== "dashboard_addon" && locked.type !== "dashboard_refresh") ||
      locked.company_id === null
    )
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
    const deliver = async (): Promise<number> => {
      // An unreadable saved dashboard throws here, so the default is only ever stored for a
      // company that has none: a paid refresh can never reset the names a company chose.
      const { blueprint, stored } = await current(pool, wrapper, scope);
      const through = await latestPeriod(pool, companyId);
      if (job.type === "dashboard_refresh" && stored === null)
        throw new DashboardError(
          "no_dashboard",
          "Add the dashboard before refreshing it.",
        );
      const next: StoredDashboard | null =
        stored === null
          ? {
              // Chosen for this company from the figures it holds, falling back to the
              // standard boxes whenever that cannot run (ADR 0056).
              spec: await firstDashboardSpec(pool, wrapper, {
                ...scope,
                jobId: job.id,
                transport: input.transport ?? null,
              }),
              parentVersion: null,
              dataThrough: through,
            }
          : stored.dataThrough === through
            ? null
            : { ...stored, dataThrough: through };
      return next === null
        ? blueprint.version
        : storeDashboard(pool, wrapper, { ...scope, jobId: job.id }, blueprint, next);
    };
    version = await releasingOnLayoutFault(
      pool,
      { accountId: input.accountId, jobId: job.id },
      () => retryStale(deliver),
    );
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

/**
 * The patched dashboard and the one version it was read from, checked against, and (when applied)
 * written on top of. One read: a second would let a version that landed in between pass as the
 * base of a change that was computed from the one before it.
 */
async function proposedDashboard(
  pool: Pool,
  wrapper: KeyWrapper,
  input: {
    accountId: string;
    companyId: string;
    baseVersion: number;
    operations: unknown;
  },
) {
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
  return { blueprint, stored, spec: result.spec };
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
  return { spec: (await proposedDashboard(pool, wrapper, input)).spec };
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
  const { blueprint, stored, spec } = await proposedDashboard(pool, wrapper, input);
  const version = await storeDashboard(
    pool,
    wrapper,
    { accountId: input.accountId, companyId: input.companyId, jobId: null },
    blueprint,
    {
      spec,
      parentVersion: input.baseVersion,
      dataThrough: stored.dataThrough,
    },
  );
  return {
    blueprintVersion: version,
    spec,
    canUndo: true,
    dataThrough: stored.dataThrough,
  };
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
    blueprint,
    // The layout goes back; the paid-for data stays.
    { ...parent.stored, dataThrough: stored.dataThrough },
  );
  return {
    blueprintVersion: version,
    spec: parent.stored.spec,
    canUndo: parent.stored.parentVersion !== null,
    dataThrough: stored.dataThrough,
  };
}
