# Pre-launch: the public site live, the product not yet

Put the public site on the real domain before the product opens (ADR 0078), so search engines
index its pages and they gain age. That is what builds search presence; a bare "coming soon" page
does not. With `PRELAUNCH=1` every public page works normally. Sign-up and sign-in say "Opening
soon", and every route that could create, claim or recover a session refuses.

## What you need

- **The domain (R-01).** Buy it and add it to the Vercel project.
- **A Supabase project in London (`eu-west-2`).** The privacy notice says that is where data
  lives (ADR 0074). The public pages read their prices, the welcome offer and the legal facts
  from its database, so it has to be real. Nothing else does yet.
- **A Vercel project** for `apps/web`. `apps/web/vercel.json` already pins its functions to
  London.

## Once

1. **Create the Supabase project** in West Europe (London). Apply the migrations:

   ```
   npx supabase link --project-ref <ref>
   npx supabase db push
   ```

2. **Set the Vercel environment for Production.**

   These must be real:

   | Variable | Value |
   |---|---|
   | `PRELAUNCH` | `1` |
   | `NEXT_PUBLIC_ENVIRONMENT` | `production` |
   | `NEXT_PUBLIC_APP_URL` | `https://<your domain>` |
   | `NEXT_PUBLIC_SUPABASE_URL` | from the project's API settings |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | from the project's API settings |
   | `SUPABASE_SECRET_KEY` | from the project's API settings |
   | `DATABASE_URL` | the **transaction pooler** string ([deployment limits](deployment-limits.md)) |

   These may hold well-formed placeholders until launch. The server refuses to start without
   them, but nothing reachable uses them while `PRELAUNCH=1`: no account can exist, so no file
   is encrypted, nothing is charged and no email is sent.

   | Variable | Placeholder |
   |---|---|
   | `ANTHROPIC_API_KEY` | `sk-ant-placeholder` |
   | `RAZORPAY_KEY_ID` | `rzp_test_placeholder` |
   | `RAZORPAY_KEY_SECRET` | `placeholder` |
   | `RAZORPAY_WEBHOOK_SECRET` | `placeholder` |
   | `KMS_MASTER_KEY_ID` | `alias/magicmis-master` |
   | `AWS_REGION` | `eu-west-2` |
   | `RESEND_API_KEY` | `re_placeholder` |
   | `EMAIL_FROM` | `noreply@<your domain>` |

3. **Deploy, then check**:
   - the home page, pricing and a guide load;
   - `/sign-up` says "Opening soon";
   - `/robots.txt` and `/sitemap.xml` name the real domain.

4. **Tell search engines.** Add the domain to Google Search Console and Bing Webmaster Tools,
   and submit `/sitemap.xml`.

## At launch

In this order:

1. Replace every placeholder with its real value:
   - an Anthropic key;
   - Razorpay keys and the webhook (R-26);
   - the KMS key in `eu-west-2` and `AWS_ROLE_ARN` (ADR 0008);
   - Resend.
2. Run `pnpm --filter @magicmis/accounts auth-email --apply` ([auth email](auth-email.md)).
3. Run `pnpm --filter @magicmis/ai go-live` ([AI go-live](ai-go-live.md)).
4. Deploy the worker ([ADR 0074](../adr/0074-london-and-the-legal-documents-final.md)).
5. Set `PRELAUNCH` to `0` and redeploy.

Nothing else changes at launch. The pages that were indexed are the same pages.
