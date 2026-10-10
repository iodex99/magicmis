/**
 * ECharts with only what the board draws (ADR 0091): bar and line series on a grid, with a
 * tooltip and a scrolling legend, painted on canvas. The full build is about 1.1 MB, 370 KB
 * gzipped, for charts this product never makes; a new kind of box that needs another series type
 * or component registers it here.
 * https://echarts.apache.org/handbook/en/basics/import/#shrinking-bundle-size
 */

import { BarChart, LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  BarChart,
  LineChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

export const init = echarts.init;
