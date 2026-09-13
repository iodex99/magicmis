"use client";

/**
 * One ECharts instance for a spec-built option (SPEC §24.2). The option comes from
 * `buildWidgetView`, never from generated code. A click reports the series and point so the page
 * can open that value's lineage.
 */

import type { EChartsOption, EChartsType } from "echarts";
import { useEffect, useRef } from "react";

export function EChart({
  option,
  onPoint,
  label,
}: {
  option: EChartsOption;
  onPoint: (seriesIndex: number, dataIndex: number) => void;
  label: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<EChartsType | null>(null);
  const handler = useRef(onPoint);
  handler.current = onPoint;
  const latest = useRef(option);
  latest.current = option;

  useEffect(() => {
    let disposed = false;
    const node = el.current;
    if (node === null) return;
    // Loaded on the client only; ECharts touches the DOM at import.
    void import("echarts").then((echarts) => {
      if (disposed) return;
      const instance = echarts.init(node, undefined, { renderer: "canvas" });
      chart.current = instance;
      instance.on("click", (params) => {
        handler.current(params.seriesIndex ?? 0, params.dataIndex);
      });
      instance.setOption(latest.current);
    });
    const resize = () => chart.current?.resize();
    window.addEventListener("resize", resize);
    return () => {
      disposed = true;
      window.removeEventListener("resize", resize);
      chart.current?.dispose();
      chart.current = null;
    };
    // The instance is created once; later option changes are applied by the effect below.
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, true);
  }, [option]);

  return (
    <div ref={el} role="img" aria-label={label} className="h-full min-h-48 w-full" />
  );
}
