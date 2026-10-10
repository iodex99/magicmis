import { priceFor } from "@magicmis/wallet";

import { AppFrame } from "@/components/AppFrame";
import { EmptyState, PageHeader } from "@/components/ui";
import { accountOrRedirect } from "@/lib/account-page";
import { db } from "@/lib/db";

import { BatchUpload } from "./BatchUpload";

export const metadata = { title: "Month end for several companies" };
export const dynamic = "force-dynamic";

/**
 * Month end for several companies at once (ADR 0087): drop every company's files together, check
 * which company each went to, and each company's refresh runs in turn — its own priced job, its
 * own hold, exactly as if its files had been added on its own page.
 */
export default async function BatchPage() {
  const account = await accountOrRedirect("/app/batch");
  // What each company's refresh holds at each tier, said where the tier is chosen (ADR 0091).
  // Instant, the only delivery a run has (ADR 0050); unreadable says nothing rather than fail.
  const prices = await Promise.all(
    (["efficient", "professional", "expert"] as const).map(async (tier) => {
      const q = await priceFor(db(), {
        actionKey: "monthly_refresh",
        tier,
        delivery: "instant",
      });
      return q.credits.toString();
    }),
  )
    .then(([efficient = "0", professional = "0", expert = "0"]) => ({
      efficient,
      professional,
      expert,
    }))
    .catch(() => null);
  const r = await db().query<{ id: string; name: string; file_names: string[] }>(
    `select c.id, c.name,
            coalesce(array_agg(u.file_name order by u.created_at desc)
                       filter (where u.file_name is not null), '{}') as file_names
       from public.companies c
       left join lateral (
         select su.file_name, su.created_at from public.source_uploads su
          where su.company_id = c.id and su.account_id = c.account_id
            and su.deleted_at is null
          order by su.created_at desc limit 24
       ) u on true
      where c.account_id = $1 and c.deleted_at is null and c.first_setup_at is not null
        and c.lifecycle_state = 'active'
      group by c.id, c.name
      order by c.name`,
    [account.accountId],
  );
  return (
    <AppFrame accountId={account.accountId} businessName={account.businessName}>
      <PageHeader
        eyebrow="Workspace"
        title="Month end for several companies"
        description="Drop every company's files together. Each goes to the company its name matches, which you can change, and each company's refresh runs in turn."
        back={{ href: "/app", label: "Companies" }}
      />
      {r.rows.length < 2 ? (
        <EmptyState icon="building" title="This is for two companies or more">
          Set up a second company first. For one company, add its file from its own page.
        </EmptyState>
      ) : (
        <BatchUpload
          companies={r.rows.map((c) => ({
            id: c.id,
            name: c.name,
            fileNames: c.file_names,
          }))}
          businessName={account.businessName}
          prices={prices}
        />
      )}
    </AppFrame>
  );
}
