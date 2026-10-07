# 0082 — A provider sign-in tested end to end

- **Status:** accepted
- **Date:** 2026-10-07
- **Decided by:** the product owner, who asked whether Google and Apple sign-up and sign-in were
  in place and, if not, to build them and "test everything end to end thoroughly".
- **Builds on:** [0043](0043-sign-in-with-google-or-apple-and-the-password-reset.md),
  [0068](0068-a-start-that-costs-nothing.md), [0071](0071-a-confirmation-opened-elsewhere.md).

## Context

Sign-in with Google or Apple was built by ADR 0043 and is off until the owner switches a provider
on (`AUTH_OAUTH_PROVIDERS`, [runbook](../runbooks/identity-providers.md)). Its browser tests
stopped at the redirect to the identity service and imitated the return with an email
confirmation, so every branch that depends on a session **opened through a provider** — the
`oauth` method in the token, the finish step without a password, an account a stranger left
waiting, the destination carried in a cookie — had never run.

The identity service fixes Google's and Apple's endpoints, so neither can be pointed at a test.
Its Keycloak provider takes a base URL and does nothing a provider does not do: it sends the
browser to an authorisation page, then calls `/token` and `/userinfo` itself
(https://github.com/supabase/auth, `internal/api/provider/keycloak.go`; `google.go` warns that a
configured URL is ignored).

## Decision

- **The local stack has a stand-in provider**, `[auth.external.keycloak]` in
  `supabase/config.toml`, pointed at a container the browser suite's global setup starts on the
  stack's own network (`apps/web/e2e/support/identity-provider.ts`), so it is reached by name the
  same way on Docker Desktop and on the CI runner. It keeps no state: the code is the access
  token, and the access token says who is signing in. The app never offers it — the environment
  schema accepts `google` and `apple` only — and the hosted project is configured in its
  dashboard, never from this file.
- **`signInThroughProvider`** (`apps/web/e2e/helpers.ts`) presses "Continue with Google" and walks
  the redirect chain one hop at a time, because a browser follows redirects without showing them
  to a route handler: our start route's real response and cookies (checked to be Google's), the
  identity service's real authorize with the provider name swapped, then the person's answer at
  the provider. Everything after — the code exchange, linking, our callback, finish, welcome
  credits, the single session — is the product.
- **`provider.spec.ts`** covers someone new finishing with a name and consent and getting a
  password from the reset link; a returning sign-in landing on its destination and ending the
  session before it; a password sign-up nobody signed in to, which is not handed over; an account
  in use keeping its password when Google is linked to it; and a sign-in turned down at the
  provider. The two tests that imitated a provider return were removed.

## What it found

- **A sign-in turned down at the provider said "That verification link is invalid or has
  expired"**: there was no link. The callback now sends a return with an `error` and no code to
  `/sign-in?provider=failed`, which says the sign-in did not finish and nothing changed.
- **The destination cookie was never deleted.** `cookies.delete` writes to `/`, and `oauth_next` is
  written on `/auth/callback`, so it stayed for its ten minutes and could steer the next link
  opened in that browser. It is now expired on its own path.
- **The identity service drops the unconfirmed email identity** when it links a verified provider
  to a password sign-up nobody confirmed, so the stranger's way in is gone at the identity service
  as well as ours — recorded in the test, because it is what makes that account the owner's.
