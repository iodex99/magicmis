# Runbook: an Anthropic model is unavailable

**Applies to:** every AI stage (SPEC §14, ADR 0019).

**Audience:** on-call engineers and admins.

## How the platform already behaves

- **Rate limits and transient errors.** The Anthropic SDK retries 408, 409, 429, 5xx and connection errors with backoff, two retries per call (`packages/ai/src/transport.ts`).
- **Model failures.** A documented not-found, permission or unavailable error, or repeated 5xx after retries, moves the stage down its `fallback_chain` (tier routing). `ai_calls.fallback_from` records it.
  - If a priced stage ran on a lower tier's model, the user is charged the price of the tier actually delivered and sees a notice.
- **Whole chain fails.** The stage fails as `platform_fault`. The hold is released and nothing is charged. The job shows a retry message.
- **Margin.** Fallbacks can change cost. The runtime cost cap still pauses a job before it overspends.

## Detect

- Margin dashboard (`/margin`):
  - the fallback rate per stage rises;
  - the failure rate by class shows `platform_fault`.
- Anthropic status page: https://status.anthropic.com
- Support messages: "analysis failed, try again".

Check the last hour of calls:

```sql
select stage, model_requested, model_used, fallback_from, count(*)
from ai_calls where created_at > now() - interval '1 hour'
group by 1, 2, 3, 4 order by 5 desc;
```

## Respond

1. **Short outage** (minutes, status page acknowledges it): do nothing. Fallbacks and failure refunds cover it. Post a notice if support volume rises.
2. **Model retired or access revoked** (not-found or permission errors on one model id):
   1. In `/models`, mark the model `available = false`. Routing then skips it.
   2. In the tier routing editor, publish a new routing version that points the affected stages at a verified replacement model.
      - Check model ids and prices against https://docs.claude.com before entering them.
      - Update `source_url` and `verified_at`.
   3. The replacement must have eval results recorded for its prompt version before activation. The activation gate refuses otherwise. Run the evals first:
      ```sh
      pnpm --filter @magicmis/ai evals
      ```
   4. Check `/price-book` → **Preview impact** for the affected actions. A more expensive model may push an action over `max_ai_cost_ratio`. Adjust prices or routing before customers hit quotes.
3. **Everything unavailable** (all models or the API key fail):
   - Check the Anthropic console for key status, billing and rate-limit tier.
   - If the key was revoked, follow [breach-response.md](breach-response.md).
   - Paid AI actions fail without charge. Monthly refreshes on unchanged structure make no AI calls and keep working.

## Afterwards

Review margin for the incident window, and note any routing change in the ADR log if it is permanent.
