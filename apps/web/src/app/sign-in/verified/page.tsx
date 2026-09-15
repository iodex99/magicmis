import { Alert, AuthShell, ButtonLink } from "@/components/ui";

export const metadata = { title: "Email verified" };

export default function VerifiedPage() {
  return (
    <AuthShell title="Email verified">
      <div className="flex flex-col gap-4">
        <Alert tone="success">Your email address is confirmed.</Alert>
        <p className="text-sm text-neutral-600">
          Next, sign in and set up an authenticator app. You will need it every time you
          sign in.
        </p>
        <ButtonLink href="/sign-in" size="lg" className="w-full">
          Sign in
        </ButtonLink>
      </div>
    </AuthShell>
  );
}
