import Link from "next/link";

import { Sparkline } from "@/components/Charts";
import { Icon, type IconName } from "@/components/Icon";
import { PublicShell } from "@/components/PublicShell";
import { Badge, ButtonLink } from "@/components/ui";
import { PRODUCT_NAME } from "@/lib/brand";

/**
 * Public home.
 *
 * SPEC §2.3 allows public marketing samples on **fictional** data only, and nothing here
 * is computed from anyone's figures -- the illustration below is invented and says so.
 * SPEC §32 keeps the marketing site to distinct pages rather than one long scroll; this
 * is the entry point, and Pricing is its own page.
 */

const STEPS: readonly { icon: IconName; title: string; body: string }[] = [
  {
    icon: "upload",
    title: "Load your exports",
    body: "Trial balances, ledgers and registers straight out of Tally. Files are read in your browser and never uploaded.",
  },
  {
    icon: "table",
    title: "Confirm the mapping once",
    body: "Ledgers are matched to a canonical MIS schema. You review and correct it the first time; later months reuse it.",
  },
  {
    icon: "check-circle",
    title: "Take the workbook",
    body: "A validated Excel workbook with live formulas, a dashboard and written commentary. Every figure traces to its source.",
  },
];

const PROOF: readonly { icon: IconName; title: string; body: string }[] = [
  {
    icon: "shield",
    title: "Raw files stay in your browser",
    body: "The server receives redacted structural profiles and aggregates. Party names are re-inserted locally, in the workbook you download.",
  },
  {
    icon: "check",
    title: "Every number is computed, not written",
    body: "Figures come from a deterministic engine and are inserted into commentary through placeholders. The model never writes a number.",
  },
  {
    icon: "wallet",
    title: "You see the price before it is charged",
    body: "Prepaid credits, a fixed price per action, confirmed before anything runs. No subscription, no negative balance.",
  },
];

export default function HomePage() {
  return (
    <PublicShell>
      <section className="mx-auto w-full max-w-[1120px] px-6 pt-16 pb-14 sm:pt-24">
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_26rem]">
          <div>
            <Badge tone="accent">For CA firms and finance teams in India</Badge>
            <h1 className="mt-5 text-[2.5rem] leading-[1.1] font-semibold tracking-tight text-neutral-900 sm:text-[3.25rem]">
              The monthly MIS, built from the exports you already have.
            </h1>
            <p className="mt-5 max-w-xl text-[1.0625rem] leading-relaxed text-neutral-600">
              {PRODUCT_NAME} turns trial balances, ledgers and registers into a validated
              Excel workbook with live formulas, a dashboard and management commentary —
              and does it again next month without being re-taught.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <ButtonLink href="/sign-up" size="lg" iconAfter="arrow-right">
                Create an account
              </ButtonLink>
              <ButtonLink href="/pricing" variant="secondary" size="lg" icon="table">
                See the price book
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
        </div>
      </section>

      <section className="mx-auto w-full max-w-[1120px] px-6 py-14">
        <div className="grid gap-5 md:grid-cols-3">
          {PROOF.map((item) => (
            <div key={item.title} className="flex gap-3.5">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-accent-600">
                <Icon name={item.icon} size={17} />
              </span>
              <div>
                <h3 className="text-[0.9375rem] font-semibold text-neutral-900">
                  {item.title}
                </h3>
                <p className="mt-1 text-[0.8125rem] leading-relaxed text-neutral-600">
                  {item.body}
                </p>
              </div>
            </div>
          ))}
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
    </PublicShell>
  );
}
