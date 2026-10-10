/**
 * Present and its presenter notes talk over a BroadcastChannel (ADR 0087): the board on the
 * room's screen says which month it is showing, and the notes on the presenter's own screen
 * follow. Same origin, same browser, nothing sent anywhere else.
 *
 * The notes ask as they open, and the board answers, so a window opened from Present follows it
 * at once rather than claiming Present is not running until the presenter steps a month; the
 * board says when Present ends, so the notes stop claiming to follow it (ADR 0091).
 */

export const presentChannelName = (companyId: string): string =>
  `magicmis-present-${companyId}`;

export type PresentMessage =
  { readonly kind: "month"; readonly period: string } | { readonly kind: "ended" };

/** The notes window, asking the board which month it is showing. */
export interface PresentAsk {
  readonly kind: "ask";
}

const kindOf = (data: unknown): unknown =>
  typeof data === "object" && data !== null
    ? (data as { kind?: unknown }).kind
    : undefined;

export const isPresentMessage = (data: unknown): data is PresentMessage =>
  kindOf(data) === "ended" ||
  (kindOf(data) === "month" &&
    typeof (data as { period?: unknown }).period === "string" &&
    /^\d{4}-(0[1-9]|1[0-2])$/u.test((data as { period: string }).period));

export const isPresentAsk = (data: unknown): data is PresentAsk => kindOf(data) === "ask";
