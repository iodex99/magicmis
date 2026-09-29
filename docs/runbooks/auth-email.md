# Auth email in production: confirmations and password resets

Sign-up confirmations and password-reset links are sent by Supabase Auth. **A new hosted project
cannot send them to customers**: Supabase's own mailer sends only to the project team's addresses,
two an hour, and every other address fails with "Email address not authorized"
(<https://supabase.com/docs/guides/auth/auth-smtp>). Until the steps below are done, nobody outside
the team can confirm a sign-up or reset a password. Locally none of this applies: every auth email
goes to Mailpit at <http://127.0.0.1:54324>.

## Once, before launch

1. **Resend account and domain.** Create a Resend account, add the sending domain (the apex domain
   of R-01, or a subdomain of it such as `mail.<domain>`), and add the DNS records Resend shows —
   SPF and DKIM, plus a DMARC record — until the domain reads *Verified*. Resend will not send
   from an unverified domain (<https://resend.com/docs/send-with-smtp>).
2. **API key.** Create a Resend API key with **sending access** only. The worker's own emails use
   the same service (`RESEND_API_KEY`, `EMAIL_FROM` on the worker), so the From addresses should
   share the domain.
3. **Supabase access token.** Create a personal access token for the Management API with auth
   config read and write.
4. **Set the environment** in your shell, without printing the secrets:
   - `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` — the production project;
   - `APP_URL` — the production origin, `https://…`, no trailing slash;
   - `AUTH_EMAIL_FROM` — e.g. `no-reply@<domain>`;
   - `AUTH_EMAILS_PER_HOUR` — how many auth emails the whole project may send in an hour. Supabase
     allows 30 until it is raised; every sign-up and every reset is one. Start at 100 and raise it
     with growth;
   - `RESEND_API_KEY`.
5. **Check, then apply, then check again:**

   ```
   pnpm --filter @magicmis/accounts auth-email            # lists what is wrong, changes nothing
   pnpm --filter @magicmis/accounts auth-email --apply    # sets it, then checks
   ```

   `--apply` sets Resend's SMTP (`smtp.resend.com`, port 465, user `resend`), the sender
   (`AUTH_EMAIL_FROM`, signed with the product name), the hourly limit, the site URL and the
   `/auth/callback` redirect, email confirmation on, the minimum password length from
   `supabase/config.toml`, re-authentication to change a password, and **the confirmation and reset
   templates and subjects from `supabase/templates`**. The templates matter: both links are the
   token-hash kind the product relies on (the reset link signs nobody in, ADR 0043; the
   confirmation signs in only the browser that signed up, ADR 0071), and Supabase's default
   templates are not.
6. **Password character rule.** In the Supabase dashboard's email and password settings for the
   project, set the required characters to lower and upper case letters and digits, to match the
   local stack (`password_requirements` in `supabase/config.toml`). The command does not set this field, because the documentation does not show its
   exact accepted value for that rule; the product enforces the same rule itself when a password is
   chosen, so nothing is weaker meanwhile.
7. **Send one of each to a real inbox**: sign up with an address you own and confirm it, then use
   *Forgot password* and set a new one. Check both arrive, both links open on the production
   domain, and neither lands in spam.

## When it goes wrong

The customer is always told to check their email — the forms must not say whether an address has an
account — so a failure is invisible to them. The server logs it instead:

- `auth_email: a password reset email was not sent` — with Supabase's error code;
- `auth_email: sign-up failed` — the same for a sign-up.

A code such as `over_email_send_rate_limit` means the hourly limit is too low: raise
`AUTH_EMAILS_PER_HOUR` and run `--apply`. Anything about the sender or the SMTP login means the
domain or the key in Resend: fix it there and run the check again.
