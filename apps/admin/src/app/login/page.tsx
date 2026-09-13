import { PRODUCT_NAME } from "@magicmis/core/brand";

import { Alert, AuthShell, Button, Field } from "@/components/ui";

import { signInAction } from "./actions";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  invalid: "Email, password or code is incorrect.",
  locked: "Too many failed attempts. Try again later.",
  ip: "Admin access is not allowed from this network.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <AuthShell title={`${PRODUCT_NAME} Admin`}>
      <form action={signInAction} className="flex flex-col gap-4">
        {error !== undefined && ERRORS[error] ? (
          <Alert tone="error">{ERRORS[error]}</Alert>
        ) : null}
        <Field
          id="email"
          name="email"
          type="email"
          label="Email"
          autoComplete="username"
          required
        />
        <Field
          id="password"
          name="password"
          type="password"
          label="Password"
          autoComplete="current-password"
          required
        />
        <Field
          id="code"
          name="code"
          label="Authenticator code"
          inputMode="numeric"
          pattern="[0-9]{6}"
          autoComplete="one-time-code"
          required
        />
        <Button type="submit">Sign in</Button>
      </form>
    </AuthShell>
  );
}
