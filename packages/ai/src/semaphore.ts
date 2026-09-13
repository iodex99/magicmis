/**
 * In-process concurrency limits for AI calls (SPEC §14), sized from `ai.concurrency` config:
 * a global limit plus per-account limits for jobs and chat. FIFO, no timers.
 */

import { readConfig } from "@magicmis/db/config";
import type { Queryable } from "@magicmis/db/tx";
import { z } from "zod";

export class Semaphore {
  private active = 0;
  private readonly waiters: (() => void)[] = [];

  constructor(private limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError("limit must be ≥ 1");
  }

  get inUse(): number {
    return this.active;
  }

  resize(limit: number): void {
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError("limit must be ≥ 1");
    this.limit = limit;
    this.drain();
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.active -= 1;
      this.drain();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private drain(): void {
    while (this.active < this.limit) {
      const next = this.waiters.shift();
      if (next === undefined) return;
      this.active += 1;
      next();
    }
  }
}

export const concurrencyConfigSchema = z.object({
  global: z.number().int().positive(),
  per_account_jobs: z.number().int().positive(),
  per_account_chat: z.number().int().positive(),
});

export class AiLimiter {
  private readonly global: Semaphore;
  private readonly perAccount = new Map<string, Semaphore>();

  constructor(private readonly config: z.infer<typeof concurrencyConfigSchema>) {
    this.global = new Semaphore(config.global);
  }

  static async fromConfig(db: Queryable): Promise<AiLimiter> {
    return new AiLimiter(await readConfig(db, "ai.concurrency", concurrencyConfigSchema));
  }

  run<T>(accountId: string, kind: "job" | "chat", fn: () => Promise<T>): Promise<T> {
    const key = `${kind}:${accountId}`;
    let sem = this.perAccount.get(key);
    if (sem === undefined) {
      sem = new Semaphore(
        kind === "job" ? this.config.per_account_jobs : this.config.per_account_chat,
      );
      this.perAccount.set(key, sem);
    }
    const account = sem;
    return account.run(async () => {
      try {
        return await this.global.run(fn);
      } finally {
        if (account.inUse === 1) this.perAccount.delete(key);
      }
    });
  }
}
