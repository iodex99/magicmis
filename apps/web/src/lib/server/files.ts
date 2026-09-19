import "server-only";

import { companyFiles } from "@magicmis/jobs";
import type { Pool } from "pg";

/** A company's stored files as the files table shows them (ADR 0047): names, counts and dates. */
export async function fileRows(
  pool: Pool,
  scope: { accountId: string; companyId: string },
) {
  const files = await companyFiles(pool, scope);
  return files.map((f) => ({
    id: f.id,
    name: f.fileName,
    size: f.byteSize,
    uploadedAt: f.uploadedAt.toISOString(),
    usable: f.usable,
    periods: f.periods,
    onDashboard: f.onDashboard,
    reads: f.reads,
    lastRead:
      f.lastRead === null
        ? null
        : { purpose: f.lastRead.purpose, at: f.lastRead.at.toISOString() },
  }));
}
