import Link from "next/link";

import { AuthShell } from "@/components/ui";

export const metadata = { title: "Signed out" };

export default async function SignedOutPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const elsewhere = reason === "elsewhere";
  return (
    <AuthShell title="Signed out">
      <div className="flex flex-col gap-3 text-sm text-neutral-700">
        {/* SPEC §8: the exact explanation for a superseded session. */}
        <p data-testid="signed-out-reason">
          {elsewhere
            ? "You were signed out because this account signed in elsewhere."
            : "You have been signed out."}
        </p>
        {elsewhere ? (
          <p>
            Each account can be signed in on one device at a time. If this wasn't you,
            sign in and change your password from Security settings.
          </p>
        ) : null}
        <Link
          href="/sign-in"
          className="inline-flex h-9 w-fit items-center rounded-md bg-accent-600 px-4 text-sm font-medium text-white"
        >
          Sign in
        </Link>
      </div>
    </AuthShell>
  );
}
