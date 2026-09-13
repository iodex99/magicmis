/**
 * RFC 6902 JSON Patch over RFC 6901 JSON Pointers, applied immutably and then validated against
 * the dashboard spec schema (SPEC §24.2). Dashboard edits happen only this way, from UI controls
 * or `chat_edit`. Keys that could reach object prototypes are refused outright.
 */

import { z } from "zod";

import { dashboardSpecSchema, type DashboardSpec } from "./spec";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const pointer = z.string().regex(/^(\/([^~]|~[01])*)*$/u);

export const patchOperationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add"), path: pointer, value: z.json() }).strict(),
  z.object({ op: z.literal("remove"), path: pointer }).strict(),
  z.object({ op: z.literal("replace"), path: pointer, value: z.json() }).strict(),
  z.object({ op: z.literal("move"), from: pointer, path: pointer }).strict(),
  z.object({ op: z.literal("copy"), from: pointer, path: pointer }).strict(),
  z.object({ op: z.literal("test"), path: pointer, value: z.json() }).strict(),
]);
export const patchSchema = z.array(patchOperationSchema).min(1).max(100);
export type PatchOperation = z.infer<typeof patchOperationSchema>;

export class PatchError extends Error {
  constructor(
    readonly index: number,
    message: string,
  ) {
    super(`operation ${(index + 1).toString()}: ${message}`);
    this.name = "PatchError";
  }
}

const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);

function tokens(path: string, index: number): string[] {
  if (path === "") return [];
  return path
    .slice(1)
    .split("/")
    .map((t) => {
      const key = t.replace(/~1/gu, "/").replace(/~0/gu, "~");
      if (FORBIDDEN.has(key)) throw new PatchError(index, `forbidden key "${key}"`);
      return key;
    });
}

const clone = <T extends Json>(v: T): T => structuredClone(v);

function isObject(v: Json | undefined): v is { [key: string]: Json } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function arrayIndex(arr: Json[], token: string, index: number, forAdd: boolean): number {
  if (forAdd && token === "-") return arr.length;
  if (!/^(0|[1-9]\d*)$/u.test(token)) throw new PatchError(index, `"${token}" is not an array index`);
  const i = Number.parseInt(token, 10);
  if (i > arr.length || (!forAdd && i === arr.length)) throw new PatchError(index, `index ${token} is out of bounds`);
  return i;
}

function parentOf(doc: Json, path: string[], index: number): Json {
  let node: Json = doc;
  for (const t of path.slice(0, -1)) {
    if (Array.isArray(node)) node = node[arrayIndex(node, t, index, false)] ?? null;
    else if (isObject(node) && Object.hasOwn(node, t)) node = node[t] ?? null;
    else throw new PatchError(index, `path does not exist`);
  }
  return node;
}

function get(doc: Json, path: string[], index: number): Json {
  if (path.length === 0) return doc;
  const parent = parentOf(doc, path, index);
  const last = path[path.length - 1] ?? "";
  if (Array.isArray(parent)) return parent[arrayIndex(parent, last, index, false)] ?? null;
  if (isObject(parent) && Object.hasOwn(parent, last)) return parent[last] ?? null;
  throw new PatchError(index, "path does not exist");
}

function add(doc: Json, path: string[], value: Json, index: number): Json {
  if (path.length === 0) return value;
  const parent = parentOf(doc, path, index);
  const last = path[path.length - 1] ?? "";
  if (Array.isArray(parent)) parent.splice(arrayIndex(parent, last, index, true), 0, value);
  else if (isObject(parent)) parent[last] = value;
  else throw new PatchError(index, "cannot add to a scalar");
  return doc;
}

function remove(doc: Json, path: string[], index: number): Json {
  if (path.length === 0) throw new PatchError(index, "cannot remove the whole document");
  const parent = parentOf(doc, path, index);
  const last = path[path.length - 1] ?? "";
  if (Array.isArray(parent)) parent.splice(arrayIndex(parent, last, index, false), 1);
  else if (isObject(parent) && Object.hasOwn(parent, last)) Reflect.deleteProperty(parent, last);
  else throw new PatchError(index, "path does not exist");
  return doc;
}

const equal = (a: Json, b: Json): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Applies a patch to any JSON document (RFC 6902 semantics), returning a new document. */
export function applyJsonPatch(document: unknown, operations: readonly PatchOperation[]): unknown {
  let doc = clone(document as Json);
  operations.forEach((op, i) => {
    switch (op.op) {
      case "add":
        doc = add(doc, tokens(op.path, i), clone(op.value), i);
        break;
      case "remove":
        doc = remove(doc, tokens(op.path, i), i);
        break;
      case "replace": {
        const path = tokens(op.path, i);
        get(doc, path, i);
        doc = add(path.length === 0 ? doc : remove(doc, path, i), path, clone(op.value), i);
        break;
      }
      case "move": {
        const from = tokens(op.from, i);
        const to = tokens(op.path, i);
        if (op.path.startsWith(`${op.from}/`)) throw new PatchError(i, "cannot move a value into itself");
        const value = get(doc, from, i);
        doc = add(remove(doc, from, i), to, value, i);
        break;
      }
      case "copy":
        doc = add(doc, tokens(op.path, i), clone(get(doc, tokens(op.from, i), i)), i);
        break;
      case "test":
        if (!equal(get(doc, tokens(op.path, i), i), op.value)) throw new PatchError(i, "test failed");
        break;
    }
  });
  return doc;
}

export type DashboardPatchResult =
  | { readonly ok: true; readonly spec: DashboardSpec }
  | { readonly ok: false; readonly errors: readonly string[] };

/** Validates the operations, applies them, and validates the resulting spec. */
export function patchDashboard(spec: DashboardSpec, operations: unknown): DashboardPatchResult {
  const ops = patchSchema.safeParse(operations);
  if (!ops.success) return { ok: false, errors: ops.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  let next: unknown;
  try {
    next = applyJsonPatch(spec, ops.data);
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : "patch failed"] };
  }
  const parsed = dashboardSpecSchema.safeParse(next);
  return parsed.success ? { ok: true, spec: parsed.data } : { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".") || "(spec)"}: ${i.message}`) };
}
