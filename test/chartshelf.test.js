import assert from 'node:assert/strict';
import test from 'node:test';

import { areaBand, areaCommands, areaPath, lineCommands, lineCoords, linePath, toPath } from '../src/curve.js';
import { buildChart, polar } from '../src/geometry.js';
import { hitTest } from '../src/mount.js';
import { normalize, stackSeries } from '../src/normalize.js';
import { niceDomain, resolveDomain, scaleLinear, timeTicks } from '../src/scale.js';
import { themes } from '../src/theme.js';
import { finiteExtent, safeColor } from '../src/util.js';
import { chart, donut, line, palette, version } from '../src/index.js';

const measure = (text, size = 12) => String(text ?? '').length * size * 0.5;

function spec(config, width = 480, height = 280) {
  const model = normalize({ legend: false, animate: false, ...config });
  return { model, spec: buildChart(model, width, height, measure, themes.light) };
}

function cubic(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

function samples(commands, steps = 12) {
  const points = [];
  let cursor = { x: 0, y: 0 };
  for (const command of commands) {
    if (command.op === 'M' || command.op === 'L') {
      cursor = { x: command.x, y: command.y };
      points.push(cursor);
    } else if (command.op === 'C') {
      const p0 = cursor;
      const p1 = { x: command.x1, y: command.y1 };
      const p2 = { x: command.x2, y: command.y2 };
      const p3 = { x: command.x, y: command.y };
      for (let i = 1; i <= steps; i += 1) points.push(cubic(p0, p1, p2, p3, i / steps));
      cursor = p3;
    }
  }
  return points;
}

test('version and palette are public', () => {
  assert.equal(version, '0.1.0');
  assert.ok(palette.length >= 6);
  assert.equal(typeof chart, 'function');
  assert.equal(typeof line, 'function');
  assert.equal(typeof donut, 'function');
});

test('charts refuse to render without a browser document', () => {
  assert.throws(() => line('#sales', { series: [1, 2, 3] }), /browser/);
});

test('safe colors reject css injection', () => {
  assert.equal(safeColor('#3d6bf5', '#000'), '#3d6bf5');
  assert.equal(safeColor('teal', '#000'), 'teal');
  assert.equal(safeColor('red;background:url(https://x)', '#000'), '#000');
  assert.equal(safeColor('#fff', '#000'), '#fff');
});

test('nice domain covers the data with even ticks', () => {
  const domain = niceDomain(0, 10, 5);
  assert.equal(domain.min, 0);
  assert.ok(domain.max >= 10);
  assert.ok(domain.ticks.length >= 2);
  const step = domain.ticks[1] - domain.ticks[0];
  for (let i = 1; i < domain.ticks.length; i += 1) {
    assert.ok(Math.abs(domain.ticks[i] - domain.ticks[i - 1] - step) < 1e-9);
  }
  const locked = resolveDomain(5, 9, { zero: true, min: 0, max: 20, ticks: 5 });
  assert.equal(locked.min, 0);
  assert.equal(locked.max, 20);
  assert.equal(locked.ticks[0], 0);
  assert.equal(locked.ticks.at(-1), 20);
  assert.ok(locked.ticks.every((tick) => tick >= 0 && tick <= 20));
});

test('value scales stay near the samples and pinned ends stay visible', () => {
  const line = resolveDomain(12, 70, { ticks: 5 });
  assert.equal(line.min, 10);
  assert.equal(line.max, 70);
  assert.deepEqual(line.ticks, [10, 20, 30, 40, 50, 60, 70]);

  const bars = resolveDomain(0, 8, { zero: true, min: 0, headroom: true, ticks: 5 });
  assert.equal(bars.min, 0);
  assert.equal(bars.max, 10);
  assert.equal(bars.ticks.at(-1), 10);

  const pinned = resolveDomain(-80, -40, { min: -130, max: -30, ticks: 5 });
  assert.equal(pinned.ticks[0], -130);
  assert.equal(pinned.ticks.at(-1), -30);
});

test('linear scale maps the ends of the domain', () => {
  const y = scaleLinear(0, 10, 100, 0);
  assert.equal(y(0), 100);
  assert.equal(y(10), 0);
  assert.equal(y(5), 50);
});

test('time ticks stay inside the domain', () => {
  const min = Date.parse('2026-01-01T00:00:00Z');
  const max = Date.parse('2026-01-02T00:00:00Z');
  const ticks = timeTicks(min, max, 5);
  assert.ok(ticks.ticks.length >= 2);
  assert.ok(ticks.ticks.every((tick) => tick >= min && tick <= max));
});

test('time ticks follow the clock across an hour, a shift, and a day', () => {
  const hour = 60 * 60 * 1000;
  const utcStart = Date.parse('2026-01-01T01:30:00Z');
  const eightHours = timeTicks(utcStart, utcStart + 8 * hour, 6, { utc: true });
  assert.equal(eightHours.step, hour);
  assert.ok(eightHours.ticks.length >= 6, `8h ticks: ${eightHours.ticks.length}`);
  for (const tick of eightHours.ticks) {
    const date = new Date(tick);
    assert.equal(date.getUTCMinutes(), 0);
    assert.equal(date.getUTCSeconds(), 0);
    assert.ok(tick > utcStart && tick < utcStart + 8 * hour);
  }

  const localStart = new Date(2026, 9, 8, 1, 30, 0, 0).getTime();
  const localEnd = new Date(2026, 9, 8, 9, 30, 0, 0).getTime();
  const local = timeTicks(localStart, localEnd, 6);
  assert.equal(local.step, hour);
  assert.ok(local.ticks.length >= 6);
  for (const tick of local.ticks) {
    const date = new Date(tick);
    assert.equal(date.getMinutes(), 0);
    assert.equal(date.getSeconds(), 0);
  }

  const dayStart = new Date(2026, 9, 8, 0, 0, 0, 0).getTime();
  const dayEnd = new Date(2026, 9, 9, 0, 0, 0, 0).getTime();
  const day = timeTicks(dayStart, dayEnd, 6);
  assert.ok(day.step <= 4 * hour, `day step ${day.step}`);
  assert.ok(day.ticks.length >= 4);
  for (const tick of day.ticks) {
    const date = new Date(tick);
    assert.equal(date.getMinutes(), 0);
    assert.equal(date.getHours() % (day.step / hour), 0);
  }

  const offsetMinutes = new Date(dayStart).getTimezoneOffset();
  if (offsetMinutes !== 0 && offsetMinutes % (day.step / 60000) !== 0) {
    const asUtc = timeTicks(dayStart, dayEnd, 6, { utc: true });
    assert.notDeepEqual(asUtc.ticks, day.ticks);
  }
});

function yTickValues(chartSpec, anchor = 'end') {
  const values = [];
  for (const node of chartSpec.nodes) {
    if (node.type !== 'text' || node.anchor !== anchor) continue;
    const raw = String(node.text).trim();
    if (!/\d/.test(raw)) continue;
    const value = Number(raw.replace(/[^\d.-]/g, ''));
    if (Number.isFinite(value)) values.push(value);
  }
  return values;
}

function yExtent(config) {
  const values = yTickValues(spec(config).spec);
  assert.ok(values.length >= 2, `expected y ticks, got ${values.join(', ')}`);
  return { min: Math.min(...values), max: Math.max(...values) };
}

test('an x window refits an unpinned y axis and keeps a pinned one', () => {
  const t0 = Date.parse('2026-06-01T00:00:00Z');
  const hour = 60 * 60 * 1000;
  const data = Array.from({ length: 24 }, (_, index) => [t0 + index * hour, 20 + index * 40]);
  const series = [{ name: 'Temp', data }];
  const open = yExtent({ type: 'line', series, y: { zero: false }, markers: false });
  const zoomed = yExtent({
    type: 'line',
    series,
    x: { min: t0 + 10 * hour, max: t0 + 14 * hour },
    y: { zero: false },
    markers: false,
  });
  const wide = yExtent({
    type: 'line',
    series,
    x: { min: t0 - 5 * hour, max: t0 + 30 * hour },
    y: { zero: false },
    markers: false,
  });
  assert.ok(open.max - open.min > zoomed.max - zoomed.min + 20);
  assert.ok(zoomed.min > open.min);
  assert.ok(zoomed.max < open.max);
  assert.deepEqual(wide, open);

  const pinned = yExtent({
    type: 'line',
    series,
    x: { min: t0 + 10 * hour, max: t0 + 14 * hour },
    y: { min: 0, max: 400, zero: false },
    markers: false,
  });
  assert.equal(pinned.min, 0);
  assert.equal(pinned.max, 400);

  const area = yExtent({
    type: 'area',
    series,
    x: { min: t0 + 10 * hour, max: t0 + 14 * hour },
    markers: false,
  });
  assert.equal(area.min, 0);
  assert.ok(area.max < open.max);

  const sparse = yExtent({
    type: 'line',
    series: [{ name: 'Temp', data: [[t0, 10], [t0 + 10 * hour, 90]] }],
    x: { min: t0 + 4 * hour, max: t0 + 6 * hour },
    y: { zero: false },
    markers: false,
  });
  assert.ok(sparse.min <= 10);
  assert.ok(sparse.max >= 90);

  const { spec: multi } = spec({
    type: 'line',
    series: [
      { name: 'Temp', data },
      { name: 'Load', yIndex: 1, data: data.map(([x, y]) => [x, y * 10]) },
    ],
    yAxes: [
      { zero: false },
      { opposite: true, zero: false, min: 0, max: 5000 },
    ],
    x: { min: t0 + 10 * hour, max: t0 + 14 * hour },
    markers: false,
  });
  const left = yTickValues(multi, 'end');
  const right = yTickValues(multi, 'start');
  assert.ok(Math.min(...left) > 200);
  assert.ok(Math.max(...left) < 900);
  assert.equal(Math.min(...right), 0);
  assert.equal(Math.max(...right), 5000);

  const windowed = spec({
    type: 'line',
    series,
    x: { min: t0, max: t0 + 8 * hour, utc: true },
    y: { zero: false },
    markers: false,
  });
  const clocks = windowed.spec.nodes.filter((node) => node.type === 'text' && node.baseline === 'hanging');
  assert.ok(clocks.length >= 4, `expected several time labels, got ${clocks.map((node) => node.text).join(', ')}`);

  const plot = windowed.spec.plot;
  const path = windowed.spec.nodes.find((node) => node.type === 'path');
  const coords = String(path.d).match(/-?\d+(?:\.\d+)?/g).map(Number);
  for (let index = 0; index < coords.length; index += 2) {
    assert.ok(coords[index] > plot.x - plot.w, `zoomed x ${coords[index]}`);
    assert.ok(coords[index] < plot.x + plot.w * 2, `zoomed x ${coords[index]}`);
    assert.ok(coords[index + 1] > plot.y - plot.h, `zoomed y ${coords[index + 1]}`);
    assert.ok(coords[index + 1] < plot.y + plot.h * 2, `zoomed y ${coords[index + 1]}`);
  }
  assert.ok(windowed.spec.hover.entries.length >= 2);
  assert.ok(windowed.spec.hover.entries.length < data.length);
  assert.equal(windowed.spec.hover.connected, true);

  const fixed = yExtent({
    type: 'line',
    series,
    x: { min: t0 + 10 * hour, max: t0 + 14 * hour },
    y: { zero: false, refit: false },
    markers: false,
  });
  assert.equal(fixed.min, open.min);
  assert.equal(fixed.max, open.max);
});

test('a wide time pattern stays on the tooltip and ticks stay readable', () => {
  const t0 = Date.parse('2026-06-01T00:00:00Z');
  const hour = 60 * 60 * 1000;
  const data = Array.from({ length: 18 }, (_, index) => [t0 + index * hour, 40 + index]);
  const { model, spec: chartSpec } = spec({
    type: 'line',
    series: [{ name: 'Temp', data }],
    x: { format: 'dd MMM HH:mm', utc: true },
    y: { zero: false },
    markers: false,
  }, 440, 280);
  const ticks = chartSpec.nodes
    .filter((node) => node.type === 'text' && node.baseline === 'hanging')
    .map((node) => node.text);
  assert.ok(ticks.length >= 5, ticks.join(', '));
  assert.ok(ticks.every((label) => !label.includes('Jun')), ticks.join(', '));
  assert.match(ticks[0], /^\d{2}:\d{2}$/);
  assert.equal(model.x.format(t0), '01 Jun 00:00');
  assert.ok(chartSpec.hover.entries.some((entry) => String(entry.label).includes('Jun')));
});

test('a long sorted window hovers the samples inside it', () => {
  const t0 = Date.parse('2026-06-01T00:00:00Z');
  const minute = 60 * 1000;
  const data = Array.from({ length: 500 }, (_, index) => [t0 + index * minute, 20 + (index % 17)]);
  const { spec: chartSpec } = spec({
    type: 'line',
    series: [{ name: 'Temp', data }],
    x: { min: t0 + 100 * minute, max: t0 + 110 * minute },
    y: { zero: false },
    markers: false,
  });
  const entries = chartSpec.hover.entries;
  assert.equal(entries.length, 13, `window hover count ${entries.length}`);
  assert.deepEqual(entries.map((entry) => entry.index), Array.from({ length: 13 }, (_, offset) => 99 + offset));
});

test('an unsorted window stays on the linear scan', () => {
  const { spec: chartSpec } = spec({
    type: 'line',
    series: [{ name: 'A', data: [[0, 1], [5, 9], [1, 3]] }],
    x: { min: 0.5, max: 1.5 },
    y: { zero: false },
    markers: false,
  });
  assert.deepEqual(chartSpec.hover.entries.map((entry) => entry.index), [1, 2]);
});

test('repeated timestamps outside a window keep the earlier sample in the scale', () => {
  const extent = yExtent({
    type: 'line',
    series: [{ name: 'A', data: [[0, 0], [0, 100], [10, 50], [20, 50]] }],
    x: { min: 5, max: 15 },
    y: { zero: false },
    markers: false,
  });
  assert.equal(extent.min, 0);
  assert.equal(extent.max, 50);
});

test('a fixed y scale stays put across later windows on the same model', () => {
  const t0 = Date.parse('2026-06-01T00:00:00Z');
  const hour = 60 * 60 * 1000;
  const data = Array.from({ length: 24 }, (_, index) => [t0 + index * hour, 20 + index * 40]);
  const open = yExtent({
    type: 'line',
    series: [{ name: 'Temp', data }],
    y: { zero: false, refit: false },
    markers: false,
  });
  const model = normalize({
    legend: false,
    animate: false,
    type: 'line',
    series: [{ name: 'Temp', data }],
    x: { min: t0 + 10 * hour, max: t0 + 14 * hour },
    y: { zero: false, refit: false },
    markers: false,
  });
  const paint = () => yTickValues(buildChart(model, 480, 280, measure, themes.light));
  const first = paint();
  model.x.min = t0;
  model.x.max = t0 + 4 * hour;
  const second = paint();
  assert.deepEqual(second, first);
  assert.equal(Math.min(...second), open.min);
  assert.equal(Math.max(...second), open.max);

  const refit = normalize({
    legend: false,
    animate: false,
    type: 'line',
    series: [{ name: 'Temp', data }],
    x: { min: t0 + 10 * hour, max: t0 + 14 * hour },
    y: { zero: false },
    markers: false,
  });
  const zoomed = yTickValues(buildChart(refit, 480, 280, measure, themes.light));
  refit.x.min = t0;
  refit.x.max = t0 + 4 * hour;
  const earlier = yTickValues(buildChart(refit, 480, 280, measure, themes.light));
  assert.notDeepEqual(earlier, zoomed);
});

test('a long list of values keeps its ends', () => {
  const values = Array.from({ length: 200000 }, (_, index) => index - 3);
  values[10] = Number.NaN;
  const { min, max } = finiteExtent(values);
  assert.equal(min, -3);
  assert.equal(max, 199996);
});

test('repeated timestamps hover the earlier sample and keep both values', () => {
  const { spec: chartSpec } = spec({
    type: 'line',
    series: [{ name: 'A', data: [[0, 1], [0, 9], [10, 4], [20, 4]] }],
    y: { zero: false },
    markers: false,
  });
  const first = chartSpec.hover.entries.find((entry) => entry.index === 0);
  const hit = hitTest(chartSpec.hover, first.x, first.y);
  assert.equal(hit.index, 0);
  assert.deepEqual(hit.rows.map((row) => row.value), [1, 9]);
});

test('pointer hits on a sorted line keep the earlier sample', () => {
  const data = Array.from({ length: 80 }, (_, index) => [index, 10 + (index % 5)]);
  const { spec: chartSpec } = spec({
    type: 'line',
    series: [
      { name: 'Temp', data },
      { name: 'Load', data: data.map(([x, y]) => [x, y + 4]) },
    ],
    y: { zero: false },
    markers: false,
  }, 860, 280);
  assert.equal(chartSpec.hover.fast, true);
  const sample = chartSpec.hover.entries.find((entry) => entry.index === 40 && entry.seriesIndex === 0);
  const hit = hitTest(chartSpec.hover, sample.x, sample.y);
  assert.equal(hit.index, 40);
  assert.deepEqual(hit.rows.map((row) => row.name), ['Temp', 'Load']);

  const next = chartSpec.hover.entries.find((entry) => entry.index === 41 && entry.seriesIndex === 0);
  const midway = hitTest(chartSpec.hover, (sample.x + next.x) / 2, sample.y);
  assert.equal(midway.index, 40);

  const unsorted = spec({
    type: 'line',
    series: [{ name: 'A', data: [[0, 1], [5, 9], [1, 3]] }],
    y: { zero: false },
    markers: false,
  }).spec;
  assert.equal(unsorted.hover.fast, false);
  const third = unsorted.hover.entries.find((entry) => entry.index === 2);
  assert.equal(hitTest(unsorted.hover, third.x, third.y).index, 2);
});

function pathVertices(d) {
  return [...String(d).matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((match) => ({
    x: Number(match[1]),
    y: Number(match[2]),
  }));
}

test('each axis keeps its own hover point', () => {
  const t0 = Date.UTC(2026, 0, 1);
  const hour = 60 * 60 * 1000;
  const { spec: drawn } = spec({
    type: 'line',
    curve: 'straight',
    markers: false,
    series: [
      { name: 'Temperature', data: [[t0, 30], [t0 + hour, 40], [t0 + 2 * hour, 35]] },
      { name: 'RSSI', yIndex: 1, dash: 5, data: [[t0, -60], [t0 + hour, -80], [t0 + 2 * hour, -70]] },
    ],
    yAxes: [
      { min: 0, max: 100 },
      { opposite: true, min: -130, max: -30 },
    ],
  });
  const strokes = drawn.nodes.filter((node) => node.type === 'path' && node.stroke && node.stroke !== 'none' && !node.glow);
  const temperature = pathVertices(strokes[0].d);
  const rssi = pathVertices(strokes[1].d);
  const hit = hitTest(drawn.hover, temperature[1].x, drawn.plot.y + drawn.plot.h / 2);
  const near = (point, list) => list.some((item) => Math.abs(item.x - point.x) < 0.6 && Math.abs(item.y - point.y) < 0.6);
  assert.equal(hit.markers.length, 2);
  assert.ok(hit.markers.some((point) => near(point, temperature)));
  assert.ok(hit.markers.some((point) => near(point, rssi)));
  assert.ok(Math.abs(hit.markers[0].y - hit.markers[1].y) > 8);
});

test('a column on its own axis hovers at the top of the bar', () => {
  const t0 = Date.UTC(2026, 0, 1);
  const hour = 60 * 60 * 1000;
  const { spec: drawn } = spec({
    type: 'line',
    curve: 'straight',
    series: [
      { name: 'Present', type: 'area', data: [[t0, 20], [t0 + hour, 24], [t0 + 2 * hour, 22]] },
      { name: 'Changes', type: 'column', yIndex: 1, data: [[t0, 1], [t0 + hour, 3], [t0 + 2 * hour, 2]] },
    ],
    yAxes: [
      { min: 0, max: 40 },
      { opposite: true, min: 0, max: 4 },
    ],
  });
  const stroke = drawn.nodes.find((node) => node.type === 'path' && node.stroke && node.stroke !== 'none' && !node.glow);
  const sample = pathVertices(stroke.d)[1];
  const hit = hitTest(drawn.hover, sample.x, drawn.plot.y + 8);
  const areaPoint = hit.markers.find((point) => Math.abs(point.y - sample.y) < 0.6);
  const columnPoint = hit.markers.find((point) => point !== areaPoint);
  const bars = drawn.nodes.filter((node) => node.series != null && !node.sheen);
  const bar = bars.map((node) => {
    const points = pathVertices(node.d);
    return {
      top: Math.min(...points.map((point) => point.y)),
      left: Math.min(...points.map((point) => point.x)),
      right: Math.max(...points.map((point) => point.x)),
    };
  }).find((item) => columnPoint.x >= item.left - 1 && columnPoint.x <= item.right + 1);
  assert.ok(areaPoint);
  assert.ok(bar);
  assert.ok(Math.abs(columnPoint.y - bar.top) < 1.2);
});

test('smooth curves shelf at each sample and do not invent peaks', () => {
  const ramp = [
    { x: 0, y: 0 },
    { x: 100, y: 50 },
    { x: 200, y: 100 },
  ];
  const rampCommands = lineCommands(ramp, 'smooth');
  assert.equal(rampCommands[0].op, 'M');
  for (let i = 1; i < rampCommands.length; i += 1) {
    const command = rampCommands[i];
    const from = ramp[i - 1];
    const to = ramp[i];
    const gap = to.x - from.x;
    assert.equal(command.op, 'C');
    assert.equal(command.y1, from.y);
    assert.equal(command.y2, to.y);
    assert.ok(Math.abs(command.x1 - (from.x + gap * 0.35)) < 1e-9);
    assert.ok(Math.abs(command.x2 - (to.x - gap * 0.35)) < 1e-9);
  }
  const mid = samples(rampCommands).find((point) => Math.abs(point.x - 50) < 8);
  assert.ok(mid);
  assert.ok(Math.abs(mid.y - 25) < 4, `expected the line near y=25, got ${mid.y}`);

  const pair = lineCommands([{ x: 0, y: 4 }, { x: 40, y: 12 }], 'smooth');
  assert.equal(pair[1].op, 'C');
  assert.equal(pair[1].y1, 4);
  assert.equal(pair[1].y2, 12);
  assert.equal(pair[1].x1, 14);
  assert.equal(pair[1].x2, 26);

  const valley = lineCommands([
    { x: 0, y: 100 },
    { x: 100, y: 0 },
    { x: 200, y: 100 },
  ], 'smooth');
  for (const point of samples(valley)) assert.ok(point.y >= -0.5, `valley overshoot ${point.y}`);

  const bump = lineCommands([
    { x: 0, y: 0 },
    { x: 50, y: 0 },
    { x: 100, y: 10 },
    { x: 150, y: 0 },
    { x: 200, y: 0 },
  ], 'smooth');
  for (const point of samples(bump)) assert.ok(point.y <= 10.2, `bump overshoot ${point.y}`);
});

test('nulls break a line into separate segments', () => {
  const { spec: chartSpec } = spec({
    type: 'line',
    categories: ['a', 'b', 'c', 'd', 'e'],
    series: { Latency: [1, 2, null, 5, 6] },
    markers: false,
  });
  const strokes = chartSpec.nodes.filter((node) => node.type === 'path' && node.stroke && node.stroke !== 'none' && !node.glow);
  assert.equal(strokes.length, 2);
});

test('area fill closes back to the baseline', () => {
  const top = [{ x: 0, y: 10 }, { x: 10, y: 0 }, { x: 20, y: 8 }];
  const base = [{ x: 0, y: 20 }, { x: 10, y: 20 }, { x: 20, y: 20 }];
  const commands = areaCommands(top, base, 'straight');
  assert.equal(commands.at(-1).op, 'Z');
  assert.match(toPath(commands), /^M/);
  const drop = commands[lineCommands(top, 'straight').length];
  assert.equal(drop.op, 'L');
  assert.equal(drop.x, 20);
  assert.equal(drop.y, 20);

  const crest = [{ x: 0, y: 8 }, { x: 30, y: 4 }, { x: 60, y: 9 }];
  const under = [{ x: 0, y: 18 }, { x: 30, y: 16 }, { x: 60, y: 14 }];
  for (const curve of ['smooth', 'straight', 'stepline']) {
    const band = areaCommands(crest, under, curve);
    const join = band[lineCommands(crest, curve).length];
    assert.equal(join.op, 'L', curve);
    assert.equal(join.x, 60, curve);
    assert.equal(join.y, 14, curve);
    assert.equal(areaPath(crest, under, curve), toPath(band), curve);
  }
});

test('direct path strings match the command list', () => {
  const sets = [
    [],
    [{ x: -4.26, y: 12 }],
    [{ x: 0, y: 4 }, { x: 40, y: 12 }],
    [
      { x: 0, y: 0 },
      { x: 12.34, y: 8.2 },
      { x: 20, y: -3 },
      { x: 48.5, y: 15 },
      { x: 60, y: 15 },
    ],
  ];
  for (const points of sets) {
    for (const curve of ['smooth', 'straight', 'stepline']) {
      assert.equal(linePath(points, curve), toPath(lineCommands(points, curve)), curve);
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      assert.equal(lineCoords(xs, ys, curve), toPath(lineCommands(points, curve)), curve);
    }
  }
  const top = sets[3];
  const base = top.map((point) => ({ x: point.x, y: 30 }));
  for (const curve of ['smooth', 'straight', 'stepline']) {
    assert.equal(areaPath(top, base, curve), toPath(areaCommands(top, base, curve)), curve);
    assert.equal(
      areaBand(top.map((point) => point.x), top.map((point) => point.y), curve, { y: 30 }),
      toPath(areaCommands(top, base, curve)),
      curve,
    );
    assert.equal(
      areaBand(top.map((point) => point.x), top.map((point) => point.y), curve, { x: 4 }),
      toPath(areaCommands(top, top.map((point) => ({ x: 4, y: point.y })), curve)),
      curve,
    );
  }
});

test('a missing time sample splits the stroke', () => {
  const { spec: chartSpec } = spec({
    type: 'line',
    curve: 'straight',
    series: [{ name: 'Temp', data: [[0, 1], [1, 2], [2, null], [3, 4], [4, 5]] }],
    y: { zero: false },
    markers: false,
  });
  const strokes = chartSpec.nodes.filter((node) => node.type === 'path' && node.stroke && node.stroke !== 'none' && !node.glow);
  assert.equal(strokes.length, 2);
  assert.match(strokes[0].d, /^M/);
  assert.match(strokes[1].d, /^M/);
});

test('series can be a list, a map, or a one-value map', () => {
  const mapped = normalize({
    categories: ['Mon', 'Tue'],
    series: { New: [1, 2], Returning: [3, 4] },
  });
  assert.deepEqual(mapped.series.map((series) => series.name), ['New', 'Returning']);
  assert.equal(mapped.series[0].color, palette[0]);

  const bars = normalize({ type: 'bar', series: { Mon: 2, Tue: 5 } });
  assert.deepEqual(bars.categories, ['Mon', 'Tue']);
  assert.equal(bars.series.length, 1);
  assert.deepEqual(bars.series[0].values, [2, 5]);

  const slices = normalize({ type: 'pie', series: { Chrome: 60, Safari: 20 } });
  assert.equal(slices.pointMode, 'pie');
  assert.deepEqual(slices.series.map((series) => series.name), ['Chrome', 'Safari']);

  const listed = normalize({ series: [4, 5, 6] });
  assert.deepEqual(listed.series[0].values, [4, 5, 6]);
  assert.equal(listed.categories, null);
});

test('rows become series, including grouped rows', () => {
  const table = normalize({
    type: 'bar',
    data: [
      { month: 'Jan', revenue: 10, cost: 4 },
      { month: 'Feb', revenue: 12, cost: 5 },
    ],
  });
  assert.deepEqual(table.categories, ['Jan', 'Feb']);
  assert.deepEqual(table.series.map((series) => series.name), ['Revenue', 'Cost']);
  assert.deepEqual(table.series[0].values, [10, 12]);

  const grouped = normalize({
    type: 'line',
    data: [
      { quarter: 'Q1', region: 'east', value: 1 },
      { quarter: 'Q1', region: 'west', value: 2 },
      { quarter: 'Q2', region: 'east', value: 3 },
    ],
    xKey: 'quarter',
    yKeys: 'value',
    groupKey: 'region',
  });
  assert.deepEqual(grouped.categories, ['Q1', 'Q2']);
  assert.deepEqual(grouped.series.map((series) => series.name), ['East', 'West']);
  assert.deepEqual(grouped.series[0].values, [1, 3]);
  assert.deepEqual(grouped.series[1].values, [2, null]);
});

test('scatter and time series keep point pairs', () => {
  const points = normalize({
    type: 'scatter',
    series: { Trial: [[1, 2], [3, 4]] },
  });
  assert.equal(points.pointMode, 'linear');
  assert.deepEqual(points.series[0].points, [{ x: 1, y: 2 }, { x: 3, y: 4 }]);

  const timed = normalize({
    type: 'line',
    series: [{
      name: 'Temp',
      data: [
        [Date.parse('2026-01-01T00:00:00Z'), 4],
        [Date.parse('2026-02-01T00:00:00Z'), 7],
      ],
    }],
  });
  assert.equal(timed.pointMode, 'time');
  assert.equal(timed.series[0].points[1].y, 7);
});

test('stacking keeps positives and negatives apart', () => {
  const stacked = stackSeries([
    { values: [1, -2, null] },
    { values: [3, -1, 4] },
  ]);
  assert.deepEqual(stacked.base[0], [0, 0, null]);
  assert.deepEqual(stacked.top[0], [1, -2, null]);
  assert.deepEqual(stacked.base[1], [1, -2, 0]);
  assert.deepEqual(stacked.top[1], [4, -3, 4]);
  assert.equal(stacked.outer[1][0], true);
  assert.equal(stacked.outer[0][0], false);
  assert.equal(stacked.min, -3);
  assert.equal(stacked.max, 4);
});

test('a line puts larger values higher on the screen', () => {
  const { spec: chartSpec } = spec({
    type: 'line',
    categories: ['A', 'B', 'C'],
    series: { Revenue: [0, 10, 5] },
    markers: false,
  });
  const heights = chartSpec.hover.entries.map((entry) => entry.rows[0].y);
  assert.ok(heights[1] < heights[0]);
  assert.ok(heights[1] < heights[2]);
  assert.ok(chartSpec.plot.w > 100);
  assert.equal(chartSpec.nodes.some((node) => node.type === 'path' && node.d.startsWith('M')), true);
});

test('bars share a category and horizontal bars read top to bottom', () => {
  const { spec: grouped } = spec({
    type: 'bar',
    categories: ['Q1', 'Q2'],
    series: { New: [2, 4], Returning: [1, 3] },
  });
  const bars = grouped.nodes.filter((node) => node.type === 'path' && node.series != null);
  assert.equal(bars.length, 4);
  const firstGroup = bars.filter((node) => node.index === 0);
  assert.ok(firstGroup[0].d !== firstGroup[1].d);

  const { spec: horizontal } = spec({
    type: 'horizontalBar',
    categories: ['Docs', 'Pricing'],
    series: [8, 5],
    legend: false,
  });
  assert.equal(horizontal.hover.kind, 'band-y');
  assert.ok(horizontal.hover.entries[0].y < horizontal.hover.entries[1].y);
});

test('a throwing axis format falls back to the plain label', () => {
  const t0 = Date.UTC(2026, 0, 1);
  const hour = 60 * 60 * 1000;
  const { spec: drawn } = spec({
    type: 'line',
    series: [{ name: 'Load', data: [[t0, 10], [t0 + hour, 20], [t0 + 2 * hour, 30]] }],
    x: { utc: true, format: () => { throw new Error('bad time'); } },
    y: { format: () => { throw new Error('bad format'); } },
    markers: false,
  });
  const labels = drawn.nodes.filter((node) => node.type === 'text').map((node) => node.text);
  assert.ok(labels.some((text) => /^\d{2}:\d{2}$/.test(text)), labels.join(', '));
  assert.ok(labels.includes('10') || labels.includes('0'), labels.join(', '));
  assert.ok(!labels.includes('bad format'));
  assert.ok(!labels.includes('bad time'));
});

test('a throwing center value still draws its caption', () => {
  const { spec: drawn } = spec({
    type: 'donut',
    series: [1, 2],
    center: { label: 'Total', value: () => { throw new Error('bad center'); } },
    showValues: false,
  }, 280, 280);
  const labels = drawn.nodes.filter((node) => node.type === 'text').map((node) => node.text);
  assert.ok(labels.includes('Total'), labels.join(', '));
  assert.ok(!labels.includes('bad center'));
});

test('the same model redraws from the new window', () => {
  const t0 = Date.UTC(2026, 0, 1);
  const hour = 60 * 60 * 1000;
  const model = normalize({
    type: 'line',
    legend: false,
    animate: false,
    series: [{ name: 'Load', data: [[t0, 10], [t0 + hour, 20], [t0 + 2 * hour, 15], [t0 + 3 * hour, 30]] }],
    x: { utc: true, min: t0, max: t0 + 3 * hour },
  });
  const pathOf = (drawn) => drawn.nodes.filter((node) => node.type === 'path').map((node) => node.d).join('|');
  const first = buildChart(model, 480, 280, measure, themes.light);
  const again = buildChart(model, 480, 280, measure, themes.light);
  assert.equal(pathOf(first), pathOf(again));
  assert.deepEqual(first.xDomain, again.xDomain);
  model.x.min = t0 + hour;
  model.x.max = t0 + 2 * hour;
  const zoomed = buildChart(model, 480, 280, measure, themes.light);
  assert.notEqual(pathOf(first), pathOf(zoomed));
});

test('hiding a series recomputes a full stack', () => {
  const model = normalize({
    type: 'bar',
    stacked: true,
    stackType: '100%',
    legend: false,
    animate: false,
    categories: ['A'],
    series: [
      { name: 'One', data: [1] },
      { name: 'Two', data: [3] },
    ],
  });
  const pathOf = (drawn) => drawn.nodes.filter((node) => node.type === 'path').map((node) => node.d).join('|');
  const before = pathOf(buildChart(model, 480, 280, measure, themes.light));
  model.series[0].hidden = true;
  const after = pathOf(buildChart(model, 480, 280, measure, themes.light));
  assert.notEqual(before, after);
  assert.ok(after.length > 0);
});

test('explicit y limits stay put', () => {
  const { spec: chartSpec } = spec({
    type: 'line',
    categories: ['A', 'B'],
    series: [10, 20],
    y: { min: 0, max: 100, format: (value) => `${value}u` },
    markers: false,
  });
  const labels = chartSpec.nodes.filter((node) => node.type === 'text').map((node) => node.text);
  assert.ok(labels.includes('0u'));
  assert.ok(labels.includes('100u'));
});

test('pie percents keep one decimal, including a small slice', () => {
  const { spec: pie } = spec({
    type: 'pie',
    series: [18, 6, 3, 2],
    showValues: true,
  }, 320, 320);
  const labels = pie.nodes.filter((node) => node.type === 'text').map((node) => node.text);
  assert.ok(labels.includes('62.1%'), labels.join(', '));
  assert.ok(labels.includes('20.7%'), labels.join(', '));
  assert.ok(labels.includes('10.3%'), labels.join(', '));
  assert.ok(labels.includes('6.9%'), labels.join(', '));
});

test('a donut center can put a caption above the total', () => {
  const { spec: chartSpec } = spec({
    type: 'donut',
    series: [18, 6, 3, 2],
    center: (total) => ({ label: 'Equipment', value: String(total) }),
    showValues: false,
  }, 280, 280);
  const labels = chartSpec.nodes.filter((node) => node.type === 'text').map((node) => node.text);
  assert.ok(labels.includes('Equipment'));
  assert.ok(labels.includes('29'));
});

test('radar rings are numbered', () => {
  const { spec: radar } = spec({
    type: 'radar',
    categories: ['Latency', 'Loss', 'Jitter', 'Signal', 'Uptime'],
    series: [{ name: 'Site A', data: [80, 50, 60, 70, 90] }],
  }, 420, 320);
  const labels = radar.nodes.filter((node) => node.type === 'text').map((node) => node.text);
  assert.ok(labels.includes('100'), labels.join(', '));
  assert.ok(labels.includes('0'), labels.join(', '));
  assert.ok(labels.includes('Latency'));
});

test('grid lines are dashed and a limit sits at the right end', () => {
  const { spec: chartSpec } = spec({
    type: 'line',
    categories: ['Mon', 'Tue', 'Wed'],
    series: { Revenue: [30, 50, 70] },
    annotations: { yaxis: [{ y: 70, borderColor: '#e2547a', label: { text: 'Limit' } }] },
    markers: false,
  });
  assert.ok(chartSpec.nodes.some((node) => node.type === 'line' && node.dash === '3'));
  const note = chartSpec.nodes.find((node) => node.type === 'line' && node.dash === '2 3');
  assert.ok(note);
  const text = chartSpec.nodes.find((node) => node.text === 'Limit');
  assert.equal(text.anchor, 'end');
});

test('pie slices fill the circle and a single slice is closed', () => {
  const { spec: chartSpec } = spec({
    type: 'donut',
    series: { A: 1, B: 1, C: 2 },
    showValues: false,
    center: false,
  }, 320, 320);
  const sweeps = chartSpec.hover.entries.map((entry) => entry.end - entry.start);
  assert.equal(chartSpec.hover.entries[0].start, 0);
  assert.ok(Math.abs(sweeps.reduce((sum, sweep) => sum + sweep, 0) - Math.PI * 2) < 1e-6);
  assert.ok(sweeps[2] > sweeps[0]);

  const { spec: only } = spec({ type: 'pie', series: { Only: 5 } }, 240, 240);
  const path = only.nodes.find((node) => node.type === 'path');
  assert.ok(path.d.length > 10);
  assert.equal((path.d.match(/A/g) || []).length, 2);

  const top = polar(0, 0, 10, 0);
  assert.ok(Math.abs(top[0]) < 1e-9);
  assert.ok(Math.abs(top[1] + 10) < 1e-9);
});

test('category text is kept as text, including markup-looking labels', () => {
  const { spec: chartSpec } = spec({
    type: 'bar',
    categories: ['<b>'],
    series: [3],
  });
  assert.ok(chartSpec.nodes.some((node) => node.type === 'text' && node.text === '<b>'));
});

test('negative bars sit below zero and stacked areas keep one band each', () => {
  const { spec: bars } = spec({
    type: 'bar',
    categories: ['Up', 'Down'],
    series: [5, -4],
  });
  const marks = bars.nodes.filter((node) => node.series != null);
  assert.equal(marks.length, 2);
  assert.ok(bars.hover.entries[1].rows[0].y > bars.hover.entries[0].rows[0].y);

  const { spec: areas } = spec({
    type: 'area',
    stacked: true,
    categories: ['A', 'B'],
    series: { One: [1, 2], Two: [3, 4] },
  });
  const fills = areas.nodes.filter((node) => node.type === 'path' && node.fill && node.fill !== 'none');
  assert.equal(fills.length, 2);
  assert.ok(fills.every((node) => node.fill !== 'none' && !String(node.fill).includes('url(')));
});

test('a category window stretches the visible labels and keeps the value scale', () => {
  const categories = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const series = [{ name: 'Revenue', data: [30, 42, 36, 50, 47, 62, 70] }];
  const open = spec({ type: 'line', categories, series, zoom: true, markers: false });
  const still = spec({ type: 'line', categories, series, markers: false });
  const at = (chartSpec, text) => chartSpec.nodes.find((node) => node.type === 'text' && node.text === text);
  assert.equal(open.spec.xDomain.min, 0);
  assert.equal(open.spec.xDomain.max, categories.length - 1);
  assert.equal(still.spec.xDomain.min, 0);
  assert.equal(still.spec.xDomain.max, categories.length - 1);
  assert.ok(Math.abs(at(open.spec, 'Mon').x - open.spec.plot.x) < 0.05);
  assert.ok(Math.abs(at(open.spec, 'Sun').x - (open.spec.plot.x + open.spec.plot.w)) < 0.05);
  assert.ok(Math.abs(at(open.spec, 'Mon').x - at(still.spec, 'Mon').x) < 0.01);
  assert.ok(Math.abs(at(open.spec, 'Sun').x - at(still.spec, 'Sun').x) < 0.01);
  assert.deepEqual(yTickValues(open.spec), yTickValues(still.spec));

  const zoomed = spec({
    type: 'line',
    categories,
    series,
    zoom: true,
    markers: false,
    x: { min: 1.5, max: 4.5 },
  });
  const names = zoomed.spec.nodes.filter((node) => node.baseline === 'hanging').map((node) => node.text);
  assert.deepEqual(names, ['Wed', 'Thu', 'Fri']);
  assert.deepEqual(yTickValues(zoomed.spec), yTickValues(open.spec));
  const span = at(zoomed.spec, 'Fri').x - at(zoomed.spec, 'Wed').x;
  const full = at(open.spec, 'Fri').x - at(open.spec, 'Wed').x;
  assert.ok(span > full * 1.5);
});

test('a time line meets both sides and a column on that axis stays inset', () => {
  const day = Date.parse('2026-10-08T00:00:00Z');
  const hour = 3600000;
  const { spec: timed } = spec({
    type: 'line',
    curve: 'straight',
    markers: false,
    series: [{ name: 'Temp', data: [[day, 30], [day + hour, 32], [day + 2 * hour, 31]] }],
  });
  const stroke = timed.nodes.find((node) => node.type === 'path' && node.stroke && node.stroke !== 'none' && !node.glow);
  const xs = [...stroke.d.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0])).filter((_, index) => index % 2 === 0);
  assert.ok(Math.abs(xs[0] - timed.plot.x) < 0.06);
  assert.ok(Math.abs(xs[xs.length - 1] - (timed.plot.x + timed.plot.w)) < 0.06);

  const { spec: mixed } = spec({
    type: 'line',
    curve: 'straight',
    series: [
      { name: 'Present', type: 'area', data: [[day, 20], [day + hour, 22]] },
      { name: 'Changes', type: 'column', data: [[day, 1], [day + hour, 3]] },
    ],
  });
  assert.ok(mixed.xDomain.min < day);
  assert.ok(mixed.xDomain.max > day + hour);

  const { spec: columns } = spec({
    type: 'bar',
    categories: ['Mon', 'Tue', 'Wed'],
    series: [1, 2, 3],
    zoom: true,
  });
  assert.equal(columns.xDomain.min, -0.5);
  assert.equal(columns.xDomain.max, 2.5);
});

test('candles window by category and keep the value scale', () => {
  const data = ['Oct 1', 'Oct 2', 'Oct 3', 'Oct 4', 'Oct 5', 'Oct 6'].map((label, index) => ({
    x: label,
    y: [70 + index, 76 + index, 68, 74],
  }));
  const open = spec({
    type: 'candlestick',
    zoom: true,
    x: { type: 'category' },
    series: [{ name: 'Session', data }],
  });
  assert.equal(open.spec.xDomain.min, -0.5);
  assert.equal(open.spec.xDomain.max, data.length - 0.5);
  const zoomed = spec({
    type: 'candlestick',
    zoom: true,
    x: { type: 'category', min: 1.5, max: 3.5 },
    series: [{ name: 'Session', data }],
  });
  const names = zoomed.spec.nodes.filter((node) => node.baseline === 'hanging').map((node) => node.text);
  assert.deepEqual(names, ['Oct 3', 'Oct 4']);
  assert.deepEqual(yTickValues(zoomed.spec), yTickValues(open.spec));
  assert.ok(zoomed.spec.xDomain.max - zoomed.spec.xDomain.min < open.spec.xDomain.max - open.spec.xDomain.min);
});

test('unknown chart types and missing data fail clearly', () => {
  assert.throws(() => normalize({ type: 'sankey', series: [1] }), /unknown chart type/);
  assert.throws(() => normalize({ title: 'Empty' }), /series or data/);
});
