# 0068 — A start that costs nothing

- **Status:** accepted
- **Date:** 2026-09-29
- **Decided by:** the product owner ("okay do it, give 1500 credits … and we can also market it")
- **Amends:** locked decision 3 (SPEC §2.3), as ADR [0040](0040-credits-that-keep-a-price-book-that-moves.md)
  did before it. Extends [0050](0050-a-wallet-that-sells.md) and [0052](0052-what-a-rupee-costs-to-earn.md).

## Context

Locked decision 3 said nothing is free: no free tier, trial, free generation, or free sample on
the customer's own data. The owner's worry was that a prepaid product with nothing to try loses
people before they see what it does, and the doubt a chartered accountant most needs settled
cannot be settled on a sample dashboard: whether it works on *their* messy trial balance.

What a free credit actually costs was measured rather than guessed. The live evals (R-28) put
every AI call at a fraction of a cent, so a new account that spends everything it is given — one
first run at the Professional tier (1,298 credits: company setup 999 and the dashboard it
delivers 299) and around ten chat questions — costs roughly ₹10 of real AI. The smallest pack
sells for ₹2,000, so one sale in about two hundred trials pays for all of them. A monthly refresh
on unchanged structure still makes no AI calls, so the recurring margin is untouched.

The real risks are not the AI bill. They are a free MIS taken and never paid for, and the same
person collecting the offer again and again with a fresh inbox.

## Decision

1. **Every new account is granted 1,500 welcome credits at its first sign-in.** The number is
   `wallet.welcome_credits` (admin-editable; 0 switches the offer off). It is an ordinary lot with
   source `welcome`, spent oldest first like any other, so every action it pays for is still held
   and captured at its price-book price: no path delivers analysis without a captured charge.
   1,500 covers exactly one first run at Professional with a little over, and cannot
   pay for two (two first runs cost 2,076 even at Efficient), so the amount itself keeps the offer
   to one company. Expert is out of reach by construction.
2. **Decided once per account, granted once per mailbox.** `welcome_credits` holds one row per
   account, granted or withheld with a reason (migrations 0064 and 0065), and a fingerprint of the
   mailbox the address reaches. The decision runs in one transaction behind advisory locks on the
   account and on the mailbox, so two first sign-ins racing — a double-clicked link, a second tab,
   two aliases of one inbox — cannot both be granted or both count against the network: the race test found exactly that bug in the first version,
   where three racers locked their own network out for a month. A failure leaves nothing decided,
   and the next sign-in decides again. Accounts that had been signed in to before the offer are
   recorded as `existing_account` and get nothing; one created but never signed in to is decided
   at its first sign-in like any other new account.
3. **Wherever the first sign-in happens, it decides.** The email link, a password sign-in, the
   password reset and the Google or Apple finish step each claim a session and then call
   `welcomeAfterClaim`. After the first decision it is one indexed read. It never fails a sign-in.
4. **Three things withhold it for good, and none stops the account working.** The offer switched
   off; an address at a throwaway-mail service or any subdomain of one
   (`wallet.welcome_blocked_email_domains`, admin-editable); and a mailbox that has had its grant
   already. Addresses are compared as the mailbox they reach — lower case, any `+tag` dropped, and
   for Gmail the dots ignored and googlemail.com folded in — and the fingerprint outlives the
   account, so deleting an account and signing up again, or `name+1@gmail.com` beside
   `name+2@gmail.com`, collects nothing. No card is asked for: sign-up still asks four things.
5. **Two things only defer it, and nothing is recorded.** A network that has had three grants in
   thirty days (`auth_throttle` scope `welcome`; IPv6 by its /64, the key hashed so no address sits
   in the table), and the platform past 300 grants in a day (scope `welcome_global`), a ceiling on
   what the offer can cost if every other check is got around. A deferral rolls back whatever was
   counted and leaves the account undecided, so a real customer who first signs in behind a crowded
   office or mobile address, or on a day of heavy sign-ups, is decided again at a later sign-in;
   someone farming from one network gets the offer no faster than the pace. The first version
   withheld these for good, which the review found would deny genuine customers permanently.
6. **Welcome credits are not revenue.** They pay for real work but carry no money. The margin
   report matches each welcome-funded capture to the job, chat message or memory fee it paid for,
   so a filter narrows it as it narrows the actions, and subtracts it from captured value
   (`welcomeCreditsSpent`, and "of which welcome" per action); the monthly accounting exports keep
   welcome credits out of `credits_consumed` and out of the `outstanding_credits` liability, each in
   a `welcome_credits` column of its own; the business page leaves them out of recognised revenue and out of
   deferred (unspent welcome credits are owed nothing), and adds whether a free start turns into a
   paying customer. The AI they consumed stays in AI cost, which is where the offer's real cost
   shows. The per-action AI ratio is unchanged, because the price charged is still the price.
7. **The site says it, from the live offer.** One module (`lib/welcome-copy.ts`) builds every
   sentence from the configured grant and the price book: the number is the configured number,
   "enough to set up your first company" is said only while the grant covers a first run at
   Professional, and with the offer off the product says plainly that it is paid. It says "new
   accounts start with", not "every new account", because not every one does. Home, pricing,
   sign-up, the page for accountants and `/llms.txt` read it, reused for a minute; a config value
   the schema refuses or a missing price row states no offer rather than failing the page. The six places that said
   there was no free tier or trial now say what is true. The new account's first screen, the
   Getting started steps and the Wallet (a "Welcome credits" lot, in an "Added" column rather than
   "Bought") say it in the app.
8. **The terms say what the offer is and is not** (TODO(review): R-10): a one-time grant of the
   amount the site shows at the time, no cash value, one per person or business, withheld for
   throwaway addresses and repeat sign-ups from one network, withdrawable if obtained around those
   limits, and the offer may change or end without touching credits already granted.

## Consequences

- Locked decision 3 now reads: nothing is free **except a one-time welcome grant**, which is spent
  through the same held-and-captured path as bought credits. The rule that sheet recognition,
  mappings, findings and outputs appear only inside a paid action still holds; welcome credits pay.
- The gross margin estimate carries the offer's cost honestly: welcome-funded work adds AI cost and
  no revenue. Expect the margin figure to dip as new accounts arrive and recover as they convert.
- A memory fee paid from welcome credits is subtracted from consumption though its capture is not
  in paid revenue, so the consumption run rate reads slightly low for new accounts. That is the
  safe direction and is said in a comment where it happens.
- Every local test sign-up comes from one address, so only three per run are granted. Tests that
  count credits read the account's actual decision (`welcomeGranted`), tests that need an empty
  wallet take the credits away as support would (`emptyTheWallet`), and the welcome spec signs up
  from its own address per test.
- For the chartered accountant (R-84): the GST treatment of credits given with no consideration,
  and whether any input tax credit must be reversed.
- For the data-protection review (R-50): the mailbox fingerprint is kept after an account is
  deleted and its address overwritten, so the offer is not collected twice. It is one-way, like the
  email keys the sign-in throttle keeps, and holds no address; the privacy notice should say so.
- Not changed here, and worth knowing (R-85): the email-and-password sign-up writes the account
  before the address is proven, so someone can sign up with another person's address and wait for
  them to click the confirmation link (the gap ADR 0043 closed only for Google and Apple). The
  grant does not create that gap, but it now gives it a small reward.

## Tests

`packages/accounts/test/welcome.test.ts`: the grant once and only reads afterwards, the ledger
replaying clean; a property test that 2–6 racing first sign-ins grant exactly once and count the
network once; throwaway addresses and subdomains withheld without counting; one mailbox granted once
across spellings, after deletion, and when two aliases race; three grants per network a month and
the fourth deferred, then granted from another network, IPv6 by /64; the daily cap defers; a new
window grants again; an existing account and a switched-off offer grant nothing and stay decided;
the decision row's constraints and the one-grant-per-mailbox index.
`packages/billing/test/billing.test.ts`: the accounting exports keep welcome credits out of
consumed revenue and the liability.
`packages/ai/test/services.test.ts` and `apps/admin/test/business.test.ts`: welcome-funded spend
is not captured value, recognised revenue or deferred, a filter narrows it with the actions, and a
later purchase counts as converted.
`packages/db/test/report-indexes.test.ts`: the revenue read still uses its time index with the
join. `apps/web/src/lib/welcome-copy.test.ts` and `llms.test.ts`: the copy with the offer on,
short of a first run, and off. `apps/web/e2e/welcome.spec.ts`: a new account sees its 1,500 on the
first screen and runs its first company on them with no purchase, every capture drawn from the
welcome lot, then refreshes the next month with no AI call; the site states the offer; a throwaway
address gets none, and a fourth account from one network waits and is granted when it signs in
from elsewhere.
