import Link from "next/link";

import { AuthShell } from "@/components/ui";

export const metadata = { title: "Email verified" };

export default function VerifiedPage() {
  return (
    <AuthShell title="Email verified">
      <div className="flex flex-col gap-3 text-sm text-neutral-700">
        <p>Your email address is confirmed.</p>
        <p>
          Next, sign in and set up an authenticator app. You will need it every time you
          sign in.
        </p>
        <Link
          href="/sign-in"
          className="inline-flex h-9 w-fit items-center rounded-md bg-accent-600 px-4 text-sm font-medium text-white hover:bg-accent-700"
        >
          Sign in
        </Link>
      </div>
    </AuthShell>
  );
}
