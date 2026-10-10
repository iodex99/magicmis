"use client";

import { useCallback, useState, type ComponentProps } from "react";

import { Panel } from "@/components/ui";

import { ReportingConventions, type Conventions } from "./ReportingConventions";
import { JobRunner } from "./run/JobRunner";

/**
 * A company's first setup: its conventions, then its files (ADR 0091).
 *
 * The conventions sat below the button whose run they decide, with their own Save, and a year
 * changed there and not saved was silently ignored by the build. They now come first, and the
 * button waits while anything in them is unsaved — saving is free and reads no data, so the
 * wait costs nothing but the press.
 */
export function SetupRunner({
  companyId,
  current,
  runner,
}: {
  companyId: string;
  current: Conventions;
  runner: Omit<ComponentProps<typeof JobRunner>, "blocked">;
}) {
  const [unsaved, setUnsaved] = useState(false);
  const onChanged = useCallback((changed: boolean) => {
    setUnsaved(changed);
  }, []);
  return (
    <>
      {/* Open, not folded away: the financial year has to be right before the first run,
          and a setting nobody sees is a setting nobody checks. */}
      <Panel
        className="mb-5"
        title="Reporting conventions"
        icon="settings"
        description="How this company's own books are kept. Check the financial year before you build: it has to match the files."
      >
        <ReportingConventions
          companyId={companyId}
          current={current}
          onChanged={onChanged}
        />
      </Panel>
      <JobRunner
        {...runner}
        blocked={
          unsaved
            ? "Save the conventions above first: the year and currency they set decide every figure."
            : null
        }
      />
    </>
  );
}
