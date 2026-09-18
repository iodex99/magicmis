# ADR 0041: Credit packs in dollars, no "fixed" price, and a tour that is rendered, not filmed

**Status:** accepted · **Date:** 2026-09-18 · **Decided by** the product owner · **Amends** ADR
[0040](0040-credits-that-keep-a-price-book-that-moves.md) and ADR
[0037](0037-brand-mark-and-explainer.md); restates locked decisions 5 and 6 as recorded in
CLAUDE.md

## Context

The owner, on seeing ADR 0040 built: keep the pricing page but call it **credit packs**, give
the packs tiers, make it look better, position everything in **dollars** ("we don't show we are
an Indian venture") and drop the GST line; take the credits off the chat's tier chooser and
take down the sentence saying the price is fixed — _"it can never be fixed… if it costs more
than we would be making a loss"_; rebuild the explainer video, which paused and stuttered, and
put it on the homepage; and use "chat with MIS" and phrases like it for search.

## Decisions

### 1. "Standard price", never "fixed price"

The owner is right and ADR 0040's copy was wrong. It said an action costs the same "however
hard the work turns out to be". That is not what locked decision 6 builds: an estimate over the
AI cost cap **stops and asks the customer to accept a quote**, and a runtime cap hit pauses the
job. The price book is a floor the customer can rely on, not a ceiling we absorb without limit.

So the word everywhere is **standard price**, with the quote named wherever price is discussed:
"each action has a standard price in credits; a job that needs more shows you a quote first."
Eighteen passages across the public pages, the wallet and the terms were reworded. The chat's
tier chooser no longer shows credits, and its footnote is back to the one line that matters and
is tested: every message uses credits, including questions outside this MIS.

Nothing in the engine changed. If the AI cost is lower than the price allows, the margin is
ours; if it would be higher than the cap, the customer is quoted before it runs. There is no
path that charges the standard price for a job that costs more than the cap.

### 2. Credit packs, as tiers, in the visitor's own currency

`credit_packs` gains a nullable `name` (migration 0044; admin-editable, seeded Starter, Plus,
Growth, Practice, Firm, Scale). `/pricing` is titled **Credit packs** and sells six cards: name,
price, credits, bonus, and what the pack is roughly worth — _one company set up and N months of
reporting_ — computed on each request from the live price book, never typed in.

**Currency follows the visitor.** Dollars for everyone, except a visitor geolocated in India
(`x-vercel-ip-country: IN`, set and overwritten by Vercel —
https://vercel.com/docs/headers/request-headers#x-vercel-ip-country), who is shown rupees.
The owner asked for dollars only; this is the one deliberate departure, for two reasons that
both bite:

- An Indian buyer **is billed in rupees** (ADR 0030), and prices are set per currency, not
  converted. Showing them the dollar list is quoting one price and charging another.
- The payment provider requires what is sold to be priced publicly **in INR** before it
  activates the merchant account (ADR 0040; R-26, R-60). Its reviewer browses from India.

Nobody outside India ever sees a rupee sign, a GST rate or the word India on the page, which is
the outcome the owner wanted. The tax line is the same true sentence for both audiences: prices
exclude tax, which is added at checkout where it applies. If the owner still wants dollars for
Indian visitors too, it is one line in `lib/server/visitor-currency.ts`.

**Dollar positioning elsewhere:** the footer and the global pages no longer say where anyone is
billed or what a credit is worth in rupees; the global pages (`/`, `/product`, `/how-it-works`,
`/pricing`, `/security`) are tagged `en_US` and the document language is `en`; the markets in
the organisation schema lead with the United States; credits group the western way for
everyone (`115,000`, not `1,15,000`), while rupee _money_ still groups in lakhs. Pages written
for Indian searchers — the MIS format, Tally, the MIS dashboard — keep rupees: that is writing
in the reader's words, not a statement about the company. The legal pages and the security
page still say what is true about the seller and where data is held; those are disclosures, not
positioning.

"Most popular" became **Recommended**: nothing has been sold, so nothing is popular yet.

### 3. The tour is rendered, not filmed

The first tour was CSS animations filmed by Playwright in real time. Real-time capture drops
frames when the machine is busy — that was the stutter — and its six scenes each held for six
to ten seconds — those were the pauses.

`docs/brand/explainer/index.html` is now a pure function of time: a list of tweens evaluated by
`render(t)`, with no CSS animation and no timer. `apps/web/e2e/support/record-tour.ts` asks for
each frame in turn, screenshots it and pipes the stills to the ffmpeg that Playwright already
ships, at a fixed 30 fps. The video is exactly as smooth as its frame rate on any machine, and
re-rendering it is one command. 32 seconds, 1600×900, VP8/WebM, about 4 MB.

It moves continuously: every scene has a slow push-in for its whole life, scenes cross over one
another rather than cutting, files fly in, wires draw, counters run, bars grow, a cursor clicks.
Dollars throughout, and the step that used to be called "Ask the assistant" is **Chat with the
MIS**.

It plays on the homepage, directly under the hero, and on `/how-it-works`. It is silent, so it
autoplays muted when most of it is on screen and pauses when it leaves; `preload="none"` means a
visitor who never scrolls to it never downloads it, and a visitor who prefers reduced motion
gets the poster and a play button.

### 4. Two pages for two unanswered searches

`/chat-with-your-mis` — "chat with MIS", "chat with your financial data", "chat with Tally
data", "MIS chatbot" — argues the one thing the ranking tools cannot: the model never says a
number. `/ai-variance-analysis` — "AI variance analysis", "flux analysis", "automated variance
commentary" — is the commentary feature in US controller vocabulary. Research and sources are in
the plan ([seo-marketing](../plans/seo-marketing.md), §8).

## Found on the way

- `groupWestern` in `lib/actions.ts` had lost its regex backslashes in an earlier session, so
  every dollar amount rendered ungrouped (`$1099.00`). Fixed, with a unit test for both
  groupings.
- The admin **Create pack** action was still sending the pre-ADR-0030 field name
  (`pricePaiseExGst`) to a schema that requires `priceInrMinor`, and ignored the dollar field, so
  the form could not create a pack at all. Fixed alongside the new name field.

## Consequences

- A pack created without a name is shown by its credit count; the admin form now requires one.
- `formatCredits` groups in thousands for every customer. Anything that needs lakh grouping is
  money, and goes through `formatMoney("INR", …)`.
- The tour's source of truth is the HTML. Editing the video means editing the timeline and
  running the recorder; the `.webm` and poster in `public/brand/` are build outputs that happen
  to be committed.
