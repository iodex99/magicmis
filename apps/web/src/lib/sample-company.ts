import type { NumberFormat } from "@magicmis/core/reporting-conventions";
import type { MetricValue } from "@magicmis/engine";
import { metricValueSchema } from "@magicmis/engine";
import { dashboardSpecSchema } from "@magicmis/render-dashboard";
import { z } from "zod";

import type { BoardActionsPayload } from "@/app/app/companies/[id]/BoardActionsView";
import type { CommentaryPayload } from "@/app/app/companies/[id]/CommentaryView";
import type { DashboardPayload } from "@/app/app/companies/[id]/DashboardClient";

import recorded from "./sample-company.json";

/**
 * The sample company (ADR 0086): an invented business a new account can read before it uploads
 * anything — the board, the month's commentary and where to act — as the product shows them.
 *
 * It is a recording, not a run. `e2e/support/record-sample.ts` takes synthetic books through the
 * real product once, with the real model writing the words, and saves what the three screens read;
 * showing it computes nothing, calls no model and charges nobody. Locked decision 3 allows it for
 * the reason it allows the public site's samples: the data is fictional and the page says so.
 *
 * The file is checked against the same schemas a live payload passes, here and in the test
 * beside it, so a sample that no longer fits the product fails the build rather than the page.
 */

const PERIOD = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u);

const factsPack = z.object({
  facts: z.array(z.object({ id: z.string(), label: z.string(), text: z.string() })),
  dimensions: z.array(z.object({ id: z.string(), label: z.string() })),
  periods: z.array(z.string()),
});

const commentaryOutput = z.object({
  sections: z.array(
    z.object({
      heading: z.string(),
      paragraphs: z.array(z.object({ text: z.string() })),
    }),
  ),
});

/** The shape `board_actions` returns (packages/ai), restated: that package is server-only. */
const boardActionsOutput = z.object({
  summary: z.string(),
  actions: z
    .array(
      z.object({
        heading: z.string(),
        because: z.string(),
        todo: z.string(),
        urgency: z.enum(["now", "this_quarter", "watch"]),
      }),
    )
    .min(1),
});

const written = <T extends z.ZodType>(output: T) =>
  z.object({
    period: PERIOD,
    output,
    pack: factsPack,
    allowlist: z.array(z.string()),
  });

export const sampleFileSchema = z.object({
  recordedOn: z.iso.date(),
  name: z.string().min(1),
  trade: z.string().min(1),
  company: z.object({
    fyStartMonth: z.number().int().min(1).max(12),
    money: z.object({
      style: z.enum(["lakhs_crores", "absolute", "millions"]),
      decimals: z.number().int().min(0).max(4),
      negativesInBrackets: z.boolean(),
    }),
    currency: z.string().length(3),
    currencySymbol: z.string().min(1),
  }),
  periods: z.array(PERIOD).min(1),
  values: z.array(metricValueSchema).min(1),
  spec: dashboardSpecSchema,
  dataThrough: PERIOD,
  commentary: written(commentaryOutput),
  boardActions: written(boardActionsOutput),
});

export interface SampleCompany {
  readonly name: string;
  readonly trade: string;
  readonly recordedOn: string;
  readonly dashboard: DashboardPayload;
  readonly commentary: { readonly period: string; readonly payload: CommentaryPayload };
  readonly boardActions: {
    readonly period: string;
    readonly payload: BoardActionsPayload;
  };
}

/**
 * How the reader writes money, from where they are (ADR 0087). The company is invented, so its
 * currency is a label and nothing more: a reader in London sees pounds in millions and one in
 * Mumbai rupees in lakhs, every figure the same number the engine computed.
 */
export interface SampleViewer {
  readonly currencySymbol: string;
  readonly style: NumberFormat;
}

let parsed: z.infer<typeof sampleFileSchema> | undefined;

/** The recorded sample, in the shapes the dashboard, commentary and actions views read. */
export function sampleCompany(viewer?: SampleViewer): SampleCompany {
  parsed ??= sampleFileSchema.parse(recorded);
  const file = parsed;
  // The store's schema leaves lineage inputs open; the engine wrote them, as it does for a
  // company's own snapshot, which is read the same way.
  const values = file.values as unknown as MetricValue[];
  const money =
    viewer === undefined
      ? file.company.money
      : { ...file.company.money, style: viewer.style };
  const currencySymbol = viewer?.currencySymbol ?? file.company.currencySymbol;
  const company = { money, currencySymbol };
  return {
    name: file.name,
    trade: file.trade,
    recordedOn: file.recordedOn,
    dashboard: {
      company: {
        id: "sample",
        name: file.name,
        fyStartMonth: file.company.fyStartMonth,
        money,
        currencySymbol,
      },
      // Every month the figures cover, as a company's own board offers them (ADR 0087).
      periods: [...new Set(values.map((v) => v.period))].sort().reverse(),
      values,
      dashboard: {
        blueprintVersion: 0,
        spec: file.spec,
        canUndo: false,
        dataThrough: file.dataThrough,
      },
      latestPeriod: file.dataThrough,
      files: [],
      hiddenPeriods: [],
    },
    commentary: {
      period: file.commentary.period,
      payload: {
        company,
        output: file.commentary.output,
        pack: file.commentary.pack,
        allowlist: file.commentary.allowlist,
        values,
      },
    },
    boardActions: {
      period: file.boardActions.period,
      payload: {
        company,
        output: file.boardActions.output,
        pack: file.boardActions.pack,
        allowlist: file.boardActions.allowlist,
        values,
      },
    },
  };
}
