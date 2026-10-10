/**
 * ADR 0087: a company's alerts are kept per company, checked on the figures a run computed, and
 * noticed by how many fired — once per company and month, and never with a figure in it.
 */

import type { MetricValue } from "@magicmis/engine";
import { startTestDb, type TestDb } from "@magicmis/db/test-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  addAlert,
  AlertError,
  listAlerts,
  MAX_ALERTS,
  noticeFiredAlerts,
  removeAlert,
} from "../src/alerts";
import { renderNotification } from "../src/notice-templates";
import { accountWithCompany } from "./helpers";

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

const allowed = new Set(["cash_and_bank", "dso", "revenue"]);
const value = (
  metricId: string,
  v: string,
  unit: MetricValue["unit"] = "paise",
): MetricValue => ({
  metricId,
  period: "2026-05" as MetricValue["period"],
  dims: {},
  value: v,
  nullReason: null,
  unit,
  formula: "",
  inputs: [],
});

describe("alerts on a company's own figures (ADR 0087)", () => {
  it("are kept per company, refuse what they cannot watch, and stop at the cap", async () => {
    const c = await accountWithCompany(pool(), 0n);
    await addAlert(pool(), c, {
      metricId: "cash_and_bank",
      comparator: "below",
      threshold: "50000000",
      allowed,
    });
    await expect(
      addAlert(pool(), c, {
        metricId: "ebitda_pct",
        comparator: "below",
        threshold: "1",
        allowed,
      }),
    ).rejects.toMatchObject({ code: "unknown_metric" });
    await expect(
      addAlert(pool(), c, {
        metricId: "dso",
        comparator: "above",
        threshold: "6O",
        allowed,
      }),
    ).rejects.toBeInstanceOf(AlertError);
    for (let i = 1; i < MAX_ALERTS; i += 1)
      await addAlert(pool(), c, {
        metricId: "dso",
        comparator: "above",
        threshold: `${i.toString()}0`,
        allowed,
      });
    await expect(
      addAlert(pool(), c, {
        metricId: "dso",
        comparator: "above",
        threshold: "99",
        allowed,
      }),
    ).rejects.toMatchObject({ code: "too_many" });
    const other = await accountWithCompany(pool(), 0n);
    expect(await listAlerts(pool(), other)).toEqual([]);
    const first = (await listAlerts(pool(), c))[0];
    if (first === undefined) throw new Error("no alert");
    // Another account cannot take it off.
    await expect(removeAlert(pool(), other, first.id)).rejects.toMatchObject({
      code: "not_found",
    });
    await removeAlert(pool(), c, first.id);
    expect(await listAlerts(pool(), c)).toHaveLength(MAX_ALERTS - 1);
  });

  it("hold the cap against requests made together, and refuse another account's company", async () => {
    const c = await accountWithCompany(pool(), 0n);
    const results = await Promise.allSettled(
      Array.from({ length: MAX_ALERTS + 5 }, (_, i) =>
        addAlert(pool(), c, {
          metricId: "revenue",
          comparator: "below",
          threshold: `${(i + 1).toString()}00`,
          allowed,
        }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(MAX_ALERTS);
    expect(await listAlerts(pool(), c)).toHaveLength(MAX_ALERTS);
    // The database refuses the pair too, whoever the caller is.
    const other = await accountWithCompany(pool(), 0n);
    await expect(
      addAlert(
        pool(),
        { accountId: other.accountId, companyId: c.companyId },
        { metricId: "revenue", comparator: "below", threshold: "1", allowed },
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      pool().query(
        `insert into public.company_alerts (account_id, company_id, metric_id, comparator, threshold)
         values ($1, $2, 'revenue', 'below', '1')`,
        [other.accountId, c.companyId],
      ),
    ).rejects.toThrow(/foreign key/u);
  });

  it("send one notice per month saying how many fired, and no figure", async () => {
    const c = await accountWithCompany(pool(), 0n);
    await addAlert(pool(), c, {
      metricId: "cash_and_bank",
      comparator: "below",
      threshold: "50000000",
      allowed,
    });
    await addAlert(pool(), c, {
      metricId: "dso",
      comparator: "above",
      threshold: "60",
      allowed,
    });
    await addAlert(pool(), c, {
      metricId: "revenue",
      comparator: "below",
      threshold: "1",
      allowed,
    });
    const values = [
      value("cash_and_bank", "45000000"),
      value("dso", "72.000000", "days"),
      value("revenue", "900000000"),
    ];
    expect(await noticeFiredAlerts(pool(), c, "2026-05", values)).toBe(2);
    // The same month run again says nothing new.
    expect(await noticeFiredAlerts(pool(), c, "2026-05", values)).toBe(2);
    const notices = await pool().query<{
      type: string;
      payload: Record<string, unknown>;
    }>(`select type, payload from notifications where account_id = $1`, [c.accountId]);
    expect(notices.rows).toHaveLength(1);
    expect(notices.rows[0]?.payload).toMatchObject({ count: 2, company_id: c.companyId });
    const email = renderNotification("alerts.fired", notices.rows[0]?.payload, {
      appUrl: "https://app.example.test",
    });
    expect(email?.title).toMatch(/^2 alerts on /u);
    // How many, never which figure or by how much. The link's company id is random and held
    // "72" one run in four, so it is taken out before the figures are looked for (ADR 0091).
    expect(email?.text.replaceAll(c.companyId, "")).not.toMatch(/450000|72|₹|\$/u);
  });
});
