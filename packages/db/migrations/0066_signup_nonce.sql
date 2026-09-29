-- 0066: a confirmation link opened anywhere but the browser that signed up does not sign anyone in
-- (ADR 0071, R-85).
--
-- Sign-up writes the account and its password before the address is proven. A stranger could
-- register someone else's address with a password they chose, wait for the owner to click the
-- genuine confirmation email, and then sign in with that password — into an account the owner
-- was now using for their clients' books. ADR 0043 closed this for Google and Apple only.
--
-- The browser that signs up is given a secret; its hash is kept here. A confirmation opened in that
-- browser signs in as before. Opened anywhere else, the password chosen at sign-up is destroyed and
-- the person who proved the mailbox finishes the account with their own password and consent.

alter table public.accounts add column signup_nonce_hash text;

comment on column public.accounts.signup_nonce_hash is
  'SHA-256 of the secret given to the browser that signed up; cleared once it has been used (ADR 0071).';
