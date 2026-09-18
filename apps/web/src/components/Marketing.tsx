import Link from "next/link";
import type { ReactNode } from "react";

import { Icon, type IconName } from "@/components/Icon";
import { TourPlayer } from "@/components/TourPlayer";
import { ButtonLink } from "@/components/ui";
import { PRODUCT_NAME } from "@/lib/brand";
import { publicPage, REPORT_NAMES } from "@/lib/seo";

/**
 * Shared furniture for the public pages (SPEC §32).
 *
 * The marketing site is several distinct pages rather than one long scroll, which only
 * works if they feel like one site: the same measure, the same heading scale, the same
 * closing step. That is what lives here.
 *
 * Nothing in this file renders a figure. Anything numeric on a public page is fictional by
 * §2.3 and has to say so where it appears, so it stays in the page that shows it.
 */

/** A page's opening: the trail back, the title, and the sentence under it. */
export function MarketingHeader({
  path,
  eyebrow,
  heading,
  intro,
}: {
  path: string;
  eyebrow: string;
  heading: string;
  intro: string;
}) {
  return (
    <header className="mx-auto w-full max-w-[760px] px-6 pt-12 pb-8 sm:pt-16">
      <nav aria-label="Breadcrumb" className="text-[0.8125rem] text-neutral-500">
        <Link href="/" className="hover:text-neutral-900">
          {PRODUCT_NAME}
        </Link>
        <span className="mx-2 text-neutral-300">/</span>
        {path.startsWith("/guides/") ? (
          <>
            <Link href="/guides" className="hover:text-neutral-900">
              Guides
            </Link>
            <span className="mx-2 text-neutral-300">/</span>
          </>
        ) : null}
        <span className="text-neutral-700">{publicPage(path).title.split(":")[0]}</span>
      </nav>
      <p className="mt-6 text-[0.8125rem] font-medium tracking-wide text-accent-700 uppercase">
        {eyebrow}
      </p>
      <h1 className="mt-3 text-[2rem] leading-[1.15] font-semibold tracking-tight text-neutral-900 sm:text-[2.75rem]">
        {heading}
      </h1>
      <p className="mt-5 text-[1.0625rem] leading-relaxed text-neutral-600">{intro}</p>
      <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3">
        <ButtonLink href="/sign-up" iconAfter="arrow-right">
          Create an account
        </ButtonLink>
        <Link
          href="/#tour"
          className="inline-flex items-center gap-1.5 text-[0.875rem] font-medium text-neutral-600 hover:text-accent-700"
        >
          <Icon name="play" className="size-4" />
          Watch the 40-second tour
        </Link>
      </div>
      <p className="mt-3 text-[0.8125rem] text-neutral-500">
        Free to create. No subscription, and credits never expire.
      </p>
    </header>
  );
}

/** A titled block of prose at reading measure. */
export function Section({
  title,
  id,
  children,
}: {
  title?: string | undefined;
  id?: string | undefined;
  children: ReactNode;
}) {
  return (
    <section id={id} className="mx-auto w-full max-w-[760px] px-6 py-7">
      {title === undefined ? null : (
        <h2 className="text-[1.375rem] font-semibold tracking-tight text-neutral-900">
          {title}
        </h2>
      )}
      <div className="mt-4 flex flex-col gap-4 text-[1rem] leading-relaxed text-neutral-700">
        {children}
      </div>
    </section>
  );
}

/** A wider block, for tables and sample output that need more than reading measure. */
export function WideSection({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string | undefined;
  children: ReactNode;
}) {
  return (
    <section className="mx-auto w-full max-w-[1120px] px-6 py-10">
      <div className="mx-auto max-w-[760px]">
        <h2 className="text-[1.375rem] font-semibold tracking-tight text-neutral-900">
          {title}
        </h2>
        {intro === undefined ? null : (
          <p className="mt-3 text-[1rem] leading-relaxed text-neutral-600">{intro}</p>
        )}
      </div>
      <div className="mt-7">{children}</div>
    </section>
  );
}

/** A numbered list of things the reader does, in order. */
export function Steps({
  steps,
}: {
  steps: readonly { title: string; body: string; icon: IconName }[];
}) {
  return (
    <ol className="flex flex-col gap-4">
      {steps.map((step, i) => (
        <li
          key={step.title}
          className="flex gap-4 rounded-xl border border-neutral-200/80 bg-surface p-5"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-accent-700">
            <Icon name={step.icon} size={18} />
          </span>
          <div>
            <h3 className="text-[0.9375rem] font-semibold text-neutral-900">
              <span className="text-neutral-400">{i + 1}. </span>
              {step.title}
            </h3>
            <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-neutral-600">
              {step.body}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * Questions and answers, rendered as real `<details>`.
 *
 * Whatever is listed here must also be in the page's `FaqSchema`: a rich result promising
 * an answer the page does not contain is the kind of thing that earns a manual action, and
 * it wastes the reader's click either way.
 */
export function Faqs({
  faqs,
}: {
  faqs: readonly { question: string; answer: string }[];
}) {
  return (
    <div className="divide-y divide-neutral-200/80 overflow-hidden rounded-xl border border-neutral-200/80 bg-surface">
      {faqs.map((faq) => (
        <details key={faq.question} className="group p-5 open:bg-neutral-50/60">
          <summary className="flex cursor-pointer list-none items-start justify-between gap-4 text-[0.9375rem] font-medium text-neutral-900">
            {faq.question}
            <span className="mt-0.5 shrink-0 text-neutral-400 transition-transform group-open:rotate-180">
              <Icon name="chevron-down" size={18} />
            </span>
          </summary>
          <p className="mt-3 text-[0.9375rem] leading-relaxed text-neutral-600">
            {faq.answer}
          </p>
        </details>
      ))}
    </div>
  );
}

/**
 * The label that has to sit beside every number on a public page.
 *
 * §2.3 permits marketing samples on fictional data and nothing else. The rule is only
 * honoured if the reader can tell, so this is deliberately plain rather than a footnote.
 */
export function FictionalNote({ children }: { children?: ReactNode }) {
  return (
    <p className="mt-3 flex items-start gap-2 text-[0.8125rem] text-neutral-500">
      <span className="mt-0.5 shrink-0 text-neutral-400">
        <Icon name="info" size={14} />
      </span>
      <span>
        {children ?? (
          <>
            Every figure shown here is invented for illustration. Nothing on this page is
            computed from anyone&rsquo;s accounts.
          </>
        )}
      </span>
    </p>
  );
}

/** The same closing step on every page, so the reader never has to look for it. */
export function ClosingCta({
  heading = "See it on your own month",
  body = "Create an account, load last month's trial balance, and get the report — paid per action.",
}: {
  heading?: string | undefined;
  body?: string | undefined;
}) {
  return (
    <section className="mx-auto w-full max-w-[1120px] px-6 py-14">
      <div className="rounded-2xl border border-neutral-200/80 bg-surface p-8 sm:p-10">
        <div className="mx-auto max-w-[620px] text-center">
          <h2 className="text-[1.5rem] font-semibold tracking-tight text-neutral-900">
            {heading}
          </h2>
          <p className="mt-3 text-[1rem] leading-relaxed text-neutral-600">{body}</p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <ButtonLink href="/sign-up" size="lg" iconAfter="arrow-right">
              Create an account
            </ButtonLink>
            <ButtonLink href="/pricing" size="lg" variant="secondary">
              See credit packs
            </ButtonLink>
          </div>
          <p className="mt-4 text-[0.8125rem] text-neutral-500">
            Prepaid credits, no subscription. Credits never expire.
          </p>
        </div>
      </div>
    </section>
  );
}

/**
 * The ask in the middle of a long page. A reader who is convinced halfway down
 * should not have to scroll to the foot to act on it, and one who is not yet convinced is
 * offered the thing that convinces without a sign-up: the sample workbook.
 */
export function MidCta() {
  return (
    <aside className="mx-auto w-full max-w-[760px] px-6 py-4">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-accent-200 bg-accent-50/50 px-5 py-4">
        <p className="min-w-0 flex-1 text-[0.9375rem] font-medium text-neutral-900">
          See it on a month you have already closed.
        </p>
        <div className="flex flex-wrap items-center gap-2.5">
          <ButtonLink href="/sign-up" size="sm" iconAfter="arrow-right">
            Try it on your own month
          </ButtonLink>
          <ButtonLink
            href="/mis-report-template"
            size="sm"
            variant="secondary"
            icon="download"
          >
            Download a sample
          </ButtonLink>
        </div>
      </div>
    </aside>
  );
}

/** Cross-links at the foot of a guide, so a reader who came from search has somewhere next. */
export function ReadNext({ paths }: { paths: readonly string[] }) {
  return (
    <section className="mx-auto w-full max-w-[760px] px-6 pb-4">
      <h2 className="text-[0.8125rem] font-medium tracking-wide text-neutral-500 uppercase">
        Read next
      </h2>
      <ul className="mt-3 divide-y divide-neutral-200/80 overflow-hidden rounded-xl border border-neutral-200/80 bg-surface">
        {paths.map((path) => {
          const page = publicPage(path);
          return (
            <li key={path}>
              <Link
                href={path}
                className="flex items-start justify-between gap-4 p-4 hover:bg-neutral-50"
              >
                <span>
                  <span className="block text-[0.9375rem] font-medium text-neutral-900">
                    {page.title}
                  </span>
                  <span className="mt-1 block text-[0.8125rem] leading-relaxed text-neutral-500">
                    {page.description}
                  </span>
                </span>
                <span className="mt-1 shrink-0 text-neutral-400">
                  <Icon name="arrow-right" size={16} />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The other names this report goes by, with a link to the page written in each (ADR 0038).
 *
 * A reader who searched "management accounts" and landed on the MIS page is on the right
 * page for the wrong reason; this line tells them so in one breath and hands them the one
 * in their own words. It also puts every market's term on every market's page, which is
 * most of what ranking for each of them is.
 */
export function AlsoCalled({ path }: { path: string }) {
  const others = REPORT_NAMES.filter((n) => n.path !== path);
  return (
    <p className="mx-auto w-full max-w-[760px] px-6 pb-6 text-[0.875rem] leading-relaxed text-neutral-500">
      Also called{" "}
      {others.map((n, i) => (
        <span key={n.term}>
          <Link
            href={n.path}
            className="font-medium text-neutral-700 hover:text-accent-700"
          >
            {n.term.toLowerCase()}
          </Link>
          {i < others.length - 2 ? ", " : i === others.length - 2 ? " and " : ""}
        </span>
      ))}
      , depending on where you are.{" "}
      <Link href="/what-is-an-mis-report" className="text-accent-700 hover:underline">
        Every name, explained
      </Link>
      .
    </p>
  );
}

/**
 * The product tour (ADR 0037, ADR 0041), served from `public/brand/` and rendered frame by
 * frame by `e2e/support/record-tour.ts`. It carries no caption (the owner removed it): the
 * film's own closing card says its figures are fictional, which is where SPEC §2.3 needs it said.
 */
export function TourVideo() {
  return (
    <figure className="mx-auto w-full max-w-[960px]">
      <TourPlayer />
    </figure>
  );
}
