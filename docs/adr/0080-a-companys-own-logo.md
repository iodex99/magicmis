# 0080 — A company's own logo

- **Status:** accepted
- **Date:** 2026-10-05
- **Decided by:** the product owner, who asked for a logo per company — JPG, JPEG, PNG or WebP, at
  most 1 MB — chosen while adding or editing the company, and shown on its dashboard and when it
  is presented.
- **Builds on:** [0045](0045-a-companys-own-layout-is-remembered-for-good.md),
  [0046](0046-a-dashboard-built-by-chatting-and-presented-live.md),
  [0047](0047-files-kept-chosen-and-opened-by-nobody-unrecorded.md).

## Context

An accountant presents a client's board to that client's directors. The board said the company's
name and nothing else; the room is looking at its own business, and its mark belongs beside the
name.

## Decision

- **Where it is chosen.** An optional field on the add-company form, and a Logo block at the top
  of Files and settings that replaces or removes it. The form uploads the logo once the company
  exists; if that upload fails, it sends the owner to Files and settings with a notice, because
  staying on the form would invite a second press of Add and a second company.
- **Where it is shown.** Before the company's name on its page header, on its card in the company
  list, and in Present beside the name. Contained and never cropped, on a white tile, so a wide
  wordmark and a square mark both sit whole and a logo drawn for white survives the dark theme.
- **Judged by its bytes.** The type is read from the file's signature, never its name or the type
  the browser declares, and only PNG, JPEG and WebP pass. SVG is refused: it is a document that can
  carry script, shown inside a signed-in page. The width and height are read from the format's own
  header and refused past `companies.logo_max_side_px` (4,096), because a 33-byte file can ask a
  browser for a 30,000-pixel canvas. The same check (`src/lib/logo.ts`, no I/O) runs in the
  browser for an immediate answer and on the server for the decision.
- **Limits are configuration.** `companies.logo_max_bytes` (1 MB) and the side limit are seeded in
  `app_config` by migration 0074 (SPEC §0.5). The body is read incrementally and abandoned past the
  limit, so an oversize upload is never buffered.
- **Sealed like every other file the company owns.** Stored on the companies row, encrypted under
  the company's data key with its own purpose, so deleting the company leaves it as unreadable as
  the rest (SPEC §10). Each upload gets a fresh version id, which is the cache key in its URL:
  served `private, immutable` for the version asked for, so only an upload costs a key unwrap, and a
  replaced logo is never shown stale. The id carries nothing about the image.
- **Served to its owner only**, from `GET /api/companies/:id/logo` behind the same account check as
  every other route, as the type found in its bytes, with `nosniff` and a sandboxing CSP on the
  response. It is not a public asset and has no public URL.
- **No idempotency key.** Setting and replacing are the same operation on an existing row, so a
  retry leaves the same logo on the company; nothing creates a row (ADR 0059).

## Consequences

- `PageHeader` takes an optional `logo`; the workspace passes `logoUrl` to `DashboardClient` for
  Present.
- `e2e/logo.spec.ts` covers choosing, refusing a disguised SVG and an oversize file, serving to the
  owner and not to a stranger, replacing and removing; `mis.spec.ts` checks it in Present.
- The workbook does not carry the logo. It could, as an image in the header row, but the owner asked
  for the dashboard and Present; that is a separate decision.
