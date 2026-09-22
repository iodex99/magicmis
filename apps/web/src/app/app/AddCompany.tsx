"use client";

import type { ReportingConventions } from "@magicmis/core/reporting-conventions";

import { Icon, type IconName } from "@/components/Icon";
import { Badge } from "@/components/ui";

import { NewCompanyForm } from "./NewCompanyForm";

const STEPS: readonly { icon: IconName; title: string; body: string }[] = [
  {
    icon: "building",
    title: "Name the company",
    body: "Its reporting conventions are filled in for you.",
  },
  {
    icon: "upload",
    title: "Drop in its trial balances",
    body: "Excel, CSV or PDF, from any accounting software.",
  },
  {
    icon: "chart",
    title: "Get the MIS",
    body: "A live dashboard and an assistant that knows the books.",
  },
];

/**
 * Adding a company, given the room it deserves: it is the first thing a new account does and
 * the start of everything else.
 *
 * **Always open**, whether or not this account already has companies. It used to collapse to a
 * button once the first company existed, which put a click in front of the one action this page
 * is for — and somebody who already has one company is the likeliest person to add another.
 * `first` only changes the wording, never whether the form is there.
 */
export function AddCompany({
  defaults,
  first,
}: {
  defaults: ReportingConventions;
  first: boolean;
}) {
  return (
    <section
      className="overflow-hidden rounded-2xl border border-neutral-200/80 bg-surface shadow-sm"
      data-testid="add-company"
    >
      <div className="grid items-center gap-10 p-8 lg:grid-cols-[minmax(0,1fr)_26rem] lg:p-12">
        <div>
          <Badge tone="accent">{first ? "Start here" : "New company"}</Badge>
          <h2 className="display mt-4 text-[2rem] leading-[1.1] font-semibold text-neutral-900 sm:text-[2.5rem]">
            Add a company. Its MIS is minutes away.
          </h2>
          <p className="mt-4 max-w-xl text-[1rem] leading-relaxed text-neutral-600">
            One company holds one MIS: its ledger mapping, every month you give it, and
            everything it produces. Adding it is free.
          </p>
          <ol className="relative mt-8 flex flex-col gap-5 before:absolute before:top-4 before:bottom-4 before:left-[1.125rem] before:w-px before:bg-neutral-200">
            {STEPS.map((step, i) => (
              <li
                key={step.title}
                className="rise flex items-start gap-3.5"
                style={{ "--i": (i + 1).toString() } as React.CSSProperties}
              >
                <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-accent-600 ring-4 ring-surface">
                  <Icon name={step.icon} size={17} />
                </span>
                <div>
                  <p className="text-[0.9375rem] font-semibold text-neutral-900">
                    <span className="mr-1.5 text-neutral-400">{i + 1}.</span>
                    {step.title}
                  </p>
                  <p className="mt-0.5 text-[0.8125rem] text-neutral-500">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div
          className="rise rounded-2xl border border-neutral-200/80 bg-surface p-6 shadow-lg"
          style={{ "--i": "3" } as React.CSSProperties}
        >
          <div className="mb-5 flex items-center justify-between">
            <p className="text-[1.0625rem] font-semibold text-neutral-900">
              Company details
            </p>
          </div>
          <NewCompanyForm defaults={defaults} autoFocus={!first} />
        </div>
      </div>
    </section>
  );
}
