# 0072 — Welcome credits under tax, consumer and privacy law

- **Status:** accepted
- **Date:** 2026-09-29
- **Decided by:** the product owner, who has no chartered accountant or lawyer and asked Claude to
  take up the review items ADR 0068 raised ("you only have to take it up"). These are researched
  positions from the primary texts, not professional advice; each is recorded with its source so a
  professional engaged later can check it in minutes.
- **Closes:** R-84, and the welcome-credit parts of R-10 and R-50. Extends
  [0068](0068-a-start-that-costs-nothing.md).

## GST and the books

**Welcome credits are not a supply, so they carry no GST and need no tax invoice**, for Indian and
foreign customers alike.

- CGST Act s.7(1)(a): a supply is made "for a consideration"; s.7(1)(c) catches supplies without
  consideration only if they are in Schedule I — business assets on which credit was taken,
  related or distinct persons, principals and agents, related-party imports. A new, unrelated user
  is none of them.
  <https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter3/section7_v1.00.html>,
  <https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter21/schedulei_v1.00.html>
- CBIC Circular 92/11/2019-GST (7 March 2019), para 2A(i): goods or services "supplied free of cost
  (without any consideration) shall not be treated as 'supply' under GST". Still in force; the
  circular withdrawn ab initio in 2019 was 105/24/2019, not this one.
  <https://cbic-gst.gov.in/pdf/circular-cgst-92.pdf>
- No invoice: s.31(2) applies to "a registered person supplying taxable services". None is made, and
  none is issued — a grant never creates a purchase. For a foreign user it is not an export either
  (IGST s.2(6)(iv) requires payment in convertible foreign exchange), so nothing goes under the LUT.

**Input tax credit: the cautious course is taken.** Read strictly, s.17(5)(h) blocks credit only on
*goods* given as gifts or free samples, and s.17(2) with Rule 42 does not apply because a non-supply
is neither an exempt nor a non-taxable supply (s.2(47), s.2(78)). But Circular 92 para 2A(ii) says
credit "shall not be available … on the inputs, input services and capital goods to the extent they
are used in relation to the gifts or free samples", and officers follow it. The sum at stake is
small — about ₹10 of AI behind a fully used grant, so roughly ₹1.80 of tax — so the credit on what
welcome-funded work directly consumes is to be reversed, and nothing is disputed. **The monthly
`welcome_credits` accounting export gives that figure**: each capture from a welcome lot takes its
job's or chat message's AI cost pro rata to the credits the welcome lot paid. Overheads keep their
credit (s.16(1): used in furtherance of business).

**Accounting.** A small unlisted company follows AS, not Ind AS. AS 9 para 4.1: revenue is "the
gross inflow of cash, receivables or other consideration"; a grant brings in none, so it is never
revenue, spent or not. The cost of serving it — AI and infrastructure — is a business-promotion
expense as incurred, and an unspent grant is not a contract liability. This is exactly what ADR
0068 made the margin report, the business page and the accounting exports do.
<https://resource.cdn.icai.org/251as9new.pdf>

## Consumer law

**A "free" claim carries its conditions beside it, in the same type.** CCPA Guidelines for
Prevention of Misleading Advertisements and Endorsements for Misleading Advertisements, 2022,
clause 7 (free claims) requires an advertisement to "make clear the extent of commitment that a
consumer shall make to take advantage of a free offer" (7(b)); clause 11(2)(b) that a disclaimer's
font be "the same as that used in the claim"; clause 12(a) that claims be capable of
substantiation. The Dark Patterns Guidelines 2023 name as drip pricing a product "advertised as free
without disclosing that continuing usage would attract extra costs".
<https://consumeraffairs.gov.in/public/upload/files/CCPA_Notification_1732707665.pdf>

So every place the site makes the claim now says, beside it and in the same size of type: one
welcome grant per person or business, not for throwaway email addresses; after that credits are
bought in packs, and each company kept has a monthly memory fee; with a link to the offer's terms.
"Enough to set up your first company" says "at its standard price", because a job that needs more
than its standard price is quoted first (clause 12(a)): the substantiation is `welcomeOffer`, which
compares the grant with the first run's price-book price and drops the claim the moment it stops
holding. The claim never says "free trial" (clause 7(e)), no card is taken, and nothing converts to
paid by itself.

**A customer who does not get the offer is told why.** An expected 1,500 that shows as nothing reads
as bait and switch. A withheld account's first screen says why (a throwaway address; a mailbox that
has had its grant), and a deferred one says the credits come at a later sign-in.

**The terms clause is tightened.** Under the Consumer Protection Act 2019 s.2(46), an unfair
contract includes one entitling a party to terminate "unilaterally, without reasonable cause".
Ending the offer for the future while keeping credits already granted is not a termination, and
withdrawing credits obtained by circumvention has reasonable cause. The clause now says the network
limit is a delay (which is what the code does), that withdrawal reaches only *unspent* welcome
credits and never bought credits or delivered work, that the customer is told why and how to raise
it with the grievance officer, and that the memory fee follows.
<https://www.indiacode.nic.in/bitstream/123456789/16939/1/a2019-35.pdf>

## Data protection

**The mailbox fingerprint is personal data, so it is keyed, disclosed and time-limited.** DPDP Act
2023 s.2(t): personal data is "any data about an individual who is identifiable by or in relation
to such data"; the fingerprint exists to recognise the same person when they return, and an
unkeyed SHA-256 of an address can be reversed by hashing guesses. The DPDP Rules 2025 were notified
as G.S.R. 846(E) on 13 November 2025, the notice, consent and erasure provisions taking effect
eighteen months later (about May 2027).
<https://www.indiacode.nic.in/bitstream/123456789/22037/1/a2023-22.pdf>,
<https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf>

- **Keyed.** The fingerprint is an HMAC-SHA-256 under a `welcome` platform key that the KMS wraps
  and the re-wrap job rotates, like the library's digests (migration 0067). Rule 6(1)(a) lists
  "the use of virtual tokens mapped to that personal data" as a safeguard. Existing unkeyed
  fingerprints were cleared; none existed outside development databases.
- **Disclosed.** The privacy notice lists it under what is collected and how long it is kept, and
  the account-deletion screen says it, with its period, before the account is deleted (Rule 3(b):
  "an itemised description … and the specified purpose").
- **Time-limited.** Kept while the account exists and `wallet.welcome_fingerprint_retention_days`
  (365) after deletion, then erased by the nightly purge (`forgetWelcomeFingerprints`); the
  decision row stays, with nothing in it that identifies anyone. One year is the period the Rules
  themselves use for keeping processing logs "even if X deletes her account" (Rule 8(3)), and covers
  the realistic delete-and-rejoin window. The notice offers erasure sooner on request through the
  grievance officer (s.12(3)).

## What is left

- **Open risk, GST:** a department could argue signing up is consideration (s.2(31)(b), "any act or
  forbearance"); no ruling takes that view. If welcome credits were ever tied to a purchase, Circular
  92 para B would apply instead and credit would be fully available.
- **Open risk, privacy:** a strict reading could treat account deletion as withdrawing consent for
  the fingerprint too (s.6(6), s.8(7)); honouring an express erasure request limits that.
- **Not done here:** the grievance officer's name and address (E-Commerce Rules 2020 rule 4(4)–(5):
  acknowledge within 48 hours, resolve within a month) are still placeholders in `legal.contacts`
  (R-11/R-12), and the rest of the terms and privacy notice outside the welcome clauses remain under
  R-10 and R-50.

## Tests

`packages/billing/test/billing.test.ts`: the `welcome_credits` export gives the grant, the spend and
the AI cost attributed to it. `packages/jobs/test/welcome-fingerprints.test.ts`: a fingerprint is
erased only after the retention period, the decision stays, and a second run changes nothing.
`packages/accounts/test/welcome.test.ts`: the server's keyed fingerprint is the one stored, and it is
handed the normalised mailbox, never the raw address. `apps/web/src/lib/welcome-copy.test.ts`: every
claim carries its conditions and the memory fee, and the first-company claim says "at its standard
price". `apps/web/e2e/welcome.spec.ts`: a throwaway address and a deferred account are each told why.
