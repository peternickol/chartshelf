export const version: string;
export const palette: readonly string[];

export type ChartType =
  | 'line'
  | 'area'
  | 'bar'
  | 'column'
  | 'horizontalBar'
  | 'hbar'
  | 'pie'
  | 'donut'
  | 'scatter'
  | 'spline'
  | 'radialBar'
  | 'heatmap'
  | 'candlestick'
  | 'boxPlot'
  | 'radar'
  | 'polarArea'
  | 'rangeBar'
  | 'rangeArea'
  | 'treemap';

export type Curve = 'smooth' | 'straight' | 'stepline';
export type ThemeName = 'light' | 'dark' | 'auto';

export type Point =
  | [x: number | string | Date, y: number | null]
  | { x: number | string | Date; y: number | null };

export interface Series {
  name?: string;
  /** Draw this series as a different mark on a mixed chart. */
  type?: 'line' | 'area' | 'bar' | 'column' | 'scatter';
  /** Index into `yAxes` when a chart has more than one value axis. */
  yIndex?: number;
  strokeWidth?: number;
  /** SVG dash pattern. A number is that many pixels on and off. `0` keeps the stroke solid. */
  dash?: number | number[] | string;
  data?: number | Array<number | null> | Point[];
  color?: string;
  hidden?: boolean;
}

/** A name→values map, a bare list of numbers, or series objects. */
export type SeriesInput =
  | Array<number | null>
  | Record<string, number | Array<number | null> | Point[]>
  | Series[];

export interface AxisOptions {
  /** Axis title. On a bar chart, `x` is the category axis and `y` is the value axis. */
  title?: string;
  min?: number;
  max?: number;
  /** Pull zero into view. Defaults to true for bar and area charts. */
  zero?: boolean;
  /** `false` keeps a time or linear value scale while the x window changes. */
  refit?: boolean;
  format?: ((value: number) => string) | string;
  /** Format a time axis in UTC. The default is the local zone. */
  utc?: boolean;
  type?: 'category' | 'linear' | 'time';
  /** Draw this axis on the right. Used with `yAxes`. */
  opposite?: boolean;
  /** `false` keeps the scale and hides the labels. */
  show?: boolean;
  color?: string;
}

export interface LegendOptions {
  show?: boolean;
  position?: 'top' | 'bottom' | 'right' | 'left';
}

export interface GridOptions {
  x?: boolean;
  y?: boolean;
}

export interface PointEvent {
  index: number;
  label: string;
  points: Array<{ name: string; value: number | null; color: string }>;
}

export interface ChartConfig {
  type?: ChartType;
  /** Column values, or a pie map such as `{ Chrome: 60, Safari: 20 }`. */
  series?: SeriesInput;
  /** Tabular rows. Category and numeric columns are picked up on their own. */
  data?: Array<Record<string, unknown>>;
  xKey?: string;
  yKeys?: string | string[];
  /** Split rows into one series per value of this column. */
  groupKey?: string;
  categories?: Array<string | number>;
  /** Alias of `categories`, useful for pie slices. */
  labels?: Array<string | number>;
  /** Name used when `series` is a single list of numbers. */
  name?: string;
  title?: string;
  subtitle?: string;
  height?: number | string;
  width?: number | string;
  colors?: string[];
  curve?: Curve;
  stacked?: boolean;
  /** `'100%'` scales a stacked chart to the share of each category. */
  stackType?: 'normal' | '100%';
  horizontal?: boolean;
  /** Extra value axes. A series chooses one with `yIndex`. */
  yAxes?: AxisOptions[];
  strokeWidth?: number;
  fillOpacity?: number;
  markers?: boolean | 'auto';
  markerSize?: number;
  legend?: boolean | LegendOptions;
  grid?: boolean | GridOptions;
  tooltip?: boolean;
  axes?: boolean;
  animate?: boolean;
  /** Hide axes, grid, and the legend. */
  sparkline?: boolean;
  theme?: ThemeName;
  background?: string;
  /** Donut hole, or radial track hole, as a fraction of the radius. */
  inner?: number;
  /** Gap between pie and donut slices, in pixels. */
  gap?: number;
  /** Radial arc, in degrees. 0 is 12 o'clock and positive runs clockwise. */
  start?: number;
  end?: number;
  /** Stable id used by `Chart.lookup` and a brush chart. */
  id?: string;
  /** Drag a window on the x axis. The wheel zooms around the pointer. Shift-drag pans. Double-click resets. Buttons zoom in, zoom out, select, pan, and reset. */
  zoom?: boolean;
  /** Overview chart. Dragging it sets the target chart's x range. */
  brush?: { target: string; min?: number; max?: number };
  /** Dash pattern for every series, or one pattern per series. */
  dash?: number | number[] | Array<number | number[] | string>;
  /** Hover dot radius. `0` hides it. */
  hoverSize?: number;
  /** Overrides applied when the host is no wider than `maxWidth`. */
  responsive?: Array<Partial<ChartConfig> & { maxWidth: number }>;
  barRadius?: number;
  showValues?: boolean;
  /** Center label for a donut or radial chart. `false` hides a donut center. `{ label, value }` draws the caption above the value. */
  center?: string | false | { label?: string; value?: string | ((total: number) => string) } | ((total: number) => string | { label?: string; value?: string });
  x?: AxisOptions;
  y?: AxisOptions;
  onPoint?: (event: PointEvent) => void;
}

export interface ChartHandle {
  render(): this;
  /** Merge into the current config. `series` is replaced. `x`, `y`, `legend`, and `grid` merge. */
  update(config: Partial<ChartConfig>, animate?: boolean): this;
  updateSeries(series: SeriesInput): this;
  /** Show an x window. Pass numbers in the same units as the x data. */
  setRange(min: number, max: number): this;
  resetRange(): this;
  /** Zoom around the middle of the current x window. A factor below 1 zooms in. */
  zoomBy(factor: number): void;
  destroy(): void;
  readonly el: Element;
}

export class Chart implements ChartHandle {
  constructor(target: Element | string, config?: ChartConfig);
  render(): this;
  update(config: Partial<ChartConfig>, animate?: boolean): this;
  updateSeries(series: SeriesInput): this;
  setRange(min: number, max: number): this;
  resetRange(): this;
  zoomBy(factor: number): void;
  /** The chart created with this `id`, or null. */
  static lookup(id: string): Chart | null;
  destroy(): void;
  readonly el: Element;
}

export class Line extends Chart {
  static type: 'line';
}
export class Area extends Chart {
  static type: 'area';
}
export class Bar extends Chart {
  static type: 'bar';
}
export class Column extends Chart {
  static type: 'column';
}
export class HorizontalBar extends Chart {
  static type: 'horizontalBar';
}
export class Pie extends Chart {
  static type: 'pie';
}
export class Donut extends Chart {
  static type: 'donut';
}
export class Scatter extends Chart {
  static type: 'scatter';
}
export class Radar extends Chart {
  static type: 'radar';
}
export class Heatmap extends Chart {
  static type: 'heatmap';
}
export class Treemap extends Chart {
  static type: 'treemap';
}
export class Candlestick extends Chart {
  static type: 'candlestick';
}
export class BoxPlot extends Chart {
  static type: 'boxPlot';
}
export class RangeBar extends Chart {
  static type: 'rangeBar';
}
export class RangeArea extends Chart {
  static type: 'rangeArea';
}
export class PolarArea extends Chart {
  static type: 'polarArea';
}
export class RadialBar extends Chart {
  static type: 'radialBar';
}

export interface ChartConstructors {
  Line: typeof Line;
  Area: typeof Area;
  Bar: typeof Bar;
  Column: typeof Column;
  HorizontalBar: typeof HorizontalBar;
  Pie: typeof Pie;
  Donut: typeof Donut;
  Scatter: typeof Scatter;
  Radar: typeof Radar;
  Heatmap: typeof Heatmap;
  Treemap: typeof Treemap;
  Candlestick: typeof Candlestick;
  BoxPlot: typeof BoxPlot;
  RangeBar: typeof RangeBar;
  RangeArea: typeof RangeArea;
  PolarArea: typeof PolarArea;
  RadialBar: typeof RadialBar;
}

export const ChartShelf: typeof Chart & ChartConstructors;
export default ChartShelf;

export function chart(target: Element | string, config?: ChartConfig): Chart;
export function line(target: Element | string, config?: ChartConfig): Line;
export function area(target: Element | string, config?: ChartConfig): Area;
export function bar(target: Element | string, config?: ChartConfig): Bar;
export function column(target: Element | string, config?: ChartConfig): Column;
export function horizontalBar(target: Element | string, config?: ChartConfig): HorizontalBar;
export function pie(target: Element | string, config?: ChartConfig): Pie;
export function donut(target: Element | string, config?: ChartConfig): Donut;
export function scatter(target: Element | string, config?: ChartConfig): Scatter;
export function radar(target: Element | string, config?: ChartConfig): Radar;
export function heatmap(target: Element | string, config?: ChartConfig): Heatmap;
export function treemap(target: Element | string, config?: ChartConfig): Treemap;
export function candlestick(target: Element | string, config?: ChartConfig): Candlestick;
export function boxPlot(target: Element | string, config?: ChartConfig): BoxPlot;
export function rangeBar(target: Element | string, config?: ChartConfig): RangeBar;
export function rangeArea(target: Element | string, config?: ChartConfig): RangeArea;
export function polarArea(target: Element | string, config?: ChartConfig): PolarArea;
export function radialBar(target: Element | string, config?: ChartConfig): RadialBar;
