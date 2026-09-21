/**
 * Many sealed values of one company, opened under one unwrap of its key (ADR 0057).
 *
 * The point of this helper is the count. `openForCompany` is a transaction, a `for update` lock on
 * the company's key row and a KMS unwrap every time it is called; reading a chat thread message by
 * message paid all three per message and serialised the page against any run on the same company.
 * So the assertion that matters here is not "it decrypts" — it is "it decrypts once".
 */

import { randomBytes, randomUUID } from "node:crypto";

import {
  LocalKeyWrapper,
  type EncryptionContext,
  type KeyWrapper,
  type WrappedKey,
} from "@magicmis/crypto";
import { startTestDb, type TestDb } from "@magicmis/db/test-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openManyForCompany, sealForCompany } from "../src/server";

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

/** Counts what the real cost is: one unwrap is one KMS round trip in production. */
class CountingWrapper implements KeyWrapper {
  unwraps = 0;
  constructor(private readonly inner: KeyWrapper) {}
  generateDataKey(context: EncryptionContext) {
    return this.inner.generateDataKey(context);
  }
  unwrap(wrapped: WrappedKey, context: EncryptionContext) {
    this.unwraps += 1;
    return this.inner.unwrap(wrapped, context);
  }
  wrap(plaintext: Buffer, context: EncryptionContext) {
    return this.inner.wrap(plaintext, context);
  }
}

const wrapper = new CountingWrapper(
  LocalKeyWrapper.fromBase64(randomBytes(32).toString("base64")),
);

async function company(): Promise<{ accountId: string; companyId: string }> {
  const a = await pool().query<{ id: string }>(
    `insert into accounts (auth_user_id, email, business_name, state_code) values (gen_random_uuid(), $1, 'Batch Co', '27') returning id`,
    [`${randomUUID()}@example.test`],
  );
  const accountId = a.rows[0]?.id ?? "";
  const c = await pool().query<{ id: string }>(
    `insert into companies (account_id, name) values ($1, 'Batch Co') returning id`,
    [accountId],
  );
  return { accountId, companyId: c.rows[0]?.id ?? "" };
}

const text = (b: Buffer | null): string | null =>
  b === null ? null : b.toString("utf8");

describe("opening many sealed values at once", () => {
  it("opens twenty values under one unwrap, in the order asked for", async () => {
    const scope = await company();
    const items = [];
    for (let i = 0; i < 20; i += 1) {
      const id = randomUUID();
      items.push({
        purpose: "chat.message",
        id,
        sealed: await sealForCompany(pool(), wrapper, {
          ...scope,
          purpose: "chat.message",
          id,
          plaintext: Buffer.from(`message ${i.toString()}`, "utf8"),
        }),
      });
    }

    const before = wrapper.unwraps;
    const opened = await openManyForCompany(pool(), wrapper, { ...scope, items });
    // Twenty values, one key. One at a time this was twenty transactions, twenty locks on the
    // company's key row and twenty unwraps.
    expect(wrapper.unwraps - before).toBe(1);
    expect(opened.map(text)).toEqual(items.map((_, i) => `message ${i.toString()}`));
  });

  it("keeps a null in its place and never opens the key for a page of them", async () => {
    const scope = await company();
    const id = randomUUID();
    const sealed = await sealForCompany(pool(), wrapper, {
      ...scope,
      purpose: "chat.reply",
      id,
      plaintext: Buffer.from("the reply", "utf8"),
    });

    const mixed = await openManyForCompany(pool(), wrapper, {
      ...scope,
      items: [
        { purpose: "chat.reply", id, sealed: null },
        { purpose: "chat.reply", id, sealed },
        { purpose: "chat.reply", id, sealed: null },
      ],
    });
    expect(mixed.map(text)).toEqual([null, "the reply", null]);

    // A thread of user messages has no replies to open; that must cost nothing at all.
    const before = wrapper.unwraps;
    const empty = await openManyForCompany(pool(), wrapper, {
      ...scope,
      items: [
        { purpose: "chat.reply", id, sealed: null },
        { purpose: "chat.values", id, sealed: null },
      ],
    });
    expect(empty).toEqual([null, null]);
    expect(wrapper.unwraps - before).toBe(0);
    expect(await openManyForCompany(pool(), wrapper, { ...scope, items: [] })).toEqual(
      [],
    );
  });

  it("refuses a value sealed for another purpose or another company", async () => {
    const mine = await company();
    const theirs = await company();
    const id = randomUUID();
    const sealed = await sealForCompany(pool(), wrapper, {
      ...mine,
      purpose: "chat.message",
      id,
      plaintext: Buffer.from("mine", "utf8"),
    });

    // The purpose and the id are bound into the ciphertext, so a value cannot be read as
    // something it was not sealed as — batching must not loosen that.
    await expect(
      openManyForCompany(pool(), wrapper, {
        ...mine,
        items: [{ purpose: "chat.reply", id, sealed }],
      }),
    ).rejects.toThrow();
    await expect(
      openManyForCompany(pool(), wrapper, {
        ...mine,
        items: [{ purpose: "chat.message", id: randomUUID(), sealed }],
      }),
    ).rejects.toThrow();
    // Another account asking for this company's key is refused before any decryption.
    await expect(
      openManyForCompany(pool(), wrapper, {
        accountId: theirs.accountId,
        companyId: mine.companyId,
        items: [{ purpose: "chat.message", id, sealed }],
      }),
    ).rejects.toThrow(/does not belong/);
  });
});
