"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type SyntheticEvent } from "react";

import { safeNextPath } from "@magicmis/accounts/redirect";

import { ProviderButtons } from "@/components/ProviderButtons";
import { Alert, AuthShell, Button, Field } from "@/components/ui";
import { api, formText } from "@/lib/client-api";
import type { OAuthProvider } from "@/lib/server/oauth";

/** Moves focus to the first field the server marked, so its message is read out (ADR 0091). */
function focusFirst(fields: Record<string, string>, order: readonly string[]): void {
  const first = order.find((name) => fields[name] !== undefined);
  if (first !== undefined) document.getElementById(first)?.focus();
}

/**
 * A new confirmation link for an address that has not been confirmed (ADR 0091). The link is the
 * kind sign-up sends, so it signs in only the browser that signed up (ADR 0071); anywhere else it
 * confirms the address and its owner chooses the password again. It never goes through sign-up,
 * which would leave the account's browser secret behind and treat this browser as a stranger.
 */
function SendLinkAgain({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2" data-testid="sign-in-resend">
      {state === "sent" ? (
        <Alert tone="success">
          A new link is on its way to {email}. Open it in the browser you signed up in to
          be signed straight in; anywhere else, it confirms the address and you choose
          your password there.
        </Alert>
      ) : (
        <div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon="mail"
            disabled={state === "sending" || email === ""}
            onClick={() => {
              setState("sending");
              setError(null);
              void api("/api/auth/resend", { body: { email } }).then((r) => {
                if (r.ok) setState("sent");
                else {
                  setState("idle");
                  setError(r.fields["email"] ?? r.message);
                }
              });
            }}
          >
            {state === "sending" ? "Sending…" : "Send a new link"}
          </Button>
        </div>
      )}
      {error === null ? null : <Alert tone="error">{error}</Alert>}
    </div>
  );
}

function Form({ providers }: { providers: readonly OAuthProvider[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [message, setMessage] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const linkFailed = params.get("verification") === "failed";

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setMessage(null);
    setCode(null);
    setFields({});
    const result = await api<{ next: "app" | "finish" }>("/api/auth/sign-in", {
      body: { email: formText(form, "email"), password: formText(form, "password") },
    });
    setSubmitting(false);
    if (!result.ok) {
      setMessage(result.message);
      setCode(result.error);
      setFields(result.fields);
      focusFirst(result.fields, ["email", "password"]);
      return;
    }
    // Only same-origin relative paths, or a crafted ?next= would bounce a freshly signed-in
    // session to another site. The shared guard is the same one /auth/callback uses.
    router.replace(
      result.data.next === "finish"
        ? "/sign-up/finish"
        : safeNextPath(params.get("next"), "/app"),
    );
  }

  // Unconfirmed, or back from a link that has lapsed: the way forward is a new link, sent to
  // the address in the field (ADR 0091). Signing in cannot send one.
  const offerResend = code === "email_not_verified" || (linkFailed && code === null);

  return (
    <>
      <ProviderButtons providers={providers} next={params.get("next") ?? undefined} />
      <form
        onSubmit={(e) => {
          void onSubmit(e);
        }}
        className="flex flex-col gap-4"
        noValidate
      >
        {linkFailed && code === null ? (
          <Alert tone="error">
            That confirmation link is invalid or has expired. Enter your email below and
            send yourself a new one.
          </Alert>
        ) : null}
        {params.get("provider") === "unavailable" ? (
          <Alert tone="error">
            That sign-in option is not available right now. Use your email and password.
          </Alert>
        ) : null}
        {params.get("provider") === "failed" ? (
          <Alert tone="error">
            Signing in with that account did not finish, so nothing has changed. Try
            again, or use your email and password.
          </Alert>
        ) : null}
        {params.get("reset") === "done" ? (
          <Alert tone="success">Your password is set. Sign in with it to continue.</Alert>
        ) : null}
        {message ? (
          <Alert tone="error">
            {message}
            {code === "account_not_active" ? (
              <>
                {" "}
                <Link href="/contact" className="font-medium underline">
                  Contact
                </Link>
              </>
            ) : null}
          </Alert>
        ) : null}
        <Field
          id="email"
          name="email"
          type="email"
          label="Email"
          autoComplete="email"
          autoFocus
          required
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
          }}
          error={fields["email"]}
        />
        {offerResend ? <SendLinkAgain email={email.trim()} /> : null}
        <Field
          id="password"
          name="password"
          type="password"
          label="Password"
          autoComplete="current-password"
          required
          error={fields["password"]}
        />
        <Button type="submit" disabled={submitting} size="lg" className="mt-1 w-full">
          {submitting ? "Signing in…" : "Continue"}
        </Button>
        <p className="text-center text-[0.8125rem]">
          <Link
            href="/forgot-password"
            className="text-neutral-500 hover:text-accent-700"
          >
            Forgot your password?
          </Link>
        </p>
      </form>
    </>
  );
}

export function SignInScreen({
  providers,
  continuing = false,
}: {
  providers: readonly OAuthProvider[];
  /** Sent here from a page that needs a sign-in, which is where they will land after. */
  continuing?: boolean;
}) {
  return (
    <AuthShell
      title="Sign in"
      description={
        continuing ? "Sign in to carry on to the page you opened." : "Welcome back."
      }
      footer={
        <>
          No account?{" "}
          <Link href="/sign-up" className="font-medium text-accent-700 hover:underline">
            Create one
          </Link>
        </>
      }
    >
      <Suspense>
        <Form providers={providers} />
      </Suspense>
    </AuthShell>
  );
}
