# ADR 0030: Sell worldwide, bill in rupees or dollars

**Status:** accepted · **Date:** 2026-09-16 · **Decided by** the product owner · **Amends** the locked decisions in SPEC §2.14 and §3

## Context

The owner directed that the product should not be restricted to India, and that pricing
should be **US dollars for the rest of the world and rupees for India**.

Two locked decisions stood in the way, so they are amended here rather than worked around
(working rule 3):

- **§2.14 "Indian context"** assumed INR throughout, an April–March financial year,
  lakhs/crores formatting and day-first dates.
- **§3** lists **multi-currency** as explicitly out of scope.

The amendment is deliberately narrow. §3's exclusion was about not becoming a
multi-currency accounting product; what is added is a **second billing currency**, not a
general one, and the reasoning for the limit is in "What this is not" below.

## What made this small

Credits are currency-independent, and that is the whole reason this is a contained change
rather than a rewrite. The price book prices an action in **credits**; the wallet holds
credits; the ledger moves credits. None of that has a currency. Currency appears only where
money is taken: the pack price, the payment, the invoice.

So **§2.4 is amended, not discarded**. "1 credit = ₹1 ex-GST" remains true for a customer
billed in rupees. A credit is the unit of consumption everywhere, and its **sale price** is
set per currency in the price book. What a credit *does* is identical for both.

## Verified before designing (working rule 4)

- **Razorpay accepts USD.** It supports USD, SGD, AUD, CAD, EUR, GBP, HKD, INR and MYR for
  transactions originating from India
  ([international payments](https://razorpay.com/docs/payments/international-payments/),
  verified 2026-09-16), so the existing integration carries the second currency rather than
  needing a second gateway. International payments must be **activated on the account**, and
  receipts need an RBI purpose code and a FIRC/eFIRC for FEMA and GST export evidence — all
  operational, recorded as **R-60**.
- **Export of services is zero-rated** under **§16 of the IGST Act**
  ([CBIC](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_IGST_Act/active/chaptervii/section16_v1.00.html)).
  It qualifies when the supplier is in India, the recipient is outside India, the place of
  supply is outside India, payment is received in **convertible foreign exchange**, and the
  two are not establishments of the same person. Billing abroad in dollars is what satisfies
  the fourth condition.
- **The invoice has to say so.** Under a Letter of Undertaking (Form GST RFD-11, filed once
  per financial year) the export invoice carries the LUT ARN and the endorsement *"Supply
  meant for export without payment of IGST, zero rated supply as per Section 16, IGST Act,
  2017"*. The ARN is a real value only the owner can supply — **R-59**, guarded like the
  seller details (R-27).

## Decision

### The billing country is the input, not the currency

`accounts.billing_country` (ISO 3166-1 alpha-2) decides both what we charge in and how the
sale is taxed. Storing only the currency would lose the *reason* for the tax treatment,
which is the thing an auditor asks about.

`IN` → rupees, GST, Rule 46 tax invoice. Anything else → dollars, zero-rated, export
invoice. An unrecognised country resolves to the **export** treatment, never to GST:
charging Indian GST to someone outside India is an error on a tax document, while the other
direction is at worst a sale that should not have completed — and the country is validated
at the form.

The database enforces the pairing rather than trusting the code: a GST state code is
allowed only on an Indian account, a USD purchase may carry no tax, an export invoice must
carry its endorsement, and bank transfer is INR-only.

### Prices are set per currency, never converted

`credit_pack_prices` holds one row per pack per currency. A pack not offered in a currency
simply has no row — a state two nullable columns cannot express without a rule about what
NULL means.

**There is no exchange rate anywhere on a customer-facing amount.** A price that moves with
the market is not a price, and the cost of serving a customer abroad is not the cost of
serving one here, so dollar prices are their own numbers. (The FX rate in `ai.fx` is
unrelated and unchanged: it converts *vendor cost* for margin reporting, never a price.)

### Money keeps its currency attached

`Amount` is a currency tag plus integer minor units, and **refuses to add across
currencies** rather than converting. Both billing currencies are two-decimal, which is why
the existing integer arithmetic carried over untouched; the type asserts that, so a third
currency with a different exponent — JPY has none, KWD has three — cannot be added without
the compiler objecting at every literal `100n` that would be wrong.

The database columns were **renamed**, not reinterpreted: `total_paise` holding US cents is
a lie every future reader has to be told about individually, and money is the last place to
leave that trap. They are `*_minor` now.

### The one place this could have cost real money

The webhook is where credits are granted, so its comparison is what stands between a
manipulated payment and a free wallet. It now checks **currency as well as amount**. Without
that, a 2900-*cent* purchase ($29) would have been settled by a 2900-*paise* payment (₹29) —
the same integer, a fortieth of the money. There is a test for exactly that, and it asserts
the wallet stays empty.

## What this is not

**It is not per-country tax.** We do not register for VAT, charge sales tax, or handle US
nexus. One Indian seller, two currencies, two GST treatments.

That limit is the point rather than an omission. Going further needs tax registrations in
other jurisdictions, which is a decision about the owner's business and its accountants,
not about this code — and getting it wrong is a legal exposure, not a bug. If a market ever
justifies it, this design does not block it: the currency is already a column, and the tax
treatment is already a branch.

## Consequences

- **Sign-up is unchanged**; billing details, including the country, are still collected at
  the first purchase (migration 0034). The country now drives which fields appear: an
  Indian address asks for a GST state and a six-digit PIN, and no other country has either.
- **`pincode` became `postalCode`** and the address gained `country`. "PIN code" on a form
  shown to a customer in Ohio is simply wrong.
- **The CSV exports group by currency.** A GST summary that added rupees to dollars would
  be worse than one that failed — and GSTR-1 wants exports in their own table anyway.
- **Bank transfer stays INR-only.** An international wire is a different operational process
  (FIRC, purpose code) and is not offered; the constraint says so.
- **Two new review items.** **R-59**: file the LUT and set its ARN. **R-60**: activate
  Razorpay international payments, set the RBI purpose code, and arrange FIRC collection.
  Until R-59 is done, `billing.allow_placeholder_details` being false blocks export
  invoicing, exactly as it blocks domestic invoicing on R-02/R-03.
- **USD pack prices are illustrative seeds**, admin-editable, and fold into **R-04/R-05**
  with the rupee ones. They still wait on R-28's live evals for real cost data.
