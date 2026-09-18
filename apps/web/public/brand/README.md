# Magic MIS brand

The mark is an **M that is also a rising line**: four strokes, up-down-up-down, the second peak
higher than the first, ending above where it began — a management report and its trend in one
shape — with the sparkline's live endpoint as a ring. It sits on the product's single accent
(indigo `#5846d2`, `#6c5ce7` in the dark theme) in a tile with an 18/64 corner radius.

| File              | Use                                                                 |
| ----------------- | ------------------------------------------------------------------- |
| `mark.svg`        | The tile mark. App icon, favicon, avatars, anywhere square.          |
| `mark-mono.svg`   | The M alone in `currentColor`. Watermarks, print, single-colour use. |
| `lockup.svg`      | Mark + wordmark on light backgrounds.                                |
| `lockup-dark.svg` | Mark + wordmark on the ink surface or the dark theme.               |

The wordmark is set in **Space Grotesk 600** with tight tracking; "MIS" takes the accent. The
SVG lockups reference the font by name — they render exactly on a page that loads it, and fall
back to Inter or the system sans elsewhere. In the app the wordmark is live text through the
`.display` class, never an image.

Rules: never stretch, recolour outside the accent and neutrals, add a gradient or a glow, or put
the tile on a busy photograph. Clear space around the mark is one stroke width (6/64 of its
size). Minimum size 16 px for the mark; below that use the mono M without the ring.

The animated mark (`AnimatedLogo` in `apps/web/src/components/Logo.tsx`) draws the M as a
stroke, then pops the ring in; it plays once on arrival and never loops.
