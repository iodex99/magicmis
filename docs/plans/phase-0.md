# Phase 0 — Repository bootstrap

Not a phase from SPEC §34 (§34 has not been received). This records the work SPEC §0.1
mandates *before* phased work begins, and the blocker preventing Phase 1.

## Blocker

`docs/SPEC.md` is **incomplete**. The source document was truncated in transit at the
50,000-character limit, mid-sentence in **Section 17** (PII redaction, at the IFSC
detector regex). Sections 18–33 and **Section 34 — the phase plan** were never received.

SPEC §0.2 requires phases to be followed from §34, in order. SPEC §0.3 forbids working
around a locked decision silently. Inventing a phase plan would do both, so Phase 1 has
not been started.

Forward references made in Sections 0–17 to material we do not have:

| Referenced from | Missing target |
|---|---|
| §16 "feeds validation check V4" | the validation check catalogue (V1..Vn) |
| §14 prompt rules | §25 — the placeholder mechanism for commentary and chat |
| §8 "Other rules" | §26 — the separate admin identity system |
| §12 price book (`refresh_with_restructure`) | §23 — source-structure drift threshold |
| §10 storage table | §17 remainder — optional encrypted token dictionary |
| §9 `companies.lifecycle_state` | company lifecycle + memory-fee billing cycle |
| §6 packages | semantic layer, recipe DSL, metric library, render specs, chat/SQL guard |

## Done

- `docs/SPEC.md` — saved verbatim as received, with a truncation banner and an inline
  `[TRUNCATED]` marker at the cut point (SPEC §0.1).
- `CLAUDE.md` — locked decisions (§2), engineering conventions (§4), trust boundaries
  (§7), stack (§5), out-of-scope (§3), layout (§6), and the current phase (§0.1).
- git initialised on `main`; `.gitignore` refusing `.env*`, keys, and stray workbooks.
- `.claude/` team configuration — see below.
- Section 6 directory skeleton (`.gitkeep` placeholders only, no code).

### `.claude/` configuration

| File | Purpose |
|---|---|
| `settings.json` | Allowlist for safe commands and the seven documentation domains; denylist for `.env`/key reads, `rm -rf`, force-push, hard reset, `supabase db reset`. Wires both hooks. |
| `hooks/pre-commit.sh` | Gates **commits only** — it parses the Bash payload and passes every non-commit command straight through. Blocks a staged `.env` or a live-looking key, then runs typecheck → lint → test. Skips the toolchain cleanly while `package.json` does not exist. |
| `hooks/lint-on-save.sh` | Advisory formatter on Edit/Write. Never exits 2. |
| `rules/money-and-ledger.md` | Integer paise, `FOR UPDATE`, hash-chained append-only ledger, FIFO capture, the mandatory property/concurrency tests. |
| `rules/ai-boundary.md` | Server-only key, no generic prompt passthrough, no client-chosen model, Claude never emits a number, caps and fallback pricing. |
| `rules/browser-data.md` | What may leave Zone A, header-based parsing, day-first dates, Dr/Cr recorded not guessed, subtotals never aggregated. |
| `rules/database.md` | `account_id` + RLS on every customer table, no user-to-user relationships, crypto-shred purge, DB-level constraints. |
| `agents/` | `code-reviewer`, `security-auditor`, `test-writer`, `debugger`, `refactorer`, `doc-writer`. |
| `commands/` | `/phase-start`, `/phase-end`, `/verify-api`. |
| `skills/indian-finance/` | Day-first dates, lakhs/crores, Apr–Mar FY, GSTIN/PAN/Aadhaar validation, GST place of supply, paise arithmetic. |

Hook behaviour verified: non-commit passes through (exit 0); commit without
`package.json` skips checks with a notice (exit 0); staged `.env` is blocked (exit 2).

## Deviations from the configuration template, and why

- **`/fix-issue`, `/deploy`, `/pr-review` not created.** There is no git remote, no
  issue tracker and no deploy target yet. They would encode guesses. Replaced with
  `/phase-start`, `/phase-end` and `/verify-api`, which encode SPEC §0.2 and §0.4.
- **No `model` pin in `settings.json`.** The template pinned `claude-sonnet-4-6`, which
  is not a current model ID; pinning it would silently downgrade the session. Omitted so
  the `/model` choice governs.
- **No `memory:` key in agent frontmatter.** Unverified field — omitted rather than
  guessed, per SPEC §0.4.
- **Hooks invoked as `bash .claude/hooks/*.sh`.** Explicit interpreter, because the
  development machine is Windows.

## New dependencies

None. No `package.json` yet — nothing has been installed.

## TODO(review)

- `TODO(review)` **— the missing spec.** Sections 17 (remainder) through 34.
- Everything SPEC §0.6 designates (legal text, TallyPrime menu paths, SAC code, final
  prices) becomes actionable only once the relevant sections arrive.

## Next

Blocked. On receipt of §17(rest)–§34: replace `docs/SPEC.md` in full, remove the
truncation banner, then `/phase-start 1`.
