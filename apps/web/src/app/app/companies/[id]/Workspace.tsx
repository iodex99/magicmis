"use client";

import type { NumberFormatOptions } from "@magicmis/core/format";
import type { PeriodId } from "@magicmis/core/time";
import { companyFormat, metricLabel } from "@magicmis/render-dashboard";
import { useCallback, useState, type ReactNode } from "react";

import { Assistant, type CommentaryRow } from "./Assistant";
import { DashboardClient } from "./DashboardClient";

/**
 * The company workspace (ADR 0033): the dashboard on the left and the assistant beside it, so a
 * question is always asked with the figures in view. Investigate on a dashboard card hands its
 * question straight to the assistant rather than opening another page.
 */
export function Workspace({
  companyId,
  companyName,
  money,
  currencySymbol,
  periods,
  commentaries,
  children,
}: {
  companyId: string;
  companyName: string;
  money: NumberFormatOptions;
  currencySymbol: string;
  periods: readonly string[];
  commentaries: readonly CommentaryRow[];
  /** Workbooks, files and history, below the dashboard. */
  children: ReactNode;
}) {
  const [prefill, setPrefill] = useState<{
    type: "investigate";
    text: string;
    nonce: number;
  } | null>(null);

  const [layoutVersion, setLayoutVersion] = useState(0);
  const layoutChanged = useCallback(() => {
    setLayoutVersion((v) => v + 1);
  }, []);

  const investigate = useCallback(
    (metric: string, period: PeriodId) => {
      const name = metricLabel(metric.split(".")[0] ?? metric);
      setPrefill({
        type: "investigate",
        text: `Why did ${name} move in ${companyFormat(money, currencySymbol).period(period)}? Which ledgers drove the change?`,
        nonce: Date.now(),
      });
    },
    [money, currencySymbol],
  );

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_25rem]">
      <div className="flex min-w-0 flex-col gap-5">
        <DashboardClient
          companyId={companyId}
          onInvestigate={investigate}
          reloadKey={layoutVersion}
        />
        {children}
      </div>
      <div className="xl:sticky xl:top-7">
        <Assistant
          companyId={companyId}
          companyName={companyName}
          money={money}
          currencySymbol={currencySymbol}
          periods={periods}
          commentaries={commentaries}
          prefill={prefill}
          onLayoutChanged={layoutChanged}
        />
      </div>
    </div>
  );
}
