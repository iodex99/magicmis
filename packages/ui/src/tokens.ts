/**
 * Design tokens (SPEC §32).
 *
 * The audience is chartered accountants reading dense numbers for long sessions. That
 * single fact drives every choice here: contrast over decoration, one accent, and
 * nothing that competes with the figures for attention.
 *
 * SPEC §32 rules out, explicitly: emojis anywhere, sparkle icons, purple-blue gradients,
 * "magic" wording, glowing effects and rounded gradient blobs. The palette below has no
 * gradient and no glow to offer, which is the point -- they are absent by construction
 * rather than by discipline.
 */

/**
 * Neutral ramp. The working surface of the app.
 *
 * Slightly warm rather than pure grey: long reading sessions on a pure-neutral ground
 * feel clinical, and a faint warmth costs nothing in contrast.
 */
export const neutral = {
  0: "#ffffff",
  25: "#fcfcfb",
  50: "#f7f7f5",
  100: "#eeeeec",
  200: "#dededa",
  300: "#c5c5bf",
  400: "#9a9a93",
  500: "#76766f",
  600: "#5a5a54",
  700: "#43433f",
  800: "#2b2b28",
  900: "#1a1a18",
  950: "#0f0f0e",
} as const;

/**
 * The single accent (SPEC §32: "restrained neutral palette with one accent colour").
 *
 * A deep teal: distinguishable from the semantic red and green at a glance, and distant
 * from the purple-blue the spec rules out.
 */
export const accent = {
  50: "#eef6f6",
  100: "#d3e8e8",
  200: "#a7d1d1",
  300: "#6fb3b3",
  400: "#3d9191",
  500: "#1f7575",
  600: "#165c5c",
  700: "#124a4a",
  800: "#0e3a3a",
  900: "#0b2d2d",
} as const;

/**
 * Variance colours.
 *
 * SPEC §32: used ONLY for variance meaning, and **always paired with a sign or arrow**
 * so meaning never relies on colour alone. `VarianceCell` enforces the pairing; these
 * values must not be used for decoration.
 *
 * Chosen to stay distinguishable under the common forms of colour vision deficiency,
 * where red/green alone is exactly the pairing that fails -- hence the sign requirement.
 */
export const variance = {
  positive: "#1c6b3f",
  positiveSubtle: "#e8f3ec",
  negative: "#a8321f",
  negativeSubtle: "#fbecea",
  neutral: neutral[600],
} as const;

/** Non-variance status colours, for validation results and job states. */
export const status = {
  info: accent[600],
  infoSubtle: accent[50],
  warning: "#8a5a00",
  warningSubtle: "#fdf3e0",
  danger: "#9b2c1c",
  dangerSubtle: "#fbecea",
  success: variance.positive,
  successSubtle: variance.positiveSubtle,
} as const;

/**
 * Typography.
 *
 * SPEC §32: a highly legible sans serif, **tabular numerals for every figure**, numbers
 * right-aligned. Tabular numerals are not cosmetic -- proportional digits make a column
 * of figures fail to align, which is the one thing this audience cannot tolerate.
 */
export const typography = {
  fontFamily: {
    sans: '"Inter", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif',
    mono: '"JetBrains Mono", "Cascadia Mono", Consolas, "Liberation Mono", monospace',
  },
  /** Applied to every numeric cell. */
  numericFeatureSettings: '"tnum" 1, "lnum" 1',
  fontSize: {
    xs: "0.75rem",
    sm: "0.8125rem",
    base: "0.875rem",
    md: "1rem",
    lg: "1.125rem",
    xl: "1.375rem",
    "2xl": "1.75rem",
  },
  lineHeight: {
    tight: "1.25",
    snug: "1.4",
    normal: "1.55",
  },
  fontWeight: {
    normal: "400",
    medium: "500",
    semibold: "600",
  },
} as const;

/** 4px base. Compact by default (SPEC §32: dense tables, long sessions). */
export const spacing = {
  0: "0",
  1: "0.25rem",
  2: "0.5rem",
  3: "0.75rem",
  4: "1rem",
  5: "1.25rem",
  6: "1.5rem",
  8: "2rem",
  10: "2.5rem",
  12: "3rem",
  16: "4rem",
} as const;

/** Small radii only. Nothing here reads as a "blob". */
export const radius = {
  none: "0",
  sm: "2px",
  base: "3px",
  md: "4px",
  lg: "6px",
} as const;

/**
 * Elevation.
 *
 * Shadows are tight and near-black at low opacity -- enough to separate a dialog from
 * the page, never enough to glow. There is no `glow` token and there should not be one.
 */
export const elevation = {
  none: "none",
  sm: "0 1px 2px rgba(15, 15, 14, 0.06)",
  md: "0 2px 6px rgba(15, 15, 14, 0.08)",
  lg: "0 8px 24px rgba(15, 15, 14, 0.12)",
} as const;

/** Table density (SPEC §32: compact tables, sticky headers, resizable columns). */
export const table = {
  rowHeight: { compact: "28px", normal: "34px", relaxed: "42px" },
  headerHeight: "36px",
  cellPaddingX: spacing[3],
  borderColor: neutral[200],
} as const;

/** WCAG 2.2 AA requires a visible, non-colour-only focus indicator. */
export const focus = {
  ringWidth: "2px",
  ringColor: accent[500],
  ringOffset: "1px",
} as const;

export const tokens = {
  neutral,
  accent,
  variance,
  status,
  typography,
  spacing,
  radius,
  elevation,
  table,
  focus,
} as const;

export type Tokens = typeof tokens;
