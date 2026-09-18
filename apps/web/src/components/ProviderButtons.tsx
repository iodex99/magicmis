import type { OAuthProvider } from "@/lib/server/oauth";

/**
 * "Continue with Google / Apple" (ADR 0043).
 *
 * Plain anchors, not `<Link>`: the target is a route handler that answers with a redirect to
 * the provider, and a client-side navigation would try to prefetch it. Nothing renders when
 * no provider is switched on, so the screens look exactly as they did until the owner has
 * configured one.
 *
 * The marks are each provider's own, drawn inline because the icon set is hand-drawn and
 * carries no brands; the wording and the neutral button follow both providers' guidelines
 * for a third-party sign-in button.
 */
const LABELS: Record<OAuthProvider, string> = { google: "Google", apple: "Apple" };

function Mark({ provider }: { provider: OAuthProvider }) {
  if (provider === "apple") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="size-[18px]"
        fill="currentColor"
      >
        <path d="M16.37 12.6c.03 2.9 2.55 3.87 2.58 3.88-.02.07-.4 1.38-1.33 2.73-.8 1.17-1.63 2.33-2.94 2.36-1.29.02-1.7-.76-3.18-.76-1.47 0-1.93.74-3.15.79-1.27.05-2.23-1.27-3.04-2.43-1.65-2.39-2.92-6.75-1.22-9.7a4.72 4.72 0 0 1 3.99-2.42c1.24-.02 2.42.84 3.18.84.76 0 2.19-1.04 3.69-.89.63.03 2.39.26 3.53 1.91-.09.06-2.1 1.23-2.08 3.69ZM13.95 5.47c.67-.81 1.12-1.94 1-3.07-.97.04-2.14.65-2.83 1.46-.62.72-1.17 1.87-1.02 2.98 1.08.08 2.18-.55 2.85-1.37Z" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[18px]">
      <path
        fill="#4285F4"
        d="M23.5 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.08 3.57-5.15 3.57-8.81Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.87-3c-1.07.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.95H1.27v3.1A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29a7.2 7.2 0 0 1 0-4.58v-3.1H1.27a12 12 0 0 0 0 10.78l4-3.1Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.43-3.43C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.27 6.61l4 3.1C6.22 6.88 8.87 4.77 12 4.77Z"
      />
    </svg>
  );
}

export function ProviderButtons({
  providers,
  next,
}: {
  providers: readonly OAuthProvider[];
  /** Where to land afterwards; validated again on the server. */
  next?: string | undefined;
}) {
  if (providers.length === 0) return null;
  const query = next === undefined ? "" : `?next=${encodeURIComponent(next)}`;
  return (
    <div className="mb-5 flex flex-col gap-2.5" data-testid="provider-buttons">
      {providers.map((provider) => (
        <a
          key={provider}
          href={`/auth/oauth/${provider}${query}`}
          className="press inline-flex h-11 w-full items-center justify-center gap-2.5 rounded-lg border border-neutral-200 bg-surface text-[0.9375rem] font-medium text-neutral-800 shadow-sm hover:border-neutral-300"
        >
          <Mark provider={provider} />
          Continue with {LABELS[provider]}
        </a>
      ))}
      <div className="mt-2 flex items-center gap-3 text-[0.75rem] text-neutral-400">
        <span className="h-px flex-1 bg-neutral-200" />
        or with your email
        <span className="h-px flex-1 bg-neutral-200" />
      </div>
    </div>
  );
}
