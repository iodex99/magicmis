/**
 * Small layout preferences that have to be right on the first paint (ADR 0044).
 *
 * Whether the navigation rail is collapsed and whether the chat is open both change the width
 * of everything else on the page. Kept in cookies, like the theme (ADR 0034), so the server
 * renders the layout the reader left rather than the default followed by a jump. They hold a
 * word each and nothing about the reader.
 */
export const RAIL_COOKIE = "rail";
export const CHAT_COOKIE = "chat";

/** Asks whichever workspace is on screen to open its chat and put the cursor in it. */
export const OPEN_CHAT_EVENT = "magicmis:open-chat";

/** The query parameter that opens the chat on arrival, for links from other pages. */
export const OPEN_CHAT_PARAM = "chat";

export function remember(name: string, value: string): void {
  document.cookie = `${name}=${value}; path=/; max-age=31536000; samesite=lax`;
}
