"use client";

import type { ReportingConventions } from "@magicmis/core/reporting-conventions";
import { useState } from "react";

import { Icon, type IconName } from "@/components/Icon";
import { Badge, Button } from "@/components/ui";

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
    body: "A checked workbook, a live dashboard and an assistant that knows the books.",
  },
];

/**
 * Adding a company, given the room it deserves: it is the first thing a new account does and
 * the start of everything else. With no companies yet the form is open; with some, it waits
 * behind one clear button and opens in place.
 */
export function AddCompany({
  defaults,
  startOpen,
}: {
  defaults: ReportingConventions;
  startOpen: boolean;
}) {
  const [open, setOpen] = useState(startOpen);

  if (!open)
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        className="group flex w-full items-center gap-4 rounded-2xl border-2 border-dashed border-neutral-200 bg-white px-6 py-5 text-left transition-colors hover:border-accent-300 hover:bg-accent-50/40"
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-600 text-white transition-transform group-hover:scale-105">
          <Icon name="plus" size={20} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[1rem] font-semibold text-neutral-900">
            Add a company
          </span>
          <span className="block text-[0.8125rem] text-neutral-500">
            Name it, drop in its trial balances, and its MIS is built.
          </span>
        </span>
        <Icon
          name="arrow-right"
          size={18}
          className="text-neutral-400 group-hover:text-accent-600"
        />
      </button>
    );

  return (
    <section
      className="overflow-hidden rounded-2xl border border-neutral-200/80 bg-white shadow-sm"
      data-testid="add-company"
    >
      <div className="grid items-center gap-10 p-8 lg:grid-cols-[minmax(0,1fr)_26rem] lg:p-12">
        <div>
          <Badge tone="accent">{startOpen ? "Start here" : "New company"}</Badge>
          <h2 className="mt-4 text-[2rem] leading-[1.15] font-semibold tracking-tight text-neutral-900 sm:text-[2.375rem]">
            Add a company. Its MIS is minutes away.
          </h2>
          <p className="mt-4 max-w-xl text-[1rem] leading-relaxed text-neutral-600">
            One company holds one MIS: its ledger mapping, every month you give it, and
            everything it produces. Adding it is free.
          </p>
          <ol className="mt-8 flex flex-col gap-4">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex items-start gap-3.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-accent-600">
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

        <div className="rounded-2xl border border-neutral-200/80 bg-white p-6 shadow-lg">
          <div className="mb-5 flex items-center justify-between">
            <p className="text-[1.0625rem] font-semibold text-neutral-900">
              Company details
            </p>
            {startOpen ? null : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setOpen(false);
                }}
              >
                Cancel
              </Button>
            )}
          </div>
          <NewCompanyForm defaults={defaults} autoFocus={!startOpen} />
        </div>
      </div>
    </section>
  );
}
