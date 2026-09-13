# ADR 0016 — Worker on pg-boss; notification delivery with SKIP LOCKED and provider idempotency

**Status:** accepted · **Date:** 2026-09-13 · **Phase:** 2

## Context

SPEC §5 names pg-boss for the worker. Phase 2 needs a reservation sweeper (5 min), nightly lot
expiry, lot-expiry notices (30/7 days), quote expiry, and delivery of queued emails (SPEC §29,
ADR 0010).

## Decisions

1. **pg-boss 12.31.0** in schema `pgboss` of the same database. Each maintenance task is a
   `singleton` queue (no stacking behind a slow run) with a cron schedule evaluated in
   `Asia/Kolkata`. Tasks are idempotent; pg-boss may run a job late or again.
2. **Runtime via tsx.** Workspace packages are TypeScript source with extensionless imports
   (ADR 0012); tsx runs them directly in the container. No bundling step.
3. **Notification delivery** claims one `queued` row at a time with `FOR UPDATE SKIP LOCKED`, sends
   with Resend `idempotencyKey = notification:<id>`, and records `sent`, a backoff
   (`retry_base_seconds × 2^(attempt-1)`), or `failed` after `max_attempts`. Untemplated types and
   deleted accounts are `suppressed`, not retried. Invoice and proforma emails attach the PDF
   rendered from the invoice row. Two concurrent workers deliver each row exactly once (tested).
4. **`MailSender` interface**; tests use a recording fake, never Resend.

## Verifying documentation

| Fact asserted | Source | Verified on |
|---|---|---|
| `new PgBoss({connectionString, schema})`, `start`, `createQueue(name, {policy, expireInSeconds, retryLimit})`, `schedule(name, cron, data, {tz})`, `work(name, handler(jobs[]))`, `getSchedules`, `stop({graceful, timeout})`; Node ≥ 22.12, PostgreSQL ≥ 13 | pg-boss@12.31.0 README and `dist/*.d.ts` (https://github.com/timgit/pg-boss) | 2026-09-13 |
| `emails.send(payload, { idempotencyKey })` returns `{ data, error }`; attachments accept Buffer content | resend@6.28.0 `dist/index.d.mts`; https://resend.com/docs/send-with-nodejs | 2026-09-13 |

A live pg-boss test starts pg-boss against Testcontainers Postgres, checks every schedule is
registered in IST and that a sent job runs its handler.

## Consequences

- Resend webhook handling (bounces, complaints → suppression) is still to be built; ADR 0010's
  unverified signature API must be confirmed first.
- The worker needs `APP_URL` for links, validated at boot.
