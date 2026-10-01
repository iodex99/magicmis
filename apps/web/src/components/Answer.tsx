import Link from "next/link";
import type { ReactNode } from "react";

import { Icon } from "@/components/Icon";
import { ButtonLink } from "@/components/ui";
import { PRODUCT_NAME } from "@/lib/brand";

/**
 * The opening of a one-question page (ADR 0079): the question as the only heading, then the
 * answer, before anything else on the page. A searcher, and an assistant skimming the page for
 * something to repeat, has one question; the first sentence they reach should answer it. The
 * account button comes after the answer, never before it.
 */
export function QuestionHeader({
  topic,
  topicPath,
  question,
  children,
}: {
  /** The guide this question belongs to, for the trail back. */
  topic: string;
  topicPath: string;
  question: string;
  /** The short answer: two or three sentences that stand on their own. */
  children: ReactNode;
}) {
  return (
    <header className="mx-auto w-full max-w-[760px] px-6 pt-12 pb-6 sm:pt-16">
      <nav aria-label="Breadcrumb" className="text-[0.8125rem] text-neutral-500">
        <Link href="/" className="hover:text-neutral-900">
          {PRODUCT_NAME}
        </Link>
        <span className="mx-2 text-neutral-300">/</span>
        <Link href={topicPath} className="hover:text-neutral-900">
          {topic}
        </Link>
      </nav>
      <h1 className="mt-6 text-[2rem] leading-[1.15] font-semibold tracking-tight text-neutral-900 sm:text-[2.5rem]">
        {question}
      </h1>
      <div className="mt-6 rounded-xl border-l-4 border-accent-500 bg-surface px-5 py-4">
        <p className="text-[0.75rem] font-medium tracking-wide text-accent-700 uppercase">
          The short answer
        </p>
        <div className="mt-2 flex flex-col gap-3 text-[1.0625rem] leading-relaxed text-neutral-800">
          {children}
        </div>
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
        <ButtonLink href="/sign-up" size="sm" iconAfter="arrow-right">
          Create an account
        </ButtonLink>
        <Link
          href="/#tour"
          className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-neutral-600 hover:text-accent-700"
        >
          <Icon name="play" className="size-4" />
          Watch the 40-second tour
        </Link>
      </div>
    </header>
  );
}
