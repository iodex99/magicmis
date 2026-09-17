import type { ReactNode } from "react";

import { PublicShell } from "@/components/PublicShell";

/**
 * The frame for the terms and the privacy notice (R-10, R-11).
 *
 * The draft note is driven by the document version, not by a hardcoded flag: while the
 * version in `legal.document_versions` ends in `-draft` the page says so, and the moment
 * the owner records a reviewed version the note disappears with no deploy. A legal document
 * that claims to be final before a lawyer has read it is the one thing worse than a draft.
 */
export interface LegalSection {
  readonly id: string;
  readonly title: string;
  readonly body: ReactNode;
}

export function LegalDocument({
  title,
  version,
  lastUpdated,
  intro,
  sections,
}: {
  title: string;
  version: string;
  lastUpdated: string;
  intro: ReactNode;
  sections: readonly LegalSection[];
}) {
  const draft = version.endsWith("-draft");
  return (
    <PublicShell>
      <article className="mx-auto w-full max-w-[760px] px-6 pt-12 pb-20 sm:pt-16">
        <header>
          <h1 className="text-[2rem] leading-tight font-semibold tracking-tight text-neutral-900">
            {title}
          </h1>
          <p className="mt-3 text-[0.8125rem] text-neutral-500">
            Version {version} · Last updated {lastUpdated}
          </p>
          {draft ? (
            <p className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-[0.8125rem] leading-relaxed text-neutral-600">
              This version is awaiting final legal review. It describes how the service
              actually works today; wording may be refined before it is marked final, and
              you will be told of any material change.
            </p>
          ) : null}
          <div className="mt-6 text-[1rem] leading-relaxed text-neutral-700">{intro}</div>
        </header>

        <nav
          aria-label="Contents"
          className="mt-8 rounded-xl border border-neutral-200/80 bg-surface p-5"
        >
          <h2 className="text-[0.75rem] font-medium tracking-wide text-neutral-500 uppercase">
            Contents
          </h2>
          <ol className="mt-3 grid gap-1.5 text-[0.875rem] sm:grid-cols-2">
            {sections.map((s, i) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="text-accent-700 hover:underline">
                  {i + 1}. {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {sections.map((s, i) => (
          <section key={s.id} id={s.id} className="mt-10 scroll-mt-24">
            <h2 className="text-[1.25rem] font-semibold tracking-tight text-neutral-900">
              {i + 1}. {s.title}
            </h2>
            <div className="legal-prose mt-3 flex flex-col gap-3 text-[0.9375rem] leading-relaxed text-neutral-700 [&_li]:ml-5 [&_li]:list-disc [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5">
              {s.body}
            </div>
          </section>
        ))}
      </article>
    </PublicShell>
  );
}

/** A name or detail that is not yet filled in, said honestly rather than left blank. */
export function Pending({ children }: { children: ReactNode }) {
  return <span className="text-neutral-500 italic">{children}</span>;
}
