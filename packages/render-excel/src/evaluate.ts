/**
 * A small evaluator for the formulas this package writes (SUMIFS, IF, OR, ABS, arithmetic,
 * comparison, concatenation, same-sheet and Data-sheet references). It runs V11 in the browser
 * without bundling a spreadsheet engine; tests check it against HyperFormula on every cell.
 */

export type Scalar = number | string | boolean;
type Value = Scalar | { readonly range: readonly Scalar[] };

export interface CellSource {
  /** Literal value, or `{ formula }` (no leading "="); undefined for an empty cell. */
  get(sheet: string, row: number, col: number): Scalar | { formula: string } | undefined;
}

export class FormulaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormulaError";
  }
}

type Tok =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "ref"; sheet: string | null; a: string; b: string | null }
  | { t: "id"; v: string }
  | { t: "op"; v: string };

const REF =
  /^(?:(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_]*))!)?(\$?[A-Z]{1,3}\$?\d+)(?::(\$?[A-Z]{1,3}\$?\d+))?/u;

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    const ch = src.charAt(i);
    if (ch === " ") {
      i += 1;
      continue;
    }
    const num = /^\d+(?:\.\d+)?/u.exec(rest);
    if (num !== null) {
      out.push({ t: "num", v: Number.parseFloat(num[0]) });
      i += num[0].length;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let s = "";
      for (;;) {
        if (j >= src.length) throw new FormulaError("unterminated string");
        if (src.charAt(j) === '"') {
          if (src.charAt(j + 1) === '"') {
            s += '"';
            j += 2;
            continue;
          }
          break;
        }
        s += src.charAt(j);
        j += 1;
      }
      out.push({ t: "str", v: s });
      i = j + 1;
      continue;
    }
    const ref = REF.exec(rest);
    if (ref !== null && !/^[A-Z]{1,3}\d+\(/u.test(rest)) {
      const sheet = ref[1]?.replace(/''/gu, "'") ?? ref[2] ?? null;
      // A bare identifier followed by "(" is a function, not a sheet-less reference.
      out.push({ t: "ref", sheet, a: ref[3] ?? "", b: ref[4] ?? null });
      i += ref[0].length;
      continue;
    }
    const id = /^[A-Z]+(?=\()/u.exec(rest);
    if (id !== null) {
      out.push({ t: "id", v: id[0] });
      i += id[0].length;
      continue;
    }
    const op = /^(<=|>=|<>|[-+*/&=<>(),])/u.exec(rest);
    if (op !== null) {
      out.push({ t: "op", v: op[0] });
      i += op[0].length;
      continue;
    }
    throw new FormulaError(`unexpected "${ch}"`);
  }
  return out;
}

const colNumber = (letters: string): number =>
  Array.from({ length: letters.length }, (_, i) => letters.charCodeAt(i) - 64).reduce(
    (n, c) => n * 26 + c,
    0,
  );
function parseAddress(a: string): { row: number; col: number } {
  const m = /^\$?([A-Z]{1,3})\$?(\d+)$/u.exec(a);
  if (m === null) throw new FormulaError(`bad address ${a}`);
  return { col: colNumber(m[1] ?? "A"), row: Number.parseInt(m[2] ?? "0", 10) };
}

const toNumber = (v: Scalar): number => {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v === "") return 0;
  throw new FormulaError("#VALUE!");
};

function wildcardRegex(pattern: string): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern.charAt(i);
    if (c === "~" && i + 1 < pattern.length) {
      re += pattern.charAt(i + 1).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      i += 1;
    } else if (c === "*") re += ".*";
    else if (c === "?") re += ".";
    else re += c.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  }
  return new RegExp(`^${re}$`, "iu");
}

function criterion(crit: Scalar): (v: Scalar) => boolean {
  if (typeof crit === "number") return (v) => typeof v === "number" && v === crit;
  if (typeof crit === "boolean") return (v) => v === crit;
  const m = /^(<=|>=|<>|<|>|=)?(.*)$/su.exec(crit);
  const op = m?.[1] ?? "=";
  const rhs = m?.[2] ?? "";
  const asNum = /^-?\d+(?:\.\d+)?$/u.test(rhs) ? Number.parseFloat(rhs) : null;
  if (asNum !== null) {
    return (v) => {
      if (typeof v !== "number") return op === "<>";
      switch (op) {
        case "<=":
          return v <= asNum;
        case ">=":
          return v >= asNum;
        case "<":
          return v < asNum;
        case ">":
          return v > asNum;
        case "<>":
          return v !== asNum;
        default:
          return v === asNum;
      }
    };
  }
  const re = wildcardRegex(rhs);
  return op === "<>"
    ? (v) => !re.test(String(v))
    : (v) => typeof v === "string" && re.test(v);
}

type Node =
  | { readonly k: "lit"; readonly v: Scalar }
  | {
      readonly k: "ref";
      readonly sheet: string | null;
      readonly a: string;
      readonly b: string | null;
    }
  | { readonly k: "neg"; readonly e: Node }
  | { readonly k: "bin"; readonly op: string; readonly l: Node; readonly r: Node }
  | { readonly k: "call"; readonly name: string; readonly args: readonly Node[] };

function parse(formula: string): Node {
  const toks = tokenize(formula);
  let p = 0;
  const peekOp = (...ops: string[]): string | null => {
    const t = toks[p];
    return t?.t === "op" && ops.includes(t.v) ? t.v : null;
  };
  const take = () => {
    const t = toks[p];
    p += 1;
    if (t === undefined) throw new FormulaError("unexpected end");
    return t;
  };
  const expectOp = (v: string) => {
    const t = take();
    if (t.t !== "op" || t.v !== v) throw new FormulaError(`expected ${v}`);
  };

  const primary = (): Node => {
    const t = take();
    if (t.t === "num" || t.t === "str") return { k: "lit", v: t.v };
    if (t.t === "ref") return { k: "ref", sheet: t.sheet, a: t.a, b: t.b };
    if (t.t === "op" && t.v === "(") {
      const e = compare();
      expectOp(")");
      return e;
    }
    if (t.t === "op" && t.v === "-") return { k: "neg", e: primary() };
    if (t.t === "id") {
      expectOp("(");
      const args: Node[] = [];
      if (peekOp(")") !== null) take();
      else {
        for (;;) {
          args.push(compare());
          const n = take();
          if (n.t === "op" && n.v === ")") break;
          if (n.t !== "op" || n.v !== ",") throw new FormulaError("expected , or )");
        }
      }
      return { k: "call", name: t.v, args };
    }
    throw new FormulaError("unexpected token");
  };
  const level = (next: () => Node, ops: string[]) => (): Node => {
    let l = next();
    for (let op = peekOp(...ops); op !== null; op = peekOp(...ops)) {
      take();
      l = { k: "bin", op, l, r: next() };
    }
    return l;
  };
  const term = level(primary, ["*", "/"]);
  const additive = level(term, ["+", "-"]);
  const concat = level(additive, ["&"]);
  const compare = (): Node => {
    const l = concat();
    const op = peekOp("=", "<>", "<", ">", "<=", ">=");
    if (op === null) return l;
    take();
    return { k: "bin", op, l, r: concat() };
  };
  const root = compare();
  if (p !== toks.length) throw new FormulaError("trailing tokens");
  return root;
}

export class Evaluator {
  private readonly memo = new Map<string, Scalar>();
  private readonly ranges = new Map<string, Scalar[]>();
  private readonly parsed = new Map<string, Node>();
  private readonly active = new Set<string>();

  constructor(private readonly cells: CellSource) {}

  cell(sheet: string, row: number, col: number): Scalar {
    const key = `${sheet}!${row.toString()}:${col.toString()}`;
    const cached = this.memo.get(key);
    if (cached !== undefined) return cached;
    const raw = this.cells.get(sheet, row, col);
    if (raw === undefined) return "";
    if (typeof raw !== "object") return raw;
    if (this.active.has(key)) throw new FormulaError("circular reference");
    this.active.add(key);
    try {
      const v = this.evaluate(raw.formula, sheet);
      this.memo.set(key, v);
      return v;
    } finally {
      this.active.delete(key);
    }
  }

  evaluate(formula: string, sheet: string): Scalar {
    let node = this.parsed.get(formula);
    if (node === undefined) {
      node = parse(formula);
      this.parsed.set(formula, node);
    }
    return this.scalar(this.eval(node, sheet));
  }

  private scalar(v: Value): Scalar {
    if (typeof v === "object") throw new FormulaError("range used as a value");
    return v;
  }

  private eval(n: Node, sheet: string): Value {
    switch (n.k) {
      case "lit":
        return n.v;
      case "neg":
        return -toNumber(this.scalar(this.eval(n.e, sheet)));
      case "ref": {
        const s = n.sheet ?? sheet;
        const a = parseAddress(n.a);
        if (n.b === null) return this.cell(s, a.row, a.col);
        const key = `${s}!${n.a}:${n.b}`;
        let range = this.ranges.get(key);
        if (range === undefined) {
          const b = parseAddress(n.b);
          range = [];
          for (let r = a.row; r <= b.row; r += 1)
            for (let c = a.col; c <= b.col; c += 1) range.push(this.cell(s, r, c));
          this.ranges.set(key, range);
        }
        return { range };
      }
      case "bin": {
        const l = this.scalar(this.eval(n.l, sheet));
        const r = this.scalar(this.eval(n.r, sheet));
        switch (n.op) {
          case "+":
            return toNumber(l) + toNumber(r);
          case "-":
            return toNumber(l) - toNumber(r);
          case "*":
            return toNumber(l) * toNumber(r);
          case "/": {
            const d = toNumber(r);
            if (d === 0) throw new FormulaError("#DIV/0!");
            return toNumber(l) / d;
          }
          case "&":
            return `${String(l)}${String(r)}`;
          default: {
            // Excel: numbers sort before text; different types are never equal.
            const cmp =
              typeof l === typeof r
                ? l < r
                  ? -1
                  : l > r
                    ? 1
                    : 0
                : typeof l === "number"
                  ? -1
                  : 1;
            switch (n.op) {
              case "=":
                return cmp === 0;
              case "<>":
                return cmp !== 0;
              case "<":
                return cmp < 0;
              case ">":
                return cmp > 0;
              case "<=":
                return cmp <= 0;
              default:
                return cmp >= 0;
            }
          }
        }
      }
      case "call":
        return this.call(n.name, n.args, sheet);
    }
  }

  private call(name: string, args: readonly Node[], sheet: string): Scalar {
    const arg = (i: number): Scalar => {
      const a = args[i];
      if (a === undefined) throw new FormulaError(`${name}: missing argument`);
      return this.scalar(this.eval(a, sheet));
    };
    switch (name) {
      // IF evaluates only the branch it takes, so a guarded division never errors.
      case "IF":
        return toNumber(arg(0)) !== 0 ? arg(1) : args.length > 2 ? arg(2) : false;
      case "OR":
        return args.some((_, i) => toNumber(arg(i)) !== 0);
      case "ABS":
        return Math.abs(toNumber(arg(0)));
      case "SUMIFS": {
        const range = (i: number): readonly Scalar[] => {
          const a = args[i];
          const v = a === undefined ? undefined : this.eval(a, sheet);
          if (v === undefined || typeof v !== "object")
            throw new FormulaError("SUMIFS: expected a range");
          return v.range;
        };
        const sum = range(0);
        const tests: { range: readonly Scalar[]; test: (v: Scalar) => boolean }[] = [];
        for (let i = 1; i < args.length; i += 2)
          tests.push({ range: range(i), test: criterion(arg(i + 1)) });
        let total = 0;
        for (let i = 0; i < sum.length; i += 1) {
          if (tests.every((c) => c.test(c.range[i] ?? ""))) {
            const v = sum[i];
            if (typeof v === "number") total += v;
          }
        }
        return total;
      }
      default:
        throw new FormulaError(`unsupported function ${name}`);
    }
  }
}
