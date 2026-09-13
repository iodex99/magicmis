import { randomBytes } from "node:crypto";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  canonicalContext,
  decryptWithKey,
  DecryptionError,
  encryptWithKey,
  LocalKeyWrapper,
  openWithWrappedKey,
  sealWithNewKey,
} from "./envelope";

const wrapper = new LocalKeyWrapper(randomBytes(32));
const ctx = { purpose: "company_data", account_id: "acc-1", company_id: "co-1" };

describe("AES-256-GCM with context", () => {
  it("round-trips", () => {
    const key = randomBytes(32);
    const sealed = encryptWithKey(key, Buffer.from("ledger balances"), ctx);
    expect(decryptWithKey(key, sealed, ctx).toString()).toBe("ledger balances");
  });

  it("uses a fresh IV, so equal plaintexts do not produce equal ciphertexts", () => {
    const key = randomBytes(32);
    const a = encryptWithKey(key, Buffer.from("same"), ctx);
    const b = encryptWithKey(key, Buffer.from("same"), ctx);
    expect(a.equals(b)).toBe(false);
  });

  it("refuses a ciphertext under a different tenant context", () => {
    // The property ADR 0008 is built on: data moved to another tenant's row is unreadable.
    const key = randomBytes(32);
    const sealed = encryptWithKey(key, Buffer.from("secret"), ctx);
    expect(() => decryptWithKey(key, sealed, { ...ctx, company_id: "co-2" })).toThrow(
      DecryptionError,
    );
  });

  it("detects tampering", () => {
    const key = randomBytes(32);
    const sealed = encryptWithKey(key, Buffer.from("secret"), ctx);
    const last = sealed.length - 1;
    sealed[last] = (sealed[last] ?? 0) ^ 0x01;
    expect(() => decryptWithKey(key, sealed, ctx)).toThrow(DecryptionError);
  });

  it("refuses the wrong key", () => {
    const sealed = encryptWithKey(randomBytes(32), Buffer.from("secret"), ctx);
    expect(() => decryptWithKey(randomBytes(32), sealed, ctx)).toThrow(DecryptionError);
  });

  it("canonicalises context key order", () => {
    expect(
      canonicalContext({ a: "1", b: "2" }).equals(canonicalContext({ b: "2", a: "1" })),
    ).toBe(true);
    const key = randomBytes(32);
    const sealed = encryptWithKey(key, Buffer.from("x"), { a: "1", b: "2" });
    expect(decryptWithKey(key, sealed, { b: "2", a: "1" }).toString()).toBe("x");
  });

  it("rejects malformed input rather than crashing", () => {
    expect(() => decryptWithKey(randomBytes(32), Buffer.from([9, 9, 9]), ctx)).toThrow(
      DecryptionError,
    );
  });

  it("property: arbitrary plaintexts round-trip", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 4096 }), (bytes) => {
        const key = randomBytes(32);
        return decryptWithKey(
          key,
          encryptWithKey(key, Buffer.from(bytes), ctx),
          ctx,
        ).equals(Buffer.from(bytes));
      }),
      { numRuns: 200 },
    );
  });
});

describe("envelope with a key wrapper", () => {
  it("seals under a new DEK and opens with the wrapped DEK", async () => {
    const { sealed, wrapped } = await sealWithNewKey(
      wrapper,
      Buffer.from("metric store"),
      ctx,
    );
    expect((await openWithWrappedKey(wrapper, sealed, wrapped, ctx)).toString()).toBe(
      "metric store",
    );
  });

  it("refuses to unwrap a DEK under a different context, as KMS does", async () => {
    const { sealed, wrapped } = await sealWithNewKey(wrapper, Buffer.from("x"), ctx);
    await expect(
      openWithWrappedKey(wrapper, sealed, wrapped, { ...ctx, account_id: "acc-2" }),
    ).rejects.toThrow(DecryptionError);
  });

  it("makes data unreadable once the wrapped DEK is destroyed (crypto-shredding)", async () => {
    const { sealed, wrapped } = await sealWithNewKey(wrapper, Buffer.from("x"), ctx);
    const shredded = {
      ...wrapped,
      ciphertext: new Uint8Array(wrapped.ciphertext.length),
    };
    await expect(openWithWrappedKey(wrapper, sealed, shredded, ctx)).rejects.toThrow(
      DecryptionError,
    );
  });

  it("a different master key cannot unwrap", async () => {
    const { sealed, wrapped } = await sealWithNewKey(wrapper, Buffer.from("x"), ctx);
    const other = new LocalKeyWrapper(randomBytes(32));
    await expect(openWithWrappedKey(other, sealed, wrapped, ctx)).rejects.toThrow(
      DecryptionError,
    );
  });

  it("rejects a master key of the wrong length", () => {
    expect(() => new LocalKeyWrapper(randomBytes(16))).toThrow(RangeError);
  });
});

describe("master key replacement (ADR 0008)", () => {
  it("re-wraps a DEK onto a new master key; the rotating wrapper opens both until the move ends", async () => {
    const { LocalKeyWrapper, RotatingKeyWrapper } = await import("./envelope");
    const { randomBytes } = await import("node:crypto");
    const oldKey = new LocalKeyWrapper(randomBytes(32), "old");
    const newKey = new LocalKeyWrapper(randomBytes(32), "new");
    const ctx = { purpose: "company_dek", company_id: "c1" };
    const { plaintext, wrapped } = await oldKey.generateDataKey(ctx);

    const rotating = new RotatingKeyWrapper(newKey, oldKey);
    expect(await rotating.unwrap(wrapped, ctx)).toEqual(plaintext);
    const moved = await newKey.wrap(await oldKey.unwrap(wrapped, ctx), ctx);
    expect(moved.keyVersion).toBe("new");
    expect(await newKey.unwrap(moved, ctx)).toEqual(plaintext);
    await expect(oldKey.unwrap(moved, ctx)).rejects.toThrow();
    // Context still binds after the move.
    await expect(rotating.unwrap(moved, { ...ctx, company_id: "c2" })).rejects.toThrow();
    expect((await rotating.generateDataKey(ctx)).wrapped.keyVersion).toBe("new");
  });
});
