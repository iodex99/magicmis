/**
 * Daily margin email to admins (SPEC §26): the last day's gross margin estimate and every action
 * over its `max_ai_cost_ratio`. Figures only, no customer names or content. Sent once per admin
 * per IST day (idempotency key), so a late or repeated run sends nothing twice.
 */

import { marginReport } from "@magicmis/ai/margin";
import type { Pool } from "pg";

import type { MailSender } from "./mail";

const rupees = (paise: bigint): string => {
  const neg = paise < 0n;
  const abs = neg ? -paise : paise;
  const s = abs.toString().padStart(3, "0");
  return `${neg ? "-" : ""}₹${s.slice(0, -2)}.${s.slice(-2)}`;
};

const escape = (s: string) => s.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");

export async function sendAdminMarginDigest(
  pool: Pool,
  mail: MailSender,
  appUrl: string,
  now: Date,
): Promise<{ sent: number; flagged: number }> {
  const report = await marginReport(pool, new Date(now.getTime() - 86_400_000), now);
  const flagged = report.actions.filter((a) => a.overCap);
  const day = new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const gm = report.grossMargin;
  const lines = [
    `Margin for the 24 hours to ${now.toISOString()}`,
    "",
    `Captured value: ${rupees(gm.capturedValuePaise)}`,
    `AI cost: ${rupees(gm.aiCostPaise)}`,
    `Payment fees: ${rupees(gm.paymentFeesPaise)}`,
    `Infra cost: ${rupees(gm.infraCostPaise)}`,
    `Gross margin estimate: ${rupees(gm.marginPaise)}`,
    `Estimation misses: ${report.estimationMisses.count.toString()} (${rupees(report.estimationMisses.costPaise)})`,
    `Platform-absorbed cost: ${report.absorbed.count.toString()} (${rupees(report.absorbed.costPaise)})`,
    "",
    flagged.length === 0
      ? "No action is over its max AI cost ratio."
      : `OVER MAX AI COST RATIO: ${flagged.map((a) => `${a.actionKey} (${a.ratio ?? "no capture"} > ${a.maxRatio ?? "?"})`).join(", ")}`,
    "",
    `${appUrl}/margin?days=1`,
  ];
  const admins = await pool.query<{ id: string; email: string }>(
    `select id, email from public.admin_users where status = 'active' order by email`,
  );
  let sent = 0;
  for (const a of admins.rows) {
    const r = await mail.send({
      to: a.email,
      subject: `${flagged.length > 0 ? "[Over ratio] " : ""}Daily margin ${day}`,
      text: lines.join("\n"),
      html: `<pre style="font-family:monospace">${escape(lines.join("\n"))}</pre>`,
      idempotencyKey: `admin-margin:${a.id}:${day}`,
    });
    if (r.ok) sent += 1;
  }
  return { sent, flagged: flagged.length };
}
