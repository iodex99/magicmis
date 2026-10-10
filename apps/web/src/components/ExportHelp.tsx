"use client";

import { useState } from "react";

import { Drawer } from "@/components/Drawer";
import { Icon } from "@/components/Icon";
import { Button } from "@/components/ui";
import { EXPORT_HELP, EXPORT_TIPS } from "@/lib/export-help";

/**
 * "Which file do I export?", on the screen that asks for the files (ADR 0087). One system at a
 * time, the answer its public guide gives, and a link to that guide for the rest.
 */
export function ExportHelp() {
  const [open, setOpen] = useState(false);
  const [system, setSystem] = useState(EXPORT_HELP[0]?.id ?? "other");
  const help = EXPORT_HELP.find((h) => h.id === system) ?? EXPORT_HELP[0];
  return (
    <>
      <button
        type="button"
        className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-accent-700 hover:underline"
        onClick={() => {
          setOpen(true);
        }}
        data-testid="export-help-open"
      >
        <Icon name="info" size={14} />
        Which file do I export?
      </button>
      <Drawer
        open={open}
        label="Which file to export"
        onClose={() => {
          setOpen(false);
        }}
      >
        <div className="flex flex-col gap-5" data-testid="export-help">
          <div>
            <h2 className="text-[1.0625rem] font-semibold text-neutral-900">
              Which file to export
            </h2>
            <p className="mt-1 text-[0.8125rem] leading-relaxed text-neutral-600">
              Choose the system the books are kept in.
            </p>
          </div>
          <div
            className="flex flex-wrap gap-1.5"
            role="radiogroup"
            aria-label="Accounting system"
          >
            {EXPORT_HELP.map((h) => (
              <button
                key={h.id}
                type="button"
                role="radio"
                aria-checked={system === h.id}
                onClick={() => {
                  setSystem(h.id);
                }}
                className={`rounded-full border px-3 py-1 text-[0.8125rem] font-medium transition-colors ${
                  system === h.id
                    ? "border-accent-600 bg-accent-600 text-white"
                    : "border-neutral-200 text-neutral-700 hover:border-neutral-300"
                }`}
              >
                {h.system}
              </button>
            ))}
          </div>
          {help === undefined ? null : (
            <div className="flex flex-col gap-3 text-sm leading-relaxed text-neutral-800">
              <p data-testid="export-help-essential">
                <strong className="font-semibold">Enough on its own: </strong>
                {help.essential}
              </p>
              <p className="text-neutral-600">{help.extras}</p>
              <a
                href={help.guide}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-fit items-center gap-1 text-[0.8125rem] font-medium text-accent-700 hover:underline"
              >
                The full guide for {help.system}
                <Icon name="arrow-right" size={13} />
              </a>
            </div>
          )}
          <div className="rounded-xl border border-neutral-200/80 bg-neutral-25 p-4">
            <p className="text-[0.75rem] font-semibold tracking-[0.06em] text-neutral-500 uppercase">
              Whatever the system
            </p>
            <ul className="mt-2 flex flex-col gap-1.5 text-[0.8125rem] text-neutral-700">
              {EXPORT_TIPS.map((t) => (
                <li key={t} className="flex items-start gap-2">
                  <Icon
                    name="check"
                    size={13}
                    className="mt-0.5 shrink-0 text-positive"
                  />
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <Button
            variant="ghost"
            onClick={() => {
              setOpen(false);
            }}
          >
            Close
          </Button>
        </div>
      </Drawer>
    </>
  );
}
