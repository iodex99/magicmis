/**
 * The browser-side redactor (SPEC §17). Holds the company's tokeniser and the token → name
 * map for the current session. The map lives only in this object: nothing here serialises it,
 * and payload builders receive tokens, never the map (SPEC §2.8).
 */

import { columnSensitivity, columnValueMatches, findValueSpans } from "./detectors";
import { Tokeniser, TOKEN_PATTERN, type TokenType } from "./tokens";

export interface RedactionStats {
  readonly byType: Readonly<Partial<Record<TokenType, number>>>;
  readonly collisions: number;
}

export class Redactor {
  private readonly map = new Map<string, string>();
  private readonly counts: Partial<Record<TokenType, number>> = {};
  private collisions = 0;
  private readonly partyNames = new Map<string, string>();

  private constructor(private readonly tokeniser: Tokeniser) {}

  static async create(key: Uint8Array): Promise<Redactor> {
    return new Redactor(await Tokeniser.fromKey(key));
  }

  /** Party ledgers (Sundry Debtors/Creditors descendants) whose names must be tokenised wherever they appear. */
  registerParties(names: Iterable<string>): void {
    for (const n of names) {
      const trimmed = n.trim();
      if (trimmed.length >= 3) this.partyNames.set(trimmed.toUpperCase(), trimmed);
    }
  }

  async token(type: TokenType, value: string): Promise<string> {
    const token = await this.tokeniser.token(type, value);
    const existing = this.map.get(token);
    if (existing === undefined) this.map.set(token, value);
    else if (
      existing.toUpperCase().replace(/\s+/gu, " ") !==
      value.toUpperCase().replace(/\s+/gu, " ")
    ) {
      // Two different values, one token: surfaced, never silently merged.
      this.collisions += 1;
    }
    this.counts[type] = (this.counts[type] ?? 0) + 1;
    return token;
  }

  /** Replace identifiers and party names inside free text. */
  async redactText(text: string): Promise<string> {
    if (text === "") return text;
    let out = text;
    // Party names first: whole-cell or whole-word occurrences, longest first.
    const parties = [...this.partyNames.values()].sort((a, b) => b.length - a.length);
    for (const name of parties) {
      const re = new RegExp(
        `(?<![A-Za-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?![A-Za-z0-9])`,
        "giu",
      );
      if (!re.test(out)) continue;
      const token = await this.token("PARTY", name);
      out = out.replace(re, token);
    }
    const spans = findValueSpans(out).filter((s) => !overlapsToken(out, s.start, s.end));
    let result = "";
    let cursor = 0;
    for (const s of spans) {
      result += out.slice(cursor, s.start) + (await this.token(s.type, s.value));
      cursor = s.end;
    }
    return result + out.slice(cursor);
  }

  /**
   * Redact one cell given its column. Sensitive columns tokenise the whole value (when it fits
   * the column's detector); other text is scanned for identifiers. Amounts and dates pass
   * through untouched — callers pass them as numbers or with `typed: true`.
   */
  async redactCell(
    value: string,
    column: {
      header: string;
      sheetKind: "payroll" | "other";
      userSensitive?: boolean;
      typed?: boolean;
    },
  ): Promise<string> {
    if (column.userSensitive === true && value.trim() !== "")
      return this.token("SENSITIVE", value);
    // A labelled sensitive column wins over its inferred type: UAN and account numbers are
    // digit runs that type as integers.
    const sensitivity = columnSensitivity(column.header, column.sheetKind);
    if (sensitivity !== null && columnValueMatches(sensitivity, value))
      return this.token(sensitivity, value);
    if (column.typed === true) return value;
    return this.redactText(value);
  }

  /** Browser-only rehydration: a token back to the name seen in this session, if any. */
  rehydrate(
    token: string,
  ): { name: string } | { name: null; hint: "name not in loaded files" } {
    const name = this.map.get(token);
    return name === undefined
      ? { name: null, hint: "name not in loaded files" }
      : { name };
  }

  stats(): RedactionStats {
    return { byType: { ...this.counts }, collisions: this.collisions };
  }
}

function overlapsToken(text: string, start: number, end: number): boolean {
  for (const m of text.matchAll(TOKEN_PATTERN)) {
    if (start < m.index + m[0].length && end > m.index) return true;
  }
  return false;
}

/** Guard for anything about to leave the browser: no raw identifiers may remain. */
export function assertNoRawIdentifiers(json: string): void {
  const leftovers = findValueSpans(json.replace(TOKEN_PATTERN, ""));
  if (leftovers.length > 0) {
    throw new Error(
      `payload still contains ${leftovers.length.toString()} unredacted identifier(s) (${[...new Set(leftovers.map((l) => l.type))].join(", ")})`,
    );
  }
}
