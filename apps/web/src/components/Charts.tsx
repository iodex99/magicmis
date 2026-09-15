/**
 * Small inline charts for stat cards (SPEC §32).
 *
 * Drawn as plain SVG rather than through ECharts: these are thumbnails beside a figure
 * that is already stated in text, so they carry no axis, no label and no tooltip, and
 * they must not pull a charting bundle into every page. Each is `aria-hidden` -- the
 * number next to it is the accessible content.
 *
 * ECharts still renders the real dashboard (SPEC §24), where a reader interrogates the
 * data rather than glances at it.
 */

const n = (value: number): string => String(value);
const box = (width: number, height: number): string => `0 0 ${n(width)} ${n(height)}`;

/**
 * A part's share of a total, as a whole percent.
 *
 * Money and credits are bigints and must not travel through a float (SPEC §4), so the
 * division happens in bigint and only the bounded result -- an integer from 0 to 100 --
 * becomes a number. A chart arc is drawn to the pixel; it does not need the remainder.
 */
export function sharePercent(part: bigint, total: bigint): number {
  if (total <= 0n) return 0;
  return Number.parseInt(((part * 100n) / total).toString(), 10);
}

function bounds(values: readonly number[]): { min: number; max: number } {
  const min = Math.min(...values);
  const max = Math.max(...values);
  // A flat series would divide by zero; give it a band so the line sits in the middle.
  return max === min ? { min: min - 1, max: max + 1 } : { min, max };
}

/** A trend over time: one stroke, one soft fill, no axis. */
export function Sparkline({
  values,
  width = 132,
  height = 40,
  tone = "accent",
}: {
  values: readonly number[];
  width?: number;
  height?: number;
  tone?: "accent" | "positive" | "negative";
}) {
  const last = values.at(-1);
  if (values.length < 2 || last === undefined) return null;
  const { min, max } = bounds(values);
  const pad = 3;
  const x = (i: number) => (i / (values.length - 1)) * (width - pad * 2) + pad;
  const y = (v: number) => height - pad - ((v - min) / (max - min)) * (height - pad * 2);
  const line = values
    .map((v, i) => `${i === 0 ? "M" : "L"}${n(x(i))} ${n(y(v))}`)
    .join(" ");
  const area = `${line} L${n(x(values.length - 1))} ${n(height)} L${n(x(0))} ${n(height)} Z`;
  const stroke = { accent: "#6c5ce7", positive: "#15724a", negative: "#b03024" }[tone];
  return (
    <svg
      width={width}
      height={height}
      viewBox={box(width, height)}
      aria-hidden="true"
      className="overflow-visible"
    >
      <path d={area} fill={stroke} fillOpacity={0.08} />
      <path
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={x(values.length - 1)} cy={y(last)} r={2.6} fill={stroke} />
    </svg>
  );
}

/** A count per period. The final bar is the current one and is drawn solid. */
export function MiniBars({
  values,
  width = 132,
  height = 40,
}: {
  values: readonly number[];
  width?: number;
  height?: number;
}) {
  if (values.length === 0) return null;
  const max = Math.max(...values, 1);
  const gap = 3;
  const bar = (width - gap * (values.length - 1)) / values.length;
  return (
    <svg width={width} height={height} viewBox={box(width, height)} aria-hidden="true">
      {values.map((v, i) => {
        const h = Math.max(2, (v / max) * height);
        return (
          <rect
            key={i}
            x={i * (bar + gap)}
            y={height - h}
            width={bar}
            height={h}
            rx={Math.min(2.5, bar / 2)}
            fill="#6c5ce7"
            fillOpacity={i === values.length - 1 ? 1 : 0.22}
          />
        );
      })}
    </svg>
  );
}

/**
 * A share of a whole. Parts are whole percents (see `sharePercent`), so nothing here ever
 * holds an amount.
 */
export function Donut({
  parts,
  size = 56,
  thickness = 8,
}: {
  parts: readonly { percent: number; tone: "accent" | "warning" | "muted" }[];
  size?: number;
  thickness?: number;
}) {
  const r = (size - thickness) / 2;
  const circumference = 2 * Math.PI * r;
  const colour = { accent: "#6c5ce7", warning: "#8a5300", muted: "#ecebf2" };
  const centre = size / 2;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={box(size, size)} aria-hidden="true">
      <circle
        cx={centre}
        cy={centre}
        r={r}
        fill="none"
        stroke="#ecebf2"
        strokeWidth={thickness}
      />
      {parts.map((p, i) => {
        const length = (Math.min(100, Math.max(0, p.percent)) / 100) * circumference;
        const element = (
          <circle
            key={i}
            cx={centre}
            cy={centre}
            r={r}
            fill="none"
            stroke={colour[p.tone]}
            strokeWidth={thickness}
            strokeDasharray={`${n(length)} ${n(circumference - length)}`}
            strokeDashoffset={-offset}
            strokeLinecap="butt"
            transform={`rotate(-90 ${n(centre)} ${n(centre)})`}
          />
        );
        offset += length;
        return element;
      })}
    </svg>
  );
}
