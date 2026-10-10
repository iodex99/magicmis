import { readFileSync } from "node:fs";

import type { PeriodId } from "@magicmis/core/time";
import { checkCommentary } from "@magicmis/engine";
import {
  buildWidgetView,
  companyFormat,
  labelsFor,
  placeholderSegments,
  renderCommentary,
} from "@magicmis/render-dashboard";
import { describe, expect, it } from "vitest";

import { sampleCompany } from "./sample-company";

/*
 * The sample company is a recording (ADR 0086), so nothing re-checks it at the moment it is
 * shown except the browser's own placeholder check — which hides a commentary that fails rather
 * than showing it. These hold it to the rules a live payload meets, so a change to the engine,
 * the board or the placeholder rule that the recording no longer fits fails here, and the fix is
 * to record it again.
 */

const sample = sampleCompany();
const { money, currencySymbol } = sample.dashboard.company;
const format = { ...companyFormat(money, currencySymbol), name: () => null };

/** Every figure a text names, with whether the recording holds it. */
const unresolved = (text: string, values: Parameters<typeof placeholderSegments>[1]) =>
  placeholderSegments(text, values, format)
    .filter((s) => s.kind === "value" && s.hint !== null)
    .map((s) => (s.kind === "value" ? s.metricKey : null));

describe("the sample company (ADR 0086)", () => {
  it("passes the commentary's figure check, and every figure it names is in the recording", () => {
    const { output, pack, allowlist, values } = sample.commentary.payload;
    expect(renderCommentary(output, pack, values, allowlist, format).ok).toBe(true);
    for (const section of output.sections)
      for (const text of [section.heading, ...section.paragraphs.map((p) => p.text)])
        expect(unresolved(text, values)).toEqual([]);
  });

  it("passes the same check on every field of where to act", () => {
    const { output, pack, allowlist, values } = sample.boardActions.payload;
    const texts = [
      output.summary,
      ...output.actions.flatMap((a) => [a.heading, a.because, a.todo]),
    ];
    // The V12 rule, applied to each field as the stage's own check applies it.
    expect(
      checkCommentary(
        { sections: [{ heading: "", paragraphs: texts.map((text) => ({ text })) }] },
        pack,
        allowlist,
      ),
    ).toEqual([]);
    for (const text of texts) expect(unresolved(text, values)).toEqual([]);
  });

  it("has something in every box for the month the board opens on", () => {
    const { dashboard, values, periods, company } = sample.dashboard;
    const spec = dashboard?.spec;
    if (spec === undefined) throw new Error("the sample has no board");
    const label = labelsFor(spec.calculated);
    for (const widget of spec.widgets) {
      const view = buildWidgetView(widget, values, {
        period: periods[0] as PeriodId,
        fyStartMonth: company.fyStartMonth,
        format: { ...companyFormat(money, currencySymbol), label },
        dimensionFilter: null,
        lens: { range: null, compare: null },
      });
      expect(view.kind, widget.title).not.toBe("empty");
    }
  });

  it("names nothing from the run that recorded it", () => {
    const text = readFileSync(new URL("./sample-company.json", import.meta.url), "utf8");
    expect(text).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/u,
    );
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/u);
  });
});
