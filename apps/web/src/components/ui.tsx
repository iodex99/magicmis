import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

/**
 * Base components (SPEC §32): precise, calm, compact. Plain elements with visible labels
 * and focus rings; no icons standing in for words, no gradients, no emoji.
 */

type ButtonVariant = "primary" | "secondary" | "danger";

const BUTTON: Record<ButtonVariant, string> = {
  primary:
    "bg-accent-600 text-white hover:bg-accent-700 disabled:bg-neutral-300 disabled:text-neutral-600",
  secondary:
    "border border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-50 disabled:text-neutral-400",
  danger: "bg-negative text-white hover:opacity-90 disabled:bg-neutral-300",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
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
  hint?: string;
}) {
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-neutral-800">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={`h-9 rounded-md border bg-white px-3 text-sm text-neutral-900 ${
          error ? "border-negative" : "border-neutral-300"
        }`}
        {...props}
      />
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-xs text-neutral-600">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-negative">
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
    info: "border-accent-100 bg-accent-50 text-accent-700",
    warning: "border-warning bg-warning-subtle text-warning",
    error: "border-negative bg-negative-subtle text-negative",
    success: "border-positive bg-positive-subtle text-positive",
  }[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-md border px-3 py-2 text-sm ${styles}`}
    >
      {children}
    </div>
  );
}

export function Panel({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-6">
      {title ? (
        <h2 className="mb-4 text-base font-semibold text-neutral-900">{title}</h2>
      ) : null}
      {children}
    </section>
  );
}

export function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-start justify-center px-4 py-16">
      <div className="w-full max-w-md">
        <h1 className="mb-6 text-xl font-semibold text-neutral-900">{title}</h1>
        <Panel>{children}</Panel>
      </div>
    </main>
  );
}
