# 0075 — The final prices

- **Status:** accepted
- **Date:** 2026-09-30
- **Decided by:** the product owner — "regarding the final prices, i would go with your
  recommendation and fix it (you already know how much profit margin i would like)". The margin
  they asked for earlier: "really good so that it covers all of costs like server, data storage,
  marketing and i am left with genuine hefty profits".
- **Closes:** R-04, R-05. **Builds on:** [0030](0030-worldwide-two-currencies.md),
  [0052](0052-what-a-rupee-costs-to-earn.md), [0068](0068-a-start-that-costs-nothing.md),
  [0074](0074-london-and-the-legal-documents-final.md).

## Context

**AI is not what limits the margin.** The live evals measured it at 0.2 to 2.4 paise per credit
sold. Chat at Expert is the thinnest action, and even there each ₹1 of AI brings in ₹40 of
credits. A monthly refresh on unchanged structure makes no AI call at all. After the gateway fee,
gross margin is 94–97% at the seeded prices (ADR 0052), so raising prices would not protect
margin that is already there. What decides "hefty profits" is revenue per customer, set against
fixed costs.

**The rupee price is fixed.** Locked decision 4 makes a credit ₹1 ex-GST, so a rupee pack is
its credits in rupees, with the bonus as the only discount.

**The dollar price is a free choice.** Prices are set per currency and never converted
(ADR 0030). The owner expects most revenue from the United States, the United Kingdom and Europe
(ADR 0074). The dollar packs seeded in migration 0037 were marked illustrative, pitched "near the
rupee price at a round dollar figure".

**What the market pays in the West** (checked 2026-09-30):

| Product | Price |
|---|---|
| Fathom Pro | $450 a month for 25 companies, plus $17 per extra company, about $18 a company a month |
| Syft, single entity | $19 / $39 / $79 / $119 a month |

At the seeded dollar packs, a Magic MIS company cost a Western customer $10–16 for a full month.
That is below both, and it includes commentary and suggested actions, which neither sells as
standard.

## Decision

1. **The price book in credits is final as it stands.** A company's first run at Professional is
   `company_setup` 999 plus `dashboard_addon` 299, which is 1,298. That stays inside the
   1,500-credit welcome grant, so "enough to set up your first company" stays true. Indian
   prices do not move.
2. **The rupee packs are final as they stand**, because locked decision 4 decides them.
3. **The dollar packs are repriced** (migration 0069):

   | Pack | Credits + bonus | Was | Now | Per credit |
   |---|---|---|---|---|
   | Starter | 2,000 | $29 | **$49** | $0.0245 |
   | Plus | 5,000 + 250 | $69 | **$109** | $0.0208 |
   | Growth | 10,000 + 750 | $129 | **$199** | $0.0185 |
   | Practice | 25,000 + 2,500 | $299 | **$449** | $0.0163 |
   | Firm | 50,000 + 6,000 | $579 | **$849** | $0.0152 |
   | Scale | 100,000 + 15,000 | $1,099 | **$1,549** | $0.0135 |

   Each pack is deactivated and replaced by a new version, because packs are never edited and a
   purchase snapshots its pack. A pack an operator has already repriced is left alone.

## What that means per company

Every figure is at Professional, the default tier.

| | Credits | India, Starter | India, Scale | Abroad, Starter | Abroad, Practice | Abroad, Scale |
|---|---|---|---|---|---|---|
| First month (setup + dashboard) | 1,298 | ₹1,298 | ₹1,129 | $31.80 | $21.19 | $17.48 |
| Core month (refresh, dashboard, memory fee) | 497 | ₹497 | ₹432 | $12.18 | $8.11 | $6.69 |
| Full month (+ commentary, where to act, ten chat questions) | 1,083 | ₹1,083 | ₹942 | $26.53 | $17.68 | $14.59 |

- **Against the market:** a firm buying Practice-sized packs pays about $18 for a full month,
  level with Fathom Pro's per-company rate, for a product that also writes commentary and
  suggests actions. A single company on the Starter pack pays about $27, under Syft's middle
  plan.
- **Against cost:** AI for a full month is about ₹5, well under 1% of any figure in the table.
  The gateway takes 2.36% of rupees and 3.54% of dollars (R-68). Gross margin stays around 95%.
  Each dollar credit now brings in about 40–70% more than before.
- **Against fixed costs:** hosting is about $60–75 a month (ADR 0074): Supabase Pro, Vercel Pro,
  the worker and the key service. That is covered by three to five Western companies on full
  months. Everything after that pays for marketing and is profit.

## Not changed, and why

- **The credit price of any action.** Raising it would raise Indian prices, which the owner did
  not ask for. It would also break the welcome grant's promise, or force the grant up with it.
- **The memory fee** (99 credits a month). It is pure margin already, and a higher one would
  push customers to delete companies they would otherwise keep refreshing.
- **The bonus schedule.** It is what makes a bigger pack cheaper per credit, and the new dollar
  prices keep that order. A test holds it.

## Consequences

- The pricing page, the Wallet and invoices read the packs from the database, so the new prices
  appear everywhere with no copy change. No public page states a figure worked out from the old
  prices.
- A price change here is a migration or the admin console's pack editor, never a deploy of copy.
  Migrations do not write the hash-chained audit log, which is computed in TypeScript, so the
  record of this change is the migration and this ADR, as it was for 0049 and 0063.

## Tests

`packages/billing/test/billing.test.ts`, "the final prices": every rupee pack is its credits in
rupees; each dollar pack is strictly cheaper per credit than the one before it, compared as
cross-multiplied integers and never as a float; and the six dollar prices are the ones above.
`apps/web/e2e/wallet.spec.ts` reads $49, $109 and $1,549 on the page.

## Sources

- Fathom pricing: <https://www.fathomhq.com/pricing> (fetched 2026-09-30).
- Syft pricing: <https://www.capterra.com/p/161231/Syft-Analytics/pricing/> (2026 listing).
- Measured AI cost per action: the R-28 live evals, recorded in ADR 0068 and
  `packages/ai/evals/recordings/`.
