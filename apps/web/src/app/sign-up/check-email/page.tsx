import Link from "next/link";

import { AuthShell } from "@/components/ui";

export const metadata = { title: "Check your email" };

export default function CheckEmailPage() {
  return (
    <AuthShell title="Check your email">
      <div className="flex flex-col gap-3 text-sm text-neutral-700">
        <p>
          We sent a verification link to the address you entered. Open it to confirm your
          email.
        </p>
        <p>
          After verifying, sign in and set up an authenticator app. Two-factor
          authentication is required for every account.
        </p>
        <p>
          No email after a few minutes? Check your spam folder, then{" "}
          <Link href="/sign-up" className="underline">
            try again
          </Link>
          .
        </p>
      </div>
    </AuthShell>
  );
}
