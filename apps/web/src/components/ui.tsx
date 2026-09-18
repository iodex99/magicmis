import Link from "next/link";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

import { PRODUCT_NAME } from "@/lib/brand";

import { Icon, type IconName } from "./Icon";
import { RollingNumber } from "./RollingNumber";

/**
 * Base components (SPEC §32): precise, calm, dense.
 *
 * Depth comes from layered shadows and one indigo accent -- never from a gradient or a
 * glow, which the spec rules out. Every control keeps a visible focus ring, every state
 * that matters is carried by a word as well as a colour, and every empty state says what
 * to do next.
 */

/* ------------------------------------------------------------------ buttons */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ControlSize = "sm" | "md" | "lg";

const BUTTON: Record<ButtonVariant, string> = {
  primary:
    "bg-accent-600 text-white shadow-sm hover:bg-accent-700 active:bg-accent-800 disabled:bg-neutral-200 disabled:text-neutral-500 disabled:shadow-none",
  secondary:
    "border border-neutral-200 bg-surface text-neutral-800 shadow-sm hover:border-neutral-300 hover:bg-neutral-25 disabled:text-neutral-400 disabled:shadow-none",
  ghost:
    "text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900 disabled:text-neutral-400",
  danger:
    "bg-negative text-white shadow-sm hover:brightness-110 active:brightness-95 disabled:bg-neutral-200 disabled:text-neutral-500 disabled:shadow-none",
};

const BUTTON_SIZE: Record<ControlSize, string> = {
  sm: "h-8 gap-1.5 rounded-md px-3 text-[0.8125rem]",
  md: "h-10 gap-2 rounded-md px-4 text-sm",
  lg: "h-11 gap-2 rounded-lg px-5 text-[0.9375rem]",
};

const BUTTON_BASE =
  "press inline-flex items-center justify-center font-medium disabled:cursor-not-allowed";

export function Button({
  variant = "primary",
  size = "md",
  icon,
  iconAfter,
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant | undefined;
  size?: ControlSize | undefined;
  icon?: IconName | undefined;
  iconAfter?: IconName | undefined;
}) {
  return (
    <button
      className={`${BUTTON_BASE} ${BUTTON_SIZE[size]} ${BUTTON[variant]} ${className}`}
      {...props}
    >
      {icon ? <Icon name={icon} size={size === "sm" ? 14 : 16} /> : null}
      {children}
      {iconAfter ? <Icon name={iconAfter} size={size === "sm" ? 14 : 16} /> : null}
    </button>
  );
}

/**
 * A link that carries a button's weight. Navigation, so it stays an anchor.
 *
 * The prop list is explicit rather than the whole of `AnchorHTMLAttributes`: under
 * `exactOptionalPropertyTypes` the anchor's own optional handlers do not satisfy
 * `LinkProps`, and a button-shaped link needs none of them.
 */
export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  icon,
  iconAfter,
  className = "",
  children,
  ...props
}: {
  href: string;
  variant?: ButtonVariant | undefined;
  size?: ControlSize | undefined;
  icon?: IconName | undefined;
  iconAfter?: IconName | undefined;
  className?: string | undefined;
  children: ReactNode;
  target?: string | undefined;
  rel?: string | undefined;
  "aria-label"?: string | undefined;
  "data-testid"?: string | undefined;
}) {
  return (
    <Link
      href={href}
      className={`${BUTTON_BASE} ${BUTTON_SIZE[size]} ${BUTTON[variant]} ${className}`}
      {...props}
    >
      {icon ? <Icon name={icon} size={size === "sm" ? 14 : 16} /> : null}
      {children}
      {iconAfter ? <Icon name={iconAfter} size={size === "sm" ? 14 : 16} /> : null}
    </Link>
  );
}

/**
 * A control whose label is carried entirely by `aria-label`. The label is required:
 * an icon with no accessible name is a control a screen reader cannot announce.
 */
export function IconButton({
  icon,
  label,
  className = "",
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  icon: IconName;
  label: string;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-full border border-neutral-200 bg-surface text-neutral-600 transition-colors hover:border-neutral-300 hover:text-neutral-900 disabled:cursor-not-allowed disabled:text-neutral-300 ${className}`}
      {...props}
    >
      <Icon name={icon} size={16} />
    </button>
  );
}

/* ------------------------------------------------------------------ surfaces */

/**
 * The working surface. `Panel` keeps the name the app already uses; `title` renders a
 * header row that `actions` can sit in.
 */
export function Panel({
  title,
  description,
  actions,
  icon,
  padding = "md",
  className = "",
  bodyClassName = "",
  children,
}: {
  title?: string | undefined;
  description?: string | undefined;
  actions?: ReactNode | undefined;
  icon?: IconName | undefined;
  padding?: "none" | "sm" | "md" | undefined;
  className?: string | undefined;
  bodyClassName?: string | undefined;
  children: ReactNode;
}) {
  const pad = { none: "", sm: "p-4", md: "p-5" }[padding];
  return (
    <section
      className={`rounded-xl border border-neutral-200/80 bg-surface shadow-sm ${className}`}
    >
      {title === undefined ? null : (
        <header
          className={`flex items-start justify-between gap-4 ${padding === "none" ? "px-5 pt-5" : `${pad} pb-0`}`}
        >
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-[0.9375rem] font-semibold text-neutral-900">
              {icon ? <Icon name={icon} size={16} className="text-neutral-400" /> : null}
              {title}
            </h2>
            {description === undefined ? null : (
              <p className="mt-1 text-[0.8125rem] text-neutral-500">{description}</p>
            )}
          </div>
          {actions === undefined ? null : (
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          )}
        </header>
      )}
      <div
        className={`${padding === "none" ? "" : pad} ${title === undefined ? "" : padding === "none" ? "" : "pt-4"} ${bodyClassName}`}
      >
        {children}
      </div>
    </section>
  );
}

/** A figure worth reading at a glance, with an optional movement and inline chart. */
export function StatCard({
  label,
  value,
  unit,
  delta,
  hint,
  icon,
  chart,
  href,
  tone = "default",
}: {
  label: string;
  value: string;
  unit?: string | undefined;
  /** Pre-formatted movement. `direction` supplies the arrow, so colour is never alone. */
  delta?: { direction: "up" | "down" | "flat"; text: string; good?: boolean } | undefined;
  hint?: string | undefined;
  icon?: IconName | undefined;
  chart?: ReactNode | undefined;
  href?: string | undefined;
  tone?: "default" | "accent" | undefined;
}) {
  const arrow = { up: "↑", down: "↓", flat: "–" }[delta?.direction ?? "flat"];
  const deltaColour =
    delta === undefined || delta.good === undefined
      ? "text-neutral-500"
      : delta.good
        ? "text-positive"
        : "text-negative";
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className="eyebrow">{label}</span>
        {icon ? (
          <span
            className={`flex h-7 w-7 items-center justify-center rounded-full ${
              tone === "accent"
                ? "bg-accent-50 text-accent-600"
                : "bg-neutral-100 text-neutral-500"
            }`}
          >
            <Icon name={icon} size={14} />
          </span>
        ) : null}
      </div>
      <p className="mt-3 flex items-baseline gap-1.5">
        <span className="num text-[1.75rem] leading-none font-semibold tracking-tight text-neutral-900">
          <RollingNumber value={value} />
        </span>
        {unit === undefined ? null : (
          <span className="text-[0.8125rem] text-neutral-500">{unit}</span>
        )}
      </p>
      {delta === undefined ? null : (
        <p className="mt-2.5">
          <span
            className={`inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[0.75rem] font-medium ${deltaColour}`}
          >
            <span aria-hidden="true">{arrow}</span>
            {delta.text}
          </span>
        </p>
      )}
      {hint === undefined ? null : (
        <p className="mt-2 text-[0.8125rem] text-neutral-500">{hint}</p>
      )}
      {chart === undefined ? null : <div className="mt-4">{chart}</div>}
    </>
  );
  const shell =
    "lift rise block rounded-xl border border-neutral-200/80 bg-surface p-4 shadow-sm";
  return href === undefined ? (
    <div className={shell}>{body}</div>
  ) : (
    <Link href={href} className={`${shell} hover:border-accent-200`}>
      {body}
    </Link>
  );
}

/* ------------------------------------------------------------------ status */

export type BadgeTone =
  "neutral" | "accent" | "positive" | "negative" | "warning" | "muted";

const BADGE: Record<BadgeTone, string> = {
  neutral: "bg-neutral-100 text-neutral-700",
  accent: "bg-accent-50 text-accent-700",
  positive: "bg-positive-subtle text-positive",
  negative: "bg-negative-subtle text-negative",
  warning: "bg-warning-subtle text-warning",
  muted: "bg-neutral-50 text-neutral-500",
};

const BADGE_DOT: Record<BadgeTone, string> = {
  neutral: "bg-neutral-400",
  accent: "bg-accent-500",
  positive: "bg-positive",
  negative: "bg-negative",
  warning: "bg-warning",
  muted: "bg-neutral-300",
};

/** A status pill. The word is the status; the colour and dot only reinforce it. */
export function Badge({
  tone = "neutral",
  dot = false,
  children,
  className = "",
}: {
  tone?: BadgeTone | undefined;
  dot?: boolean | undefined;
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.75rem] font-medium whitespace-nowrap ${BADGE[tone]} ${className}`}
    >
      {dot ? (
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 rounded-full ${BADGE_DOT[tone]}`}
        />
      ) : null}
      {children}
    </span>
  );
}

export function Alert({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warning" | "error" | "success" | undefined;
  title?: string | undefined;
  children: ReactNode;
}) {
  const { box, mark, icon } = {
    info: {
      box: "border-accent-100 bg-accent-50 text-accent-800",
      mark: "text-accent-600",
      icon: "info" as const,
    },
    warning: {
      box: "border-warning/25 bg-warning-subtle text-warning",
      mark: "text-warning",
      icon: "alert" as const,
    },
    error: {
      box: "border-negative/25 bg-negative-subtle text-negative",
      mark: "text-negative",
      icon: "alert" as const,
    },
    success: {
      box: "border-positive/25 bg-positive-subtle text-positive",
      mark: "text-positive",
      icon: "check-circle" as const,
    },
  }[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`flex gap-2.5 rounded-lg border px-3.5 py-3 text-sm ${box}`}
    >
      <Icon name={icon} size={16} className={`mt-0.5 ${mark}`} />
      <div className="min-w-0 flex-1">
        {title === undefined ? null : <p className="font-semibold">{title}</p>}
        <div className={title === undefined ? "" : "mt-0.5"}>{children}</div>
      </div>
    </div>
  );
}

/** SPEC §32: every empty state says what to do next, so `action` is not decoration. */
export function EmptyState({
  icon = "info",
  title,
  children,
  action,
  testId,
}: {
  icon?: IconName | undefined;
  title: string;
  children: ReactNode;
  action?: ReactNode | undefined;
  testId?: string | undefined;
}) {
  return (
    <div
      className="flex flex-col items-center px-6 py-10 text-center"
      data-testid={testId}
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-100 text-neutral-500 ring-8 ring-neutral-50">
        <Icon name={icon} size={20} />
      </span>
      <p className="mt-3 text-sm font-semibold text-neutral-900">{title}</p>
      <div className="mt-1 max-w-md text-[0.8125rem] text-neutral-500">{children}</div>
      {action === undefined ? null : <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Initials on a tinted ground. No photograph is ever uploaded, so initials are the avatar. */
export function Avatar({
  name,
  size = 32,
  className = "",
}: {
  name: string;
  size?: number | undefined;
  className?: string | undefined;
}) {
  const initials =
    name
      .split(/\s+/u)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?";
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.floor(size * 0.38) }}
      className={`inline-flex items-center justify-center rounded-full bg-accent-100 font-semibold text-accent-700 ${className}`}
    >
      {initials}
    </span>
  );
}

export function Progress({
  value,
  max = 100,
  label,
  tone = "accent",
}: {
  value: number;
  max?: number | undefined;
  label: string;
  tone?: "accent" | "positive" | "warning" | undefined;
}) {
  const pct = max <= 0 ? 0 : Math.min(100, Math.max(0, Math.floor((value / max) * 100)));
  const bar = { accent: "bg-accent-500", positive: "bg-positive", warning: "bg-warning" }[
    tone
  ];
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100"
    >
      <div
        className={`h-full rounded-full ${bar}`}
        style={{ width: `${String(pct)}%` }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ forms */

const CONTROL =
  "h-10 w-full rounded-md border bg-surface px-3 text-sm text-neutral-900 transition-colors placeholder:text-neutral-400 hover:border-neutral-300 disabled:bg-neutral-50 disabled:text-neutral-500";

function describedBy(id: string, error?: string, hint?: string): string | undefined {
  const ids = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean);
  return ids.length === 0 ? undefined : ids.join(" ");
}

function Help({
  id,
  error,
  hint,
}: {
  id: string;
  error?: string | undefined;
  hint?: string | undefined;
}) {
  return (
    <>
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-[0.75rem] text-neutral-500">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p
          id={`${id}-error`}
          className="flex items-center gap-1 text-[0.75rem] font-medium text-negative"
        >
          <Icon name="alert" size={12} />
          {error}
        </p>
      ) : null}
    </>
  );
}

export function Field({
  label,
  error,
  hint,
  id,
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  id: string;
  error?: string | undefined;
  hint?: string | undefined;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[0.8125rem] font-medium text-neutral-700">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={`${CONTROL} ${error ? "border-negative" : "border-neutral-200"} ${className}`}
        {...props}
      />
      <Help id={id} error={error} hint={hint} />
    </div>
  );
}

export function SelectField({
  label,
  error,
  hint,
  id,
  className = "",
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  id: string;
  error?: string | undefined;
  hint?: string | undefined;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[0.8125rem] font-medium text-neutral-700">
        {label}
      </label>
      <div className="relative">
        <select
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, error, hint)}
          className={`${CONTROL} appearance-none pr-9 ${error ? "border-negative" : "border-neutral-200"} ${className}`}
          {...props}
        >
          {children}
        </select>
        {/* The native arrow is suppressed for a consistent control height across browsers. */}
        <Icon
          name="chevron-down"
          size={16}
          className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-neutral-400"
        />
      </div>
      <Help id={id} error={error} hint={hint} />
    </div>
  );
}

export function TextareaField({
  label,
  error,
  hint,
  id,
  className = "",
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  id: string;
  error?: string | undefined;
  hint?: string | undefined;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[0.8125rem] font-medium text-neutral-700">
        {label}
      </label>
      <textarea
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={`w-full rounded-md border bg-surface px-3 py-2 text-sm text-neutral-900 transition-colors placeholder:text-neutral-400 hover:border-neutral-300 ${error ? "border-negative" : "border-neutral-200"} ${className}`}
        {...props}
      />
      <Help id={id} error={error} hint={hint} />
    </div>
  );
}

/* ------------------------------------------------------------------ tables */

/**
 * A dense table on a panel. Sticky headers are opt-in through `maxHeight`, which is what
 * makes them useful -- a header that sticks to nothing is just a header.
 */
export function DataTable({
  head,
  children,
  maxHeight,
  testId,
  className = "",
}: {
  head: ReactNode;
  children: ReactNode;
  maxHeight?: string | undefined;
  testId?: string | undefined;
  className?: string | undefined;
}) {
  return (
    <div
      className={`scroll-slim overflow-auto ${className}`}
      style={maxHeight === undefined ? undefined : { maxHeight }}
    >
      <table className="w-full border-collapse text-sm" data-testid={testId}>
        <thead className="sticky top-0 z-10 bg-surface">
          <tr className="border-b border-neutral-200 text-left">{head}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Th({
  children,
  numeric = false,
  className = "",
}: {
  children?: ReactNode | undefined;
  numeric?: boolean | undefined;
  className?: string | undefined;
}) {
  return (
    <th
      scope="col"
      className={`px-3 py-2 text-[0.6875rem] font-semibold tracking-[0.06em] text-neutral-500 uppercase ${numeric ? "text-right" : ""} ${className}`}
    >
      {children}
    </th>
  );
}

export function Tr({
  children,
  className = "",
  ...props
}: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={`border-b border-neutral-100 last:border-0 hover:bg-neutral-25 ${className}`}
      {...props}
    >
      {children}
    </tr>
  );
}

export function Td({
  children,
  numeric = false,
  className = "",
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td
      className={`px-3 py-2.5 text-neutral-700 ${numeric ? "num text-neutral-900" : ""} ${className}`}
      {...props}
    >
      {children}
    </td>
  );
}

/* ------------------------------------------------------------------ shells */

/**
 * The page header every signed-in screen starts with: where you are, what this screen is
 * for, and the actions that belong to it.
 */
export function PageHeader({
  title,
  description,
  actions,
  back,
  meta,
}: {
  title: string;
  description?: string | undefined;
  actions?: ReactNode | undefined;
  back?: { href: string; label: string } | undefined;
  meta?: ReactNode | undefined;
}) {
  return (
    <header className="mb-6">
      {back === undefined ? null : (
        <Link
          href={back.href}
          className="mb-3 inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-neutral-500 hover:text-neutral-900"
        >
          <Icon name="chevron-right" size={14} className="rotate-180" />
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="display text-[1.75rem] leading-tight font-semibold text-neutral-900">
              {title}
            </h1>
            {meta}
          </div>
          {description === undefined ? null : (
            <p className="mt-1.5 text-sm text-neutral-500">{description}</p>
          )}
        </div>
        {actions === undefined ? null : (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
    </header>
  );
}

/** Segmented, pill-shaped navigation within a screen. */
export function Tabs({
  items,
  current,
}: {
  items: readonly { href: string; label: string; icon?: IconName }[];
  current: string;
}) {
  return (
    <nav
      aria-label="Section"
      className="inline-flex items-center gap-0.5 rounded-full border border-neutral-200/80 bg-surface p-1 shadow-sm"
    >
      {items.map((item) => {
        const active = item.href === current;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[0.8125rem] font-medium transition-colors ${
              active
                ? "bg-accent-600 text-white"
                : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
            }`}
          >
            {item.icon ? <Icon name={item.icon} size={14} /> : null}
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** The centred shell every unauthenticated screen uses. */
export function AuthShell({
  title,
  description,
  children,
  footer,
  width = "narrow",
}: {
  title: string;
  description?: string | undefined;
  children: ReactNode;
  footer?: ReactNode | undefined;
  /** Sign-up carries a billing address and needs the room; everything else does not. */
  width?: "narrow" | "wide" | undefined;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className={`w-full ${width === "wide" ? "max-w-[32rem]" : "max-w-[26rem]"}`}>
        <Link href="/" className="mb-8 flex items-center justify-center gap-2">
          <BrandMark size={30} />
          <span className="text-[0.9375rem] font-semibold tracking-tight text-neutral-900">
            {PRODUCT_NAME}
          </span>
        </Link>
        <div className="rounded-2xl border border-neutral-200/80 bg-surface p-7 shadow-lg">
          <h1 className="text-xl font-semibold tracking-tight text-neutral-900">
            {title}
          </h1>
          {description === undefined ? null : (
            <p className="mt-1.5 text-[0.8125rem] text-neutral-500">{description}</p>
          )}
          <div className="mt-6">{children}</div>
        </div>
        {footer === undefined ? null : (
          <div className="mt-5 text-center text-[0.8125rem] text-neutral-500">
            {footer}
          </div>
        )}
      </div>
    </main>
  );
}

/**
 * The mark. Two stacked bars and a rule -- a ledger column, not a spark or a gradient
 * blob (SPEC §32).
 */
export function BrandMark({
  size = 28,
  className = "",
}: {
  size?: number | undefined;
  className?: string | undefined;
}) {
  return (
    <span
      style={{ width: size, height: size }}
      className={`inline-flex shrink-0 items-center justify-center rounded-[28%] bg-accent-600 ${className}`}
    >
      <svg
        width={size * 0.62}
        height={size * 0.62}
        viewBox="0 0 24 24"
        fill="none"
        stroke="#ffffff"
        strokeWidth={2.4}
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M7 16.5V11m5 5.5V6m5 10.5v-3.5M4.5 20.5h15" />
      </svg>
    </span>
  );
}
