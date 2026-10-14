import assert from 'node:assert/strict';
import test from 'node:test';

import { buildChart } from '../src/geometry.js';
import { formatTip } from '../src/mount.js';
import { applyResponsive, normalize } from '../src/normalize.js';
import { themes } from '../src/theme.js';

const measure = (text, size = 12) => String(text ?? '').length * size * 0.5;

function draw(config, width = 640, height = 360) {
  const model = normalize(config);
  return { model, spec: buildChart(model, width, height, measure, themes.light) };
}

function texts(spec) {
  return spec.nodes.filter((node) => node.type === 'text').map((node) => node.text);
}

function strokes(spec) {
  return spec.nodes.filter((node) => node.type === 'path' && node.stroke && node.stroke !== 'none');
}

const hour = 60 * 60 * 1000;
const day = Date.UTC(2026, 9, 7, 0, 0, 0);

test('monitor trends keep a dash, a time pattern, one axis per metric, and a window', () => {
  const metrics = [
    { name: 'CPU', dash: 0, color: '#0f8a70' },
    { name: 'Memory', dash: 0, color: '#3d6bf5' },
    { name: 'Load', dash: 5, color: '#e39b12' },
  ];
  const { model, spec } = draw({
    id: 'monitor-trend-main',
    type: 'line',
    zoom: true,
    markers: false,
    hoverSize: 5,
    curve: 'smooth',
    series: metrics.map((metric, index) => ({
      name: metric.name,
      color: metric.color,
      dash: metric.dash,
      yIndex: index,
      strokeWidth: index === 0 ? 3 : 2,
      data: [0, 6, 12, 18].map((hourOfDay) => [day + hourOfDay * hour, 10 + index * 5 + hourOfDay]),
    })),
    x: { format: 'dd MMM HH:mm', utc: true, min: day + 12 * hour, max: day + 18 * hour },
    yAxes: metrics.map((metric, index) => ({
      title: metric.name,
      opposite: index > 0,
      color: metric.color,
      format: (value) => `${value}${metric.name === 'CPU' ? '%' : ''}`,
    })),
    brush: null,
  });
  assert.equal(model.id, 'monitor-trend-main');
  assert.equal(model.zoom, true);
  assert.equal(model.series[2].dash, '5 5');
  assert.equal(model.series[0].dash, null);
  assert.equal(spec.xDomain.min, day + 12 * hour);
  assert.equal(spec.xDomain.max, day + 18 * hour);
  const labels = texts(spec);
  assert.ok(labels.includes('CPU'));
  assert.ok(labels.includes('Memory'));
  assert.ok(labels.includes('Load'));
  assert.equal(model.x.format(day + 12 * hour), '07 Oct 12:00');
  assert.ok(labels.some((label) => /\d:\d{2}/.test(label)), labels.join(' | '));
  const dashed = strokes(spec).filter((node) => node.dash === '5 5');
  assert.ok(dashed.length >= 1);
  assert.equal(spec.empty, false);

  const narrow = applyResponsive({
    height: 410,
    legend: { position: 'top' },
    responsive: [{ maxWidth: 768, height: 340, legend: { position: 'bottom' } }],
  }, 700);
  assert.equal(narrow.height, 340);
  assert.equal(narrow.legend.position, 'bottom');
  assert.equal(applyResponsive({ height: 410, responsive: [{ maxWidth: 768, height: 340 }] }, 900).height, 410);
});

test('a brush overview records the chart it should window', () => {
  const { model, spec } = draw({
    id: 'monitor-trend-brush',
    type: 'area',
    height: 118,
    brush: { target: 'monitor-trend-main', min: day + 8 * hour, max: day + 16 * hour },
    series: [{ name: 'Trend Window', data: [[day, 10], [day + 23 * hour, 40]] }],
    x: { utc: true },
    y: { min: 0, max: 100 },
    legend: false,
  });
  assert.equal(model.brush.target, 'monitor-trend-main');
  assert.equal(model.brush.min, day + 8 * hour);
  assert.equal(spec.empty, false);
  assert.ok(spec.xDomain.max > spec.xDomain.min);
});

test('gateway sensor lines keep a solid trace and a dashed trace on two axes', () => {
  const { model, spec } = draw({
    type: 'line',
    curve: 'straight',
    markers: false,
    series: [
      {
        name: 'Temperature',
        strokeWidth: 2.25,
        data: [[day, 32.2], [day + hour, 33.1], [day + 2 * hour, 31.4]],
      },
      {
        name: 'RSSI',
        yIndex: 1,
        strokeWidth: 1.75,
        dash: 5,
        data: [[day, -62], [day + hour, -70], [day + 2 * hour, -58]],
      },
    ],
    yAxes: [
      { title: 'Temperature (°F)', format: (value) => `${value.toFixed(1)}°F` },
      { opposite: true, title: 'RSSI', min: -130, max: -30, format: (value) => `${Math.round(value)} dBm` },
    ],
    x: { utc: true },
  });
  assert.equal(model.series[1].dash, '5 5');
  assert.equal(model.series[1].strokeWidth, 1.75);
  const labels = texts(spec);
  assert.ok(labels.includes('Temperature (°F)'));
  assert.ok(labels.includes('RSSI'));
  assert.ok(labels.some((label) => label.endsWith('°F')));
  assert.ok(labels.some((label) => label.endsWith('dBm')));
  assert.ok(strokes(spec).some((node) => node.dash === '5 5' && node.sw === 1.75));
  assert.equal(formatTip(model, { value: -70, seriesIndex: 1 }, { index: 1 }), '-70 dBm');
  assert.equal(formatTip(model, { value: 32.2, seriesIndex: 0 }, { index: 0 }), '32.2°F');
});

test('a sparkline gauge fills its host and a blank label stays blank', () => {
  const { model, spec } = draw({
    type: 'radialBar',
    series: [60],
    labels: [''],
    center: (value) => `${Math.round(value)}%`,
    sparkline: true,
    start: -135,
    end: 135,
    inner: 0.6,
  }, 132, 132);
  assert.equal(model.sparkline, true);
  assert.equal(model.series[0].name, '');
  assert.deepEqual(texts(spec), ['60%']);
  assert.ok(spec.plot.w > 100, `arc span ${spec.plot.w}`);
});

test('a queue gauge is an arc and can print a count instead of a percent', () => {
  const { spec } = draw({
    type: 'radialBar',
    series: [46],
    labels: ['Queued payloads'],
    center: () => '12',
    inner: 0.63,
    start: -135,
    end: 135,
  });
  const labels = texts(spec);
  assert.ok(labels.includes('12'));
  assert.ok(labels.includes('Queued payloads'));
  const arcs = spec.nodes.filter((node) => node.type === 'path' && node.d);
  assert.ok(arcs.length >= 2);
  assert.equal(arcs.some((node) => /A[^A]+A[^A]+A/.test(node.d) && node.d.includes('Z') && node.fill !== 'none' && node.d.startsWith('M') && node.d.split('A').length > 3), false);
  const partial = arcs.find((node) => node.fill !== themes.light.grid);
  assert.ok(partial);
  assert.equal((partial.d.match(/A/g) || []).length, 2);
});

test('hop loss shares no axis with latency, and a hidden twin axis stays off the page', () => {
  const { spec } = draw({
    type: 'line',
    categories: ['1 · a', '2 · b', '3 · c'],
    series: [
      { name: 'Average ms', type: 'line', data: [10, 20, 15] },
      { name: 'Worst ms', type: 'line', data: [40, 50, 30], yIndex: 0 },
      { name: 'Loss %', type: 'column', data: [0, 2, 1], yIndex: 1 },
    ],
    strokeWidth: 2,
    yAxes: [
      { title: 'Latency (ms)', min: 0 },
      { opposite: true, title: 'Loss %', min: 0, max: 100, show: true },
      { title: 'Hidden twin', show: false },
    ],
  });
  const labels = texts(spec);
  assert.ok(labels.includes('Latency (ms)'));
  assert.ok(labels.includes('Loss %'));
  assert.equal(labels.includes('Hidden twin'), false);
  assert.equal(spec.empty, false);
  assert.ok(spec.nodes.some((node) => node.type === 'path' && node.fill && node.fill !== 'none'));
});

test('a datetime column still draws beside an area', () => {
  const { spec } = draw({
    type: 'line',
    series: [
      { name: 'Present', type: 'area', data: [[day, 4], [day + hour, 6], [day + 2 * hour, 5]] },
      { name: 'Changes', type: 'column', data: [[day, 1], [day + hour, 3], [day + 2 * hour, 2]], yIndex: 1 },
    ],
    yAxes: [
      { title: 'Present devices', min: 0 },
      { opposite: true, title: 'Changes', min: 0 },
    ],
    x: { utc: true },
  });
  assert.equal(spec.empty, false);
  const bars = spec.nodes.filter((node) => node.type === 'path' && node.fill && node.fill !== 'none' && !String(node.fill).startsWith('url('));
  assert.ok(bars.length >= 3);
  assert.ok(texts(spec).includes('Changes'));
});

test('donut holes, slice gaps, and sparkline status charts stay closed shapes', () => {
  const donut = draw({
    type: 'donut',
    series: [4, 1, 2],
    labels: ['Online', 'Offline', 'Idle'],
    inner: 0.68,
    gap: 4,
    center: (total) => String(total),
    showValues: false,
  });
  assert.ok(texts(donut.spec).includes('7'));
  const slices = donut.spec.nodes.filter((node) => node.type === 'path');
  assert.equal(slices.length, 3);
  assert.ok(slices.every((node) => node.sw === 0));

  const spark = draw({
    type: 'donut',
    sparkline: true,
    series: [3, 1],
    labels: ['Open', 'Closed'],
    inner: 0.64,
    legend: false,
    center: false,
    showValues: false,
  }, 250, 250);
  assert.equal(spark.model.axes, false);
  assert.equal(spark.model.legend.show, false);
  assert.equal(spark.spec.empty, false);
  assert.equal(texts(spark.spec).includes('Total'), false);
});

test('distributed signal bars and dated school bars keep their axes', () => {
  const signal = draw({
    type: 'horizontalBar',
    distributed: true,
    series: [{ name: 'RSSI', data: [0, 40, 80] }],
    categories: ['Freezer A', 'Freezer B', 'Dock'],
    y: { min: 0, max: 100, format: (value) => `${Math.round(value - 130)} dBm` },
    barRadius: 5,
  });
  const signalText = texts(signal.spec);
  assert.ok(signalText.includes('Freezer A'));
  assert.ok(signalText.some((label) => label.endsWith('dBm')));
  assert.equal(signal.spec.nodes.filter((node) => node.type === 'path' && !node.sheen).length, 3);

  const school = draw({
    type: 'bar',
    series: [
      { name: 'Received', data: [{ x: '2026-10-01', y: 2 }, { x: '2026-10-02', y: 5 }] },
      { name: 'Reviewed', data: [{ x: '2026-10-01', y: 1 }, { x: '2026-10-02', y: 4 }] },
    ],
    y: { min: 0 },
  });
  assert.equal(school.model.pointMode, 'time');
  assert.equal(school.spec.empty, false);
  assert.ok(school.spec.nodes.filter((node) => node.type === 'path').length >= 4);
});
