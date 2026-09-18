/**
 * A figure that arrives a character at a time (ADR 0036).
 *
 * The string is already formatted by the company's conventions; nothing here touches the
 * value. Each character is wrapped so the stylesheet can roll it in with a short stagger,
 * and the whole is one accessible label, so a screen reader hears the figure, not the
 * characters. Under reduced motion the stylesheet collapses the animation and this is plain
 * text.
 */
export function RollingNumber({
  value,
  className = "",
}: {
  value: string;
  className?: string;
}) {
  return (
    <span className={`roll ${className}`} aria-label={value} role="text">
      {Array.from(new Intl.Segmenter().segment(value), (s) => s.segment).map((ch, i) => (
        <span
          key={`${i.toString()}-${ch}`}
          aria-hidden="true"
          style={{ "--d": i.toString() } as React.CSSProperties}
        >
          {ch === " " ? " " : ch}
        </span>
      ))}
    </span>
  );
}
