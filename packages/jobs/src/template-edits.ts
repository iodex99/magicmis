/**
 * MIS template edits (SPEC §27 `chat_edit`): validated JSON Patch operations against the company's
 * template, applied as a new immutable blueprint version that records the version it was edited
 * from, so undo restores that template as another new version. The change shows in the next
 * workbook the company renders.
 */

import { patchDocument } from "@magicmis/core/json-patch";
import type { KeyWrapper } from "@magicmis/crypto";
import { latestBlueprint, storeBlueprint } from "@magicmis/engine/server";
import { templateSpecSchema, type TemplateSpec } from "@magicmis/templates";
import type { Pool } from "pg";

import { DashboardError } from "./dashboard";

async function currentTemplate(
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
      "Set up this company before editing its MIS.",
    );
  const template = templateSpecSchema.safeParse(blueprint.parts.templateSpec);
  if (!template.success)
    throw new DashboardError(
      "no_blueprint",
      "This company's template could not be read.",
    );
  return { blueprint, template: template.data };
}

export interface TemplateEdit {
  readonly blueprintVersion: number;
  readonly template: TemplateSpec;
  readonly canUndo: boolean;
}

/** Validates operations against the current template without storing anything. */
export async function previewTemplatePatch(
  pool: Pool,
  wrapper: KeyWrapper,
  input: {
    accountId: string;
    companyId: string;
    baseVersion: number;
    operations: unknown;
  },
): Promise<{ template: TemplateSpec }> {
  const { blueprint, template } = await currentTemplate(pool, wrapper, input);
  if (blueprint.version !== input.baseVersion)
    throw new DashboardError(
      "stale",
      "The MIS changed since this edit was proposed. Ask again.",
    );
  const r = patchDocument(template, input.operations, templateSpecSchema);
  if (!r.ok)
    throw new DashboardError(
      "invalid_patch",
      "That change would make the MIS invalid.",
      r.errors,
    );
  return { template: r.value };
}

export async function applyTemplatePatch(
  pool: Pool,
  wrapper: KeyWrapper,
  input: {
    accountId: string;
    companyId: string;
    baseVersion: number;
    operations: unknown;
  },
): Promise<TemplateEdit> {
  const { template } = await previewTemplatePatch(pool, wrapper, input);
  const { blueprint } = await currentTemplate(pool, wrapper, input);
  const next = { ...template, editedFrom: input.baseVersion };
  const b = await storeBlueprint(pool, wrapper, {
    accountId: input.accountId,
    companyId: input.companyId,
    jobId: null,
    parts: { ...blueprint.parts, templateSpec: next },
  });
  return { blueprintVersion: b.version, template: next, canUndo: true };
}

export async function undoTemplatePatch(
  pool: Pool,
  wrapper: KeyWrapper,
  input: { accountId: string; companyId: string; baseVersion: number },
): Promise<TemplateEdit> {
  const { blueprint, template } = await currentTemplate(pool, wrapper, input);
  if (blueprint.version !== input.baseVersion)
    throw new DashboardError(
      "stale",
      "The MIS changed since you opened it. Reload and try again.",
    );
  if (template.editedFrom == null)
    throw new DashboardError(
      "nothing_to_undo",
      "There is no earlier MIS layout to go back to.",
    );
  const parent = await currentTemplate(pool, wrapper, input, template.editedFrom);
  const b = await storeBlueprint(pool, wrapper, {
    accountId: input.accountId,
    companyId: input.companyId,
    jobId: null,
    parts: { ...blueprint.parts, templateSpec: parent.template },
  });
  return {
    blueprintVersion: b.version,
    template: parent.template,
    canUndo: parent.template.editedFrom != null,
  };
}
