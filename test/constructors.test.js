import assert from 'node:assert/strict';
import test from 'node:test';

import { buildChart } from '../src/geometry.js';
import { normalize } from '../src/normalize.js';
import { themes, palette } from '../src/theme.js';
import Shelf, {
  Area,
  Bar,
  BoxPlot,
  Candlestick,
  Chart,
  Column,
  Donut,
  Heatmap,
  HorizontalBar,
  Line,
  Pie,
  PolarArea,
  Radar,
  RadialBar,
  RangeArea,
  RangeBar,
  Scatter,
  Treemap,
  line,
} from '../src/index.js';

const measure = (text, size = 12) => String(text ?? '').length * size * 0.5;

function draw(config, width = 480, height = 280) {
  const model = normalize(config);
  return { model, spec: buildChart(model, width, height, measure, themes.light) };
}

function paths(spec) {
  return spec.nodes.filter((node) => node.type === 'path' && node.d);
}

test('each chart kind has its own constructor', () => {
  const kinds = [
    [Line, 'line'],
    [Area, 'area'],
    [Bar, 'bar'],
    [Column, 'column'],
    [HorizontalBar, 'horizontalBar'],
    [Pie, 'pie'],
    [Donut, 'donut'],
    [Scatter, 'scatter'],
    [Radar, 'radar'],
    [Heatmap, 'heatmap'],
    [Treemap, 'treemap'],
    [Candlestick, 'candlestick'],
    [BoxPlot, 'boxPlot'],
    [RangeBar, 'rangeBar'],
    [RangeArea, 'rangeArea'],
    [PolarArea, 'polarArea'],
    [RadialBar, 'radialBar'],
  ];
  assert.equal(Shelf, Chart);
  assert.equal(typeof line, 'function');
  for (const [Ctor, type] of kinds) {
    assert.equal(Ctor.type, type);
    assert.equal(Chart[Ctor.name], Ctor);
    assert.equal(Object.getPrototypeOf(Ctor.prototype), Chart.prototype);
  }
});

test('a line config keeps titles, format, and the shelf palette', () => {
  const { model, spec } = draw({
    type: 'line',
    height: 320,
    title: 'Monthly',
    titleAlign: 'center',
    subtitle: '2026',
    categories: ['Jan', 'Feb', 'Mar', 'Apr'],
    series: [{ name: 'Revenue', data: [30, 40, 35, 50] }],
    x: { title: 'Month' },
    y: { title: 'Revenue', format: (value) => `$${value}` },
    curve: 'smooth',
    strokeWidth: 3,
    markers: false,
    showValues: false,
    legend: false,
  });
  assert.equal(model.type, 'line');
  assert.equal(model.height, 320);
  assert.equal(model.title, 'Monthly');
  assert.equal(model.titleAlign, 'center');
  assert.equal(model.subtitle, '2026');
  assert.equal(model.x.title, 'Month');
  assert.equal(model.y.title, 'Revenue');
  assert.equal(model.y.format(12), '$12');
  assert.equal(model.series[0].color, palette[0]);
  assert.equal(model.markers, false);
  assert.equal(model.showValues, false);
  assert.equal(model.legend.show, false);
  assert.deepEqual(model.categories, ['Jan', 'Feb', 'Mar', 'Apr']);
  assert.ok(paths(spec).length >= 1);
});

test('donut hole and horizontal bars use the shelf config', () => {
  const donut = draw({
    type: 'donut',
    height: 300,
    series: [44, 55, 13],
    labels: ['Apple', 'Mango', 'Orange'],
    inner: 0.65,
  });
  assert.equal(donut.model.type, 'donut');
  assert.equal(donut.model.inner, 0.65);
  assert.equal(donut.model.showValues, true);
  assert.deepEqual(donut.model.series.map((series) => series.name), ['Apple', 'Mango', 'Orange']);
  assert.ok(paths(donut.spec).length >= 3);

  const bars = draw({
    type: 'horizontalBar',
    height: 300,
    name: 'Views',
    series: [40, 30, 20],
    categories: ['Docs', 'Pricing', 'Blog'],
    barRadius: 4,
    band: 0.6,
    showValues: true,
  });
  assert.equal(bars.model.horizontal, true);
  assert.equal(bars.model.barRadius, 4);
  assert.equal(bars.model.band, 0.6);
  assert.equal(bars.model.showValues, true);
  assert.equal(paths(bars.spec).filter((node) => !node.sheen).length, 3);
});

test('a 100% stack draws one full column', () => {
  const { model, spec } = draw({
    type: 'bar',
    stacked: true,
    stackType: '100%',
    height: 300,
    categories: ['Q1', 'Q2'],
    series: [
      { name: 'A', data: [1, 1] },
      { name: 'B', data: [3, 1] },
    ],
  });
  assert.equal(model.stackType, '100%');
  assert.deepEqual(model.categories, ['Q1', 'Q2']);
  assert.deepEqual(model.series[0].values, [1, 1]);
  const texts = spec.nodes.filter((node) => node.type === 'text').map((node) => node.text);
  assert.ok(texts.includes('0%'));
  assert.ok(texts.includes('100%'));
  assert.equal(paths(spec).filter((node) => !node.sheen).length, 4);
});

test('a mixed chart keeps columns and a line on two axes', () => {
  const { model, spec } = draw({
    type: 'line',
    height: 320,
    categories: ['Jan', 'Feb', 'Mar', 'Apr'],
    series: [
      { name: 'Orders', type: 'column', data: [44, 55, 41, 67] },
      { name: 'Margin', type: 'line', data: [12, 18, 14, 22], yIndex: 1, strokeWidth: 3 },
    ],
    yAxes: [
      { title: 'Orders' },
      { opposite: true, title: 'Margin' },
    ],
    legend: { position: 'left' },
  });
  assert.equal(model.series[0].seriesType, 'bar');
  assert.equal(model.series[1].seriesType, 'line');
  assert.equal(model.series[1].yIndex, 1);
  assert.equal(model.legend.position, 'left');
  assert.equal(model.yAxes[1].title, 'Margin');
  const fills = paths(spec).filter((node) => node.fill && node.fill !== 'none');
  const lines = paths(spec).filter((node) => node.stroke && node.stroke !== 'none' && node.fill === 'none');
  assert.ok(fills.length >= 4);
  assert.ok(lines.length >= 1);
  assert.ok(spec.nodes.some((node) => node.text === 'Margin' && node.rotate === 90));
});

test('every constructor type draws marks', () => {
  const cases = [
    { name: 'radialBar', config: { type: 'radialBar', series: [70, 55], labels: ['A', 'B'] } },
    {
      name: 'heatmap',
      config: {
        type: 'heatmap',
        categories: ['A', 'B', 'C'],
        series: [{ name: 'Mon', data: [10, 20, 30] }, { name: 'Tue', data: [12, 18, 24] }],
      },
    },
    {
      name: 'radar',
      config: {
        type: 'radar',
        categories: ['A', 'B', 'C', 'D'],
        series: [{ name: 'Score', data: [80, 50, 70, 60] }],
      },
    },
    { name: 'polarArea', config: { type: 'polarArea', series: [14, 23, 21], labels: ['A', 'B', 'C'] } },
    {
      name: 'candlestick',
      config: {
        type: 'candlestick',
        series: [{ data: [{ x: 'Jan', y: [10, 16, 8, 14] }, { x: 'Feb', y: [14, 18, 12, 11] }] }],
      },
    },
    {
      name: 'boxPlot',
      config: {
        type: 'boxPlot',
        series: [{ data: [{ x: 'A', y: [10, 20, 30, 40, 50] }, { x: 'B', y: [12, 22, 32, 42, 54] }] }],
      },
    },
    {
      name: 'rangeBar',
      config: {
        type: 'rangeBar',
        series: [{ name: 'Plan', data: [{ x: 'Design', y: [1, 4] }, { x: 'Build', y: [3, 8] }] }],
      },
    },
    {
      name: 'rangeArea',
      config: {
        type: 'rangeArea',
        series: [{ name: 'Band', data: [{ x: 'Mon', y: [10, 20] }, { x: 'Tue', y: [12, 24] }, { x: 'Wed', y: [9, 18] }] }],
      },
    },
    {
      name: 'treemap',
      config: {
        type: 'treemap',
        series: [{ data: [{ x: 'Docs', y: 40 }, { x: 'Blog', y: 25 }, { x: 'Home', y: 15 }] }],
      },
    },
  ];
  for (const item of cases) {
    const { spec } = draw(item.config);
    const marks = spec.nodes.filter((node) => node.type === 'path' || node.type === 'circle' || node.type === 'line');
    assert.ok(marks.length > 0, item.name);
    assert.equal(spec.empty, false, item.name);
  }
});

test('dated bars stay on the time axis and a radial center can be its own label', () => {
  const bars = draw({
    type: 'bar',
    series: [
      { name: 'Received', data: [{ x: '2026-10-01', y: 2 }, { x: '2026-10-02', y: 5 }] },
      { name: 'Reviewed', data: [{ x: '2026-10-01', y: 1 }, { x: '2026-10-02', y: 4 }] },
    ],
    y: { min: 0 },
  });
  assert.equal(bars.model.pointMode, 'time');
  assert.equal(paths(bars.spec).filter((node) => !node.sheen).length, 4);
  assert.equal(bars.spec.empty, false);

  const radial = draw({
    type: 'radialBar',
    series: [46],
    labels: ['Queued payloads'],
    center: () => '12',
  });
  const texts = radial.spec.nodes.filter((node) => node.type === 'text').map((node) => node.text);
  assert.ok(texts.includes('12'));
  assert.ok(texts.includes('Queued payloads'));
});

test('axis min functions, tooltip formatters, and annotations are kept', () => {
  const { model } = draw({
    type: 'line',
    series: [{ name: 'A', data: [10, 20, 30] }],
    categories: ['A', 'B', 'C'],
    y: { min: (min) => min - 5, format: (value) => `${value}ms` },
    tooltipFormat: (value) => `${value} ms`,
    annotations: { yaxis: [{ y: 20, borderColor: '#ff0000', label: { text: 'Goal' } }] },
  });
  assert.equal(typeof model.y.minFn, 'function');
  assert.equal(model.y.format(10), '10ms');
  assert.equal(model.tooltipFormat(4, {}), '4 ms');
  assert.equal(model.annotations.y[0].text, 'Goal');
  const spec = buildChart(model, 480, 280, measure, themes.light);
  assert.ok(spec.nodes.some((node) => node.text === 'Goal'));
});
