import Link from "next/link";

import { AuthShell, ButtonLink } from "@/components/ui";

export const metadata = { title: "Signed out" };

export default async function SignedOutPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const elsewhere = reason === "elsewhere";
  const deleted = reason === "deleted";
  const inactive = reason === "inactive";
  return (
    <AuthShell moment="leave" title="Signed out">
      <div className="flex flex-col gap-3 text-sm text-neutral-600">
        {/* SPEC §8: the exact explanation for a superseded session. */}
        <p data-testid="signed-out-reason">
          {elsewhere
            ? "You were signed out because this account signed in elsewhere."
            : deleted
              ? "Your account has been deleted. We have emailed you the date its data will be permanently destroyed."
              : inactive
                ? "You were signed out because this account is not active."
                : "You have been signed out."}
        </p>
        {elsewhere ? (
          <p>
            Each account can be signed in on one device at a time. If this wasn't you,
            sign in and change your password from Security settings.
          </p>
        ) : null}
        {inactive ? (
          // Somewhere to go when the account itself is the problem (ADR 0091).
          <p>
            If you think that is wrong,{" "}
            <Link href="/contact" className="font-medium text-accent-700 underline">
              write to us
            </Link>
            .
          </p>
        ) : null}
        {/* A deleted account has nothing to sign in to (ADR 0091). */}
        {deleted ? (
          <ButtonLink href="/" size="lg" className="mt-1 w-full">
            Back to the home page
          </ButtonLink>
        ) : (
          <ButtonLink href="/sign-in" size="lg" className="mt-1 w-full">
            Sign in
          </ButtonLink>
        )}
      </div>
    </AuthShell>
  );
}
