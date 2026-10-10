import Link from "next/link";

import { MONTHS_TO_ADD } from "@/lib/job-display";

import { Icon } from "./Icon";

/**
 * First-run guidance.
 *
 * A new account used to land on an empty page with no companies, no credits and no files,
 * and nothing telling it which of those to fix first. This says so, in order, and takes
 * itself off the page once the account has produced its first workbook.
 */
export interface FirstRunState {
  readonly hasCompany: boolean;
  readonly hasCredits: boolean;
  readonly hasRun: boolean;
  /** Unspent welcome credits, formatted, or null when there are none (ADR 0068). */
  readonly welcomeCredits?: string | null;
}

export function GetStarted({
  state,
  firstCompanyId,
}: {
  state: FirstRunState;
  firstCompanyId: string | null;
}) {
  if (state.hasRun) return null;

  const steps = [
    {
      done: state.hasCompany,
      title: "Add a company",
      body: "One company holds one MIS: its mappings, its months and everything it produces. Adding it is free.",
      action: null,
    },
    state.welcomeCredits !== undefined && state.welcomeCredits !== null
      ? {
          done: true,
          // Done, but a gift rather than a task: shown with its amount, never struck through.
          gift: true,
          title: "Welcome credits in your wallet",
          body: `${state.welcomeCredits} credits are on us. Each action is paid from them first, at the price it shows before you press it.`,
          action: null,
        }
      : {
          done: state.hasCredits,
          title: "Put credits in your wallet",
          body: "Credits pay for each action as you use it. The wallet shows what a pack costs in your own currency before you buy.",
          action: { href: "/wallet", label: "Add credits" },
        },
    {
      done: false,
      title: "Run your first MIS",
      body: `${MONTHS_TO_ADD} Press Build and the workbook, dashboard and assistant follow.`,
      action:
        state.hasCompany && firstCompanyId !== null
          ? { href: `/app/companies/${firstCompanyId}`, label: "Start" }
          : null,
    },
  ];

  // The step to point at: the first one not yet done.
  const current = steps.findIndex((s) => !s.done);

  return (
    <section className="mb-6 overflow-hidden rounded-xl border border-accent-100 bg-accent-50/50">
      <header className="flex items-center gap-2.5 px-5 pt-5">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-600 text-white">
          <Icon name="play" size={14} />
        </span>
        <h2 className="text-[0.9375rem] font-semibold text-neutral-900">
          Getting started
        </h2>
        <span className="text-[0.8125rem] text-neutral-500">
          {steps.filter((s) => s.done).length} of 3 done
        </span>
      </header>
      <ol className="grid gap-3 p-5 md:grid-cols-3">
        {steps.map((step, i) => {
          const isCurrent = i === current;
          return (
            <li
              key={step.title}
              className={`rounded-xl border bg-surface p-4 ${
                isCurrent ? "border-accent-300 shadow-sm" : "border-neutral-200/70"
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-[0.6875rem] font-semibold ${
                    step.done
                      ? "bg-positive text-white"
                      : isCurrent
                        ? "bg-accent-600 text-white"
                        : "bg-neutral-100 text-neutral-500"
                  }`}
                >
                  {step.done ? <Icon name="check" size={11} /> : i + 1}
                </span>
                <h3
                  className={`text-[0.875rem] font-semibold ${
                    step.done && !("gift" in step)
                      ? "text-neutral-500 line-through"
                      : "text-neutral-900"
                  }`}
                >
                  {step.title}
                </h3>
              </div>
              {step.done && !("gift" in step) ? null : (
                <>
                  <p className="mt-2 text-[0.8125rem] leading-relaxed text-neutral-600">
                    {step.body}
                  </p>
                  {step.action === null ? null : (
                    <Link
                      href={step.action.href}
                      className="mt-3 inline-flex items-center gap-1 text-[0.8125rem] font-semibold text-accent-700 hover:underline"
                    >
                      {step.action.label}
                      <Icon name="arrow-right" size={13} />
                    </Link>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
