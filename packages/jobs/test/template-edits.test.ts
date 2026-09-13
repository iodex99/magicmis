/** SPEC §27 chat_edit on the MIS template: validated patch, new blueprint version, undo. */

import { startTestDb, type TestDb } from "@magicmis/db/test-harness";
import { latestBlueprint, storeBlueprint } from "@magicmis/engine/server";
import { MONTHLY_FINANCIAL_MIS } from "@magicmis/templates";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  applyTemplatePatch,
  previewTemplatePatch,
  undoTemplatePatch,
} from "../src/template-edits";
import { accountWithCompany, wrapper } from "./helpers";

let db: TestDb | undefined;
beforeAll(async () => {
  db = await startTestDb();
}, 180_000);
afterAll(async () => {
  await db?.stop();
});
const pool = () => {
  if (db === undefined) throw new Error("db not started");
  return db.pool;
};

describe("template edits", () => {
  it("applies a renamed row as a new version and undoes back to the original", async () => {
    const c = await accountWithCompany(pool(), 0n);
    await storeBlueprint(pool(), wrapper, {
      ...c,
      jobId: null,
      parts: {
        templateSpec: MONTHLY_FINANCIAL_MIS,
        recipe: {},
        mappingRules: [],
        dashboardSpec: null,
        materiality: {},
        sourceFingerprints: {},
      },
    });
    const ops = [{ op: "replace", path: "/sections/0/rows/0/label", value: "Sales" }];
    const preview = await previewTemplatePatch(pool(), wrapper, {
      ...c,
      baseVersion: 1,
      operations: ops,
    });
    expect(preview.template.sections[0]?.rows[0]?.label).toBe("Sales");

    const applied = await applyTemplatePatch(pool(), wrapper, {
      ...c,
      baseVersion: 1,
      operations: ops,
    });
    expect(applied).toMatchObject({ blueprintVersion: 2, canUndo: true });
    const undone = await undoTemplatePatch(pool(), wrapper, { ...c, baseVersion: 2 });
    expect(undone.template.sections[0]?.rows[0]?.label).toBe("Revenue from operations");
    expect((await latestBlueprint(pool(), wrapper, c))?.version).toBe(3);

    await expect(
      applyTemplatePatch(pool(), wrapper, {
        ...c,
        baseVersion: 3,
        operations: [
          {
            op: "add",
            path: "/sections/0/rows/-",
            value: { kind: "metric", id: "x", label: "X" },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "invalid_patch" });
    await expect(
      undoTemplatePatch(pool(), wrapper, { ...c, baseVersion: 3 }),
    ).rejects.toMatchObject({ code: "nothing_to_undo" });
  });
});
