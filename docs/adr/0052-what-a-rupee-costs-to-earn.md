# ADR 0052: What a rupee costs to earn, and copy that leads with the outcome

**Status:** accepted · **Date:** 2026-09-19 · **Decided by** the product owner ("take your best
decisions on the points") · **Extends** ADR [0050](0050-a-wallet-that-sells.md) and ADR
[0039](0039-raw-data-and-the-words-the-market-types.md)

## Context

The owner asked how the business earns: what a customer's payment is split into, where the AI
cost sits, and whether keeping customers' files now has to be priced in. Working through it
turned up four things wrong in the margin reporting and one thing wrong in the marketing copy.
The owner then asked for a decision on each.

Nothing here changes a price a customer pays. Four of the five change what we believe we keep,
and the fifth changes how the product describes itself.

## The economics, for the record

Credits are the unit: 1 credit is ₹1 ex-GST, and packs carry a volume bonus, so a credit is
actually sold for between ₹0.87 and ₹1.00. The same packs priced in dollars earn between 4% and
38% more per credit at the seeded rate, and carry no GST to remit, because an export of services
is zero-rated (ADR 0030).

Against that, every action's AI spend is capped at `max_ai_cost_ratio`, seeded at 20% of its
price (locked decision 6). The cap is a ceiling, not the expectation: the routed models and
token budgets put most actions between 2% and 5%, and a monthly refresh on unchanged structure
makes no AI calls at all, which is where the recurring margin comes from. None of those figures
is measured yet, because no prompt version is active (R-28); they are estimates from the routing
table and published model prices.

**Storage does not belong in the credit price.** Kept files live in object storage, not in the
database, at roughly two cents per gigabyte per month. A company at the 2 GiB cap costs about ₹4
a month against a ₹99 memory fee, and a realistic company costs a fraction of that. Keeping a
file also changes nothing about what the AI reads: the model receives redacted structure and
capped samples whether the file was kept for a day or for ever. Pricing storage into tokens
would charge twice for one cost that the memory fee already covers many times over.

## Decisions

1. **Infrastructure has a cost.** `admin.infra_cost_paise_per_day` was seeded at 0, so the daily
   gross-margin estimate was overstated by the entire hosting bill. Set to 25,000 paise, about
   ₹7,500 a month, to be replaced by the real total after the first month of invoices (R-67).
2. **The payment fee is per currency, and includes the GST charged on the fee.** One percentage
   for two currencies could not be right, and 2.00 left out the 18% GST levied on the gateway's
   own fee. `admin.payment_fee_percent_by_currency` is seeded `{INR: 2.36, USD: 3.54}`, to be
   confirmed against the live rate card (R-68). The old single-rate key is left in place,
   unread, rather than deleted, so an operator who edited it can still see what it held.
3. **The gateway fee is charged on money received, not on credits spent.** The margin report
   applied the percentage to captured credits. That was wrong three ways: bonus credits carry no
   money at all, a pack bought in one month and spent over the next six put the whole fee in the
   wrong month, and a bank transfer pays no gateway fee yet was charged one. It now sums the
   purchases that settled inside the window, by the method that actually charges a fee, at the
   rate for their own currency. A dollar purchase is converted to paise for reporting at the
   same buffered rate that values vendor cost; no customer-facing amount is ever converted.
4. **The instant surcharge is folded into the price.** ADR 0050 removed the delivery choice, so
   commentary always paid 149 base plus a 49 surcharge. A new price-book version makes it 198
   base with no surcharge. The customer pays exactly what they paid yesterday; the book now
   describes a price rather than a discount nobody can choose.
5. **The copy leads with the outcome.** Every public description named what the machine emits, a
   workbook and a dashboard and commentary, and none of them named what the reader ends up with.
   The headline, the hero paragraph the owner flagged, the three steps, five page descriptions
   and a new question all now lead with insight and action, and carry the phrases the market
   types: turning raw data into business insights, and into actionable insights. A short band of
   three plain claims sits under the hero. Each is something the product can be held to today;
   there are still no testimonials, no customer logos and no usage counts.

## Deferred, with reasons

- **Reconciling real settlements** (R-69). Nothing compares the configured percentage with what
  the gateway actually deducted. It needs a live account first (R-26).
- **Unspent credits as a liability** (R-70) and **GST on AI spend under reverse charge** (R-71).
  Both are accounting questions, not engineering ones, and belong with the owner's chartered
  accountant alongside the SAC code and GST rate already open.

## Consequences

- The margin dashboard will report a **lower** number than it did, and a truer one. Anyone
  comparing it against last week's figure should expect the drop.
- Payment fees now appear in the period the money arrived, not the period the credits were
  spent, so a month with a big pack purchase carries its own fee.
- The public site's vocabulary widens from the artefact to the outcome without any new claim.

## Tests

`packages/ai/test/services.test.ts`: a window with plenty of captured credits and no purchases
carries no gateway fee at all; infrastructure is charged per day; a rupee card purchase is
charged 2.36% exactly; a bank transfer adds nothing; and a dollar purchase is charged at the
international rate, pinned by a range the domestic rate cannot reach.
