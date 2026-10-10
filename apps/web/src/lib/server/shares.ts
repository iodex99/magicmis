import "server-only";

import type { Pool } from "pg";
import { z } from "zod";

import type { BoardActionsPayload } from "@/app/app/companies/[id]/BoardActionsView";
import type { CommentaryPayload } from "@/app/app/companies/[id]/CommentaryView";
import type { DashboardPayload as BoardPayload } from "@/app/app/companies/[id]/DashboardClient";

import { readBrand, readBrandLogo } from "./brand";
import { boardActionsPayload, commentaryPayload, dashboardPayload } from "./insights";
import { readCompanyLogo } from "./logo";
import { keyWrapper } from "./runtime";

/**
 * The board a link shares (ADR 0090), frozen when the link is made: the figures the owner's board
 * shows, the month it opens on, and — when the owner chose — what was written about that month.
 *
 * It is what the owner sees, less what is theirs alone: the files that fed it, the alerts they
 * set, and the ids of uploads behind each figure's lineage. Hidden months are already gone from
 * the values the board is built from (ADR 0048). Logos travel inside it as data, so the page that
 * shows it needs no other request to anything of the account's.
 */
export interface SharedBoard {
  readonly version: 1;
  readonly companyName: string;
  readonly period: string;
  readonly sharedOn: string;
  /** As the board component reads it, the shape the sample company uses too. */
  readonly dashboard: BoardPayload;
  readonly logo: string | null;
  readonly preparer: { readonly name: string; readonly logo: string | null } | null;
  readonly commentary: CommentaryPayload | null;
  readonly boardActions: BoardActionsPayload | null;
}

/** The shape read back from the seal: checked at the edges, the payloads as the server wrote them. */
export const sharedBoardSchema = z.object({
  version: z.literal(1),
  companyName: z.string(),
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u),
  sharedOn: z.iso.datetime(),
  dashboard: z.looseObject({
    periods: z.array(z.string()),
    values: z.array(z.unknown()),
  }),
  logo: z.string().nullable(),
  preparer: z.object({ name: z.string(), logo: z.string().nullable() }).nullable(),
  commentary: z.looseObject({}).nullable(),
  boardActions: z.looseObject({}).nullable(),
});

const dataUrl = (logo: { bytes: Buffer; type: string } | null): string | null =>
  logo === null ? null : `data:${logo.type};base64,${logo.bytes.toString("base64")}`;

/** Lineage without the upload ids: a reader of a shared board has no file to open. */
function withoutUploadIds<T extends { values: readonly unknown[] }>(payload: T): T {
  return {
    ...payload,
    values: payload.values.map((v) => {
      const value = v as { inputs?: readonly Record<string, unknown>[] };
      return value.inputs === undefined
        ? v
        : {
            ...value,
            inputs: value.inputs.map((i) =>
              i["kind"] === "source" ? { ...i, fileId: "" } : i,
            ),
          };
    }),
  };
}

/**
 * Builds the board to share, or null when the company has no board or the month is not on it.
 * Reads only what the owner already has: no figure is computed and no model is asked anything.
 */
export async function buildSharedBoard(
  pool: Pool,
  scope: { accountId: string; companyId: string },
  input: { period: string; withWriting: boolean; now: Date },
): Promise<SharedBoard | null> {
  const payload = await dashboardPayload(pool, scope.accountId, scope.companyId);
  if (payload?.dashboard == null || !payload.periods.includes(input.period)) return null;

  // The newest completed commentary and where to act for the month, as presenter notes read
  // them (ADR 0087).
  let commentary: CommentaryPayload | null = null;
  let boardActions: BoardActionsPayload | null = null;
  if (input.withWriting) {
    const written = await pool.query<{ id: string; type: string }>(
      `select distinct on (type) id, type
         from public.jobs
        where account_id = $1 and company_id = $2 and state = 'completed'
          and type in ('commentary', 'board_actions')
          and stage_checkpoints->>'period' = $3
        order by type, created_at desc`,
      [scope.accountId, scope.companyId, input.period],
    );
    for (const w of written.rows) {
      if (w.type === "commentary") {
        const c = await commentaryPayload(pool, scope.accountId, w.id);
        commentary = c === null ? null : withoutUploadIds(c);
      } else {
        const a = await boardActionsPayload(pool, scope.accountId, w.id);
        boardActions = a === null ? null : withoutUploadIds(a);
      }
    }
  }

  const wrapper = keyWrapper();
  const quietly = <T>(p: Promise<T>) => p.catch(() => null);
  const [logo, brand] = await Promise.all([
    quietly(readCompanyLogo(pool, wrapper, scope)),
    readBrand(pool, scope.accountId),
  ]);
  const preparer =
    brand?.on === true
      ? {
          name: brand.name,
          logo: dataUrl(await quietly(readBrandLogo(pool, wrapper, scope.accountId))),
        }
      : null;

  return {
    version: 1,
    companyName: payload.company.name,
    period: input.period,
    sharedOn: input.now.toISOString(),
    dashboard: withoutUploadIds({
      ...payload,
      company: { ...payload.company, id: "shared" },
      // The board as of the month shared: a March board sent in April shows March as its latest.
      periods: payload.periods.filter((p) => p <= input.period),
      values: payload.values.filter((v) => v.period <= input.period),
      checks: Object.fromEntries(
        Object.entries(payload.checks).filter(([p]) => p <= input.period),
      ),
      latestPeriod: input.period,
      // The owner's own: which files fed it, and the alerts they keep.
      files: [],
      alerts: [],
    }) as unknown as BoardPayload,
    logo: dataUrl(logo),
    preparer,
    commentary,
    boardActions,
  };
}
