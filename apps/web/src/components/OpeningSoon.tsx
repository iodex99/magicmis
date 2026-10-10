import Link from "next/link";

import { PRODUCT_NAME } from "@/lib/brand";

import { AuthShell } from "./ui";

/**
 * What sign-up, sign-in and the password pages show before launch (ADR 0078). No form and no
 * email capture: a waiting list would be personal data held for a purpose the privacy notice
 * does not name. Everything a visitor might want to read meanwhile is one link away. Its own
 * panel, without sign-up's progress or "free to create", since nobody can sign up yet (ADR 0091).
 */
export function OpeningSoon() {
  return (
    <AuthShell
      moment="soon"
      title="Opening soon"
      description={`${PRODUCT_NAME} accounts are not open yet. They open shortly, and nothing is charged before then.`}
      footer={
        <Link href="/" className="font-medium text-accent-700 hover:underline">
          Back to the home page
        </Link>
      }
    >
      <p className="text-sm leading-relaxed text-neutral-600">
        Meanwhile the rest of the site is open:
      </p>
      <ul className="mt-3 flex flex-col gap-2 text-sm">
        <li>
          <Link href="/how-it-works" className="text-accent-700 hover:underline">
            How it works
          </Link>
        </li>
        <li>
          <Link href="/pricing" className="text-accent-700 hover:underline">
            What it costs
          </Link>
        </li>
        <li>
          <Link href="/security" className="text-accent-700 hover:underline">
            How your data is kept
          </Link>
        </li>
      </ul>
    </AuthShell>
  );
}
