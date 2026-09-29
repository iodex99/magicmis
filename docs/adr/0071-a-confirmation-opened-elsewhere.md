# 0071 — A confirmation opened elsewhere signs nobody in

- **Status:** accepted
- **Date:** 2026-09-29
- **Decided by:** the product owner ("Fix r 85")
- **Closes:** R-85. Extends [0043](0043-sign-in-with-google-or-apple-and-the-password-reset.md)
  to the password sign-up, and amends [0028](0028-password-only-sign-in.md)'s "the confirmation
  email establishes the session".

## Context

The password sign-up writes the account and its password when the form is submitted, before the
address is proven — sign-up asks four things and the confirmation email is what proves the
mailbox. So a stranger could register someone else's address with a password they chose and
wait. When the owner clicked the genuine confirmation email, the callback claimed the account for
them and they started using it — for their clients' books — while the stranger still held a
working password. ADR 0043 closed exactly this for Google and Apple (a provider sign-in to a
never-signed-in account destroys the pre-set password and sends its owner to finish it); the
email link had no such guard. The security review of ADR 0068 raised it again, because welcome
credits now land on that account too.

What the link proves is the mailbox. What it cannot prove is that whoever clicked it chose the
password.

## Decision

1. **The browser that signs up is given a secret.** `POST /api/auth/sign-up` sets an
   `httpOnly`, `SameSite=Lax` cookie scoped to `/auth/callback` for a week, and keeps only its
   SHA-256 on the new account (`signup_nonce_hash`, migration 0066). It is set on every
   well-formed answer, new address or not, so its presence says nothing about which addresses
   have accounts (the sign-up already answers "check your email" either way).
2. **Opened in that browser, the link signs in as it always has.** The callback matches the
   cookie against the hash of a never-signed-in account, claims the session, and spends the
   secret. Nearly everyone signs up and confirms in one browser, and sees no change.
3. **Opened anywhere else, it signs nobody in.** On an account nobody has signed in to, the
   password chosen at sign-up is destroyed (`forgetSignupPassword`, audited as
   `account.signup_password_destroyed`), nothing is claimed, and the browser that proved the
   mailbox is sent to the finish step. There the owner chooses their own password, business name
   and consent — the same step a Google or Apple newcomer finishes, with a password field added
   because a password sign-up should end with a password. The stranger is left holding nothing.
4. **Everything else is unchanged.** A Google or Apple return is still handled by ADR 0043; the
   reset link still sets a password and authorises nothing else; an account anyone has signed in
   to is never touched by a later link.

## Consequences

- Someone who signs up in one browser and opens the email in another — a default browser that
  is not the one they used, a second profile — chooses their password again on the finish step
  (the hint says they may reuse the one they picked). That is the price of the guard, and it
  falls only on that case.
- If they abandon the finish step and go back to the first browser, their original password no
  longer works: the reset link is the way back, and it is offered on the sign-in page as always.
- A consent record from the stranger stays on the account beside the owner's own, as ADR 0043
  already leaves it for provider sign-ins; the owner's is the one that counts, recorded against
  their own request.

## Tests

`packages/accounts/test/signup-browser.test.ts`: the secret is random and only its hash is kept;
it matches only the browser that holds it, and nothing once spent or on an older account; the
destroyed password is recorded; the finish keeps the owner's name and password and adds their
consent; a provider finish still ends with no password. `apps/web/e2e/recovery.spec.ts`: a
stranger registers an address, its owner opens the link in their own browser and is sent to
finish; the stranger's password is refused; the owner's name and password stand and work from
anywhere; and a link opened in the browser that signed up still lands in the app and spends the
secret.
