import { randomUUID } from "node:crypto";

import { requestBankTransfer } from "@magicmis/billing";
import { EnvValidationError } from "@magicmis/core/config";
import { startTestDb, type TestDb } from "@magicmis/db/test-harness";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startBoss } from "../src/boss";
import { deliverNotifications } from "../src/deliver";
import { loadWorkerEnv } from "../src/env";
import type { MailSender, OutboundEmail, SendResult } from "../src/mail";
import { MAINTENANCE_TASKS } from "../src/tasks";
import { renderNotification } from "../src/templates";

let db: TestDb | undefined;
beforeAll(async () => {
  db = await startTestDb();
}, 180_000);
afterAll(async () => {
  await db?.stop();
});
function testDb(): TestDb {
  if (db === undefined) throw new Error("test database was not started");
  return db;
}

const CTX = { appUrl: "https://app.example.test" };
const silent = { info: () => undefined, error: () => undefined };

class RecordingSender implements MailSender {
  sent: OutboundEmail[] = [];
  constructor(private readonly fail: string | null = null) {}
  async send(email: OutboundEmail): Promise<SendResult> {
    await new Promise((r) => setTimeout(r, 5));
    if (this.fail !== null) return { ok: false, error: this.fail };
    this.sent.push(email);
    return { ok: true, id: `msg_${this.sent.length.toString()}` };
  }
}

async function account(status = "active"): Promise<{ id: string; email: string }> {
  const email = `${randomUUID()}@example.test`;
  const r = await testDb().pool.query<{ id: string }>(
    `insert into accounts (auth_user_id, email, business_name, billing_address, state_code, status)
     values (gen_random_uuid(), $1, 'Synthetic Works', '{"line1":"2 Road","city":"Nashik","pincode":"422001","stateCode":"27"}', '27', $2)
     returning id`,
    [email, status],
  );
  return { id: r.rows[0]?.id ?? "", email };
}

async function queue(accountId: string, type: string, payload: object): Promise<string> {
  const r = await testDb().pool.query<{ id: string }>(
    `insert into notifications (account_id, type, payload, dedupe_key) values ($1, $2, $3, $4) returning id`,
    [accountId, type, JSON.stringify(payload), randomUUID()],
  );
  return r.rows[0]?.id ?? "";
}

async function status(id: string) {
  const r = await testDb().pool.query<{
    status: string;
    attempts: number;
    last_error: string | null;
    next_attempt_at: Date;
  }>(
    `select status, attempts, last_error, next_attempt_at from notifications where id = $1`,
    [id],
  );
  const row = r.rows[0];
  if (row === undefined) throw new Error("notification missing");
  return row;
}

const later = (seconds: number): Date => new Date(Date.now() + seconds * 1000);

describe("notification delivery (SPEC §29, ADR 0010)", () => {
  it("sends security notices with an idempotency key and suppresses unknown types and deleted accounts", async () => {
    const pool = testDb().pool;
    // Drain rows other tests may have left.
    await deliverNotifications(pool, new RecordingSender(), CTX, later(1));

    const a = await account();
    const login = await queue(a.id, "security.new_device_login", {
      device: "Chrome on Windows",
      country: "IN",
      city: "Pune",
    });
    const unknown = await queue(a.id, "nonexistent.type", {});
    const gone = await account("deleted");
    const toDeleted = await queue(gone.id, "security.password_changed", {});

    const sender = new RecordingSender();
    const stats = await deliverNotifications(pool, sender, CTX, later(1));
    expect(stats).toMatchObject({ sent: 1, suppressed: 2 });
    expect(sender.sent[0]).toMatchObject({
      to: a.email,
      idempotencyKey: `notification:${login}`,
    });
    expect(sender.sent[0]?.text).toContain("Chrome on Windows");
    expect(sender.sent[0]?.text).toContain("https://app.example.test/settings/security");
    expect((await status(login)).status).toBe("sent");
    expect((await status(unknown)).status).toBe("suppressed");
    expect((await status(toDeleted)).last_error).toBe("account deleted");

    // Nothing is sent twice.
    expect((await deliverNotifications(pool, sender, CTX, later(2))).sent).toBe(0);
  });

  it("attaches the proforma PDF queued by a bank transfer request", async () => {
    const pool = testDb().pool;
    const a = await account();
    const pack = await pool.query<{ id: string }>(
      `select id from credit_packs where price_paise_ex_gst = 2500000`,
    );
    await requestBankTransfer(pool, {
      accountId: a.id,
      packId: pack.rows[0]?.id ?? "",
      idempotencyKey: randomUUID(),
    });

    const sender = new RecordingSender();
    await deliverNotifications(pool, sender, CTX, later(1));
    const mail = sender.sent.find((m) => m.to === a.email);
    expect(mail?.subject).toContain("proforma");
    const attachment = mail?.attachments?.[0];
    expect(attachment?.filename).toMatch(/^PRO-\d\d-\d\d-\d{6}\.pdf$/u);
    expect(attachment?.content.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("backs off on failure and gives up after the configured attempts", async () => {
    const pool = testDb().pool;
    await deliverNotifications(pool, new RecordingSender(), CTX, later(1));
    const a = await account();
    const id = await queue(a.id, "security.password_changed", {});
    const failing = new RecordingSender("rate_limit_exceeded: slow down");

    let t = later(1);
    await deliverNotifications(pool, failing, CTX, t);
    let row = await status(id);
    expect(row).toMatchObject({ status: "queued", attempts: 1 });
    expect(row.next_attempt_at.getTime()).toBe(t.getTime() + 60_000);

    // Not retried before its time.
    expect(
      (await deliverNotifications(pool, failing, CTX, new Date(t.getTime() + 30_000)))
        .retried,
    ).toBe(0);

    for (let attempt = 2; attempt <= 5; attempt += 1) {
      t = new Date(row.next_attempt_at.getTime() + 1);
      await deliverNotifications(pool, failing, CTX, t);
      row = await status(id);
    }
    expect(row).toMatchObject({ status: "failed", attempts: 5 });
    expect(row.last_error).toContain("rate_limit_exceeded");
  });

  it("never delivers a row twice when two workers run at once", async () => {
    const pool = testDb().pool;
    await deliverNotifications(pool, new RecordingSender(), CTX, later(1));
    const a = await account();
    const ids = await Promise.all(
      Array.from({ length: 12 }, () =>
        queue(a.id, "security.backup_codes_regenerated", {}),
      ),
    );
    const s1 = new RecordingSender();
    const s2 = new RecordingSender();
    await Promise.all([
      deliverNotifications(pool, s1, CTX, later(1)),
      deliverNotifications(pool, s2, CTX, later(1)),
    ]);
    const keys = [...s1.sent, ...s2.sent].map((m) => m.idempotencyKey);
    expect(keys.sort()).toEqual(ids.map((id) => `notification:${id}`).sort());
  });
});

describe("templates", () => {
  it("renders every type the product queues, and escapes payload text in HTML", () => {
    const types: [string, object][] = [
      [
        "security.new_device_login",
        { device: "<script>x</script>", country: null, city: null },
      ],
      ["security.mfa_reset_with_backup_code", {}],
      ["security.backup_codes_regenerated", {}],
      ["security.password_changed", {}],
      ["security.break_glass", { reason: "Customer asked for help with a mapping", expires_at: "2027-01-02T00:00:00Z" }],
      ["account.deletion_scheduled", { purge_after: "2027-02-01T00:00:00Z" }],
      ["security.email_changed", {}],
      ["invoice_issued", { invoiceId: randomUUID(), purchaseId: randomUUID() }],
      ["proforma_issued", { invoiceId: randomUUID(), purchaseId: randomUUID() }],
      ["job.awaiting_review", { job_id: randomUUID(), company_id: randomUUID() }],
      [
        "job.review_expiring",
        { job_id: randomUUID(), expires_at: "2027-01-02T00:00:00Z" },
      ],
      ["job.completed", { job_id: randomUUID() }],
      [
        "job.failed",
        { job_id: randomUUID(), failure_class: "data_fault", charged: "299" },
      ],
      [
        "job.quote_offered",
        { job_id: randomUUID(), credits: "1499", expires_at: "2027-01-02T00:00:00Z" },
      ],
      ...[
        "billing.memory_fee_debited",
        "billing.memory_fee_failed",
        "billing.low_balance_before_fee",
        "lifecycle.grace",
        "lifecycle.archive_notice",
        "lifecycle.archived",
        "lifecycle.purge_notice",
        "lifecycle.purged",
        "reminder.monthly_refresh",
      ].map((type): [string, object] => [
        type,
        { company_id: randomUUID(), company_name: "Synthetic <Co>", days: 7 },
      ]),
      [
        "billing.lot_expiry_notice",
        { credits: "750", expires_at: "2027-12-31T10:00:00Z", days: 7 },
      ],
    ];
    for (const [type, payload] of types) {
      const r = renderNotification(type, payload, CTX);
      expect(r, type).not.toBeNull();
      expect(r?.subject).toContain("MIS Studio");
    }
    const html =
      renderNotification("security.new_device_login", types[0]?.[1], CTX)?.html ?? "";
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(
      renderNotification("invoice_issued", { invoiceId: "not-a-uuid" }, CTX),
    ).toBeNull();
  });
});

describe("pg-boss wiring", () => {
  it("registers every maintenance queue with an IST schedule and runs a job", async () => {
    let ran = 0;
    const probe = {
      queue: "test-probe",
      cron: "0 3 * * *",
      expireInSeconds: 30,
      run: () => {
        ran += 1;
        return Promise.resolve("ok");
      },
    };
    const boss: PgBoss = await startBoss(
      testDb().container.getConnectionUri(),
      { pool: testDb().pool, mail: new RecordingSender(), appUrl: CTX.appUrl },
      silent,
      [
        ...MAINTENANCE_TASKS.map((t) => ({ ...t, run: () => Promise.resolve(null) })),
        probe,
      ],
    );
    try {
      const schedules = await boss.getSchedules();
      expect(schedules.map((s) => s.name).sort()).toEqual(
        [...MAINTENANCE_TASKS.map((t) => t.queue), "test-probe"].sort(),
      );
      expect(schedules.every((s) => s.timezone === "Asia/Kolkata")).toBe(true);

      await boss.send("test-probe", {});
      const deadline = Date.now() + 30_000;
      while (ran === 0 && Date.now() < deadline)
        await new Promise((r) => setTimeout(r, 250));
      expect(ran).toBe(1);
    } finally {
      await boss.stop({ graceful: false, timeout: 5_000 });
    }
  });
});

describe("admin margin digest (SPEC §26)", () => {
  it("emails each active admin once per day, naming actions over their ratio", async () => {
    const { sendAdminMarginDigest } = await import("../src/admin-digest");
    const pool = testDb().pool;
    await pool.query(
      `insert into admin_users (email, password_hash, totp_secret_enc, totp_key_wrapped, totp_key_version, status)
       values ($1, 'x', '\\x00', '\\x00', 'test', 'active'), ($2, 'x', '\\x00', '\\x00', 'test', 'disabled')`,
      [`${randomUUID()}@admin.example.test`, `${randomUUID()}@admin.example.test`],
    );
    const a = await account();
    // commentary: 100 credits captured, ₹30 AI cost → 0.30, over the 0.20 cap.
    await pool.query(
      `insert into jobs (account_id, type, state, idempotency_key, captured_credits, actual_ai_cost_paise)
       values ($1, 'commentary', 'completed', $2, 100, 3000)`,
      [a.id, randomUUID()],
    );
    const mail = new RecordingSender();
    const now = new Date();
    const first = await sendAdminMarginDigest(
      pool,
      mail,
      "https://admin.example.test",
      now,
    );
    const active = await pool.query(
      `select count(*)::int as n from admin_users where status = 'active'`,
    );
    expect(first.sent).toBe((active.rows[0] as { n: number }).n);
    expect(first.flagged).toBeGreaterThanOrEqual(1);
    const email = mail.sent[0];
    expect(email?.subject).toMatch(/^\[Over ratio\] Daily margin \d{4}-\d{2}-\d{2}$/u);
    expect(email?.text).toContain("OVER MAX AI COST RATIO: commentary");
    expect(email?.text).toContain("Gross margin estimate");
    // The idempotency key makes a repeated run the same send for the provider.
    const again = new RecordingSender();
    await sendAdminMarginDigest(pool, again, "https://admin.example.test", now);
    expect(again.sent.map((e) => e.idempotencyKey)).toEqual(
      mail.sent.map((e) => e.idempotencyKey),
    );
  });
});

describe("worker env", () => {
  it("refuses to start without its variables, naming them but not their values", () => {
    try {
      loadWorkerEnv({ DATABASE_URL: "postgres://x", RESEND_API_KEY: "sk_wrong_secret" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const message = (error as Error).message;
      expect(message).toContain("RESEND_API_KEY");
      expect(message).toContain("EMAIL_FROM");
      expect(message).toContain("APP_URL");
      expect(message).not.toContain("sk_wrong_secret");
    }
    const env = loadWorkerEnv({
      DATABASE_URL: "postgres://x",
      RESEND_API_KEY: "re_test_123",
      EMAIL_FROM: "MIS Studio <noreply@mail.example.test>",
      NEXT_PUBLIC_APP_URL: "https://app.example.test",
    });
    expect(env.APP_URL).toBe("https://app.example.test");
  });
});
