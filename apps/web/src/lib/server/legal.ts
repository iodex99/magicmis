import "server-only";

import { readConfig } from "@magicmis/db/config";
import { z } from "zod";

import { db } from "@/lib/db";

/**
 * Everything the legal documents state as a fact about this deployment (R-10, R-11).
 *
 * The periods and names in a terms of service or a privacy notice are promises, and a
 * promise that disagrees with the product is worse than none. So none of them is typed into
 * the pages: each is read from the same configuration the product itself runs on, and a
 * change to a retention period or a grace period changes the published document with it
 * (SPEC §0.5 keeps business numbers out of code for the same reason).
 *
 * Placeholders are passed through as `null` so a page can say plainly that a detail is still
 * to be confirmed, rather than printing "PENDING-REVIEW" at a reader.
 */

const PLACEHOLDER = "PENDING-REVIEW";
const real = (v: string): string | null =>
  v.trim() === "" || v === PLACEHOLDER ? null : v;

const sellerSchema = z.object({
  legal_name: z.string(),
  address: z.array(z.string()),
});

const contactsSchema = z.object({
  support_email: z.string(),
  privacy_email: z.string(),
  grievance_officer_name: z.string(),
  grievance_officer_email: z.string(),
  jurisdiction_city: z.string(),
  last_updated: z.string(),
});

const versionsSchema = z.object({
  terms: z.string(),
  privacy: z.string(),
  processing: z.string(),
});

export interface LegalFacts {
  readonly sellerName: string | null;
  readonly sellerAddress: readonly string[];
  readonly supportEmail: string | null;
  readonly privacyEmail: string | null;
  readonly grievanceOfficerName: string | null;
  readonly grievanceOfficerEmail: string | null;
  readonly jurisdictionCity: string | null;
  readonly lastUpdated: string;
  readonly versions: z.infer<typeof versionsSchema>;
  readonly creditValidityMonths: number;
  readonly graceMonths: number;
  readonly archiveMonths: number;
  readonly deletionPurgeDelayDays: number;
  readonly outputRetentionDays: number;
  readonly uploadRetentionDays: number;
  readonly exportLinkHours: number;
}

export async function legalFacts(): Promise<LegalFacts> {
  const pool = db();
  const n = z.number().int().nonnegative();
  const [
    seller,
    contacts,
    versions,
    validity,
    grace,
    archive,
    purgeDelay,
    outputs,
    link,
    uploads,
  ] = await Promise.all([
    readConfig(pool, "billing.seller", sellerSchema),
    readConfig(pool, "legal.contacts", contactsSchema),
    readConfig(pool, "legal.document_versions", versionsSchema),
    readConfig(pool, "wallet.lot_validity_months", n),
    readConfig(pool, "lifecycle.grace_months", n),
    readConfig(pool, "lifecycle.archive_months", n),
    readConfig(pool, "lifecycle.deletion_purge_delay_days", n),
    readConfig(pool, "outputs.retention_days", n),
    readConfig(pool, "privacy.export_link_hours", n),
    readConfig(pool, "sources.retention_days", n),
  ]);

  const address = seller.address.filter((line) => real(line) !== null);
  return {
    sellerName: real(seller.legal_name),
    sellerAddress: address,
    supportEmail: real(contacts.support_email),
    privacyEmail: real(contacts.privacy_email),
    grievanceOfficerName: real(contacts.grievance_officer_name),
    grievanceOfficerEmail: real(contacts.grievance_officer_email),
    jurisdictionCity: real(contacts.jurisdiction_city),
    lastUpdated: contacts.last_updated,
    versions,
    creditValidityMonths: validity,
    graceMonths: grace,
    archiveMonths: archive,
    deletionPurgeDelayDays: purgeDelay,
    outputRetentionDays: outputs,
    uploadRetentionDays: uploads,
    exportLinkHours: link,
  };
}
