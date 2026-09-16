import Link from "next/link";
import type { Metadata } from "next";

import { Sparkline } from "@/components/Charts";
import { Icon, type IconName } from "@/components/Icon";
import { Faqs } from "@/components/Marketing";
import { PublicShell } from "@/components/PublicShell";
import {
  FaqSchema,
  OrganizationSchema,
  SoftwareApplicationSchema,
  type Faq,
} from "@/components/StructuredData";
import { Badge, ButtonLink } from "@/components/ui";
import { PRODUCT_NAME } from "@/lib/brand";
import { PUBLIC_PAGES, pageMetadata, publicPage } from "@/lib/seo";

export const metadata: Metadata = pageMetadata("/");

/**
 * Public home.
 *
 * SPEC §2.3 allows public marketing samples on **fictional** data only, and nothing here
 * is computed from anyone's figures -- the illustration below is invented and says so.
 * SPEC §32 keeps the marketing site to distinct pages rather than one long scroll; this
 * is the entry point, and each of the others is linked from here.
 *
 * No testimonials, customer logos or usage counts: there are no customers yet. Every claim
 * on this page is one the product can be held to today.
 */

const STEPS: readonly { icon: IconName; title: string; body: string }[] = [
  {
    icon: "upload",
    title: "Load your exports",
    body: "Trial balances, ledgers and registers as your accounting system exports them. Files are read in your browser and never uploaded.",
  },
  {
    icon: "table",
    title: "Confirm the mapping once",
    body: "Ledgers are matched to a standard reporting schema. You review and correct it the first time; later months reuse it.",
  },
  {
    icon: "check-circle",
    title: "Take the workbook",
    body: "A validated Excel workbook with live formulas, a dashboard and written commentary. Every figure traces to its source.",
  },
];

const PROOF: readonly { icon: IconName; title: string; body: string; href: string }[] = [
  {
    icon: "shield",
    title: "Raw files stay in your browser",
    body: "The server receives redacted structural profiles and aggregates. Party names are re-inserted locally, in the workbook you download.",
    href: "/security",
  },
  {
    icon: "check",
    title: "Every number is computed, not written",
    body: "Figures come from a deterministic engine and are inserted into commentary through placeholders. The model never writes a number.",
    href: "/how-it-works",
  },
  {
    icon: "wallet",
    title: "You see the price before it is charged",
    body: "Prepaid credits, a fixed price per action, confirmed before anything runs. No subscription, no negative balance.",
    href: "/pricing",
  },
];

/** The guides, linked from here so a reader who arrived on one can find the rest. */
const GUIDES = [
  "/management-accounts",
  "/mis-report-format",
  "/tally-mis-report",
  "/for-accountants",
] as const;

const FAQS: readonly Faq[] = [
  {
    question: `What does ${PRODUCT_NAME} do?`,
    answer:
      "It turns your accounting exports — a trial balance, and optionally ledgers and registers — into a monthly management report: a validated Excel workbook with live formulas, a dashboard and written commentary, where every figure traces back to the ledger it came from. India calls this an MIS report and the UK calls it management accounts.",
  },
  {
    question: "Does my accounting data get uploaded?",
    answer:
      "No. Files are parsed and queried in your browser. The server receives a redacted structural profile and aggregate figures for the action you paid for — never the raw file, and never the party names, which are re-inserted locally in the workbook you download.",
  },
  {
    question: "Is there a free trial?",
    answer:
      "No. There is no free tier, trial or free sample on your own data. Creating an account, adding a company and reading the price book cost nothing; anything that produces analysis or output is a paid action, priced before it runs.",
  },
  {
    question: "How much does a monthly report cost?",
    answer:
      "Each action has a fixed price in credits from a published price book, and one credit is one rupee excluding GST. A monthly refresh on unchanged ledger structure is much cheaper than the first setup, because it reuses the mapping and makes no AI calls at all.",
  },
  {
    question: "Which accounting systems does it work with?",
    answer:
      "No. There is no connector and nothing to install. You export a trial balance from your accounting system as you would anyway — Tally, Xero, QuickBooks, Sage, Zoho Books or anything else that writes Excel or CSV — and load the file in your browser. Columns are read by their headers, never by position.",
  },
  {
    question: "Can several people in my firm use one account?",
    answer:
      "No. One account is one login, with a single active session — a new sign-in ends the previous one. There are no team members, roles, invitations or share links.",
  },
];

export default function HomePage() {
  return (
    <PublicShell>
      <OrganizationSchema />
      <SoftwareApplicationSchema />
      <FaqSchema faqs={FAQS} />

      <section className="mx-auto w-full max-w-[1120px] px-6 pt-16 pb-14 sm:pt-24">
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_26rem]">
          <div>
            <Badge tone="accent">For accountants and finance teams</Badge>
            <h1 className="mt-5 text-[2.5rem] leading-[1.1] font-semibold tracking-tight text-neutral-900 sm:text-[3.25rem]">
              The monthly management report, built from the exports you already have.
            </h1>
            <p className="mt-5 max-w-xl text-[1.0625rem] leading-relaxed text-neutral-600">
              {PRODUCT_NAME} turns a trial balance from any accounting system into a
              validated Excel workbook with live formulas, a dashboard and written
              commentary — and does it again next month without being re-taught. Called an
              MIS in India and management accounts in the UK; it is the same monthly
              report either way.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <ButtonLink href="/sign-up" size="lg" iconAfter="arrow-right">
                Create an account
              </ButtonLink>
              <ButtonLink href="/product" variant="secondary" size="lg" icon="chart">
                See what you get
              </ButtonLink>
            </div>
            <p className="mt-4 text-[0.8125rem] text-neutral-500">
              Prepaid credits, priced per action. No free tier, no trial, no subscription.
            </p>
          </div>

          {/* Illustration only. Fictional figures, stated as such (SPEC §2.3). */}
          <div className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-lg">
            <div className="flex items-center justify-between">
              <div>
                <p className="eyebrow">Revenue · illustration</p>
                <p className="num mt-1.5 text-[1.75rem] leading-none font-semibold text-neutral-900">
                  ₹4,82,15,000
                </p>
              </div>
              <span className="rounded-full bg-positive-subtle px-2.5 py-1 text-[0.75rem] font-medium text-positive">
                ↑ 6.4% vs last month
              </span>
            </div>
            <div className="mt-4">
              <Sparkline
                values={[38, 41, 39, 44, 47, 46, 52, 55, 53, 58, 61, 64]}
                width={340}
                height={82}
              />
            </div>
            <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-neutral-100 pt-4">
              {[
                ["Gross margin", "31.4%"],
                ["Debtor days", "47"],
                ["Checks passed", "12 / 12"],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[0.6875rem] tracking-[0.04em] text-neutral-500 uppercase">
                    {label}
                  </dt>
                  <dd className="num mt-1 text-left text-[0.9375rem] font-semibold text-neutral-900">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-[0.6875rem] text-neutral-400">
              Illustration on fictional data. Not a sample of any customer&rsquo;s
              figures.
            </p>
          </div>
        </div>
      </section>

      <section className="border-y border-neutral-200/70 bg-white">
        <div className="mx-auto w-full max-w-[1120px] px-6 py-14">
          <h2 className="text-[1.375rem] font-semibold tracking-tight text-neutral-900">
            Three steps, then it repeats itself
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-neutral-600">
            The first month teaches the mapping. Every month after that, a refresh on
            unchanged structure needs no review at all.
          </p>
          <ol className="mt-8 grid gap-5 md:grid-cols-3">
            {STEPS.map((step, i) => (
              <li
                key={step.title}
                className="rounded-xl border border-neutral-200/80 bg-neutral-25 p-5"
              >
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-600 text-white">
                    <Icon name={step.icon} size={16} />
                  </span>
                  <span className="text-[0.6875rem] font-semibold tracking-[0.08em] text-neutral-400 uppercase">
                    Step {i + 1}
                  </span>
                </div>
                <h3 className="mt-3.5 text-[0.9375rem] font-semibold text-neutral-900">
                  {step.title}
                </h3>
                <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-neutral-600">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
          <p className="mt-6 text-[0.875rem] text-neutral-600">
            <Link
              href="/how-it-works"
              className="font-medium text-accent-700 hover:underline"
            >
              How each stage works, in detail
            </Link>
          </p>
        </div>
      </section>

      <section className="mx-auto w-full max-w-[1120px] px-6 py-14">
        <div className="grid gap-5 md:grid-cols-3">
          {PROOF.map((item) => (
            <Link
              key={item.title}
              href={item.href}
              className="group flex gap-3.5 rounded-xl p-3 -m-3 hover:bg-white"
            >
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-accent-600">
                <Icon name={item.icon} size={17} />
              </span>
              <div>
                <h3 className="text-[0.9375rem] font-semibold text-neutral-900 group-hover:text-accent-700">
                  {item.title}
                </h3>
                <p className="mt-1 text-[0.8125rem] leading-relaxed text-neutral-600">
                  {item.body}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="border-t border-neutral-200/70 bg-white">
        <div className="mx-auto w-full max-w-[1120px] px-6 py-14">
          <h2 className="text-[1.375rem] font-semibold tracking-tight text-neutral-900">
            Guides
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-neutral-600">
            Written to be useful whether or not you ever use the product.
          </p>
          <ul className="mt-8 grid gap-5 md:grid-cols-3">
            {GUIDES.map((path) => {
              const page = publicPage(path);
              return (
                <li key={path}>
                  <Link
                    href={path}
                    className="group flex h-full flex-col rounded-xl border border-neutral-200/80 bg-neutral-25 p-5 hover:border-accent-200"
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
            })}
          </ul>
        </div>
      </section>

      <section className="mx-auto w-full max-w-[760px] px-6 py-14">
        <h2 className="text-[1.375rem] font-semibold tracking-tight text-neutral-900">
          Common questions
        </h2>
        <div className="mt-6">
          <Faqs faqs={FAQS} />
        </div>
      </section>

      <section className="mx-auto w-full max-w-[1120px] px-6 pb-20">
        <div className="on-ink flex flex-wrap items-center justify-between gap-6 rounded-2xl bg-ink-900 px-8 py-9">
          <div>
            <h2 className="text-[1.375rem] font-semibold tracking-tight text-white">
              Start with one company
            </h2>
            <p className="mt-1.5 max-w-lg text-[0.875rem] text-neutral-300">
              Creating an account and adding a company cost nothing. You buy credits when
              you are ready to run something, and confirm the price before it runs.
            </p>
          </div>
          <Link
            href="/sign-up"
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-white px-5 text-[0.9375rem] font-semibold text-ink-900 hover:bg-neutral-100"
          >
            Get started
            <Icon name="arrow-right" size={16} />
          </Link>
        </div>
      </section>

      {/* Every public page is reachable from the home page: a page nothing links to is a
          page a crawler has to be told about twice, and a reader never finds at all. */}
      <nav aria-label="All pages" className="sr-only">
        <ul>
          {PUBLIC_PAGES.map((page) => (
            <li key={page.path}>
              <Link href={page.path}>{page.title}</Link>
            </li>
          ))}
        </ul>
      </nav>
    </PublicShell>
  );
}
