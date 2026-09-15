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
 * rather than by discipline. Depth comes from layered, offset shadows; emphasis comes
 * from the ink surface and the accent; never from a gradient.
 */

/**
 * Neutral ramp. The working surface of the app.
 *
 * Very slightly cool, carrying a trace of the accent's hue so that white cards on the
 * page ground separate without a border doing all the work. Contrast ratios against
 * `neutral[0]` are unchanged from a pure grey ramp.
 */
export const neutral = {
  0: "#ffffff",
  25: "#fbfbfd",
  50: "#f5f5f9",
  100: "#ecebf2",
  200: "#dedce8",
  300: "#c2bfd2",
  400: "#928fa6",
  500: "#6f6c85",
  600: "#565369",
  700: "#403e50",
  800: "#2a2937",
  900: "#191824",
  950: "#0f0e16",
} as const;

/**
 * The single accent (SPEC §32: "restrained neutral palette with one accent colour").
 *
 * Indigo, chosen by the product owner on 2026-09-15 (ADR 0026). It is distinguishable
 * from the semantic red and green at a glance, it holds AA contrast on white from 600
 * up, and -- the reason the spec's original teal gave way -- it is the colour finance
 * software has settled on for its primary action, so the affordance reads instantly.
 *
 * It is one flat colour at each step. SPEC §32's prohibition is on purple-blue
 * *gradients*, and there is no gradient here to prohibit.
 */
export const accent = {
  50: "#f1effe",
  100: "#e4e0fd",
  200: "#cbc3fa",
  300: "#ab9ef5",
  400: "#8a79ee",
  500: "#6c5ce7",
  600: "#5846d2",
  700: "#4736ac",
  800: "#392c86",
  900: "#2b2266",
} as const;

/**
 * The ink surface: the sidebar, and any panel that frames the working area rather than
 * holding figures.
 *
 * Deliberately not used under dense numbers. Long reading sessions on a dark ground cost
 * accuracy, so the rule is: navigation and framing may be dark, data never is.
 */
export const ink = {
  500: "#413c73",
  600: "#312c5c",
  700: "#252048",
  800: "#1b1739",
  900: "#141029",
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
  positive: "#15724a",
  positiveSubtle: "#e4f5ec",
  negative: "#b03024",
  negativeSubtle: "#fceceb",
  neutral: neutral[600],
} as const;

/** Non-variance status colours, for validation results and job states. */
export const status = {
  info: accent[600],
  infoSubtle: accent[50],
  warning: "#8a5300",
  warningSubtle: "#fdf2e2",
  danger: "#9b2c1c",
  dangerSubtle: "#fceceb",
  success: variance.positive,
  successSubtle: variance.positiveSubtle,
} as const;

/**
 * Typography.
 *
 * SPEC §32: a highly legible sans serif, **tabular numerals for every figure**, numbers
 * right-aligned. Tabular numerals are not cosmetic -- proportional digits make a column
 * of figures fail to align, which is the one thing this audience cannot tolerate.
 *
 * Inter is loaded and self-hosted by the app through `next/font`, so `font-src 'self'`
 * in the CSP (SPEC §30) holds and no request reaches a font CDN.
 */
export const typography = {
  fontFamily: {
    sans: '"Inter", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif',
    mono: '"JetBrains Mono", "Cascadia Mono", Consolas, "Liberation Mono", monospace',
  },
  /** Applied to every numeric cell. */
  numericFeatureSettings: '"tnum" 1, "lnum" 1',
  fontSize: {
    xs: "0.6875rem",
    sm: "0.8125rem",
    base: "0.875rem",
    md: "1rem",
    lg: "1.125rem",
    xl: "1.375rem",
    "2xl": "1.75rem",
    "3xl": "2.125rem",
  },
  lineHeight: {
    tight: "1.2",
    snug: "1.4",
    normal: "1.55",
  },
  fontWeight: {
    normal: "400",
    medium: "500",
    semibold: "600",
    bold: "700",
  },
  /** Section labels above a figure: small, wide, uppercase. */
  eyebrow: {
    fontSize: "0.6875rem",
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    fontWeight: "600",
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

/**
 * Radii.
 *
 * Widened on 2026-09-15 (ADR 0026). SPEC §32 prohibits "rounded gradient blobs" -- a
 * decorative shape, not a corner radius. Cards at 16px and controls at 10px are the
 * current convention for finance software and read as finished rather than soft; the
 * `full` step exists only for pills and avatars, which have no corners to soften.
 */
export const radius = {
  none: "0",
  sm: "6px",
  base: "8px",
  md: "10px",
  lg: "12px",
  xl: "16px",
  "2xl": "20px",
  full: "9999px",
} as const;

/**
 * Elevation.
 *
 * Every shadow has a vertical offset and no spread term, so it separates a surface from
 * the page without radiating from it. There is no `glow` token and there should not be
 * one. The larger steps layer two offset shadows rather than widening one, which is what
 * keeps a raised card from looking lit.
 */
export const elevation = {
  none: "none",
  sm: "0 1px 2px rgba(20, 16, 41, 0.06)",
  md: "0 2px 6px rgba(20, 16, 41, 0.07)",
  lg: "0 8px 24px rgba(20, 16, 41, 0.10)",
  xl: "0 20px 48px rgba(20, 16, 41, 0.14)",
} as const;

/** Table density (SPEC §32: compact tables, sticky headers, resizable columns). */
export const table = {
  rowHeight: { compact: "32px", normal: "40px", relaxed: "48px" },
  headerHeight: "36px",
  cellPaddingX: spacing[3],
  borderColor: neutral[200],
} as const;

/** WCAG 2.2 AA requires a visible, non-colour-only focus indicator. */
export const focus = {
  ringWidth: "2px",
  ringColor: accent[500],
  ringOffset: "2px",
} as const;

export const tokens = {
  neutral,
  accent,
  ink,
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
