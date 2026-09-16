# ADR 0029: Launch decisions — hosting, 2FA, break-glass, and the rendered-response secret scan

**Status:** accepted · **Date:** 2026-09-16 · **Decided by** the product owner, with the rest delegated ("other things take your best call")

## Context

[REVIEW_ITEMS](../REVIEW_ITEMS.md) had accumulated rows that were blocked on facts only the
owner holds. Four directions settled most of them:

1. **R-58, customer 2FA: "no need of 2FA."**
2. **Hosting: "i'll deploy on vercel."**
3. **"no multiple login, one user one login."**
4. Everything else: take the best call.

This records what was decided, what was verified, and — importantly — what still cannot be
decided here, so the remaining list is short and honest rather than long and vague.

## Decisions

### 1. R-58 closed: a password is the only customer factor, permanently

[ADR 0028](0028-password-only-sign-in.md) removed the second factor and recorded R-58 so the
choice would be revisited before launch. It has been: the owner confirmed it, knowing the
cost already written down there — a single leaked password reaches a firm's financial data
and its credit balance.

R-58 moves to **closed**. The compensating controls ADR 0028 identified are what carry the
weight, and they are the reason this is defensible rather than merely decided: single active
session, per-IP **and** per-email throttling with lockout, re-authentication before anything
irreversible, and login history with new-device alerts. Those are now load-bearing and must
not be quietly weakened — a change to any of them is a change to the security posture of the
whole product.

### 2. R-55 closed: Vercel, with the three assumptions verified

All three assumptions in [ADR 0024 §6](0024-admin-compliance-hardening.md) were checked against Vercel's
own reference, not assumed
([request headers](https://vercel.com/docs/headers/request-headers), verified 2026-09-16):

- **Client IP.** Vercel "overwrite[s] the X-Forwarded-For header and do[es] not forward
  external IPs … to prevent IP spoofing", and `x-vercel-forwarded-for` is the same value
  except that `x-forwarded-for` "could be overwritten if you're using a proxy on top of
  Vercel". Reading the platform header first is therefore right, and the right-most
  `x-forwarded-for` fallback is right off Vercel. Unchanged; the reasoning is now recorded
  next to the code instead of inferred.
- **`x-real-ip`.** Vercel makes it a third copy of the same value. Still never read: any
  client can set it off Vercel, and a header that is only sometimes trustworthy is not.
- **HSTS.** Vercel documents `x-forwarded-proto` as "the protocol of the forwarded server,
  typically `https` in production". The code derived HTTPS from the parsed URL alone, which
  is the connection *to the function*, not the one the browser made. A new `isHttps` helper
  accepts either source. This is a real hardening: a missing HSTS header fails nothing
  visibly, so it would have been discovered by a downgrade attack rather than by a test.

**`includeSubDomains; preload` stays in the header, but the preload list is not submitted
yet.** Sending the directive costs nothing; submitting to `hstspreload.org` is close to
irreversible and commits every subdomain of the apex to HTTPS forever. The apex domain does
not exist yet — it follows the product name (**R-01**) — so that submission is a deliberate
step at launch, not a side effect of this ADR. Recorded on R-01.

### 3. R-53 settled: break-glass stays single-admin

"One user one login" is the customer rule (§2.2, unchanged and enforced). It also answers
R-53: there is one operator, so `admin.break_glass_second_admin` has no second admin to
approve anything and **stays off**.

Stated plainly, because the register should not imply a control that does not exist: the
operator can grant themselves access to one company's data, and nobody approves it. What
constrains it is detection, not prevention — a fresh TOTP code per grant, one company per
grant, an audit-log entry, and an email to the customer every day the grant is used. Turn
the flag on the day a second admin exists.

### 4. R-54 closed: the secret scan now covers rendered responses

The CI scan walked `.next/static`, which is half of what a browser receives. Props passed
from a server component to a client one are serialised into the page's HTML **and** its RSC
payload — neither a static file. An inlined connection string would have passed the scan and
landed in the reader's tab.

`scan-client-bundles.mjs` now exposes its rules as `scanTexts`, and `e2e/secrets.spec.ts`
fetches every route — public, authenticated, and company-scoped — as both HTML and RSC, then
applies them.

It carries its own control. A scan that cannot fail is worse than no scan, because it reads
as evidence, so the test first plants one of each finding — a real environment value, a
secret-shaped token, a server-only code marker — in a synthetic page and asserts all three
are caught. The clean result means something only because that control passes in the same
run.

### 5. Best calls taken on the remaining policy rows

Each is a default that stands until evidence says otherwise, not a finding:

- **R-51, reconciliation window** (credit a purchase whose webhook never arrived: after 30
  minutes, up to 7 days). Kept. The window is about missed webhooks, not settlement timing,
  and the source of truth is Razorpay's own record of the payment. Tightening it only adds
  ways for a paid customer to stay uncredited. The keys still have to be set on the worker,
  which is deployment, not design.
- **R-52, external write-once anchor copy.** Not built. The threat it answers is an attacker
  holding the database *and* the KMS role; against that, the daily admin email already puts
  the anchors somewhere the database cannot reach. Worth revisiting the first time the audit
  log is evidence in a dispute rather than a control.
- **R-40, uncharged dashboard layout edits.** Confirmed uncharged. §2.3 forbids free
  *analysis*; renaming, reordering and removing a widget is presentation of figures already
  paid for. Chat edits stay charged because they invoke the model.
- **R-43, abandoned chat messages.** Confirmed: the hold is released, the message is marked
  failed, and the AI cost already spent is absorbed. Charging for an answer nobody received
  is the worse error, and the margin exposure is bounded by the per-message cap.

### 6. R-25 closed: invoice text is guarded at the field, not patched at the page

The invoice PDF is drawn with standard Helvetica, and `winAnsiSafe` replaced anything
outside WinAnsi with `?` — silently, on a document that must carry the recipient's name
correctly under Rule 46. A customer could type a Devanagari business name at sign-up and
receive a tax invoice made out to `????`.

A Unicode font is the obvious answer and is the wrong one here: it means committing a
multi-megabyte face to serve a case the GST system does not produce, because the legal name
behind a GSTIN is registered in Latin script.

So the guard moved upstream. Every customer-typed field that prints on an invoice — business
name, address lines, city — is refused at entry unless the invoice font can draw it, with a
message that names the offending characters rather than the rule. A property test pins the
guard to *exactly* what the PDF writer keeps, so the two cannot drift apart and let a `?`
back through. `winAnsiSafe` stays as the backstop for text that does not come from those
fields, such as the seller details in config: an invoice must still render.

### 7. Config seeds kept, with the reason written down

R-15, R-34, R-36, R-45, R-48 and R-49 were all "confirm the seed". Each is now either
confirmed with its justification or moved off the pre-launch list, because every one is
admin-editable config and tuning them without traffic is guessing with extra steps. The
substantive notes: the eight-year retention matches Companies Act 2013 §128(5);
HyperFormula's GPL obligation is not triggered by a devDependency used as a test oracle;
`AI_TRANSPORT=fake` already fails closed in code, leaving only a deployment check. One point
from R-49 — that deletion forfeits unused credits and is refused while credits are held — is
genuinely legal rather than operational and goes to the R-50 reviewer.

## What this does not decide

These need facts that are not available here, and guessing at them would be worse than
leaving them open. They stay on the register:

- **R-01** product name, and with it the apex domain and HSTS preload submission.
- **R-02 / R-03** seller legal name, address, GSTIN, and the SAC code — a CA's answer.
- **R-04 / R-05** final prices and packs. These are not a matter of taste: the margin
  dashboard cannot say whether the seeded prices hold until **R-28**'s live evals produce
  real AI costs. Pricing follows that measurement, not this ADR.
- **R-10 / R-11 / R-12** legal text. Drafted as accurate descriptions of product behaviour;
  final wording is a lawyer's, and this ADR does not pretend otherwise.
- **R-26 / R-28** a live Razorpay test run and the AI evals — both need the owner's accounts
  and real spend.
- **R-50** the processing register's data-protection review.
