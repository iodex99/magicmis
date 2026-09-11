---
name: indian-finance
description: Indian financial conventions for this product — lakhs/crores formatting, April–March financial year, day-first dates, GSTIN/PAN validation, GST place of supply, and paise arithmetic. Apply whenever formatting a number or date for display, parsing an amount or date from a file, validating an identifier, or computing tax.
user-invocable: true
---

# Indian finance conventions

The product is Indian-context by locked decision (SPEC §2.14). These are the rules that
get silently wrong.

## Dates — **day-first, always**
`01/04/2025` is **1 April 2025**, never 4 January. This holds for every input format:
`1-Apr-25`, `01-04-2025`, `01/04/2025`, and Excel serial numbers. There is no locale
detection step and no month-first fallback. A parser that could read a date month-first
is a defect.

Store **UTC**, display **IST** (UTC+05:30, no DST). Never format a stored timestamp
without converting.

## Financial year — April to March
FY 2025-26 runs 1 Apr 2025 → 31 Mar 2026. Default `fy_start_month = 4`, configurable per
company — so never hardcode April; read it from the company record. Invoice numbering
series are per financial year, e.g. `INV/2026-27/000123`, gapless, from a row-locked
counter.

## Number formatting — lakhs and crores
Indian digit grouping puts the first separator after three digits and every two
thereafter: `1,00,000` · `12,34,567` · `1,23,45,678`.

1 lakh = 100,000 · 1 crore = 100 lakh = 10,000,000.

Three display modes per company (`number_format`): `lakhs_crores` (default), `absolute`,
`millions`, with configurable `decimals`. Negatives in financial statements conventionally
show in parentheses — and parentheses on **input** mean negative.

## Amount parsing
Accept both Indian (`1,00,000.00`) and international (`100,000.00`) grouping. Parentheses
mean negative. A trailing `Dr`/`Cr` sets sign — but the convention is **recorded
explicitly in the profile, never guessed silently** (SPEC §15). Debit and Credit may
arrive as two separate columns.

## Arithmetic
INR is **integer paise**. Never float. ₹1,234.56 → `123456`. Convert at the display
boundary only. AI cost is integer **micro-USD**, converted to INR at the FX rate in
effect (admin-set, plus a configurable buffer) and both values stored.

## Identifiers
- **PAN** — `[A-Z]{5}[0-9]{4}[A-Z]`. The 4th character encodes holder type, the 5th is
  the surname/name initial.
- **GSTIN** — 15 characters: 2-digit state code, 10-character PAN, entity number,
  `Z`, then a checksum character. **Validate the checksum, not just the shape**
  (SPEC §8). The leading 2 digits give the state for place of supply.
- **Aadhaar** — 12 digits with a **Verhoeff** checksum. Treat as sensitive: redact
  before any egress, never log, never send to the model.
- **IFSC** — 4 letters, then `0`, then 6 alphanumerics.

## GST (SPEC §13)
Rate from config (default 18%) — never hardcode it. Place of supply comes from the
buyer's billing state, or the GSTIN's state code when a GSTIN is on file:
- **buyer state == seller state** → CGST + SGST, split equally
- **different state** → IGST at the full rate

Prices display **ex-GST**, with the GST line shown before payment. 1 credit = ₹1 ex-GST.
The SAC code is a `TODO(review)` item pending CA confirmation — do not assert one.
