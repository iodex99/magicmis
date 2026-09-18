"use server";

import { BillingError, markBankTransferReceived } from "@magicmis/billing";
import { adminAdjust } from "@magicmis/wallet";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { setAccountStatus } from "@/server/accounts";
import {
  createPack,
  packSchema,
  priceBookVersionSchema,
  publishPriceBookVersion,
  setPackActive,
} from "@/server/catalog";
import { db } from "@/server/runtime";
import { requireAdmin } from "@/server/session";

/**
 * Admin mutations (SPEC §26). Each action authenticates itself, validates with Zod, and the
 * server function it calls writes the audit entry in the same transaction as the change.
 * Failures return to the page with a message; `redirect` is always called outside try/catch.
 */

const text = (form: FormData, name: string): string => {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
};

const back = (path: string, message: string): never =>
  redirect(`${path}?${new URLSearchParams({ error: message }).toString()}`);

const done = (path: string, message: string): never => {
  revalidatePath(path);
  return redirect(`${path}?${new URLSearchParams({ ok: message }).toString()}`);
};

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue === undefined
    ? "Invalid input"
    : `${issue.path.join(".")}: ${issue.message}`;
}

export async function publishPriceAction(form: FormData): Promise<void> {
  const admin = await requireAdmin();
  const parsed = priceBookVersionSchema.safeParse({
    actionKey: text(form, "actionKey"),
    baseCredits: text(form, "baseCredits"),
    efficient: text(form, "efficient"),
    professional: text(form, "professional"),
    expert: text(form, "expert"),
    instantSurchargeCredits: text(form, "instantSurchargeCredits") || "0",
    maxAiCostRatio: text(form, "maxAiCostRatio"),
    reservationMode: text(form, "reservationMode"),
    priceFromActionKey: text(form, "priceFromActionKey") || null,
    enabled: text(form, "enabled") === "on",
    // datetime-local is entered in IST.
    effectiveFrom:
      text(form, "effectiveFrom") === ""
        ? new Date()
        : `${text(form, "effectiveFrom")}:00+05:30`,
  });
  if (!parsed.success) return back("/price-book", firstIssue(parsed.error));
  let message: string;
  try {
    const { version } = await publishPriceBookVersion(db(), {
      adminId: admin.adminId,
      version: parsed.data,
      ip: admin.ip,
    });
    message = `Published ${parsed.data.actionKey} version ${version.toString()}`;
  } catch (error) {
    return back(
      "/price-book",
      error instanceof RangeError ? error.message : "Could not publish",
    );
  }
  done("/price-book", message);
}

export async function createPackAction(form: FormData): Promise<void> {
  const admin = await requireAdmin();
  const rupees = text(form, "priceRupees");
  if (!/^\d+$/u.test(rupees)) return back("/packs", "Price must be whole rupees");
  const dollars = text(form, "priceDollars");
  if (dollars !== "" && !/^\d+$/u.test(dollars))
    return back("/packs", "Dollar price must be whole dollars");
  const parsed = packSchema.safeParse({
    name: text(form, "name"),
    priceInrMinor: `${rupees}00`,
    ...(dollars === "" ? {} : { priceUsdMinor: `${dollars}00` }),
    credits: text(form, "credits"),
    bonusCredits: text(form, "bonusCredits") || "0",
    sortOrder: text(form, "sortOrder") || "0",
  });
  if (!parsed.success) return back("/packs", firstIssue(parsed.error));
  await createPack(db(), { adminId: admin.adminId, pack: parsed.data, ip: admin.ip });
  done("/packs", "Pack created");
}

export async function togglePackAction(form: FormData): Promise<void> {
  const admin = await requireAdmin();
  const packId = z.uuid().safeParse(text(form, "packId"));
  if (!packId.success) return back("/packs", "Unknown pack");
  await setPackActive(db(), {
    adminId: admin.adminId,
    packId: packId.data,
    active: text(form, "active") === "true",
    ip: admin.ip,
  });
  done("/packs", "Pack updated");
}

export async function adjustCreditsAction(form: FormData): Promise<void> {
  const admin = await requireAdmin();
  const accountId = text(form, "accountId");
  const path = `/accounts/${accountId}`;
  if (!z.uuid().safeParse(accountId).success) return back("/accounts", "Unknown account");
  const delta = text(form, "delta").trim();
  if (!/^-?\d+$/u.test(delta) || /^-?0+$/u.test(delta))
    return back(path, "Delta must be a non-zero whole number");
  const reason = text(form, "reason").trim();
  if (reason.length < 5)
    return back(path, "A reason of at least 5 characters is required");
  const key = z.uuid().safeParse(text(form, "idempotencyKey"));
  if (!key.success) return back(path, "Reload the page and try again");

  let message: string;
  try {
    const result = await adminAdjust(db(), {
      accountId,
      delta: BigInt(delta),
      reason,
      adminId: admin.adminId,
      idempotencyKey: `admin-adjust:${key.data}`,
      ip: admin.ip,
    });
    message = result.status === "duplicate" ? "Already applied" : "Adjustment applied";
  } catch (error) {
    return back(path, error instanceof Error ? error.message : "Adjustment failed");
  }
  done(path, message);
}

export async function setStatusAction(form: FormData): Promise<void> {
  const admin = await requireAdmin();
  const accountId = text(form, "accountId");
  const path = `/accounts/${accountId}`;
  const status = z.enum(["active", "suspended"]).safeParse(text(form, "status"));
  if (!status.success || !z.uuid().safeParse(accountId).success)
    return back("/accounts", "Invalid request");
  try {
    await setAccountStatus(db(), {
      adminId: admin.adminId,
      accountId,
      status: status.data,
      reason: text(form, "reason"),
      ip: admin.ip,
    });
  } catch (error) {
    return back(path, error instanceof Error ? error.message : "Could not update status");
  }
  done(path, status.data === "suspended" ? "Account suspended" : "Account reactivated");
}

export async function markReceivedAction(form: FormData): Promise<void> {
  const admin = await requireAdmin();
  const purchaseId = z.uuid().safeParse(text(form, "purchaseId"));
  if (!purchaseId.success) return back("/bank-transfers", "Unknown purchase");
  let message: string;
  try {
    const result = await markBankTransferReceived(db(), {
      purchaseId: purchaseId.data,
      utr: text(form, "utr"),
      adminId: admin.adminId,
    });
    message =
      result.status === "credited"
        ? `Credited; tax invoice ${result.invoice.number} issued`
        : "Already credited";
  } catch (error) {
    if (error instanceof BillingError) return back("/bank-transfers", error.message);
    if (error instanceof Error && error.message.includes("purchases_bank_utr_idx")) {
      return back(
        "/bank-transfers",
        "That UTR is already recorded against another purchase",
      );
    }
    throw error;
  }
  done("/bank-transfers", message);
}
