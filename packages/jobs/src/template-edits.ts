/**
 * MIS template edits (SPEC §27 `chat_edit`): validated JSON Patch operations against the company's
 * template, applied as a new immutable blueprint version that records the version it was edited
 * from, so undo restores that template as another new version. The change shows in the next
 * workbook the company renders.
 */

import { patchDocument } from "@magicmis/core/json-patch";
import type { KeyWrapper } from "@magicmis/crypto";
import {
  BlueprintConflict,
  latestBlueprint,
  storeBlueprint,
  type BlueprintParts,
} from "@magicmis/engine/server";
import { templateSpecSchema, type TemplateSpec } from "@magicmis/templates";
import type { Pool } from "pg";

import { DashboardError } from "./layout-error";
import { readStoredTemplate } from "./stored-layout";

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
  const template = readStoredTemplate(blueprint.parts.templateSpec);
  if (template === null)
    throw new DashboardError(
      "no_blueprint",
      "Set up this company before editing its MIS.",
    );
  return { blueprint, template };
}

async function storeTemplate(
  pool: Pool,
  wrapper: KeyWrapper,
  scope: { accountId: string; companyId: string },
  from: { version: number; parts: BlueprintParts },
  template: TemplateSpec,
): Promise<number> {
  try {
    const b = await storeBlueprint(pool, wrapper, {
      accountId: scope.accountId,
      companyId: scope.companyId,
      jobId: null,
      parts: { ...from.parts, templateSpec: template },
      basedOn: from.version,
    });
    return b.version;
  } catch (error) {
    if (error instanceof BlueprintConflict)
      throw new DashboardError(
        "stale",
        "This company's layout changed a moment ago. Ask again.",
      );
    throw error;
  }
}

export interface TemplateEdit {
  readonly blueprintVersion: number;
  readonly template: TemplateSpec;
  readonly canUndo: boolean;
}

/** The patched template and the one version it was read from and checked against. One read. */
async function proposedTemplate(
  pool: Pool,
  wrapper: KeyWrapper,
  input: {
    accountId: string;
    companyId: string;
    baseVersion: number;
    operations: unknown;
  },
) {
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
  return { blueprint, template: r.value };
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
  return { template: (await proposedTemplate(pool, wrapper, input)).template };
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
  const { blueprint, template } = await proposedTemplate(pool, wrapper, input);
  const next = { ...template, editedFrom: input.baseVersion };
  const version = await storeTemplate(pool, wrapper, input, blueprint, next);
  return { blueprintVersion: version, template: next, canUndo: true };
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
  const version = await storeTemplate(pool, wrapper, input, blueprint, parent.template);
  return {
    blueprintVersion: version,
    template: parent.template,
    canUndo: parent.template.editedFrom != null,
  };
}
