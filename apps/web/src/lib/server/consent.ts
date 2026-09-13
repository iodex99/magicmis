import "server-only";

import { documentVersionsSchema } from "@magicmis/accounts";
import { readConfig } from "@magicmis/db/config";

import { db } from "@/lib/db";
import { apiError } from "@/lib/http";

/**
 * SPEC §31: nothing derived from the user's files is processed before the current processing notice
 * is accepted. The browser shows the notice; this is the server-side gate on the endpoints that start
 * processing (job creation, chat messages), so a scripted client cannot skip it.
 */
export async function processingConsentRequired(
  accountId: string,
): Promise<Response | null> {
  const pool = db();
  const versions = await readConfig(
    pool,
    "legal.document_versions",
    documentVersionsSchema,
  );
  const r = await pool.query(
    `select 1 from public.consents where account_id = $1 and document = 'processing' and version = $2 limit 1`,
    [accountId, versions.processing],
  );
  if (r.rows.length > 0) return null;
  return apiError(
    403,
    "consent_required",
    "Read and accept the processing notice before uploading files. Reload the page to see it.",
  );
}
