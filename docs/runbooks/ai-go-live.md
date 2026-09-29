# Switching the AI on in a new database

Every AI stage in a fresh database refuses: no prompt version is active on any route, so a run
still delivers its workbook but nothing the model would have done happens (ledgers the rules
cannot place stay Unmapped, there is no first dashboard chosen, no commentary, no chat). A prompt
is switched on per stage and per tier, and only on a **live eval recorded in that same database,
on the model that database routes to** (SPEC §14). The evals run on the local stack switched it on
there; production starts with everything off.

## Where it is switched on

- **One route at a time:** the admin console, **Prompts**. Each live eval row has an **Activate**
  button; rows from replays say "replay: not eligible".
- **Every route at once:** the go-live command below, which runs the evals and presses the same
  button for each one that passes. It decides nothing the button would not.

## The go-live command

Run from the repository root, against the target database. See first what it would do; this
spends nothing:

```
DATABASE_URL=<target> pnpm --filter @magicmis/ai go-live --dryRun
```

Then for real (about US$22 once for every route, on synthetic data only; `--maxCents` caps each
run, default 800):

```
AI_LIVE=1 ANTHROPIC_API_KEY=<key> DATABASE_URL=<target> pnpm --filter @magicmis/ai go-live
```

- It evaluates the newest prompt version on disk for each stage and tier, skipping any already on.
- A route whose eval falls under its threshold is left off and listed; nothing is forced.
- Recordings go to `packages/ai/evals/reports/go-live/`, never over the committed evidence.
- `--stage <name>` limits it to one stage.
- It exits non-zero while any route is still off, so it can gate a deploy step.

Set the two secrets in the environment without printing them (for example, source them from a
file that is never committed), and never pass them on a shared terminal's history.

## What stays off

- **`chat_deep`** (Dig deeper, and Investigate) has no eval: the harness cannot yet drive its tool
  loop (R-44). Until it does, Deep answers refuse in a new database. Quick answers and dashboard
  edits are unaffected.

## After it runs

`DATABASE_URL=<target> pnpm --filter @magicmis/ai activate` lists every route and what it runs.
