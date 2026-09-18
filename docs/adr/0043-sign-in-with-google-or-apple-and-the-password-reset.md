# ADR 0043: Sign in with Google or Apple, and the password reset the spec always asked for

**Status:** accepted · **Date:** 2026-09-18 · **Decided by** the product owner · **Amends** ADR
[0028](0028-password-only-sign-in.md) and ADR [0009](0009-authentication-methods.md) (R-17: SPEC §8
says Google sign-in "may be offered") · **Completes** SPEC §8 ("Password reset by email, through
the identity provider")

## Context

The owner asked for sign-up with Google or Apple. Looking at what that needs turned up something
that was missing regardless: SPEC §8 and §32 both list a **password reset**, and there was none.
A customer who forgot their password had no way back in.

The two turned out to be one piece of work. An account created through Google or Apple has no
password, and SPEC §8 makes every irreversible action — export, deleting a company or the
account, changing credentials — ask for the password again. Without an answer to that, such an
account could never delete itself, which is a legal right and not a nice-to-have.

The first design was reviewed by the security auditor before it was committed. The review found
two high-severity problems in the design itself, not just the code, and this ADR records the
design that came out of it.

## Decisions

### 1. Providers are configuration, and off until the owner turns one on

`AUTH_OAUTH_PROVIDERS` (validated at boot, empty by default) names the providers offered. With
it empty there is no button and `/auth/oauth/:provider` answers 404. Turning one on is a
deliberate act with two halves — credentials in Supabase, then the name here — so a
half-configured provider can never be reached by a customer.
[Runbook](../runbooks/identity-providers.md).

The flow is Supabase's PKCE flow, verified against
https://supabase.com/docs/guides/auth/social-login/auth-google: `signInWithOAuth` with
`skipBrowserRedirect`, the browser sent to the provider, and the return landing on the
**existing** `/auth/callback`, which already exchanges a code and claims the single active
session. New-device alerts, login events and the one-session rule therefore apply to a Google
sign-in exactly as to a password one.

`redirectTo` is **exactly** the allow-listed callback URL with no query. The identity service
matches its allow-list against the whole URL and silently falls back to the site root on a miss,
where nothing exchanges the code; the destination travels in a short-lived HttpOnly cookie
instead. Widening the allow-list to a pattern is how an open redirect gets introduced.

### 2. A proven identity with no account is asked to finish

The provider says who someone is. It cannot say what their business is called or that they
accept the terms, and consent has to be recorded, versioned and audited — so `claimSession`
refusing with `no_account` leads to `/sign-up/finish`, which asks for those two things and calls
the same `provisionAccount` the password form uses. The identity comes from the verified
session, never from the request body. A _closed_ account now refuses as closed, not as "never
created", or it would be sent here and loop.

### 3. An account nobody has signed in to belongs to whoever first proves the address

The password form writes the account row when it is submitted, before the address is proven.
Anyone can therefore leave a row behind for an address that is not theirs — with a business
name and a password of their choosing — and wait for its owner to arrive through Google, since
the identity service links the two by email (pre-account hijacking).

Supabase defends part of this: it links only verified emails and "will remove any other
unconfirmed identities linked to an existing user"
(https://supabase.com/docs/guides/auth/auth-identity-linking). That is the vendor's behaviour,
not ours, and it says nothing about _our_ row. So the callback does not rely on it: a provider
sign-in to an account with **no login ever recorded** does not claim it. The password is
replaced with random bytes, and the owner is sent to the finish step, where `refinishAccount`
records _their_ business name and _their_ consent against their own request and marks the
account as having no password. Once anyone has signed in, the account cannot be finished again.

### 4. The password re-check stays a password re-check

For an account with no password the options were to accept a second trip to the provider as
proof, or to keep the rule and give the account a password. A trip to Google proves very little:
Google will not force a fresh login on request, so a browser with an open Google session passes
silently — exactly the walked-away-laptop case the re-check exists for.

So the rule is unchanged. `accounts.has_password` (migration 0045) records the fact the identity
service will not expose; `reauthenticate` answers `password_not_set` **without counting a failed
attempt**; and the screen offers the emailed link that sets one. Only a session opened _with_ a
password is recorded as having one — anything else, including a token that no longer says how it
was obtained, is recorded as having none, because that direction fails safely: the worst it can
do is offer an emailed link, whereas a wrong "yes" leaves the re-check asking for a password that
does not exist.

### 5. A reset link authorises one thing, in one request

The first design verified the link on the GET and recorded it as a general re-authentication,
reasoning that whoever holds the mailbox could set a password and pass the check anyway. The
review showed why that is wrong for the threat the re-check is written against — an unlocked
machine usually has the mail client open too — so one emailed link would have unlocked **export
and account deletion** for ten minutes without the password ever changing, and without the
"your password changed" notice that a real reset fires.

So the link carries its token to `/reset-password` and **opening it does nothing**. The token is
verified by `POST /api/auth/reset` together with the new password, consumed doing it, and never
becomes a grant. Two consequences:

- The token authorises exactly one thing. Export after a reset still asks for the (new)
  password; an E2E test holds that.
- A link someone else sends you cannot sign you in to _their_ account by being clicked. (The
  confirmation email still verifies on a GET, as it did before this ADR; that is older than
  this change and is listed below.)

`/api/auth/forgot` answers identically whether or not the address has an account, and sends the
email after the response so timing says nothing either. It is throttled per network with a
lockout, and per address **without** one: past the limit for an address the email is quietly
not sent. A lock an anonymous caller could place on someone else's address would shut a Google
account out of the only way it has to set a password — and with it out of export and deletion.

### 6. JSON means JSON

`readJsonBody` now refuses anything that is not `application/json` (415). A cross-site form can
post `text/plain` without a preflight, and a body that happened to parse would have been acted
on: on `/api/auth/finish` that is a forged consent record. Requiring the JSON type forces a
preflight the browser will not grant another origin. Endpoints that demand an `Idempotency-Key`
were already immune for the same reason.

## What the owner has to do, and what it costs

- **Google:** an OAuth client in Google Cloud. Free.
- **Apple:** a paid Apple Developer Program membership, an App ID, a Services ID and a signing
  key — and **the client secret expires every six months** and must be regenerated, or Apple
  sign-in stops working for everyone
  (https://supabase.com/docs/guides/auth/social-login/auth-apple). Worth deciding whether Apple
  earns that for a desktop-only product sold to accountants before turning it on.
- Apple users may choose "Hide My Email", so the address on the account and its invoices can be
  a relay address.
- Set the production rate limit for auth emails explicitly (the local default is two an hour for
  the whole project): `/api/auth/forgot` is a way to spend it. Tracked as R-63.

## Known, and not changed here

- The **confirmation** email still verifies on a GET with a forwardable token-hash link, so a
  link for an attacker's own new account, sent to a victim, signs the victim in to it. Older
  than this ADR, and the fix is the same shape as decision 5. Tracked as R-64.
- The callback builds its redirect from the `Host` header to keep `127.0.0.1` and `localhost`
  apart in development. Low: the path is already constrained. Tracked with R-64.
- A reset token rides in a URL for up to an hour, single-use. `Referrer-Policy` stops it
  leaking cross-origin; platform access-log retention is worth checking before launch.

## What is not tested, and why

Nothing can drive Google or Apple from a test, so the two branches that need a real provider
session — decision 3's guard in the callback, and `has_password = false` on a real provider
sign-up — are covered at the unit level (`neverSignedInAccount`, `refinishAccount`) and not end
to end. Everything else on our side is: the button exists only for a provider that is switched
on; starting one leaves for the identity service with a PKCE challenge, the exact callback URL,
and the destination in a cookie; somewhere else entirely is not accepted as a destination; a
session with no account lands on the finish step, refuses without consent, and ends in the
workspace; the emailed link does not sign anyone in when opened, sets a password once, does not
unlock export, and cannot be used twice; a made-up token sets nothing; a forged cross-site post
is refused; and an account with no password is pointed at the link rather than asked for one.
**The first real Google sign-in has to be made by hand**, following the runbook.

## Consequences

- ADR 0028's "password alone" is now "password, or a provider the owner has switched on". The
  admin console is unchanged (password + TOTP).
- Sign-in and sign-up are a server page (which knows the providers) around a client form;
  `/forgot-password`, `/reset-password` and `/sign-up/finish` are new.
- Anything that sets a password goes through `setAccountPassword`, which is what keeps
  `has_password`, the notice and the audit trail in step.
- Every JSON endpoint now requires the JSON content type.
