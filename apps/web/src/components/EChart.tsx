"use client";

/**
 * One ECharts instance for a spec-built option (SPEC §24.2). The option comes from
 * `buildWidgetView`, never from generated code. A click reports the series and point so the page
 * can open that value's lineage.
 *
 * Two things the option cannot know are applied here: the size of the box it is drawn into, which
 * changes when the assistant beside it opens or the window moves, and the theme, whose colours are
 * read from the page's own CSS variables so a chart is never the one light rectangle on a dark
 * screen (ADR 0034).
 */

import type { EChartsOption, EChartsType } from "echarts";
import { useCallback, useEffect, useRef, useState } from "react";

/** The tokens a chart needs, read from the document so there is one source of colour. */
function themeColours(): { axis: string; line: string; surface: string; text: string } {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) =>
    style.getPropertyValue(name).trim() || fallback;
  return {
    axis: token("--color-neutral-500", "#6f6c85"),
    line: token("--color-neutral-100", "#eceaf3"),
    surface: token("--color-surface", "#ffffff"),
    text: token("--color-neutral-800", "#2a2937"),
  };
}

type Part = Record<string, unknown>;

const isPart = (value: unknown): value is Part =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The option, with every colour the theme owns overwritten by the theme's current value. The
 * option is walked as plain objects: `buildWidgetView` writes one axis per chart, and merging
 * through ECharts' union types buys nothing here.
 */
function themed(option: EChartsOption): EChartsOption {
  const c = themeColours();
  const merged: Part = { ...(option as Part) };
  const patch = (key: string, extra: Part) => {
    const value = merged[key];
    if (!isPart(value)) return;
    merged[key] = { ...value, ...extra };
  };
  /** An axis keeps whatever formatter the view gave it; only its colours change. */
  const axis = (key: string, extra: Part) => {
    const value = merged[key];
    if (!isPart(value)) return;
    const label = isPart(value["axisLabel"]) ? value["axisLabel"] : {};
    merged[key] = { ...value, ...extra, axisLabel: { ...label, color: c.axis } };
  };
  axis("xAxis", { axisLine: { lineStyle: { color: c.line } } });
  axis("yAxis", { splitLine: { lineStyle: { color: c.line } } });
  patch("legend", { textStyle: { color: c.axis, fontSize: 11 } });
  patch("tooltip", {
    backgroundColor: c.surface,
    borderColor: c.line,
    textStyle: { color: c.text, fontSize: 12 },
  });
  return merged;
}

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
  /** Bumped when the theme changes, to redraw with the new colours. */
  const [theme, setTheme] = useState(0);

  const draw = useCallback(() => {
    chart.current?.setOption(themed(latest.current), true);
  }, []);

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
      draw();
    });
    // The chart sits beside a panel that can appear, disappear and resize without the
    // window changing at all, so it watches its own box rather than the window.
    const resize = () => chart.current?.resize();
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    window.addEventListener("resize", resize);
    // The theme is an attribute on <html>; watching it keeps the chart in step with the page.
    const themeWatcher = new MutationObserver(() => {
      setTheme((n) => n + 1);
    });
    themeWatcher.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => {
      disposed = true;
      observer.disconnect();
      themeWatcher.disconnect();
      window.removeEventListener("resize", resize);
      chart.current?.dispose();
      chart.current = null;
    };
    // The instance is created once; later option and theme changes are applied below.
  }, [draw]);

  useEffect(draw, [option, theme, draw]);

  return <div ref={el} role="img" aria-label={label} className="h-full w-full" />;
}
