"use server";

import { STAGES } from "@magicmis/ai";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  activatePrompt,
  decideCandidate,
  grantBreakGlass,
  modelSchema,
  publishConfig,
  publishModel,
  publishRoute,
  removeLibraryEntry,
  revokeBreakGlass,
  routeSchema,
} from "@/server/console";
import { db } from "@/server/runtime";
import { requireAdmin } from "@/server/session";

/**
 * Admin console mutations added in Phase 9 (SPEC §26). Same pattern as `actions.ts`: authenticate,
 * validate, call a server function that audits in its transaction, redirect outside try/catch.
 */

const text = (form: FormData, name: string): string => {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
};

const back = (path: string, message: string): never =>
  redirect(`${path}${path.includes("?") ? "&" : "?"}${new URLSearchParams({ error: message }).toString()}`);

const done = (path: string, message: string): never => {
  revalidatePath(path.split("?")[0] ?? path);
  return redirect(`${path}${path.includes("?") ? "&" : "?"}${new URLSearchParams({ ok: message }).toString()}`);
};

const message = (error: unknown, fallback: string) =>
  error instanceof RangeError || (error instanceof Error && error.name === "ActivationError") ? error.message : fallback;

export async function publishRouteAction(form: FormData): Promise<void> {
  const admin = await requireAdmin();
  const parsed = routeSchema.safeParse({
    tier: text(form, "tier"),
    stage: text(form, "stage"),
    modelId: text(form, "modelId"),
    effort: text(form, "effort") || null,
    maxTokens: text(form, "maxTokens"),
    fallbackChain: text(form, "fallbackChain")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== ""),
  });
  if (!parsed.success) return back("/models", parsed.error.issues[0]?.message ?? "Invalid route");
  let version: number;
  try {
    ({ version } = await publishRoute(db(), { adminId: admin.adminId, ip: admin.ip, route: parsed.data }));
  } catch (error) {
    return back("/models", message(error, "Could not publish the route"));
  }
  done("/models", `Published ${parsed.data.tier}/${parsed.data.stage} version ${version.toString()}`);
}

export async function publishModelAction(form: FormData): Promise<void> {
  const admin = await requireAdmin();
  const parsed = modelSchema.safeParse({
    modelId: text(form, "modelId"),
    inputPricePerMTokMicroUsd: text(form, "input"),
    outputPricePerMTokMicroUsd: text(form, "output"),
    available: text(form, "available") === "on",
    sourceUrl: text(form, "sourceUrl"),
  });
  if (!parsed.success) return back("/models", parsed.error.issues[0]?.message ?? "Invalid model");
  let version: number;
  try {
    ({ version } = await publishModel(db(), { adminId: admin.adminId, ip: admin.ip, model: parsed.data }));
  } catch (error) {
    return back("/models", message(error, "Could not update the model"));
  }
  done("/models", `Re-verified ${parsed.data.modelId} (version ${version.toString()})`);
}

export async function publishConfigAction(form: FormData): Promise<void> {
  const admin = await requireAdmin();
  const key = text(form, "key");
  let version: number;
  try {
    ({ version } = await publishConfig(db(), { adminId: admin.adminId, ip: admin.ip, key, valueJson: text(form, "value") }));
  } catch (error) {
    return back("/config", message(error, "Could not publish the value"));
  }
  done("/config", `Published ${key} version ${version.toString()}`);
}

export async function decideCandidateAction(form: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = z.uuid().safeParse(text(form, "candidateId"));
  const decision = z.enum(["approved", "rejected"]).safeParse(text(form, "decision"));
  if (!id.success || !decision.success) return back("/library", "Invalid request");
  try {
    await decideCandidate(db(), { adminId: admin.adminId, ip: admin.ip, candidateId: id.data, decision: decision.data });
  } catch (error) {
    return back("/library", message(error, "Could not record the decision"));
  }
  done("/library", decision.data === "approved" ? "Added to the library" : "Candidate rejected");
}

export async function removeLibraryEntryAction(form: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = z.uuid().safeParse(text(form, "entryId"));
  if (!id.success) return back("/library", "Invalid request");
  try {
    await removeLibraryEntry(db(), { adminId: admin.adminId, ip: admin.ip, entryId: id.data });
  } catch (error) {
    return back("/library", message(error, "Could not remove the entry"));
  }
  done("/library", "Entry removed");
}

export async function activatePromptAction(form: FormData): Promise<void> {
  const admin = await requireAdmin();
  const stage = z.enum(STAGES).safeParse(text(form, "stage"));
  const tier = z.enum(["efficient", "professional", "expert", "expert_plus"]).safeParse(text(form, "tier"));
  const version = z.coerce.number().int().positive().safeParse(text(form, "promptVersion"));
  if (!stage.success || !tier.success || !version.success) return back("/prompts", "Invalid request");
  try {
    await activatePrompt(db(), { adminId: admin.adminId, stage: stage.data, tier: tier.data, promptVersion: version.data });
  } catch (error) {
    return back("/prompts", message(error, "Activation refused"));
  }
  done("/prompts", `Activated ${stage.data} v${version.data.toString()} for ${tier.data}`);
}

export async function grantBreakGlassAction(form: FormData): Promise<void> {
  const admin = await requireAdmin();
  const accountId = text(form, "accountId");
  const path = `/accounts/${accountId}`;
  if (!z.uuid().safeParse(accountId).success) return back("/accounts", "Invalid request");
  try {
    await grantBreakGlass(db(), {
      adminId: admin.adminId,
      ip: admin.ip,
      accountId,
      reason: text(form, "reason"),
      minutes: Number.parseInt(text(form, "minutes"), 10),
    });
  } catch (error) {
    return back(path, message(error, "Could not grant access"));
  }
  done(path, "Access granted; the account holder has been notified");
}

export async function revokeBreakGlassAction(form: FormData): Promise<void> {
  const admin = await requireAdmin();
  const accountId = text(form, "accountId");
  const grantId = z.uuid().safeParse(text(form, "grantId"));
  if (!grantId.success) return back(`/accounts/${accountId}`, "Invalid request");
  try {
    await revokeBreakGlass(db(), { adminId: admin.adminId, ip: admin.ip, grantId: grantId.data });
  } catch (error) {
    return back(`/accounts/${accountId}`, message(error, "Could not revoke"));
  }
  done(`/accounts/${accountId}`, "Access revoked");
}
