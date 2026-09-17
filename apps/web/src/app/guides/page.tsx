import Link from "next/link";
import type { Metadata } from "next";

import { Icon } from "@/components/Icon";
import { ClosingCta, MarketingHeader } from "@/components/Marketing";
import { PublicShell } from "@/components/PublicShell";
import { BreadcrumbSchema } from "@/components/StructuredData";
import { GUIDE_PATHS, SOLUTION_PATHS, pageMetadata, publicPage } from "@/lib/seo";

const PATH = "/guides";
export const metadata: Metadata = pageMetadata(PATH);

/**
 * The guides index: every guide from one page, so a crawler reaches each within two links of
 * the home page and a reader who finished one has the rest in front of them.
 */
function Card({ path }: { path: string }) {
  const page = publicPage(path);
  return (
    <li>
      <Link
        href={path}
        className="group flex h-full flex-col rounded-xl border border-neutral-200/80 bg-surface p-5 hover:border-accent-200"
      >
        <h3 className="text-[0.9375rem] font-semibold text-neutral-900 group-hover:text-accent-700">
          {page.title.split(":")[0]}
        </h3>
        <p className="mt-2 flex-1 text-[0.8125rem] leading-relaxed text-neutral-600">
          {page.description}
        </p>
        <span className="mt-4 inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-accent-700">
          Read
          <Icon name="arrow-right" size={14} />
        </span>
      </Link>
    </li>
  );
}

export default function GuidesPage() {
  return (
    <PublicShell>
      <BreadcrumbSchema path={PATH} />
      <MarketingHeader
        path={PATH}
        eyebrow="Guides"
        heading="Guides to monthly management reporting"
        intro="The monthly report goes by a different name in each market — an MIS report in India, management accounts in the UK, monthly financial reporting in the US — but the work is the same. These guides cover that work, and are written to be useful whether or not you ever use the product."
      />

      <section className="mx-auto w-full max-w-[1120px] px-6 py-6">
        <h2 className="text-[1.125rem] font-semibold tracking-tight text-neutral-900">
          Preparing the report
        </h2>
        <ul className="mt-5 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {GUIDE_PATHS.map((path) => (
            <Card key={path} path={path} />
          ))}
        </ul>
      </section>

      <section className="mx-auto w-full max-w-[1120px] px-6 py-10">
        <h2 className="text-[1.125rem] font-semibold tracking-tight text-neutral-900">
          Automating it
        </h2>
        <ul className="mt-5 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {SOLUTION_PATHS.map((path) => (
            <Card key={path} path={path} />
          ))}
        </ul>
      </section>

      <ClosingCta />
    </PublicShell>
  );
}
