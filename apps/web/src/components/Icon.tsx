/**
 * The icon set (SPEC §32).
 *
 * Hand-drawn stroke paths rather than an icon dependency: the set is small, it never
 * ships a glyph we did not choose, and it cannot drift into the "generic AI aesthetic"
 * the spec rules out -- there is no sparkle, wand or star here, and none is to be added.
 *
 * Icons accompany words; they do not replace them. The only exception is a control whose
 * whole label is carried by `aria-label` (see `IconButton`), where the word would be
 * redundant to a sighted user and is still announced to a screen reader.
 */

export type IconName =
  | "alert"
  | "archive"
  | "arrow-down"
  | "arrow-right"
  | "arrow-up"
  | "bank"
  | "building"
  | "calendar"
  | "chart"
  | "chat"
  | "check"
  | "check-circle"
  | "chevron-down"
  | "chevron-right"
  | "clock"
  | "close"
  | "document"
  | "download"
  | "external"
  | "file"
  | "filter"
  | "info"
  | "key"
  | "loader"
  | "lock"
  | "logout"
  | "mail"
  | "menu"
  | "moon"
  | "pause"
  | "play"
  | "plus"
  | "refresh"
  | "search"
  | "settings"
  | "sun"
  | "shield"
  | "sliders"
  | "table"
  | "trash"
  | "upload"
  | "user"
  | "wallet";

/**
 * Every path is drawn on a 24×24 grid with a 1.7px stroke, round caps and round joins,
 * so the set has one weight and one corner treatment throughout.
 */
const PATHS: Record<IconName, string> = {
  alert:
    "M12 9v4m0 3.5v.01M10.3 4.3 2.7 17.4A2 2 0 0 0 4.4 20.4h15.2a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z",
  archive: "M3 7h18M5 7v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7M3 7l2-3h14l2 3M10 12h4",
  "arrow-down": "M12 5v14m0 0-6-6m6 6 6-6",
  "arrow-right": "M5 12h14m0 0-6-6m6 6-6 6",
  "arrow-up": "M12 19V5m0 0-6 6m6-6 6 6",
  bank: "M3 10h18M5 10v8m5-8v8m4-8v8m5-8v8M3 21h18M12 3 3 7.5h18L12 3Z",
  building:
    "M4 21V6a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v15M14 10h5a1 1 0 0 1 1 1v10M3 21h18M7.5 9h3m-3 4h3m-3 4h3m6.5-4h1m-1 4h1",
  calendar:
    "M7 3v3m10-3v3M4 9h16M5 6h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z",
  chart: "M4 20V10m5 10V5m5 15v-7m5 7V8M3 20h18",
  chat: "M20 15a2 2 0 0 1-2 2H9l-4 3V6a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v9Z",
  check: "m5 13 4.5 4.5L19 7",
  "check-circle": "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-12.5.5 2.5 2.5 5-5.5",
  "chevron-down": "m6 9.5 6 6 6-6",
  "chevron-right": "m9.5 6 6 6-6 6",
  clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-5v5.2l3.2 2",
  close: "m6 6 12 12M18 6 6 18",
  document:
    "M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7l-4-4Zm0 0v4h4M9 13h6m-6 4h4",
  download:
    "M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2",
  external:
    "M14 4h6m0 0v6m0-6-8.5 8.5M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  file: "M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7l-4-4Zm0 0v4h4",
  filter: "M4 5h16l-6.2 7.3v5.9l-3.6 2v-7.9L4 5Z",
  info: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-4.5v.01M12 11v5.5",
  key: "M15.5 3a5.5 5.5 0 0 0-5.2 7.3L3 17.6V21h3.4l.9-.9v-1.8h1.8l1.3-1.3v-1.8h1.8l1.4-1.4A5.5 5.5 0 1 0 15.5 3Zm1.8 3.4v.01",
  loader:
    "M12 3v4m0 10v4M5.6 5.6l2.8 2.8m7.2 7.2 2.8 2.8M3 12h4m10 0h4M5.6 18.4l2.8-2.8m7.2-7.2 2.8-2.8",
  lock: "M7 10V7.5a5 5 0 0 1 10 0V10M5.5 10h13a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z",
  logout: "M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M11 16l-4-4m0 0 4-4m-4 4h13",
  mail: "M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Zm0 1.5 8 5.5 8-5.5",
  menu: "M4 7h16M4 12h16M4 17h16",
  pause: "M9.5 5v14m5-14v14",
  play: "M7 5.5v13l11-6.5-11-6.5Z",
  plus: "M12 5v14M5 12h14",
  refresh:
    "M20 11a8 8 0 0 0-13.7-5.3L3 9m0 0V4m0 5h5M4 13a8 8 0 0 0 13.7 5.3L21 15m0 0v5m0-5h-5",
  search: "M20 20l-3.6-3.6M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z",
  settings:
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8-3a8 8 0 0 0-.2-1.7l2-1.5-2-3.4-2.3 1a8 8 0 0 0-2.9-1.7L14.2 2H9.8l-.4 2.7a8 8 0 0 0-2.9 1.7l-2.3-1-2 3.4 2 1.5a8.1 8.1 0 0 0 0 3.4l-2 1.5 2 3.4 2.3-1a8 8 0 0 0 2.9 1.7l.4 2.7h4.4l.4-2.7a8 8 0 0 0 2.9-1.7l2.3 1 2-3.4-2-1.5c.1-.6.2-1.1.2-1.7Z",
  shield:
    "M12 3 4.5 6v6c0 4.4 3.1 7.9 7.5 9 4.4-1.1 7.5-4.6 7.5-9V6L12 3Zm-2.5 9 2 2 4-4.5",
  sliders: "M4 7h9m3 0h4M4 17h4m3 0h9M14.5 4.5v5M9.5 14.5v5",
  table:
    "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm-1 5h18M9 10v9",
  trash:
    "M4 7h16M10 4h4a1 1 0 0 1 1 1v2H9V5a1 1 0 0 1 1-1ZM6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M10.5 11v6m3-6v6",
  upload: "M12 16V4m0 0 4.5 4.5M12 4 7.5 8.5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-8 9a8 8 0 0 1 16 0",
  // A crescent, and a disc with rays: the two states of the theme switch.
  moon: "M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-14v2m0 18v-2M3 12h2m14 0h2M5.6 5.6l1.4 1.4m10 10 1.4 1.4m0-12.8-1.4 1.4m-10 10-1.4 1.4",
  wallet:
    "M19 8V6.5a1.5 1.5 0 0 0-1.5-1.5H5a2 2 0 0 0 0 4h13.5A1.5 1.5 0 0 1 20 10.5v8A1.5 1.5 0 0 1 18.5 20H5a2 2 0 0 1-2-2V7m13.5 6.5v.01",
};

export function Icon({
  name,
  size = 16,
  className = "",
  title,
}: {
  name: IconName;
  size?: number;
  className?: string;
  /** Supply only when the icon is the sole carrier of meaning; otherwise it stays decorative. */
  title?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden={title === undefined ? true : undefined}
      role={title === undefined ? undefined : "img"}
      focusable="false"
    >
      {title === undefined ? null : <title>{title}</title>}
      <path d={PATHS[name]} />
    </svg>
  );
}
