import type { Metadata } from "next";
import Link from "next/link";

import { Icon } from "@/components/Icon";
import { PublicShell } from "@/components/PublicShell";
import { PRODUCT_NAME } from "@/lib/brand";
import { legalFacts } from "@/lib/server/legal";

export const metadata: Metadata = {
  title: "Contact",
  description: `How to reach ${PRODUCT_NAME} about an account, a charge, a file or a privacy request.`,
};
// The addresses are owner facts in configuration (`legal.contacts`, ADR 0074), read per request.
export const dynamic = "force-dynamic";

/**
 * Where every "contact us" leads (ADR 0091): the footer, the signed-in rail and the messages that
 * send a customer to a person. The address is the one the legal documents publish, read from the
 * same configuration, so this page can never name a different one. Until the owner has set it the
 * page says so plainly and points to what a customer can already do for themselves, rather than
 * printing a placeholder or an address nobody reads.
 */
async function contacts(): Promise<{
  support: string | null;
  privacy: string | null;
}> {
  try {
    const f = await legalFacts();
    return {
      support: f.supportEmail,
      privacy: f.privacyEmail === f.supportEmail ? null : f.privacyEmail,
    };
  } catch (error) {
    // Unreadable configuration states nothing rather than failing the page someone came to for help.
    console.error("contact: the contact addresses could not be read", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { support: null, privacy: null };
  }
}

const SELF_SERVE: readonly { href: string; label: string; body: string }[] = [
  {
    href: "/wallet",
    label: "Wallet",
    body: "Every purchase, every charge and its tax invoice, and the price of each action.",
  },
  {
    href: "/app",
    label: "Your companies",
    body: "Each company's Files and settings list its files, every time one was opened, its workbooks and its shared links.",
  },
  {
    href: "/settings/privacy",
    label: "Privacy settings",
    body: "Export everything we hold about you, or delete your account.",
  },
  {
    href: "/forgot-password",
    label: "Reset your password",
    body: "A link to set a new one, sent to the address on the account.",
  },
];

export default async function ContactPage() {
  const { support, privacy } = await contacts();
  return (
    <PublicShell>
      <div className="mx-auto w-full max-w-[760px] px-6 pt-12 pb-16 sm:pt-16">
        <p className="text-[0.8125rem] font-medium tracking-wide text-accent-700 uppercase">
          Contact
        </p>
        <h1 className="display mt-3 text-[2rem] leading-[1.15] font-semibold tracking-tight text-neutral-900 sm:text-[2.5rem]">
          Write to us about an account, a charge or a file
        </h1>

        {support === null ? (
          <div
            className="mt-8 rounded-xl border border-neutral-200/80 bg-surface p-6"
            data-testid="contact-pending"
          >
            <p className="text-[1rem] leading-relaxed text-neutral-700">
              Our support address is not published yet. It will appear on this page, and
              in the terms and the privacy notice, as soon as it is.
            </p>
            <p className="mt-3 text-[1rem] leading-relaxed text-neutral-700">
              Meanwhile most of what people write in about can be done from the account
              itself:
            </p>
          </div>
        ) : (
          <div
            className="mt-8 rounded-xl border border-neutral-200/80 bg-surface p-6"
            data-testid="contact-address"
          >
            <p className="flex items-center gap-2.5 text-[1.0625rem] font-medium text-neutral-900">
              <Icon name="mail" size={18} className="text-accent-700" />
              <a
                href={`mailto:${support}`}
                className="text-accent-700 underline underline-offset-2"
              >
                {support}
              </a>
            </p>
            {privacy === null ? null : (
              <p className="mt-3 text-[0.9375rem] text-neutral-700">
                Privacy requests, including access, correction and erasure:{" "}
                <a href={`mailto:${privacy}`} className="text-accent-700 underline">
                  {privacy}
                </a>
              </p>
            )}
            <p className="mt-4 text-[0.9375rem] leading-relaxed text-neutral-600">
              Write from the address your account uses, so the account can be found
              without asking you for anything else, and say which company and which month
              it is about. Never send a password: nobody here will ask for one. There is
              no need to attach a file either — no person on our side can open the ones
              you uploaded, and none needs to.
            </p>
          </div>
        )}

        <h2 className="display mt-12 text-[1.25rem] font-semibold tracking-tight text-neutral-900">
          Most answers are already in your account
        </h2>
        <ul className="mt-5 flex flex-col gap-3">
          {SELF_SERVE.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="group flex items-start justify-between gap-4 rounded-xl border border-neutral-200/80 bg-surface p-4 hover:border-accent-200"
              >
                <span>
                  <span className="block text-[0.9375rem] font-medium text-neutral-900 group-hover:text-accent-700">
                    {item.label}
                  </span>
                  <span className="mt-1 block text-[0.875rem] leading-relaxed text-neutral-600">
                    {item.body}
                  </span>
                </span>
                <Icon
                  name="arrow-right"
                  size={16}
                  className="mt-1 shrink-0 text-neutral-400"
                />
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-8 text-[0.9375rem] leading-relaxed text-neutral-600">
          How the product works, what it costs and how your files are kept are on{" "}
          <Link href="/how-it-works" className="text-accent-700 underline">
            How it works
          </Link>
          ,{" "}
          <Link href="/pricing" className="text-accent-700 underline">
            Credit packs
          </Link>{" "}
          and{" "}
          <Link href="/security" className="text-accent-700 underline">
            Security
          </Link>
          . The{" "}
          <Link href="/legal/privacy" className="text-accent-700 underline">
            privacy notice
          </Link>{" "}
          names the grievance officer.
        </p>
      </div>
    </PublicShell>
  );
}
