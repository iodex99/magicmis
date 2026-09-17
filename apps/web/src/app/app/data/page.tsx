import { uploadLimits } from "@magicmis/jobs";

import { AppFrame } from "@/components/AppFrame";
import { PageHeader } from "@/components/ui";
import { accountOrRedirect } from "@/lib/account-page";
import { db } from "@/lib/db";

import { UploadedFiles, type UploadedFileRow } from "./UploadedFiles";

export const metadata = { title: "Uploaded files" };
export const dynamic = "force-dynamic";

/**
 * Every file this account has uploaded and still keeps (ADR 0032): what it was for, when it
 * arrived and when it will be deleted, with a way to delete it now. Names and sizes only.
 */
export default async function UploadedFilesPage() {
  const account = await accountOrRedirect("/app/data");
  const pool = db();
  const [{ retentionDays }, rows] = await Promise.all([
    uploadLimits(pool),
    pool.query<{
      id: string;
      file_name: string;
      byte_size: string;
      status: string;
      company_name: string;
      created_at: Date;
      expires_at: Date;
    }>(
      `select u.id, u.file_name, u.byte_size::text as byte_size, u.status, c.name as company_name,
              u.created_at, u.expires_at
       from source_uploads u join companies c on c.id = u.company_id
       where u.account_id = $1 and u.deleted_at is null
       order by u.created_at desc
       limit 500`,
      [account.accountId],
    ),
  ]);
  const files: UploadedFileRow[] = rows.rows.map((r) => ({
    id: r.id,
    name: r.file_name,
    size: Number.parseInt(r.byte_size, 10),
    company: r.company_name,
    usable: r.status === "ready",
    uploadedAt: r.created_at.toISOString(),
    deletesAt: r.expires_at.toISOString(),
  }));
  return (
    <AppFrame accountId={account.accountId} businessName={account.businessName}>
      <PageHeader
        title="Uploaded files"
        description={`Files you upload are encrypted when they arrive and deleted automatically ${retentionDays.toString()} days later. Delete any of them sooner here.`}
      />
      <UploadedFiles files={files} />
    </AppFrame>
  );
}
