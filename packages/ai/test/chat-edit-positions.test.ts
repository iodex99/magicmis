/** A dashboard change is told where each box is, so it copies a position rather than counting (ADR 0085). */

import { DEFAULT_DASHBOARD } from "@magicmis/render-dashboard";
import { describe, expect, it } from "vitest";

import { boxPositions, chatEditStageSpec } from "../src/chat-stages";

describe("boxPositions", () => {
  it("lists every box with its exact pointer and id", () => {
    const text = boxPositions(DEFAULT_DASHBOARD) ?? "";
    DEFAULT_DASHBOARD.widgets.forEach((w, i) => {
      expect(text).toContain(`/widgets/${i.toString()}\t${w.id}\t`);
    });
  });

  it("is absent for a spec with no boxes or no widgets array", () => {
    expect(boxPositions({ widgets: [] })).toBeNull();
    expect(boxPositions({ rows: [] })).toBeNull();
    expect(boxPositions(null)).toBeNull();
  });

  it("is given to a dashboard change and not to a template change", () => {
    const base = {
      spec: DEFAULT_DASHBOARD as never,
      metrics: [],
      summary: null,
      history: [],
      request: "Remove the costs box.",
    };
    expect(chatEditStageSpec.volatile({ ...base, target: "dashboard" })).toContain(
      "boxes by position",
    );
    expect(chatEditStageSpec.volatile({ ...base, target: "template" })).not.toContain(
      "boxes by position",
    );
  });
});
