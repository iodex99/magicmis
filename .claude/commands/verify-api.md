---
name: verify-api
description: Verify an external API fact against official documentation before implementing it.
argument-hint: [what to verify, e.g. "Anthropic batch API polling"]
---

Verify against **official documentation**: $ARGUMENTS

SPEC §0.4 forbids guessing an API shape. This command exists so verification leaves a
record.

1. Fetch the official docs. Start points:
   - Anthropic — https://docs.claude.com/en/api/overview ·
     site map https://docs.claude.com/en/docs_site_map.md
     (also load the `claude-api` skill before answering anything Anthropic-related)
   - Supabase — https://supabase.com/docs
   - Razorpay — https://razorpay.com/docs
   - SheetJS — https://docs.sheetjs.com (note: install per **their** distribution
     instructions, not the stale npm registry package)
   - DuckDB-WASM — https://duckdb.org/docs
   - ECharts — https://echarts.apache.org/en/api.html
   - GST — the official CBIC/GST portal, not a blog
2. Report the exact shape: parameter names, allowed values, defaults, response fields,
   error codes, limits. Quote the doc where it matters.
3. **Flag every contradiction** with what `docs/SPEC.md` or our seed data assumes —
   especially model IDs, prices, the effort parameter's name and values, structured
   output support, cache multipliers, and the batch discount. Spec seed values are
   explicitly illustrative and may be wrong.
4. Record it: the doc URL and today's date, into the relevant ADR (or a new one). For
   model or pricing facts, also update `model_registry`'s `source_url` and `verified_at`.
5. If the documentation does not answer the question, **say so.** Do not fill the gap
   with a plausible guess.
