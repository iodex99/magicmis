import { documentVersionsSchema } from "@magicmis/accounts";
import { appendAudit } from "@magicmis/db/audit";
import { readConfig } from "@magicmis/db/config";
import { withTransaction } from "@magicmis/db/tx";
import { z } from "zod";

import { db } from "@/lib/db";
import { idempotent, ok, parseJson, requestMeta, withAccount } from "@/lib/http";

const DOCUMENTS = ["terms", "privacy", "processing"] as const;

/** Which current document versions this account has accepted (SPEC §31). */
async function consentState(accountId: string) {
  const pool = db();
  const versions = await readConfig(
    pool,
    "legal.document_versions",
    documentVersionsSchema,
  );
  const r = await pool.query<{ document: string; version: string; accepted_at: Date }>(
    `select distinct on (document) document, version, accepted_at from public.consents
     where account_id = $1 order by document, accepted_at desc`,
    [accountId],
  );
  return Object.fromEntries(
    DOCUMENTS.map((d) => {
      const latest = r.rows.find((row) => row.document === d);
      return [
        d,
        {
          currentVersion: versions[d],
          acceptedVersion: latest?.version ?? null,
          acceptedAt: latest?.accepted_at.toISOString() ?? null,
          current: latest?.version === versions[d],
        },
      ];
    }),
  );
}

/** GET /api/account/consents */
export async function GET(): Promise<Response> {
  return withAccount(async (account) =>
    ok({ consents: await consentState(account.accountId) }),
  );
}

const bodySchema = z.object({ document: z.enum(DOCUMENTS) });

/**
 * POST /api/account/consents — accept the current version of a document. The first-upload processing
 * notice records `processing` here. Accepting a version already accepted records nothing new.
 */
export async function POST(request: Request): Promise<Response> {
  return withAccount(async (account) => {
    const parsed = await parseJson(request, bodySchema);
    if (!parsed.ok) return parsed.response;
    const { document } = parsed.data;
    const { ip } = await requestMeta();
    return idempotent(request, `consent:${account.accountId}`, { document }, async () => {
      await withTransaction(db(), async (tx) => {
        const versions = await readConfig(
          tx,
          "legal.document_versions",
          documentVersionsSchema,
        );
        const version = versions[document];
        await tx.query(`select id from public.accounts where id = $1 for update`, [
          account.accountId,
        ]);
        const existing = await tx.query(
          `select 1 from public.consents where account_id = $1 and document = $2 and version = $3`,
          [account.accountId, document, version],
        );
        if (existing.rows.length > 0) return;
        await tx.query(
          `insert into public.consents (account_id, document, version, ip) values ($1, $2, $3, $4)`,
          [account.accountId, document, version, ip],
        );
        await appendAudit(tx, {
          actorType: "account",
          actorId: account.accountId,
          action: "consent.recorded",
          targetType: "consent",
          metadata: { document, version },
          ip,
        });
      });
      return { status: 200, body: { consents: await consentState(account.accountId) } };
    });
  });
}
