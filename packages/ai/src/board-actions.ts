/**
 * Where to act (SPEC §25 neighbour, ADR 0062).
 *
 * Commentary says what happened; its prompt forbids advice in as many words. This says what to
 * do about it. The two are deliberately separate stages so neither drifts into the other: a
 * board pack that mixes description and recommendation in one paragraph is the thing a chartered
 * accountant's client cannot act on.
 *
 * It reads the *same facts pack* commentary reads, which is what makes locked decision 7 hold
 * here: every figure the model wants to cite already exists as a fact with an id, so it writes a
 * placeholder and the engine substitutes the figure it computed. A suggestion that invents a
 * number is a validation failure, not something to tidy up.
 */

import "server-only";

import { checkPlaceholderTexts } from "@magicmis/engine";
import { z } from "zod";

import {
  runStage,
  type AiContext,
  type StageResult,
  type StageSpec,
} from "./orchestrator";

/** The facts pack, exactly as commentary receives it. */
const factsPack = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u),
  facts: z
    .array(
      z.object({
        id: z.string().max(120),
        label: z.string().max(200),
        text: z.string().max(60),
      }),
    )
    .max(400),
  dimensions: z
    .array(z.object({ id: z.string().max(80), label: z.string().max(200) }))
    .max(100),
  periods: z.array(z.string().max(20)).max(40),
  warnings: z.array(z.string().max(300)).max(50),
});

export const boardActionsInput = z.object({
  factsPack,
  /** Server config `commentary.digit_allowlist`, never from the browser. */
  allowlist: z.array(z.string().max(40)).max(50),
  /** How many to ask for. A board reads five things, not twenty. */
  maxActions: z.number().int().min(3).max(8),
});
export type BoardActionsInput = z.infer<typeof boardActionsInput>;

/**
 * `now` is this month's problem, `this_quarter` is the one to plan, `watch` is the one that is
 * not yet a problem. Three buckets, because a board meeting has three kinds of item and a
 * numeric priority would be a figure the model made up.
 */
export const URGENCIES = ["now", "this_quarter", "watch"] as const;

/*
 * The limits the model has to write inside (ADR 0066).
 *
 * They were in the schema alone to begin with, and every expert answer in the first eval run
 * overran the summary — the model was being marked against a number nobody had given it, and
 * the repair round that rescued most of them was a second paid call on every single month.
 *
 * A limit the output is judged by is part of the brief, and the brief is the **system prompt**:
 * stating it in `stable()` did nothing, because `stable()` is wrapped in `<data>` tags and every
 * prompt here tells the model that what is inside them is data and never an instruction. So
 * prompt v2 carries these numbers in words, and `prompt-limits.test.ts` holds the prompt and
 * this constant to the same values — a static file cannot read a constant, so a test has to.
 */
export const LIMITS = { summary: 300, heading: 120, because: 700, todo: 700 } as const;

export const boardActionsOutput = z.object({
  /** One line the chair reads first. */
  summary: z.string().max(LIMITS.summary),
  actions: z
    .array(
      z.object({
        heading: z.string().max(LIMITS.heading),
        /** What the books show, in placeholders. */
        because: z.string().max(LIMITS.because),
        /** What to do about it. */
        todo: z.string().max(LIMITS.todo),
        urgency: z.enum(URGENCIES),
      }),
    )
    .min(1)
    .max(8),
});
export type BoardActionsOutput = z.infer<typeof boardActionsOutput>;

/** Every piece of prose the model wrote, so none of it escapes the placeholder rule. */
const textsOf = (output: BoardActionsOutput) => [
  { where: "summary", text: output.summary },
  ...output.actions.flatMap((a, i) => [
    { where: `action ${(i + 1).toString()} heading`, text: a.heading },
    { where: `action ${(i + 1).toString()} because`, text: a.because },
    { where: `action ${(i + 1).toString()} todo`, text: a.todo },
  ]),
];

export function checkBoardActions(
  input: BoardActionsInput,
  output: BoardActionsOutput,
): string[] {
  const known = new Set<string>([
    ...input.factsPack.facts.map((f) => f.id),
    ...input.factsPack.dimensions.map((d) => d.id),
    ...input.factsPack.periods,
  ]);
  const problems = checkPlaceholderTexts(textsOf(output), known, input.allowlist, []);
  if (output.actions.length > input.maxActions)
    problems.push(
      `asked for at most ${input.maxActions.toString()} actions and got ${output.actions.length.toString()}`,
    );
  // An action with nothing to do is an observation, and commentary already does those.
  for (const [i, a] of output.actions.entries())
    if (a.todo.trim() === "")
      problems.push(
        `action ${(i + 1).toString()} says what is happening but not what to do`,
      );
  return problems;
}

const table = (rows: readonly (readonly string[])[]): string =>
  rows.map((r) => r.join("\t")).join("\n");

export const boardActionsStageSpec: StageSpec<BoardActionsInput, BoardActionsOutput> = {
  stage: "board_actions",
  promptName: "board_actions",
  input: boardActionsInput,
  output: boardActionsOutput,
  maxInputBytes: 96_000,
  stable: (input) => [
    `Give at most ${input.maxActions.toString()} actions, most pressing first.`,
  ],
  volatile: (input) =>
    [
      "facts:",
      table(input.factsPack.facts.map((f) => [f.id, f.label, f.text])),
      "dimension values:",
      table(input.factsPack.dimensions.map((d) => [d.id, d.label])),
      `periods: ${input.factsPack.periods.join(", ")}`,
      "validation warnings:",
      input.factsPack.warnings.join("\n"),
    ].join("\n"),
  check: (input, output) => checkBoardActions(input, output),
};

export function suggestBoardActions(
  ctx: AiContext,
  input: BoardActionsInput,
): Promise<StageResult<BoardActionsOutput>> {
  return runStage(ctx, boardActionsStageSpec, input);
}
