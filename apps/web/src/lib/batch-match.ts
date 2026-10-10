/**
 * Month-end for several companies at once (ADR 0087): which company a dropped file belongs to.
 *
 * Decided from the file's name only, because that is all anything may know before the file is
 * uploaded: each file is sealed under its own company's key as it arrives (SPEC §10), so the
 * company has to be chosen first. A name is compared with each company's own name and with the
 * names of the files it was given before — people name next month's export the way they named
 * this month's — and the best match is offered for the person to confirm or change. Nothing is
 * uploaded to a company nobody chose.
 */

export interface BatchCompany {
  readonly id: string;
  readonly name: string;
  /** Names of files this company was given before, newest first. */
  readonly fileNames: readonly string[];
}

const MONTH_WORDS = new Set([
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "sept",
  "oct",
  "nov",
  "dec",
  "january",
  "february",
  "march",
  "april",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
]);
/** Words every export's name might carry, which say nothing about whose it is. */
const NOISE = new Set([
  "tb",
  "trial",
  "balance",
  "report",
  "export",
  "final",
  "copy",
  "the",
  "of",
  "and",
  "for",
  "pvt",
  "ltd",
  "llp",
  "llc",
  "inc",
  "plc",
  "co",
  "limited",
  "private",
  "company",
  "xlsx",
  "xls",
  "csv",
  "pdf",
  "sheet",
  "month",
  "fy",
]);

/** The words in a name that could say whose file it is: no dates, months or common words. */
export function nameWords(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .replace(/\.[a-z0-9]{2,5}$/u, "")
      .split(/[^\p{L}\p{N}]+/u)
      .filter(
        (w) => w.length > 1 && !/^\d+$/u.test(w) && !MONTH_WORDS.has(w) && !NOISE.has(w),
      ),
  );
}

const overlap = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared += 1;
  return shared / Math.min(a.size, b.size);
};

/** The company a file most likely belongs to, or null when no name says so clearly. */
export function matchFile(
  fileName: string,
  companies: readonly BatchCompany[],
): { companyId: string; score: number } | null {
  const words = nameWords(fileName);
  let best: { companyId: string; score: number } | null = null;
  let runnerUp = 0;
  for (const c of companies) {
    const score = Math.max(
      overlap(words, nameWords(c.name)),
      ...c.fileNames.slice(0, 24).map((f) => overlap(words, nameWords(f))),
      0,
    );
    if (best === null || score > best.score) {
      runnerUp = best?.score ?? 0;
      best = { companyId: c.id, score };
    } else if (score > runnerUp) runnerUp = score;
  }
  // Half the words at least, and clearly ahead of the next company: a tie is a question for the
  // person, not a guess.
  return best !== null && best.score >= 0.5 && best.score > runnerUp ? best : null;
}
