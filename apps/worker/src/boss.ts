/**
 * pg-boss wiring (SPEC §5). Verified against pg-boss@12.31.0's type declarations and README:
 * `new PgBoss({ connectionString, schema })`, `start()`, `createQueue(name, options)`,
 * `schedule(name, cron, data, { tz })`, `work(name, options, handler(jobs[]))`,
 * `stop({ graceful, timeout })`. Requires Node ≥ 22.12 and PostgreSQL ≥ 13.
 */

import { PgBoss } from "pg-boss";

import {
  MAINTENANCE_TASKS,
  SCHEDULE_TZ,
  type MaintenanceTask,
  type TaskDeps,
} from "./tasks";

export interface Logger {
  info(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export const BOSS_SCHEMA = "pgboss";

export async function startBoss(
  connectionString: string,
  deps: TaskDeps,
  log: Logger,
  tasks: readonly MaintenanceTask[] = MAINTENANCE_TASKS,
): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString,
    schema: BOSS_SCHEMA,
    application_name: "magicmis-worker",
  });
  boss.on("error", (error: unknown) => {
    log.error(
      { err: error instanceof Error ? error.message : String(error) },
      "pg-boss error",
    );
  });
  await boss.start();

  for (const task of tasks) {
    // `singleton`: at most one queued or active job per queue, so a slow run is never
    // stacked behind by the next tick.
    await boss.createQueue(task.queue, {
      policy: "singleton",
      expireInSeconds: task.expireInSeconds,
      retryLimit: 2,
    });
    await boss.schedule(task.queue, task.cron, null, { tz: SCHEDULE_TZ });
    await boss.work(task.queue, async (jobs) => {
      for (const job of jobs) {
        const started = Date.now();
        const result = await task.run(deps, new Date());
        log.info(
          { queue: task.queue, jobId: job.id, ms: Date.now() - started, result },
          "task complete",
        );
      }
    });
  }
  return boss;
}
