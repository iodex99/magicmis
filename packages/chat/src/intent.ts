/**
 * Is this message a question about the figures, or a request to change the dashboard? (ADR 0046)
 *
 * The customer types into one box and does not pick a mode first, so something has to decide
 * which priced action a message is before its credits are held. That something is these rules,
 * not a model: a classifier call would cost money on every message, and its answer could not be
 * shown to the customer before they press send. These can — the chat says "this will update the
 * dashboard" as they type, with one press to ask it as a question instead.
 *
 * **When in doubt it is a question.** A change sent as a question gets an answer and the
 * customer rephrases; a question sent as a change is declined and charged, which is the worse
 * mistake. So a change needs all of: not phrased as a question, something to *do*, and a *thing
 * on a dashboard* to do it to — and words that belong to other parts of the product (the account,
 * files, credits) rule it out unless a box is named too.
 */

export type ChatIntent = "ask" | "dashboard";

/** Things that only exist on a dashboard. */
const BOX =
  /\b(cards?|box(?:es)?|tiles?|widgets?|charts?|graphs?|kpis?|trend ?lines?|waterfall|bridge|tables?|formulas?|sections?)\b/u;
/** The subset a loose verb ("show me a…") may build. A "table of top customers" is a question. */
const DRAWN =
  /\b(?:a|an|another|new|one more)\s+(?:[a-z-]+\s+){0,3}?(?:cards?|box(?:es)?|tiles?|widgets?|charts?|graphs?|kpis?|trend ?lines?)\b/u;
const ON_DASHBOARD =
  /\b(?:on|to|onto|into|from|off) (?:the|my|our|this) (?:dashboard|board|layout)\b/u;
/** What a box shows: enough to know "delete working capital" is about a box. */
const FIGURE =
  /\b(revenue|sales|turnover|margins?|profit|ebitda|pat|pbt|cash|bank|costs?|expenses?|opex|working capital|receivables?|debtors?|payables?|creditors?|inventory|stock|ratios?|debtor days|creditor days)\b/u;

/** Verbs that change a layout. "compare", "show" and "give" are not among them. */
const CHANGE =
  /\b(add|make|create|build|put|pin|insert|include|plot|draw|rename|call|name|title|remove|delete|drop|hide|move|reorder|swap|resize|widen|shrink|enlarge|bigger|smaller|wider|taller|replace|turn|convert|switch)\b/u;
/** Verbs that change a layout only when they are asking for a new drawn thing. */
const ASK_FOR = /\b(show|display|give|want|need|get)\b/u;
/** A message that opens with one of these is about a box if it names a box or what one shows. */
const OPENS_WITH = /^(rename|remove|delete|resize|reorder|pin|move|hide)\b/u;

/** Other parts of the product. "Delete my account" is not a change to a dashboard. */
const ELSEWHERE =
  /\b(accounts?|passwords?|files?|uploads?|compan(?:y|ies)|credits?|wallet|invoices?|subscription|workbooks?|data|entries|ledgers?|months?)\b/u;

const POLITE =
  /^(please|kindly|can you|could you|would you|will you|i want to|i would like to|i'd like to|let's|lets)[\s,]+/u;

const QUESTION =
  /^(what|why|how|which|when|who|where|whose|is|are|was|were|does|do|did|has|have|explain|tell me|describe|summari[sz]e)\b/u;

export function detectIntent(text: string): ChatIntent {
  let t = text.trim().toLowerCase().replace(/\s+/gu, " ");
  // "Can you please add…" is an instruction; "can you explain…" is still a question below.
  for (let i = 0; i < 3 && POLITE.test(t); i += 1) t = t.replace(POLITE, "");
  if (t === "" || QUESTION.test(t)) return "ask";
  const box = BOX.test(t);
  if (!box && ELSEWHERE.test(t)) return "ask";
  if (OPENS_WITH.test(t))
    return box || FIGURE.test(t) || ON_DASHBOARD.test(t) ? "dashboard" : "ask";
  if (CHANGE.test(t) && (box || ON_DASHBOARD.test(t))) return "dashboard";
  return ASK_FOR.test(t) && DRAWN.test(t) ? "dashboard" : "ask";
}
