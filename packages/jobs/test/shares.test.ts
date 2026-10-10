/**
 * ADR 0090: a board shared by a link — frozen and sealed under the company's key, opened by the
 * link alone, every opening recorded, and nothing left once it is withdrawn, expired, or its
 * company gone.
 */

import { createHash } from "node:crypto";

import { startTestDb, type TestDb } from "@magicmis/db/test-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createShare, listShares, openShare, revokeShare } from "../src/shares";
import { accountWithCompany, wrapper } from "./helpers";

let db: TestDb | undefined;
beforeAll(async () => {
  db = await startTestDb();
}, 180_000);
afterAll(async () => {
  await db?.stop();
});
const pool = () => {
  if (db === undefined) throw new Error("db not started");
  return db.pool;
};
const board = { company: "Acme", values: [{ metricId: "revenue", value: "125000" }] };
const NOW = new Date("2026-10-10T09:00:00Z");

describe("a board shared by a link (ADR 0090)", () => {
  it("opens for whoever holds the link, records each opening, and keeps no copy of the link", async () => {
    const c = await accountWithCompany(pool(), 0n);
    const made = await createShare(pool(), wrapper, c, {
      period: "2026-05",
      withWriting: true,
      days: 30,
      board,
      now: NOW,
    });
    expect(made.token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(made.expiresAt.toISOString()).toBe("2026-11-09T09:00:00.000Z");

    // The secret is not stored: only its hash, and the board only sealed.
    const row = await pool().query<{ token_hash: Buffer; sealed_board: Buffer }>(
      `select token_hash, sealed_board from share_links where id = $1`,
      [made.id],
    );
    const stored = row.rows[0];
    expect(
      stored?.token_hash.equals(createHash("sha256").update(made.token).digest()),
    ).toBe(true);
    expect(stored?.sealed_board.includes(Buffer.from("Acme"))).toBe(false);

    const opened = await openShare(pool(), wrapper, made.token, NOW);
    expect(opened).toMatchObject({ period: "2026-05", withWriting: true, board });
    await openShare(pool(), wrapper, made.token, NOW);
    expect(await listShares(pool(), c)).toEqual([
      expect.objectContaining({
        id: made.id,
        views: 2,
        lastViewedAt: NOW,
        revokedAt: null,
      }),
    ]);

    // Another account sees none of it.
    const other = await accountWithCompany(pool(), 0n);
    expect(await listShares(pool(), other)).toEqual([]);
    await expect(revokeShare(pool(), other, made.id)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("opens nothing for a wrong, malformed, expired or withdrawn link, or a deleted company", async () => {
    const c = await accountWithCompany(pool(), 0n);
    const made = await createShare(pool(), wrapper, c, {
      period: "2026-05",
      withWriting: false,
      days: 7,
      board,
      now: NOW,
    });
    expect(await openShare(pool(), wrapper, "x".repeat(43), NOW)).toBeNull();
    expect(await openShare(pool(), wrapper, "not a link", NOW)).toBeNull();
    // A week and a day later it has lapsed.
    expect(
      await openShare(pool(), wrapper, made.token, new Date("2026-10-18T09:00:00Z")),
    ).toBeNull();
    // Nothing was recorded for any of those.
    expect((await listShares(pool(), c))[0]?.views).toBe(0);

    await revokeShare(pool(), c, made.id);
    expect(await openShare(pool(), wrapper, made.token, NOW)).toBeNull();

    const live = await createShare(pool(), wrapper, c, {
      period: "2026-05",
      withWriting: false,
      days: 7,
      board,
      now: NOW,
    });
    await pool().query(`update companies set deleted_at = now() where id = $1`, [
      c.companyId,
    ]);
    expect(await openShare(pool(), wrapper, live.token, NOW)).toBeNull();
  });

  it("lasts no longer than the configured limit, and only for a month", async () => {
    const c = await accountWithCompany(pool(), 0n);
    const base = { withWriting: false, board, now: NOW };
    await expect(
      createShare(pool(), wrapper, c, { ...base, period: "2026-05", days: 91 }),
    ).rejects.toMatchObject({ code: "bad_days" });
    await expect(
      createShare(pool(), wrapper, c, { ...base, period: "2026-05", days: 0 }),
    ).rejects.toMatchObject({ code: "bad_days" });
    await expect(
      createShare(pool(), wrapper, c, { ...base, period: "May", days: 7 }),
    ).rejects.toMatchObject({ code: "bad_period" });
    const other = await accountWithCompany(pool(), 0n);
    await expect(
      createShare(
        pool(),
        wrapper,
        { accountId: other.accountId, companyId: c.companyId },
        { ...base, period: "2026-05", days: 7 },
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
