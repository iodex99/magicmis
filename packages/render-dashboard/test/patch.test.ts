import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { applyJsonPatch, patchDashboard, type PatchOperation } from "../src/patch";
import { DEFAULT_DASHBOARD } from "../src/spec";

// RFC 6902 Appendix A (https://www.rfc-editor.org/rfc/rfc6902#appendix-A).
const cases: {
  name: string;
  doc: unknown;
  patch: PatchOperation[];
  expected?: unknown;
  error?: RegExp;
}[] = [
  {
    name: "A.1 add object member",
    doc: { foo: "bar" },
    patch: [{ op: "add", path: "/baz", value: "qux" }],
    expected: { baz: "qux", foo: "bar" },
  },
  {
    name: "A.2 add array element",
    doc: { foo: ["bar", "baz"] },
    patch: [{ op: "add", path: "/foo/1", value: "qux" }],
    expected: { foo: ["bar", "qux", "baz"] },
  },
  {
    name: "A.3 remove object member",
    doc: { baz: "qux", foo: "bar" },
    patch: [{ op: "remove", path: "/baz" }],
    expected: { foo: "bar" },
  },
  {
    name: "A.4 remove array element",
    doc: { foo: ["bar", "qux", "baz"] },
    patch: [{ op: "remove", path: "/foo/1" }],
    expected: { foo: ["bar", "baz"] },
  },
  {
    name: "A.5 replace value",
    doc: { baz: "qux", foo: "bar" },
    patch: [{ op: "replace", path: "/baz", value: "boo" }],
    expected: { baz: "boo", foo: "bar" },
  },
  {
    name: "A.6 move value",
    doc: { foo: { bar: "baz", waldo: "fred" }, qux: { corge: "grault" } },
    patch: [{ op: "move", from: "/foo/waldo", path: "/qux/thud" }],
    expected: { foo: { bar: "baz" }, qux: { corge: "grault", thud: "fred" } },
  },
  {
    name: "A.7 move array element",
    doc: { foo: ["all", "grass", "cows", "eat"] },
    patch: [{ op: "move", from: "/foo/1", path: "/foo/3" }],
    expected: { foo: ["all", "cows", "eat", "grass"] },
  },
  {
    name: "A.8 test success",
    doc: { baz: "qux", foo: ["a", 2, "c"] },
    patch: [
      { op: "test", path: "/baz", value: "qux" },
      { op: "test", path: "/foo/1", value: 2 },
    ],
    expected: { baz: "qux", foo: ["a", 2, "c"] },
  },
  {
    name: "A.9 test failure",
    doc: { baz: "qux" },
    patch: [{ op: "test", path: "/baz", value: "bar" }],
    error: /test failed/u,
  },
  {
    name: "A.10 add nested member",
    doc: { foo: "bar" },
    patch: [{ op: "add", path: "/child", value: { grandchild: {} } }],
    expected: { foo: "bar", child: { grandchild: {} } },
  },
  {
    name: "A.12 add to nonexistent target",
    doc: { foo: "bar" },
    patch: [{ op: "add", path: "/baz/bat", value: "qux" }],
    error: /does not exist/u,
  },
  {
    name: "A.14 ~ escape ordering",
    doc: { "/": 9, "~1": 10 },
    patch: [{ op: "test", path: "/~01", value: 10 }],
    expected: { "/": 9, "~1": 10 },
  },
  {
    name: "A.15 comparing strings and numbers",
    doc: { "/": 9, "~1": 10 },
    patch: [{ op: "test", path: "/~01", value: "10" }],
    error: /test failed/u,
  },
  {
    name: "A.16 add array value",
    doc: { foo: ["bar"] },
    patch: [{ op: "add", path: "/foo/-", value: ["abc", "def"] }],
    expected: { foo: ["bar", ["abc", "def"]] },
  },
  {
    name: "copy",
    doc: { a: { b: 1 } },
    patch: [{ op: "copy", from: "/a", path: "/c" }],
    expected: { a: { b: 1 }, c: { b: 1 } },
  },
  {
    name: "array index out of bounds",
    doc: { foo: [1] },
    patch: [{ op: "add", path: "/foo/5", value: 2 }],
    error: /out of bounds/u,
  },
  {
    name: "leading zero index",
    doc: { foo: [1, 2] },
    patch: [{ op: "remove", path: "/foo/01" }],
    error: /not an array index/u,
  },
  {
    name: "move into own child",
    doc: { a: { b: {} } },
    patch: [{ op: "move", from: "/a", path: "/a/b/c" }],
    error: /into itself/u,
  },
];

describe("applyJsonPatch (RFC 6902)", () => {
  for (const c of cases) {
    it(c.name, () => {
      if (c.error !== undefined)
        expect(() => applyJsonPatch(c.doc, c.patch)).toThrow(c.error);
      else expect(applyJsonPatch(c.doc, c.patch)).toEqual(c.expected);
    });
  }

  it("refuses prototype keys", () => {
    for (const path of [
      "/__proto__/polluted",
      "/constructor/prototype",
      "/a/prototype",
    ]) {
      expect(() => applyJsonPatch({ a: {} }, [{ op: "add", path, value: 1 }])).toThrow(
        /forbidden key/u,
      );
    }
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("never mutates its input", () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc
            .string({ minLength: 1 })
            .filter((k) => !["__proto__", "constructor", "prototype"].includes(k)),
          fc.integer(),
        ),
        fc.integer(),
        (doc, v) => {
          const before = JSON.stringify(doc);
          applyJsonPatch(doc, [{ op: "add", path: "/new", value: v }]);
          expect(JSON.stringify(doc)).toBe(before);
        },
      ),
    );
  });
});

describe("patchDashboard", () => {
  it("applies a valid edit and keeps the result a valid spec", () => {
    const r = patchDashboard(DEFAULT_DASHBOARD, [
      { op: "replace", path: "/widgets/0/title", value: "Sales" },
    ]);
    expect(r.ok && r.spec.widgets[0]?.title).toBe("Sales");
    expect(DEFAULT_DASHBOARD.widgets[0]?.title).toBe("Revenue");
  });

  it("rejects edits that produce an invalid spec", () => {
    const wide = patchDashboard(DEFAULT_DASHBOARD, [
      { op: "replace", path: "/widgets/0/layout/x", value: 11 },
    ]);
    expect(wide.ok).toBe(false);
    const code = patchDashboard(DEFAULT_DASHBOARD, [
      { op: "add", path: "/widgets/0/script", value: "alert(1)" },
    ]);
    expect(code.ok).toBe(false);
    const dup = patchDashboard(DEFAULT_DASHBOARD, [
      { op: "copy", from: "/widgets/0", path: "/widgets/-" },
    ]);
    expect(dup).toMatchObject({
      ok: false,
      errors: [expect.stringContaining("duplicate widget id")],
    });
  });

  it("rejects malformed operations before applying", () => {
    expect(patchDashboard(DEFAULT_DASHBOARD, [{ op: "eval", path: "/" }]).ok).toBe(false);
    expect(patchDashboard(DEFAULT_DASHBOARD, []).ok).toBe(false);
    expect(
      patchDashboard(DEFAULT_DASHBOARD, [{ op: "remove", path: "widgets" }]).ok,
    ).toBe(false);
  });
});
