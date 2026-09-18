# Runbook: turning on Sign in with Google or Apple

Both are built and **off** (ADR [0043](../adr/0043-sign-in-with-google-or-apple-and-the-password-reset.md)).
A provider is on only when both halves below are done. With only the first half done nothing
changes for customers; with only the second, the button appears and leads to an error — so do
them in this order.

`TODO(review)`: the console steps below follow Supabase's guides as of 2026-09; check them
against the linked pages when you do this, because the consoles move.

## 1. Give Supabase the provider's credentials

In the Supabase dashboard: **Authentication → Providers**. The page shows the **callback URL**
to give the provider — copy it from there rather than typing it.

### Google — free

Guide: https://supabase.com/docs/guides/auth/social-login/auth-google

1. Google Cloud Console → APIs & Services → Credentials → **Create OAuth client ID**, type
   **Web application**.
2. **Authorized redirect URIs:** the callback URL from the Supabase provider page.
3. Configure the consent screen with the product name and the support address.
4. Paste the client ID and secret into the Google provider in Supabase and enable it.

### Apple — needs a paid developer account, and upkeep

Guide: https://supabase.com/docs/guides/auth/social-login/auth-apple

1. Apple Developer Program membership.
2. An **App ID**, a **Services ID** (this is the client ID) with Sign in with Apple enabled and
   the Supabase callback URL as a return URL, and a **signing key** (`.p8`).
3. Generate the client secret from the key and paste it into the Apple provider in Supabase.
4. **Put a repeating reminder in a calendar for five months from now.** Apple's client secret
   expires after six months. When it lapses, Sign in with Apple fails for every customer until a
   new one is generated from the same `.p8` and pasted in. Keep the `.p8` somewhere safe; it is
   not recoverable.

Apple lets a customer hide their email. Their account, invoices and notices will then carry a
`privaterelay.appleid.com` address, which forwards to them for as long as they keep it active.

## 2. Tell the app

Set `AUTH_OAUTH_PROVIDERS` in the web app's environment (Vercel → Project → Settings →
Environment Variables) to a comma-separated list, and redeploy:

```
AUTH_OAUTH_PROVIDERS=google
AUTH_OAUTH_PROVIDERS=google,apple
```

Anything other than `google` or `apple` in the list stops the app from starting, by design.

## 3. Check it, by hand, once

This is the one part no automated test can cover.

1. In a private window, **Continue with Google** from `/sign-up`. You should land on **One last
   thing**, asking for a business name and the terms. Complete it; you should land in the
   workspace.
2. Sign out, **Continue with Google** from `/sign-in`. You should land straight in the
   workspace, and the first session should be signed out.
3. In **Privacy and data → Request export**, you should be told the account has no password and
   offered an emailed link. Open the link and set a password. Request the export again: it should
   now ask for that password, and go through once you give it. (The link sets the password and
   nothing else — it does not itself unlock the export.)
4. Sign in with that email and the new password. It should be the same account.

## Turning one off

Remove it from `AUTH_OAUTH_PROVIDERS` and redeploy. Customers who signed up with it keep their
accounts: **Forgot your password?** on the sign-in page sends them a link that sets one.

## Local development

`supabase/config.toml` has `[auth.external.google]` and `[auth.external.apple]`, both
`enabled = false`. To try Google locally, set `enabled = true`, put the client ID in
`client_id`, export `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`, add
`http://127.0.0.1:54321/auth/v1/callback` to the Google client's redirect URIs, restart the
stack, and start the web app with `AUTH_OAUTH_PROVIDERS=google`. Never commit a client secret.
