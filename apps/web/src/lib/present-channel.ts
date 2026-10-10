/**
 * Present and its presenter notes talk over a BroadcastChannel (ADR 0087): the board on the
 * room's screen says which month it is showing, and the notes on the presenter's own screen
 * follow. Same origin, same browser, nothing sent anywhere else.
 */

export const presentChannelName = (companyId: string): string =>
  `magicmis-present-${companyId}`;

export interface PresentMessage {
  readonly kind: "month";
  readonly period: string;
}

export const isPresentMessage = (data: unknown): data is PresentMessage =>
  typeof data === "object" &&
  data !== null &&
  (data as { kind?: unknown }).kind === "month" &&
  typeof (data as { period?: unknown }).period === "string" &&
  /^\d{4}-(0[1-9]|1[0-2])$/u.test((data as { period: string }).period);
