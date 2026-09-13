import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  canonicalise,
  computeHash,
  GENESIS_HASH,
  linkEntry,
  verifyChain,
  type ChainValue,
} from "./chain";

describe("canonicalise", () => {
  it("sorts object keys so insertion order cannot change the hash", () => {
    expect(canonicalise({ b: 1, a: 2 })).toBe(canonicalise({ a: 2, b: 1 }));
    expect(canonicalise({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("sorts nested keys too", () => {
    expect(canonicalise({ x: { z: 1, y: 2 } })).toBe(canonicalise({ x: { y: 2, z: 1 } }));
  });

  it("preserves array order, which is meaningful", () => {
    expect(canonicalise([1, 2])).not.toBe(canonicalise([2, 1]));
  });

  it("renders bigint as a decimal string so ledger amounts survive intact", () => {
    expect(canonicalise({ amount: 12345678901234567890n })).toBe(
      '{"amount":"12345678901234567890"}',
    );
  });

  it("rejects a float — it would hash differently across renderings", () => {
    expect(() => canonicalise({ amount: 1.5 })).toThrow(TypeError);
    expect(() => canonicalise({ amount: Number.NaN })).toThrow(TypeError);
    expect(() => canonicalise({ amount: Number.POSITIVE_INFINITY })).toThrow(TypeError);
  });

  it("rejects undefined rather than silently dropping the key", () => {
    expect(() => canonicalise({ a: undefined } as unknown as ChainValue)).toThrow(
      TypeError,
    );
  });

  it("distinguishes a number from its string form", () => {
    expect(canonicalise({ v: 1 })).not.toBe(canonicalise({ v: "1" }));
  });

  it("escapes strings via JSON so separators cannot be smuggled in", () => {
    // Without escaping, {a:'1","b":"2'} could canonicalise to look like two keys.
    const sneaky = canonicalise({ a: '1","b":"2' });
    expect(sneaky).toBe('{"a":"1\\",\\"b\\":\\"2"}');
    expect(sneaky).not.toBe(canonicalise({ a: "1", b: "2" }));
  });
});

describe("hash chain", () => {
  const payloads: ChainValue[] = [
    { entryType: "grant", amount: 2000n, lotId: "lot-1" },
    { entryType: "reserve", amount: 999n, jobId: "job-1" },
    { entryType: "capture", amount: 999n, jobId: "job-1" },
  ];

  interface ChainRow {
    prevHash: string;
    hash: string;
    payload: ChainValue;
  }

  function buildChain(items: readonly ChainValue[]): ChainRow[] {
    let prev = GENESIS_HASH;
    return items.map((payload) => {
      const linked = linkEntry(prev, payload);
      prev = linked.hash;
      return { ...linked, payload };
    });
  }

  /** Index a built chain without a non-null assertion. */
  function at(chain: readonly ChainRow[], index: number): ChainRow {
    const row = chain[index];
    if (row === undefined) throw new Error(`no chain row at ${String(index)}`);
    return row;
  }

  it("verifies an intact chain", () => {
    expect(verifyChain(buildChain(payloads))).toEqual([]);
  });

  it("produces a 64-character hex digest", () => {
    expect(computeHash(GENESIS_HASH, { a: 1 })).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("is deterministic", () => {
    expect(computeHash(GENESIS_HASH, { a: 1, b: 2 })).toBe(
      computeHash(GENESIS_HASH, { b: 2, a: 1 }),
    );
  });

  it("detects an edited payload — the tamper the chain exists to catch", () => {
    const chain = buildChain(payloads);
    const tampered = chain.map((e, i) =>
      i === 1
        ? { ...e, payload: { entryType: "reserve", amount: 1n, jobId: "job-1" } }
        : e,
    );
    const failures = verifyChain(tampered);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ index: 1, reason: "bad_hash" });
  });

  it("detects a deleted entry as a broken link", () => {
    const chain = buildChain(payloads);
    const failures = verifyChain([at(chain, 0), at(chain, 2)]);
    expect(failures.some((f) => f.reason === "broken_link")).toBe(true);
  });

  it("detects a reordered chain", () => {
    const chain = buildChain(payloads);
    const failures = verifyChain([at(chain, 1), at(chain, 0), at(chain, 2)]);
    expect(failures.length).toBeGreaterThan(0);
  });

  it("reports one failure per bad row rather than cascading", () => {
    // An operator needs to tell "one row edited" from "chain rebuilt from here".
    const chain = buildChain([...payloads, { entryType: "release", amount: 0n }]);
    const tampered = chain.map((e, i) =>
      i === 1 ? { ...e, payload: { entryType: "tampered" } } : e,
    );
    const failures = verifyChain(tampered);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.index).toBe(1);
  });

  it("detects an entry appended onto the wrong predecessor", () => {
    const chain = buildChain(payloads);
    const forged = {
      ...linkEntry(GENESIS_HASH, { entryType: "forged" }),
      payload: { entryType: "forged" },
    };
    const failures = verifyChain([...chain, forged]);
    expect(failures.some((f) => f.reason === "broken_link")).toBe(true);
  });

  it("property: any change to any payload breaks verification", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ k: fc.string(), v: fc.integer() }), {
          minLength: 1,
          maxLength: 12,
        }),
        fc.integer({ min: 0, max: 11 }),
        (items, rawIndex) => {
          const chain = buildChain(items.map((i) => ({ k: i.k, v: i.v })));
          if (verifyChain(chain).length !== 0) return false;

          const index = rawIndex % chain.length;
          const target = chain[index];
          if (target === undefined) return false;
          const original = target.payload as { k: string; v: number };
          const tampered = chain.map((e, i) =>
            i === index ? { ...e, payload: { k: original.k, v: original.v + 1 } } : e,
          );
          return verifyChain(tampered).length > 0;
        },
      ),
    );
  });

  it("property: an intact chain of any length always verifies", () => {
    fc.assert(
      fc.property(fc.array(fc.integer(), { maxLength: 50 }), (values) => {
        return verifyChain(buildChain(values.map((v) => ({ v })))).length === 0;
      }),
    );
  });
});
