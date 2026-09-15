import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

/**
 * Base components (SPEC §32), on the same tokens as the customer app (ADR 0026): precise,
 * calm, compact. Plain elements with visible labels and focus rings; no gradients, no
 * emoji, and no icon standing in for a word.
 *
 * Deliberately a smaller set than the customer app's. This console is an operator tool
 * read by two people; it earns the same palette and typography, not the same attention to
 * summary layers and empty states.
 */

type ButtonVariant = "primary" | "secondary" | "danger";

const BUTTON: Record<ButtonVariant, string> = {
  primary:
    "bg-accent-600 text-white shadow-sm hover:bg-accent-700 active:bg-accent-800 disabled:bg-neutral-200 disabled:text-neutral-500 disabled:shadow-none",
  secondary:
    "border border-neutral-200 bg-white text-neutral-800 shadow-sm hover:border-neutral-300 hover:bg-neutral-25 disabled:text-neutral-400 disabled:shadow-none",
  danger:
    "bg-negative text-white shadow-sm hover:brightness-110 disabled:bg-neutral-200 disabled:text-neutral-500",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant | undefined }) {
  return (
    <button
      className={`inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed ${BUTTON[variant]} ${className}`}
      {...props}
    />
  );
}

export function Field({
  label,
  error,
  hint,
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  id: string;
  error?: string | undefined;
  hint?: string | undefined;
}) {
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[0.8125rem] font-medium text-neutral-700">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={`h-10 rounded-md border bg-white px-3 text-sm text-neutral-900 transition-colors placeholder:text-neutral-400 hover:border-neutral-300 ${
          error ? "border-negative" : "border-neutral-200"
        }`}
        {...props}
      />
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-[0.75rem] text-neutral-500">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-[0.75rem] font-medium text-negative">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Alert({
  tone = "info",
  children,
}: {
  tone?: "info" | "warning" | "error" | "success";
  children: ReactNode;
}) {
  const styles = {
    info: "border-accent-100 bg-accent-50 text-accent-800",
    warning: "border-warning/25 bg-warning-subtle text-warning",
    error: "border-negative/25 bg-negative-subtle text-negative",
    success: "border-positive/25 bg-positive-subtle text-positive",
  }[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-lg border px-3.5 py-3 text-sm ${styles}`}
    >
      {children}
    </div>
  );
}

/** A status word in a pill. The word carries the state; the colour reinforces it. */
export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "accent" | "positive" | "negative" | "warning";
  children: ReactNode;
}) {
  const styles = {
    neutral: "bg-neutral-100 text-neutral-700",
    accent: "bg-accent-50 text-accent-700",
    positive: "bg-positive-subtle text-positive",
    negative: "bg-negative-subtle text-negative",
    warning: "bg-warning-subtle text-warning",
  }[tone];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[0.75rem] font-medium whitespace-nowrap ${styles}`}
    >
      {children}
    </span>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
}: {
  title?: string | undefined;
  description?: string | undefined;
  actions?: ReactNode | undefined;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-neutral-200/80 bg-white p-5 shadow-sm">
      {title === undefined ? null : (
        <header className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[0.9375rem] font-semibold text-neutral-900">{title}</h2>
            {description === undefined ? null : (
              <p className="mt-1 text-[0.8125rem] text-neutral-500">{description}</p>
            )}
          </div>
          {actions === undefined ? null : (
            <div className="flex shrink-0 gap-2">{actions}</div>
          )}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string | undefined;
  actions?: ReactNode | undefined;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-[1.5rem] leading-tight font-semibold tracking-tight text-neutral-900">
          {title}
        </h1>
        {description === undefined ? null : (
          <p className="mt-1.5 text-sm text-neutral-500">{description}</p>
        )}
      </div>
      {actions === undefined ? null : (
        <div className="flex shrink-0 gap-2">{actions}</div>
      )}
    </header>
  );
}

export function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <h1 className="mb-6 text-center text-xl font-semibold tracking-tight text-neutral-900">
          {title}
        </h1>
        <Panel>{children}</Panel>
      </div>
    </main>
  );
}
