# Plan: sell worldwide, bill in two currencies

Directed by the product owner on 2026-09-16: the product should not be restricted to
India, and pricing should be **USD for the rest of the world, INR for India**.

This changes two locked decisions, so it is recorded rather than worked around (working
rule 3): §2.14 "Indian context" and §3's "multi-currency" exclusion. The ADR carries the
amendments.

## The insight that makes this tractable

Credits are currency-independent. The price book prices an action in **credits**; the
wallet holds **credits**; the ledger moves **credits**. Currency appears in exactly one
place: **buying** credits — the pack price, the payment, the invoice.

So this is not a rewrite of the 109 files that mention paise. It is the purchase path, plus
the places that assume the customer's *books* are Indian.

§2.4 ("1 credit = ₹1 ex-GST") needs amending, not discarding: a credit stays the unit of
consumption, and its **sale price** is set per currency in the price book.

## What "Indian" actually means here, separated

| Thing | Today | Worldwide |
|---|---|---|
| **What we charge** | INR, GST, Rule 46 tax invoice | INR + GST for India; **USD, zero-rated export** for everyone else |
| **The customer's own books** | assumed INR, Apr–Mar, lakhs/crores, day-first dates | the company's own currency, year end, format and date order |
| **Positioning** | "for CA firms in India" | English-language, worldwide |

The second row is mostly already built: `companies` carries `fy_start_month` (1–12),
`number_format` (`lakhs_crores` | `absolute` | `millions`) and `decimals` from migration
0003. What is missing is the **book currency** and the **date order**.

## Verified before designing (working rule 4)

- **Razorpay takes USD.** It supports USD, SGD, AUD, CAD, EUR, GBP, HKD, INR and MYR for
  transactions originating from India
  ([international payments](https://razorpay.com/docs/payments/international-payments/)),
  so the existing gateway integration carries the second currency. International payments
  must be **activated on the account**, and receipts need an RBI purpose code and a
  FIRC/eFIRC for FEMA and GST export evidence — operational, and a new review item.
- **Export of services is zero-rated** under **§16 of the IGST Act**
  ([CBIC](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_IGST_Act/active/chaptervii/section16_v1.00.html)).
  It qualifies when the supplier is in India, the recipient is outside India, the place of
  supply is outside India, payment is in **convertible foreign exchange**, and the two are
  not establishments of the same person — which is exactly the USD case.
- **The export invoice must say so.** With a Letter of Undertaking (Form GST RFD-11, filed
  once per financial year) the invoice carries the LUT ARN and the endorsement *"Supply
  meant for export without payment of IGST, zero rated supply as per Section 16, IGST Act,
  2017"*. Without an LUT, IGST must be paid and reclaimed. The ARN is a real value only the
  owner can supply — a review item, and invoicing refuses placeholder export details the
  same way it already refuses placeholder seller details (R-27).

**This is not per-country tax.** We do not register for VAT, charge sales tax, or handle US
nexus. One Indian seller, two currencies, two GST treatments. That is the whole of it, and
the limit is deliberate: anything more needs tax registrations abroad, which is a decision
about the owner's business rather than about this code.

## Stages

Each is independently shippable and independently verifiable.

### 1. Currency in the core

`Currency` = `"INR" | "USD"`. Both are two-decimal currencies, so the existing integer
minor-unit representation carries over unchanged — the branded `Paise` type generalises to
minor units with a currency tag rather than being duplicated. Formatting becomes
currency-aware: `₹` with lakhs/crores grouping, `$` with thousands grouping.

### 2. Billing currency per account

The billing **country** decides it: India → INR, anything else → USD. Collected with the
billing details at first purchase (migration 0034), alongside the existing state code —
which becomes India-only, as GSTIN already is.

### 3. Packs, quotes, payments, invoices

Packs priced in both currencies. A quote computes GST for India and zero-rated export for
the rest, with the endorsement and LUT ARN. Razorpay orders carry the currency. Two invoice
shapes from one template: Rule 46 tax invoice, and export invoice.

### 4. The customer's own books

A company gains its own **currency** and **date order**. Day-first parsing is right for
India and wrong for the United States, where an ambiguous `03/04` is 4 March — a silent
month shift, which is the worst kind of data error because every total still balances.

### 5. Positioning

The public site stops being India-only: broader keywords, the guides kept (they rank for
Indian queries and those remain a real market), new copy for the rest.

## Rules that still bind

- **§0.5, no hardcoded business numbers.** USD pack prices are config, like INR ones. The
  FX rate for AI-cost reporting is unchanged and separate: it converts vendor cost, not
  customer price. **USD prices are set, not converted** — a price that moves with the
  exchange rate is not a price.
- **§4, never floating point for money.** The currency tag travels with integer minor
  units; no conversion between currencies happens on a customer-facing amount.
- **Tests are part of the work**, and money logic gets property tests.
