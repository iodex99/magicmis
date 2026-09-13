/**
 * Job state machine (SPEC §23). Transitions are checked under a row lock; nothing moves a job
 * except through `transition`.
 *
 *   draft → estimated → [needs_quote → quote_accepted] → reserved
 *     → preflight → profiling → classifying → mapping → awaiting_review
 *     → computing → validating → rendering → [commentary_queued → commentary_done] → completed
 *   Terminal: completed | failed_data | failed_platform | cancelled | expired
 *   Pause: needs_quote (runtime cap) → quote_accepted → resumes from the checkpoint
 */

import type { Queryable } from "@magicmis/db/tx";

export const PIPELINE = [
  "reserved",
  "preflight",
  "profiling",
  "classifying",
  "mapping",
  "awaiting_review",
  "computing",
  "validating",
  "rendering",
] as const;

export type JobState =
  | "draft"
  | "estimated"
  | "needs_quote"
  | "quote_accepted"
  | (typeof PIPELINE)[number]
  | "commentary_queued"
  | "commentary_done"
  | "completed"
  | "failed_data"
  | "failed_platform"
  | "cancelled"
  | "expired";

export const TERMINAL: ReadonlySet<JobState> = new Set([
  "completed",
  "failed_data",
  "failed_platform",
  "cancelled",
  "expired",
]);

const RUNNING: readonly JobState[] = [
  "preflight",
  "profiling",
  "classifying",
  "mapping",
  "awaiting_review",
  "computing",
  "validating",
  "rendering",
];

/** Allowed next states. Stages may be skipped forward (a refresh with nothing to review skips review). */
export function allowedNext(from: JobState): readonly JobState[] {
  switch (from) {
    case "draft":
      return ["estimated", "needs_quote", "cancelled"];
    case "estimated":
      return ["reserved", "needs_quote", "cancelled", "expired"];
    case "needs_quote":
      return ["quote_accepted", "cancelled", "expired"];
    case "quote_accepted":
      return ["reserved", "cancelled"];
    case "commentary_queued":
      return ["commentary_done", "failed_platform", "needs_quote", "cancelled"];
    case "commentary_done":
      return ["completed"];
    default: {
      const i = PIPELINE.indexOf(from as (typeof PIPELINE)[number]);
      if (i < 0) return [];
      const forward = PIPELINE.slice(i + 1);
      const settle: JobState[] = [
        "failed_data",
        "failed_platform",
        "cancelled",
        "needs_quote",
      ];
      if (from === "awaiting_review") settle.push("expired");
      if (from === "rendering") settle.push("completed", "commentary_queued");
      // A commentary job has no browser stages: once credits are held it is queued for analysis.
      if (from === "reserved") settle.push("commentary_queued");
      return [...forward, ...settle];
    }
  }
}

export class JobStateError extends Error {
  constructor(
    readonly code: "not_found" | "invalid_transition" | "terminal",
    message: string,
  ) {
    super(message);
    this.name = "JobStateError";
  }
}

export interface JobRow {
  readonly id: string;
  readonly account_id: string;
  readonly company_id: string | null;
  readonly type: string;
  readonly tier: "efficient" | "professional" | "expert" | "expert_plus";
  readonly delivery_mode: "standard" | "instant";
  readonly state: JobState;
  readonly stage_checkpoints: Record<string, unknown>;
  readonly price_credits: string | null;
  readonly quote_id: string | null;
  readonly reservation_id: string | null;
  readonly captured_credits: string | null;
}

export async function lockJob(
  db: Queryable,
  jobId: string,
  accountId: string,
): Promise<JobRow> {
  const r = await db.query<JobRow>(
    `select id, account_id, company_id, type, tier, delivery_mode, state, stage_checkpoints,
            price_credits::text as price_credits, quote_id, reservation_id, captured_credits::text as captured_credits
     from public.jobs where id = $1 and account_id = $2 for update`,
    [jobId, accountId],
  );
  const job = r.rows[0];
  if (job === undefined) throw new JobStateError("not_found", "job not found");
  return job;
}

export async function transition(
  db: Queryable,
  job: JobRow,
  to: JobState,
  patch: {
    checkpoint?: Record<string, unknown>;
    failure?: { class: string; code: string; detail: string };
  } = {},
): Promise<void> {
  if (TERMINAL.has(job.state))
    throw new JobStateError("terminal", `job is already ${job.state}`);
  if (!allowedNext(job.state).includes(to)) {
    throw new JobStateError(
      "invalid_transition",
      `cannot move a job from ${job.state} to ${to}`,
    );
  }
  const running = RUNNING.includes(job.state) ? { last_running_state: job.state } : {};
  await db.query(
    `update public.jobs set
       state = $2,
       -- The state timeline for the admin jobs inspector (SPEC §26); no content, states and times only.
       stage_checkpoints = (stage_checkpoints || $3::jsonb) || jsonb_build_object('state_history',
         coalesce(stage_checkpoints->'state_history', '[]'::jsonb)
           || jsonb_build_array(jsonb_build_object('from', $9::text, 'state', $2::text, 'at', now()))),
       failure_class = coalesce($4, failure_class),
       failure_code = coalesce($5, failure_code),
       failure_detail = coalesce($6, failure_detail),
       heartbeat_at = case when $2 = any($7::text[]) then now() else heartbeat_at end,
       completed_at = case when $2 = any($8::text[]) then now() else completed_at end
     where id = $1`,
    [
      job.id,
      to,
      JSON.stringify({ ...running, ...(patch.checkpoint ?? {}) }),
      patch.failure?.class ?? null,
      patch.failure?.code ?? null,
      patch.failure?.detail ?? null,
      RUNNING,
      [...TERMINAL],
      job.state,
    ],
  );
}
