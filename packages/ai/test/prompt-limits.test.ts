/**
 * The prompt and the schema must state the same lengths (ADR 0066).
 *
 * A length that lives only in the schema is a number the model is marked against and never
 * given: `board_actions` expert overran its summary on 54 of 54 first attempts, and the single
 * repair round hid it by turning every call into two. Prompt v2 states the numbers, so the two
 * can now disagree — and a prompt is a static `.md` file that cannot read a constant, which
 * leaves a test as the only thing that can hold them together.
 *
 * If this fails, the schema moved and the prompt did not. Write a new prompt version with the
 * new number; do not edit an activated one, because its eval was run against the words it had.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { LIMITS as BOARD_ACTIONS } from "../src/board-actions";
import { LIMITS as DASHBOARD_LAYOUT } from "../src/dashboard-layout";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const prompt = (name: string, version: number): string =>
  readFileSync(
    path.join(HERE, "..", "prompts", name, `v${version.toString()}.md`),
    "utf8",
  );

/** Every run of digits in the prompt, so a stated limit cannot hide as prose. */
const numbersIn = (text: string): Set<number> =>
  new Set((text.match(/\d+/gu) ?? []).map((n) => Number.parseInt(n, 10)));

describe("a limit the output is judged by is in the prompt that asks for it", () => {
  it("board_actions v2 states every length its schema enforces", () => {
    const stated = numbersIn(prompt("board_actions", 2));
    for (const [field, limit] of Object.entries(BOARD_ACTIONS))
      expect(stated, `${field} (${limit.toString()})`).toContain(limit);
  });

  it("dashboard_layout v2 states every length its schema enforces", () => {
    const stated = numbersIn(prompt("dashboard_layout", 2));
    for (const [field, limit] of Object.entries(DASHBOARD_LAYOUT))
      expect(stated, `${field} (${limit.toString()})`).toContain(limit);
  });

  /*
   * The older versions are kept as the record of what their evals were run against, so they are
   * deliberately *not* held to the current numbers. This asserts the gap rather than leaving a
   * reader to wonder whether v1 was missed: v1 is why ADR 0066 exists.
   */
  it("records that v1 stated none of them, which is the bug", () => {
    const stated = numbersIn(prompt("board_actions", 1));
    expect(stated).not.toContain(BOARD_ACTIONS.summary);
  });
});
