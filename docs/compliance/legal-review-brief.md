# Legal review brief: uploaded files (ADR 0047 and 0048)

**For:** the lawyer and the data-protection reviewer (R-10, R-11, R-12, R-50, R-63).
**Status of the documents:** terms, privacy notice and processing notice are all `1.2-draft`.
They stay draft until this review is done; nothing here is a legal opinion.

This brief exists so the review is an hour, not a discovery exercise. It gives the exact
sentences that changed, the fact behind each, where that fact is enforced, and the questions
only a lawyer can answer.

## What changed in the product

1. **Uploaded files are kept until the customer deletes them.** They used to be deleted
   automatically 30 days after upload. Now `sources.retention_days` is 0 (no expiry). The
   customer deletes any file from the company's Files and settings page, and deleting a company
   destroys its encryption key, which makes everything stored under it unreadable.
2. **Each company may keep up to 2 GB of files** (`sources.max_company_bytes`, configuration).
   Past that, an upload is refused with an instruction to delete files. Keeping files is not
   charged separately.
3. **Every decryption of a file is recorded** with its reason and shown to the customer.
4. **The customer can download any file back**, after confirming their password.

## The sentences to review

| Where | Sentence | Fact behind it | Enforced by |
| --- | --- | --- | --- |
| Privacy notice §2; processing notice; security page | "Uploaded files are kept, encrypted, until you delete them." | No expiry is set on an upload; the purge removes only files past an operator-set period or belonging to a deleted company. | `packages/jobs/src/sources.ts`; tests in `packages/jobs/test/sources.test.ts` |
| Privacy notice §2; processing notice; security page; terms (security clause) | "No member of our staff has a screen, tool or role that opens an uploaded file." | Nothing in the admin console or the background worker references the code that decrypts a file. Support ("break-glass") access opens computed report data only, never a file. | **A build-failing test**: `packages/jobs/test/no-staff-path.test.ts` |
| Privacy notice §2 | "A file is decrypted only in memory, by the automated steps of something you start (counting its sheets when it arrives, sizing and running a run, answering a question) or by your own download, and each of those is recorded where you can see it." | The only function that decrypts a file requires a purpose and writes the record first. The record is append-only in the database and has no value for a person. | `loadUploadBytes`; migration `0046`; same tests |
| Terms, security clause | "…encryption of uploaded files under a key unique to each company, keeping them only until you delete them (or for the period the privacy notice states), giving no member of our staff a means of opening them, and redaction before anything is sent to an AI provider." | As above. Replaces "their deletion on a fixed schedule". | As above |
| Files and settings page | "Delete the company and its key is destroyed, which leaves everything sealed under it unreadable, to us as well." | Company deletion destroys the company data key (crypto-shredding). | `packages/jobs` purge; SPEC §4 |

**What is deliberately not claimed:** that the service *cannot* decrypt customer files. It
processes them on its servers, so it can, by automated code, when the customer starts something.
The claims are about who and what ever does, and the customer's ability to check. Please confirm
the wording does not imply more than that. A person with direct access to production
infrastructure and the key-management service is outside what the application can prevent; the
reviewer should say whether the notices need a sentence about infrastructure access and the
controls on it (R-50).

## Questions for the reviewer

1. **Storage limitation.** Is "until the customer deletes it", with per-file deletion, owner
   download, a visible read record and a 2 GB cap, acceptable under the DPDP Act 2023 and, for
   customers elsewhere, GDPR Article 5(1)(e)? The files contain third parties' personal data
   (party names, PAN, bank details) for which the customer is the controller/fiduciary and we
   are the processor. If a maximum period is required, it is one configuration value
   (`sources.retention_days`) and the notices already say whichever is set.
2. **Dormant accounts.** A company whose memory fee goes unpaid is archived and then destroyed
   on the existing lifecycle (terms §5). Is that sufficient as the outer bound on retention, or
   should files have their own dormancy rule?
3. **Re-consent.** Every account is shown the new processing notice and accepts it before its
   next upload. The product had not launched when this changed, so no customer's files were
   held under the 30-day promise; the question only matters if that is no longer true when you
   read this. If it is not, the conservative fix is a one-off restoration of the original
   deletion date for files uploaded before the change, which is a small migration.
4. **The staff-access sentence in the terms.** It is now a contractual term. Confirm the
   wording, and whether it should be qualified for legally compelled access.
5. **The read record** holds a file id, a reason and a time, no content. Should it be part of
   the account data export (R-66)? We think yes.

## If the answer to any of these is "no"

| Reviewer says | Change needed |
| --- | --- |
| A maximum retention period is required | Set `sources.retention_days` in the admin console. No code change; the notices update themselves. |
| Pre-change files must go at 30 days | One migration restoring `expires_at` for files uploaded before `0046`. |
| The staff sentence must be softened | Edit the five places listed above together; the guard test stays. |
| The cap should differ | Set `sources.max_company_bytes`. |
