/**
 * The mark (ADR 0037): an M that is also a rising line — a management report and its trend in one
 * shape — with the sparkline's live endpoint as a ring, on the product's single accent.
 *
 * One drawing, used everywhere: the rail, the public header, the sign-in page, the favicon and
 * the social image all take their geometry from `MARK_PATH`, so the brand has exactly one
 * definition. `animate` draws the stroke and pops the ring in, once, on arrival; the stylesheet
 * collapses it under reduced motion.
 */

export const MARK_PATH = "M13 47 L23 19 L32 33 L42 13 L51 29";
export const MARK_END = { x: 51, y: 29 } as const;

export function LogoMark({
  size = 28,
  animate = false,
  className = "",
  title = "Magic MIS",
}: {
  size?: number | undefined;
  animate?: boolean | undefined;
  className?: string | undefined;
  title?: string | undefined;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label={title}
      className={`shrink-0 ${animate ? "logo-animate" : ""} ${className}`}
    >
      <rect width="64" height="64" rx="18" className="fill-accent-600" />
      <path
        d={MARK_PATH}
        fill="none"
        stroke="#ffffff"
        strokeWidth={6}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="logo-stroke"
      />
      <g className="logo-ring">
        <circle cx={MARK_END.x} cy={MARK_END.y} r={5.5} fill="#ffffff" />
        <circle cx={MARK_END.x} cy={MARK_END.y} r={2.4} className="fill-accent-600" />
      </g>
    </svg>
  );
}

/** The M alone, in the current text colour, for single-colour and very small uses. */
export function LogoMono({
  size = 24,
  className = "",
}: {
  size?: number | undefined;
  className?: string | undefined;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      <path
        d={MARK_PATH}
        fill="none"
        stroke="currentColor"
        strokeWidth={6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={MARK_END.x} cy={MARK_END.y} r={5.5} fill="currentColor" />
    </svg>
  );
}

/** Mark and wordmark together, the wordmark as live text in the display face. */
export function Logo({
  size = 28,
  animate = false,
  onInk = false,
  className = "",
}: {
  size?: number | undefined;
  animate?: boolean | undefined;
  /** On the dark rail the wordmark is white; "MIS" keeps a lighter accent. */
  onInk?: boolean | undefined;
  className?: string | undefined;
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      {/* Beside the wordmark the tile is decoration; the text carries the name. */}
      <span aria-hidden="true" className="inline-flex">
        <LogoMark size={size} animate={animate} />
      </span>
      <span
        className={`display font-semibold ${onInk ? "text-white" : "text-neutral-900"}`}
        style={{ fontSize: size * 0.6 }}
      >
        Magic <span className={onInk ? "text-accent-300" : "text-accent-600"}>MIS</span>
      </span>
    </span>
  );
}
