import { Chart } from './mount.js';
import { palette } from './theme.js';

export { palette };
export { Chart };
export const version = '0.1.0';

function chartClass(name, type) {
  class ShelfChart extends Chart {
    static type = type;

    constructor(target, config = {}) {
      super(target, { ...config, type });
    }
  }
  Object.defineProperty(ShelfChart, 'name', { value: name });
  return ShelfChart;
}

export const Line = chartClass('Line', 'line');
export const Area = chartClass('Area', 'area');
export const Bar = chartClass('Bar', 'bar');
export const Column = chartClass('Column', 'column');
export const HorizontalBar = chartClass('HorizontalBar', 'horizontalBar');
export const Pie = chartClass('Pie', 'pie');
export const Donut = chartClass('Donut', 'donut');
export const Scatter = chartClass('Scatter', 'scatter');
export const Radar = chartClass('Radar', 'radar');
export const Heatmap = chartClass('Heatmap', 'heatmap');
export const Treemap = chartClass('Treemap', 'treemap');
export const Candlestick = chartClass('Candlestick', 'candlestick');
export const BoxPlot = chartClass('BoxPlot', 'boxPlot');
export const RangeBar = chartClass('RangeBar', 'rangeBar');
export const RangeArea = chartClass('RangeArea', 'rangeArea');
export const PolarArea = chartClass('PolarArea', 'polarArea');
export const RadialBar = chartClass('RadialBar', 'radialBar');

Object.assign(Chart, {
  Line,
  Area,
  Bar,
  Column,
  HorizontalBar,
  Pie,
  Donut,
  Scatter,
  Radar,
  Heatmap,
  Treemap,
  Candlestick,
  BoxPlot,
  RangeBar,
  RangeArea,
  PolarArea,
  RadialBar,
});

/** Draw a chart and return it. `target` is an element or a CSS selector. */
export function chart(target, config = {}) {
  return new Chart(target, config).render();
}

function draw(Ctor) {
  return (target, config = {}) => new Ctor(target, config).render();
}

export const line = draw(Line);
export const area = draw(Area);
export const bar = draw(Bar);
export const column = draw(Column);
export const horizontalBar = draw(HorizontalBar);
export const pie = draw(Pie);
export const donut = draw(Donut);
export const scatter = draw(Scatter);
export const radar = draw(Radar);
export const heatmap = draw(Heatmap);
export const treemap = draw(Treemap);
export const candlestick = draw(Candlestick);
export const boxPlot = draw(BoxPlot);
export const rangeBar = draw(RangeBar);
export const rangeArea = draw(RangeArea);
export const polarArea = draw(PolarArea);
export const radialBar = draw(RadialBar);

export { Chart as ChartShelf };
export default Chart;

if (typeof window !== 'undefined') window.ChartShelf = Chart;
