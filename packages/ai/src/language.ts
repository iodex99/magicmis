/**
 * The language a company's commentary and "where to act" are written in (ADR 0087).
 *
 * It reaches the model as one line of the data, built here from a code the server chose from a
 * fixed list — never text a customer typed — and the system prompt says what to do with it. The
 * figures are untouched by it: they are placeholders the engine fills, in any language.
 */

import { COMMENTARY_LANGUAGES } from "@magicmis/core/reporting-conventions";
import { z } from "zod";

const CODES = COMMENTARY_LANGUAGES.map((l) => l.code) as [string, ...string[]];

/** English unless the company chose another; a stored request that predates it reads as English. */
export const writingLanguage = z.enum(CODES).default("en");

/** "Language: Spanish." — the English name, without the native one beside it. */
export function languageLine(code: string): string {
  const name = COMMENTARY_LANGUAGES.find((l) => l.code === code)?.name ?? "English";
  return `Language: ${name.replace(/\s*\(.*\)$/u, "")}.`;
}
