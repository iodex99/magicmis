# 0074 — London, and the legal documents final

- **Status:** accepted
- **Date:** 2026-09-30
- **Decided by:** the product owner — "i want my customers to be WEST (worldwise, US, UK)
  focused, of course indians too but the revenue would come from the west" and "lock the legal
  pages, i am not going to rework on it, atleast at this point"
- **Supersedes:** [0006](0006-hosting-region.md) (everything in Mumbai). **Closes:** R-10, R-11,
  R-12. **Settles:** R-50 for launch. **Amends:** R-19.

## Context

ADR 0006 put the database, the functions and the key service in Mumbai, because SPEC §5 was
written for Indian customers. The owner now expects most revenue from the United States, the
United Kingdom and Europe, with Indian customers as well. No production project exists yet, so
the region is still a choice rather than a migration.

The terms, the privacy notice and the processing notice were full drafts at `1.2-draft`, each
page saying it awaited legal review. The owner has no lawyer and has decided the documents are
final as written.

## Decision

### 1. Everything in London

| Component | Region |
|---|---|
| Supabase project (Postgres, Auth, Storage) | `eu-west-2`, "West Europe (London)" |
| Vercel Functions (`apps/web`, `apps/admin`) | `lhr1`, committed in each app's `vercel.json` |
| AWS KMS key | `eu-west-2` |
| Worker (pg-boss) | Fly.io, region `lhr` |
| Resend sending domain | Ireland, `eu-west-1` (Resend has no London region) |
| Sentry organisation | EU data storage, Frankfurt (chosen at creation, cannot be changed) |

Why London rather than the US or Mumbai:

- **UK customers**: their data does not leave the UK.
- **EEA customers**: the European Commission renewed the UK's adequacy decisions on
  2025-12-19, to 2031-12-27, so data flows from the EEA to London without further safeguards.
  A US or Indian region would need standard contractual clauses and a transfer assessment for
  every European customer.
- **US customers**: London is roughly 75 ms from the US east coast; Mumbai is roughly 200 ms.
- **Indian customers**: the DPDP Act 2023 (s.16) allows transfers abroad except to countries
  the Government restricts, and none has been restricted. London is roughly 120 ms from India.

The whole stack stays in one AWS region, so the function-to-database hop does not leave it,
exactly as ADR 0006 intended for Mumbai. ADR 0006's other consequences stand: one region's
outage takes the product down, and Routing Middleware runs everywhere, so it must not read the
database.

`vercel.json` did not exist until now, although ADR 0006 said the region would be committed
there. Without it a new Vercel project runs its functions in `iad1`, across the Atlantic from
its database. Both apps now have one.

### 2. The legal documents are final at 1.3

Migration 0068 sets all three documents to `1.3`, and `LegalDocument` stops showing the draft
note because the version no longer ends in `-draft`. The wording changed first, so the version
change is honest about it:

- **Where data is.** The privacy notice says data is stored and processed in the United
  Kingdom. It names every provider and its region, including the background job host, which
  had been left "to be confirmed". The international transfers section explains adequacy for
  the EEA, standard contractual clauses for the US, and DPDP s.16 for India. The processing
  notice says files are read on servers in the United Kingdom.
- **Things no longer true.** The privacy notice's summary line said files are "deleted on a
  schedule". That stopped being true with ADR 0047, and so did the security page's heading,
  the public AI page's answer and the explainer's line. Sign-in is described as password, "or
  with Google or Apple where we offer it" (ADR 0043), in both documents.
- **Where to ask.** The security page answers "Where is my data stored?", without naming a
  vendor (ADR 0042).

Because the processing notice is enforced per version, an existing account accepts it again
before its next upload. That is right for a change to where its files are kept.

### 3. What a lawyer would look at first

These are recorded so they are not lost. They are not open items.

- Section 7 of the terms has the Article 28 processor commitments. Some EU/UK customers will
  still ask for a signed data processing agreement, and the terms offer one on request.
- Section 13's cap is twelve months of payments.
- Section 17 puts governing law in India and the courts in the city of the registered office.
- The no-refund rule, against consumer law in the countries sold into. The terms exclude
  consumers, and section 11 refunds unused credits if the service ends.

## What still needs the owner

These are facts, not wording. Each is an admin edit of `legal.contacts` or `billing.seller`,
not a deploy, and the pages say "to be published" until each is filled in:

- the support and privacy email addresses;
- the grievance officer's name and email;
- the jurisdiction city;
- the seller's legal name and address (R-02).

## Consequences

- When the production projects are created, each goes in the region in the table above. The
  privacy notice already says so, so a project made anywhere else makes the notice untrue.
- `docs/compliance/processing-register.md` states the same regions.
- The key rotation runbook's key region is `eu-west-2`.

## Sources (verified 2026-09-30)

| Fact | Source |
|---|---|
| Supabase "West Europe (London)", `eu-west-2` | <https://supabase.com/docs/guides/platform/regions> |
| Vercel `lhr1` is `eu-west-2`, London; default `iad1`; `"regions"` in `vercel.json`; Hobby one region, Pro five | <https://vercel.com/docs/regions>, <https://vercel.com/docs/functions/configuring-functions/region> |
| Resend regions: us-east-1, eu-west-1 (Ireland), sa-east-1, ap-northeast-1; chosen per domain | <https://resend.com/docs/dashboard/domains/regions> |
| Sentry data storage: US (Iowa) or EU (Frankfurt), chosen at setup, not changeable | <https://docs.sentry.io/organization/data-storage-location/> |
| EU renewed the UK adequacy decisions on 2025-12-19, expiring 2031-12-27 | <https://www.hunton.com/privacy-and-information-security-law/european-commission-renews-uk-data-adequacy-decisions> |
| AWS KMS: $1 a month per key, $0.03 per 10,000 requests, 20,000 free a month | <https://aws.amazon.com/kms/pricing/> |
| Fly.io: London (`lhr`) region; shared-cpu-1x 512 MB about $5.83 a month in `iad`, London about 13.5% more | <https://docs.fly.io/about/pricing/> |
