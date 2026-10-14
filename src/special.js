import { formatNumber } from './format.js';
import { categoryWindow, resolveDomain, scaleLinear } from './scale.js';
import { centerContent, finiteExtent, inkOn, round } from './util.js';

const SPECIAL = new Set([
  'radialBar', 'heatmap', 'candlestick', 'boxPlot', 'radar',
  'polarArea', 'rangeBar', 'rangeArea', 'treemap',
]);

/** Chart types that do not share the cartesian line/bar path. Returns null for the others. */
export function buildSpecial(display, width, height, measure, theme, model) {
  if (!SPECIAL.has(model.type)) return null;
  if (model.type === 'radialBar') return buildRadial(display, width, height, theme, model);
  if (model.type === 'polarArea') return buildPolar(display, width, height, theme, model);
  if (model.type === 'radar') return buildRadar(display, width, height, measure, theme, model);
  if (model.type === 'heatmap') return buildHeatmap(display, width, height, measure, theme, model);
  if (model.type === 'treemap') return buildTreemap(width, height, measure, theme, model);
  if (model.type === 'candlestick') return buildCandle(display, width, height, measure, theme, model, 'candle');
  if (model.type === 'boxPlot') return buildCandle(display, width, height, measure, theme, model, 'box');
  if (model.type === 'rangeBar') return buildRangeBar(display, width, height, measure, theme, model);
  return buildRangeArea(display, width, height, measure, theme, model);
}

function buildRadial(display, width, height, theme, model) {
  const slices = ringValues(display, model);
  if (!slices.length) return empty(width, height, theme, model);
  const max = Math.max(100, ...slices.map((slice) => slice.value));
  const cx = width / 2;
  const cy = height / 2;
  const inset = model.sparkline ? 8 : 34;
  const outer = Math.max(12, Math.min(width, height) / 2 - inset);
  const hole = outer * (model.inner > 0 ? model.inner : 0.42);
  const gap = slices.length > 1 ? 4 : 0;
  const thick = (outer - hole - gap * (slices.length - 1)) / slices.length;
  const { a0, sweep: track } = radialAngles(model);
  const nodes = [];
  const entries = [];
  slices.forEach((slice, order) => {
    const r1 = outer - order * (thick + gap);
    const r0 = r1 - thick;
    nodes.push({
      type: 'path',
      d: arc(cx, cy, r0, r1, a0, a0 + track),
      fill: theme.track || theme.grid,
      stroke: 'none',
      sw: 0,
      fillRule: track >= Math.PI * 2 - 1e-3 ? 'evenodd' : null,
    });
    const sweep = Math.max(0, Math.min(1, slice.value / max)) * track;
    let slicePath = '';
    if (sweep > 0.01) {
      const d = arc(cx, cy, r0, r1, a0, a0 + sweep);
      if (!model.sparkline) {
        nodes.push({
          type: 'path',
          d,
          fill: 'none',
          stroke: slice.color,
          sw: 12,
          strokeOpacity: 0.2,
          cap: 'round',
          join: 'round',
          glow: true,
        });
      }
      nodes.push({
        type: 'path',
        d,
        fill: slice.color,
        stroke: 'none',
        sw: 0,
        fillRule: sweep >= Math.PI * 2 - 1e-3 ? 'evenodd' : null,
      });
      slicePath = d;
    }
    if (model.showValues && slices.length > 1 && thick >= 14) {
      const at = polar(cx, cy, (r0 + r1) / 2, a0 + Math.min(sweep, track * 0.92) / 2);
      nodes.push(text(at[0], at[1], `${Math.round(slice.value)}%`, 'middle', 'middle', inkOn(slice.color), 11, 700));
    }
    entries.push({
      index: slice.index,
      name: slice.name,
      value: slice.value,
      color: slice.color,
      start: a0,
      end: a0 + Math.max(sweep, 0.001),
      cx,
      cy,
      r0,
      r1,
      d: slicePath,
      label: slice.name,
      rows: [{ name: slice.name, value: slice.value, color: slice.color, seriesIndex: slice.index }],
    });
  });
  const lead = slices[0];
  const custom = centerContent(model.center, lead.value);
  const valueText = custom ? custom.text : `${Math.round(lead.value)}%`;
  const caption = custom ? (custom.label || lead.name) : lead.name;
  if (!caption) {
    nodes.push(text(cx, cy, valueText, 'middle', 'middle', theme.fg, 22, 700));
  } else if (custom) {
    nodes.push(text(cx, cy - 6, valueText, 'middle', 'middle', theme.fg, 22, 700));
    nodes.push(text(cx, cy + 14, caption, 'middle', 'middle', theme.muted, 11, 500));
  } else {
    nodes.push(text(cx, cy - 11, valueText, 'middle', 'middle', theme.muted, 14, 500));
    nodes.push(text(cx, cy + 12, caption, 'middle', 'middle', theme.fg, 16, 700));
  }
  return finish(model, nodes, { x: cx - outer, y: cy - outer, w: outer * 2, h: outer * 2 }, {
    kind: 'pie',
    plot: { x: cx - outer, y: cy - outer, w: outer * 2, h: outer * 2 },
    entries,
  });
}

function buildPolar(display, width, height, theme, model) {
  const slices = ringValues(display, model).filter((slice) => slice.value > 0);
  if (!slices.length) return empty(width, height, theme, model);
  const max = Math.max(...slices.map((slice) => slice.value));
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.max(12, Math.min(width, height) / 2 - 16);
  const step = (Math.PI * 2) / slices.length;
  const nodes = [];
  const entries = [];
  slices.forEach((slice, order) => {
    const r1 = radius * (slice.value / max);
    const start = order * step;
    const end = start + step;
    const d = arc(cx, cy, 0, r1, start, end);
    nodes.push({
      type: 'path',
      d,
      fill: slice.color,
      stroke: theme.ring,
      sw: 1.5,
    });
    if (model.showValues && step > 0.35) {
      const at = polar(cx, cy, r1 * 0.62, (start + end) / 2);
      nodes.push(text(at[0], at[1], `${Math.round((slice.value / slices.reduce((sum, item) => sum + item.value, 0)) * 100)}%`, 'middle', 'middle', inkOn(slice.color), 11, 700));
    }
    entries.push({
      index: slice.index,
      start,
      end,
      cx,
      cy,
      r0: 0,
      r1,
      d,
      label: slice.name,
      rows: [{ name: slice.name, value: slice.value, color: slice.color, seriesIndex: slice.index }],
    });
  });
  return finish(model, nodes, { x: cx - radius, y: cy - radius, w: radius * 2, h: radius * 2 }, {
    kind: 'pie',
    plot: { x: cx - radius, y: cy - radius, w: radius * 2, h: radius * 2 },
    entries,
  });
}

function buildRadar(display, width, height, measure, theme, model) {
  const count = Math.max(model.categories?.length || 0, ...model.series.map((series) => series.values?.length || 0));
  if (count < 3) return empty(width, height, theme, model);
  const labels = Array.from({ length: count }, (_, index) => model.categories?.[index] || String(index + 1));
  let max = 0;
  model.series.forEach((series, seriesIndex) => {
    if (series.hidden) return;
    for (let index = 0; index < count; index += 1) {
      const value = num(display.series[seriesIndex]?.values?.[index] ?? series.values?.[index]);
      if (value != null) max = Math.max(max, value);
    }
  });
  const domain = resolveDomain(0, max || 1, { zero: true, min: model.y.min, max: model.y.max, ticks: 6 });
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.max(16, Math.min(width, height) / 2 - 36);
  const nodes = [];
  const span = domain.max - domain.min || 1;
  domain.ticks.forEach((value) => {
    const at = (value - domain.min) / span;
    if (at > 0.04) {
      const points = labels.map((_, index) => polar(cx, cy, radius * at, (index / count) * Math.PI * 2));
      nodes.push(poly(points, true, 'none', theme.grid, 1));
    }
    const y = cy - radius * at + (at > 0.96 ? 16 : 0);
    nodes.push(text(cx, y, formatNumber(value), 'middle', 'middle', theme.muted, 10, 500));
  });
  labels.forEach((label, index) => {
    const [x, y] = polar(cx, cy, radius, (index / count) * Math.PI * 2);
    nodes.push({ type: 'line', x1: cx, y1: cy, x2: x, y2: y, stroke: theme.grid, sw: 1 });
    const [lx, ly] = polar(cx, cy, radius + 20, (index / count) * Math.PI * 2);
    const anchor = lx < cx - 4 ? 'end' : lx > cx + 4 ? 'start' : 'middle';
    nodes.push(text(lx, ly, clip(label, 14), anchor, 'middle', theme.muted, 11, 400));
  });
  const entries = [];
  model.series.forEach((series, seriesIndex) => {
    if (series.hidden) return;
    const points = [];
    for (let index = 0; index < count; index += 1) {
      const value = num(display.series[seriesIndex]?.values?.[index] ?? series.values?.[index]);
      const at = value == null ? 0 : (value - domain.min) / (domain.max - domain.min || 1);
      points.push(polar(cx, cy, radius * Math.max(0, Math.min(1, at)), (index / count) * Math.PI * 2));
    }
    const glow = poly(points, true, 'none', series.color, 8);
    glow.strokeOpacity = 0.2;
    glow.glow = true;
    nodes.push(glow);
    nodes.push(poly(points, true, series.color, series.color, 2, 0.18));
    points.forEach((point, index) => {
      const value = num(series.values?.[index]);
      nodes.push({
        type: 'circle', cx: point[0], cy: point[1], r: 8, fill: series.color, fillOpacity: 0.2, stroke: 'none',
      });
      nodes.push(circle(point[0], point[1], 3, series.color, theme));
      nodes.push({
        type: 'circle',
        cx: point[0] - 0.7,
        cy: point[1] - 0.8,
        r: 1.1,
        fill: '#fff',
        fillOpacity: 0.9,
        stroke: 'none',
      });
      entries.push({
        index,
        x: point[0],
        y: point[1],
        label: labels[index],
        rows: [{ name: series.name, value, color: series.color, y: point[1], seriesIndex }],
      });
    });
  });
  return finish(model, nodes, { x: cx - radius, y: cy - radius, w: radius * 2, h: radius * 2 }, {
    kind: 'point',
    plot: { x: cx - radius, y: cy - radius, w: radius * 2, h: radius * 2 },
    entries,
  });
}

function buildHeatmap(display, width, height, measure, theme, model) {
  const rows = model.series.map((series, index) => ({ series, index })).filter((row) => !row.series.hidden);
  const count = Math.max(model.categories?.length || 0, ...model.series.map((series) => series.values?.length || 0));
  if (!rows.length || count < 1) return empty(width, height, theme, model);
  const labels = Array.from({ length: count }, (_, index) => model.categories?.[index] || String(index + 1));
  const names = rows.map((row) => row.series.name);
  const frame = axesFrame(width, height, measure, names, labels, model, theme);
  const values = [];
  rows.forEach((row) => {
    for (let index = 0; index < count; index += 1) {
      const value = num(display.series[row.index]?.values?.[index] ?? row.series.values?.[index]);
      if (value != null) values.push(value);
    }
  });
  const { min: lo, max: hi } = finiteExtent(values);
  const cellW = frame.plot.w / count;
  const cellH = frame.plot.h / rows.length;
  const nodes = [...frame.nodes];
  rows.forEach((row, rowIndex) => {
    nodes.push(text(frame.plot.x - 8, frame.plot.y + (rowIndex + 0.5) * cellH, clip(row.series.name, 16), 'end', 'middle', theme.muted, 11, 400));
  });
  const entries = [];
  const gradients = [];
  const ink = model.colors?.[0] || rows[0].series.color;
  rows.forEach((row, rowIndex) => {
    for (let index = 0; index < count; index += 1) {
      const value = num(display.series[row.index]?.values?.[index] ?? row.series.values?.[index]);
      const x = frame.plot.x + index * cellW;
      const y = frame.plot.y + rowIndex * cellH;
      const eased = Math.pow(Math.max(0, Math.min(1, (value - lo) / (hi - lo || 1))), 1.05);
      const color = value == null ? theme.grid : mix('#f4f7fb', ink, 0.16 + eased * 0.84);
      const inset = 2;
      const rect = {
        x: x + inset,
        y: y + inset,
        w: Math.max(0, cellW - inset * 2),
        h: Math.max(0, cellH - inset * 2),
      };
      const d = rectPath(rect.x, rect.y, rect.w, rect.h, 4);
      nodes.push({
        type: 'path',
        d,
        fill: color,
        stroke: 'none',
        sw: 0,
      });
      pushSheen(nodes, gradients, d, 'top', rect);
      if (model.showValues && value != null && cellW > 28 && cellH > 16) {
        nodes.push(text(x + cellW / 2, y + cellH / 2, formatNumber(value), 'middle', 'middle', inkOn(color), 11, 600));
      }
      entries.push({
        index,
        x,
        y,
        x0: x,
        y0: y,
        x1: x + cellW,
        y1: y + cellH,
        label: labels[index],
        rows: [{ name: row.series.name, value, color, seriesIndex: row.index }],
      });
    }
  });
  return finish(model, nodes, frame.plot, { kind: 'cell', plot: frame.plot, entries }, { gradients });
}

function buildTreemap(width, height, measure, theme, model) {
  const items = model.series
    .map((series, index) => ({
      name: series.name,
      value: Math.max(0, num(series.values?.[0]) || 0),
      color: series.color,
      index,
    }))
    .filter((item) => item.value > 0 && !model.series[item.index].hidden)
    .sort((a, b) => b.value - a.value);
  if (!items.length) return empty(width, height, theme, model);
  const pad = 8;
  const laid = squarify(items, pad, pad, Math.max(8, width - pad * 2), Math.max(8, height - pad * 2));
  const nodes = [];
  const entries = [];
  const gradients = [];
  for (const item of laid) {
    const rect = { x: item.x + 1, y: item.y + 1, w: Math.max(0, item.w - 2), h: Math.max(0, item.h - 2) };
    const d = rectPath(rect.x, rect.y, rect.w, rect.h, 4);
    nodes.push({
      type: 'path',
      d,
      fill: item.color,
      stroke: theme.ring,
      sw: 1,
    });
    pushSheen(nodes, gradients, d, 'top', rect);
    if (item.w > 36 && item.h > 22) {
      const ink = inkOn(item.color);
      const nameY = model.showValues && item.h > 36 ? item.y + item.h / 2 - 7 : item.y + item.h / 2;
      nodes.push(text(item.x + item.w / 2, nameY, clip(item.name, Math.floor(item.w / 7)), 'middle', 'middle', ink, 12, 600));
      if (model.showValues && item.h > 36) {
        nodes.push(text(item.x + item.w / 2, item.y + item.h / 2 + 9, formatNumber(item.value), 'middle', 'middle', ink, 11, 500));
      }
    }
    entries.push({
      index: item.index,
      x0: item.x,
      y0: item.y,
      x1: item.x + item.w,
      y1: item.y + item.h,
      label: item.name,
      rows: [{ name: item.name, value: item.value, color: item.color, seriesIndex: item.index }],
    });
  }
  return finish(model, nodes, { x: pad, y: pad, w: width - pad * 2, h: height - pad * 2 }, {
    kind: 'cell',
    plot: { x: pad, y: pad, w: width - pad * 2, h: height - pad * 2 },
    entries,
  }, { gradients });
}

function buildCandle(display, width, height, measure, theme, model, mode) {
  const rows = collectRows(display, model);
  if (!rows.length) return empty(width, height, theme, model);
  const labels = rows.map((row) => row.label);
  const nums = rows.flatMap((row) => row.extra.filter((value) => value != null));
  const candleExtent = finiteExtent(nums);
  const domain = resolveDomain(candleExtent.min, candleExtent.max, {
    zero: false,
    min: model.y.min,
    max: model.y.max,
    ticks: 5,
  });
  const ranged = !!(model.zoom || model.x?.min != null || model.x?.max != null);
  const xWindow = ranged ? categoryWindow(rows.length, model.x?.min, model.x?.max) : null;
  const frame = axesFrame(
    width,
    height,
    measure,
    domain.ticks.map((value) => formatNumber(value)),
    xWindow?.windowed ? [] : labels,
    model,
    theme,
  );
  const scale = scaleLinear(domain.min, domain.max, frame.plot.y + frame.plot.h, frame.plot.y);
  const gradients = [];
  const scaleX = xWindow
    ? scaleLinear(xWindow.min, xWindow.max, frame.plot.x, frame.plot.x + frame.plot.w)
    : null;
  const slot = scaleX ? Math.abs(scaleX(1) - scaleX(0)) : frame.plot.w / rows.length;
  const nodes = [...frame.nodes];
  if (xWindow?.windowed) {
    const shown = xWindow.ticks.map((index) => labels[index]);
    const widest = shown.reduce((max, label) => Math.max(max, measure(String(label), 11)), 0);
    const every = widest > slot - 2 ? Math.max(1, Math.ceil((widest + 2) / Math.max(slot, 1))) : 1;
    const ink = theme?.muted || '#667085';
    xWindow.ticks.forEach((index, order) => {
      if (order % every !== 0) return;
      nodes.push(text(scaleX(index), frame.plot.y + frame.plot.h + 14, clip(labels[index], 12), 'middle', 'hanging', ink, 11, 400));
    });
  }
  domain.ticks.forEach((value) => {
    const y = Math.round(scale(value)) + 0.5;
    nodes.push({ type: 'line', x1: frame.plot.x, y1: y, x2: frame.plot.x + frame.plot.w, y2: y, stroke: theme.grid, sw: 1, dash: '3' });
    nodes.push(text(frame.plot.x - 8, y, formatNumber(value), 'end', 'middle', theme.muted, 12, 400));
  });
  const entries = [];
  rows.forEach((row, index) => {
    const extra = row.extra;
    const x = scaleX ? scaleX(index) : frame.plot.x + index * slot + slot / 2;
    if (xWindow?.windowed && (index + 0.5 <= xWindow.min || index - 0.5 >= xWindow.max)) return;
    if (mode === 'box' && extra.length >= 5) {
      const [low, q1, median, q3, high] = extra;
      const body = Math.max(8, Math.min(slot * 0.55, 18));
      nodes.push({ type: 'line', x1: x, y1: scale(low), x2: x, y2: scale(high), stroke: row.color, sw: 1.5, clip: !!xWindow?.windowed });
      nodes.push({
        type: 'path',
        d: rectPath(x - body / 2, Math.min(scale(q1), scale(q3)), body, Math.max(1, Math.abs(scale(q3) - scale(q1))), 3),
        fill: theme.ring,
        stroke: row.color,
        sw: 1.5,
      });
      const my = scale(median);
      nodes.push({ type: 'line', x1: x - body / 2, y1: my, x2: x + body / 2, y2: my, stroke: row.color, sw: 2 });
    } else {
      const open = extra[0];
      const high = extra.length >= 4 ? extra[1] : Math.max(...extra);
      const low = extra.length >= 4 ? extra[2] : Math.min(...extra);
      const close = extra.length >= 4 ? extra[3] : extra[extra.length - 1];
      const up = close >= open;
      const color = up ? model.candleUp : model.candleDown;
      const body = xWindow?.windowed ? Math.max(4, slot * 0.62) : Math.max(4, Math.min(slot * 0.62, 16));
      nodes.push({ type: 'line', x1: x, y1: scale(low), x2: x, y2: scale(high), stroke: color, sw: 1.5, clip: !!xWindow?.windowed });
      const y = Math.min(scale(open), scale(close));
      const h = Math.max(1, Math.abs(scale(close) - scale(open)));
      const rect = { x: x - body / 2, y, w: body, h };
      const d = rectPath(rect.x, rect.y, rect.w, rect.h, 3);
      nodes.push({
        type: 'path',
        d,
        fill: color,
        stroke: 'none',
        sw: 0,
        clip: !!xWindow?.windowed,
      });
      pushSheen(nodes, gradients, d, 'top', rect);
    }
    entries.push({
      index,
      x,
      y: frame.plot.y,
      x0: scaleX ? scaleX(index - 0.5) : frame.plot.x + index * slot,
      x1: scaleX ? scaleX(index + 0.5) : frame.plot.x + (index + 1) * slot,
      y0: frame.plot.y,
      y1: frame.plot.y + frame.plot.h,
      label: row.label,
      rows: [{ name: row.name, value: row.y, color: row.color, seriesIndex: row.seriesIndex, x, y: scale(row.y) }],
    });
  });
  return finish(model, nodes, frame.plot, { kind: 'band', plot: frame.plot, entries }, {
    xDomain: xWindow ? { min: xWindow.min, max: xWindow.max } : null,
    gradients,
  });
}

function buildRangeBar(display, width, height, measure, theme, model) {
  const rows = collectRows(display, model);
  if (!rows.length) return empty(width, height, theme, model);
  const nums = rows.flatMap((row) => row.extra.filter((value) => value != null));
  const rangeExtent = finiteExtent(nums);
  const domain = resolveDomain(rangeExtent.min, rangeExtent.max, {
    zero: false,
    pad: 0,
    min: model.x.min,
    max: model.x.max,
    ticks: 5,
  });
  const labels = rows.map((row) => row.label);
  const longest = labels.reduce((max, label) => Math.max(max, measure(String(label).slice(0, 18), 12)), 0);
  const left = 12 + Math.min(width * 0.42, Math.max(24, longest)) + 8;
  const plot = { x: left, y: 14, w: Math.max(8, width - left - 16), h: Math.max(8, height - 36) };
  const scale = scaleLinear(domain.min, domain.max, plot.x, plot.x + plot.w);
  const slot = plot.h / rows.length;
  const nodes = [];
  const gradients = [];
  domain.ticks.forEach((value) => {
    const x = Math.round(scale(value)) + 0.5;
    nodes.push({ type: 'line', x1: x, y1: plot.y, x2: x, y2: plot.y + plot.h, stroke: theme.grid, sw: 1, dash: '3' });
    nodes.push(text(x, plot.y + plot.h + 14, formatNumber(value), 'middle', 'hanging', theme.muted, 11, 400));
  });
  const entries = [];
  rows.forEach((row, index) => {
    const start = row.extra[0];
    const end = row.extra[row.extra.length - 1];
    const y = plot.y + index * slot + slot * 0.18;
    const h = slot * 0.64;
    const x = Math.min(scale(start), scale(end));
    const w = Math.max(1, Math.abs(scale(end) - scale(start)));
    const rect = { x, y, w, h };
    const d = rectPath(rect.x, rect.y, rect.w, rect.h, Math.min(5, h / 2));
    nodes.push(text(plot.x - 8, y + h / 2, clip(row.label, 18), 'end', 'middle', theme.muted, 12, 400));
    nodes.push({
      type: 'path',
      d,
      fill: row.color,
      stroke: 'none',
      sw: 0,
    });
    pushSheen(nodes, gradients, d, end >= start ? 'right' : 'left', rect);
    entries.push({
      index,
      x,
      y: y + h / 2,
      x0: plot.x,
      x1: plot.x + plot.w,
      y0: plot.y + index * slot,
      y1: plot.y + (index + 1) * slot,
      label: row.label,
      rows: [{ name: row.name, value: end, color: row.color, seriesIndex: row.seriesIndex, y: y + h / 2, x: x + w }],
    });
  });
  return finish(model, nodes, plot, { kind: 'band-y', plot, entries }, { gradients });
}

function buildRangeArea(display, width, height, measure, theme, model) {
  const seriesRows = model.series.map((series, seriesIndex) => ({
    series,
    seriesIndex,
    rows: collectSeries(display, model, seriesIndex),
  })).filter((item) => !item.series.hidden && item.rows.length);
  if (!seriesRows.length) return empty(width, height, theme, model);
  const nums = seriesRows.flatMap((item) => item.rows.flatMap((row) => row.extra));
  const areaExtent = finiteExtent(nums);
  const domain = resolveDomain(areaExtent.min, areaExtent.max, {
    zero: false,
    min: model.y.min,
    max: model.y.max,
    ticks: 5,
  });
  const labels = seriesRows[0].rows.map((row) => row.label);
  const frame = axesFrame(width, height, measure, domain.ticks.map((value) => formatNumber(value)), labels, model, theme);
  const scale = scaleLinear(domain.min, domain.max, frame.plot.y + frame.plot.h, frame.plot.y);
  const nodes = [...frame.nodes];
  domain.ticks.forEach((value) => {
    const y = Math.round(scale(value)) + 0.5;
    nodes.push({ type: 'line', x1: frame.plot.x, y1: y, x2: frame.plot.x + frame.plot.w, y2: y, stroke: theme.grid, sw: 1, dash: '3' });
    nodes.push(text(frame.plot.x - 8, y, formatNumber(value), 'end', 'middle', theme.muted, 12, 400));
  });
  const entries = [];
  seriesRows.forEach((item) => {
    const coords = item.rows.map((row, index) => {
      const x = frame.plot.x + ((index + 0.5) / item.rows.length) * frame.plot.w;
      const low = row.extra[0];
      const high = row.extra[row.extra.length - 1];
      return { x, high: scale(high), low: scale(low), label: row.label, value: high };
    });
    const d = `${coords.map((point, index) => `${index ? 'L' : 'M'}${round(point.x)},${round(point.high)}`).join('')}${coords.slice().reverse().map((point) => `L${round(point.x)},${round(point.low)}`).join('')}Z`;
    nodes.push({ type: 'path', d, fill: item.series.color, fillOpacity: 0.28, stroke: 'none', sw: 0, clip: true });
    const crest = coords.map((point, index) => `${index ? 'L' : 'M'}${round(point.x)},${round(point.high)}`).join('');
    if (coords.length > 1 && coords.length <= 96) {
      nodes.push({
        type: 'path',
        d: crest,
        fill: 'none',
        stroke: item.series.color,
        sw: 8,
        strokeOpacity: 0.18,
        cap: 'round',
        join: 'round',
        clip: true,
        glow: true,
      });
    }
    nodes.push({
      type: 'path',
      d: crest,
      fill: 'none',
      stroke: item.series.color,
      sw: 2,
      cap: 'round',
      join: 'round',
      clip: true,
    });
    coords.forEach((point, index) => {
      entries.push({
        index,
        x: point.x,
        y: point.high,
        label: point.label,
        rows: [{ name: item.series.name, value: point.value, color: item.series.color, y: point.high, seriesIndex: item.seriesIndex }],
      });
    });
  });
  return finish(model, nodes, frame.plot, { kind: 'point', plot: frame.plot, entries });
}

function ringValues(display, model) {
  return model.series.map((series, index) => {
    const raw = display.series[index]?.values?.[0] ?? series.values?.[0];
    const value = series.hidden ? null : num(raw);
    return value == null ? null : { index, name: series.name, value: Math.max(0, value), color: series.color };
  }).filter(Boolean);
}

function collectRows(display, model) {
  const rows = [];
  model.series.forEach((series, seriesIndex) => {
    if (series.hidden) return;
    collectSeries(display, model, seriesIndex).forEach((row) => {
      rows.push({ ...row, name: series.name, color: series.color, seriesIndex });
    });
  });
  return rows;
}

function collectSeries(display, model, seriesIndex) {
  const series = model.series[seriesIndex];
  const shown = display.series[seriesIndex] || series;
  if (shown.points?.length) {
    return shown.points.map((point, index) => {
      if (!point?.extra?.length) return null;
      return {
        label: point.label || model.categories?.[index] || formatNumber(point.x),
        extra: point.extra,
        y: point.y,
      };
    }).filter(Boolean);
  }
  const extras = shown.extras || series.extras || [];
  return extras.map((extra, index) => {
    if (!extra?.length) return null;
    return {
      label: model.categories?.[index] || String(index + 1),
      extra,
      y: shown.values?.[index] ?? series.values?.[index],
    };
  }).filter(Boolean);
}

function axesFrame(width, height, measure, yLabels, xLabels, model, theme) {
  const yWidth = Math.min(88, yLabels.reduce((max, label) => Math.max(max, measure(String(label), 12)), 0));
  const left = 12 + yWidth + 10;
  const top = model.zoom ? 36 : 12;
  const bottom = 28;
  const plot = {
    x: left,
    y: top,
    w: Math.max(8, width - left - 14),
    h: Math.max(8, height - top - bottom),
  };
  const nodes = [];
  const ink = theme?.muted || '#667085';
  if (model.x?.title) nodes.push(text(plot.x + plot.w / 2, height - 4, model.x.title, 'middle', 'auto', ink, 12, 500));
  const widest = xLabels.reduce((max, label) => Math.max(max, measure(String(label), 11)), 0);
  const slot = plot.w / Math.max(xLabels.length, 1);
  const every = widest > slot - 2 ? Math.max(1, Math.ceil((widest + 2) / Math.max(slot, 1))) : 1;
  xLabels.forEach((label, index) => {
    if (index % every !== 0) return;
    const x = plot.x + ((index + 0.5) / xLabels.length) * plot.w;
    nodes.push(text(x, plot.y + plot.h + 14, clip(label, 12), 'middle', 'hanging', ink, 11, 400));
  });
  return { plot, nodes };
}

function squarify(items, x, y, w, h) {
  const nodes = [];
  let rest = items.slice();
  let rx = x;
  let ry = y;
  let rw = w;
  let rh = h;
  while (rest.length) {
    const horizontal = rw >= rh;
    const side = horizontal ? rh : rw;
    const remaining = rest.reduce((sum, item) => sum + item.value, 0) || 1;
    let row = [];
    let rowValue = 0;
    let best = Infinity;
    for (let index = 0; index < rest.length; index += 1) {
      const nextValue = rowValue + rest[index].value;
      const next = row.concat(rest[index]);
      const span = (nextValue / remaining) * (horizontal ? rw : rh);
      const worst = next.reduce((max, item) => {
        const breadth = (item.value / nextValue) * side;
        return Math.max(max, span / breadth, breadth / span);
      }, 0);
      if (row.length && worst > best) break;
      row = next;
      rowValue = nextValue;
      best = worst;
    }
    const span = (rowValue / remaining) * (horizontal ? rw : rh);
    let offset = 0;
    for (const item of row) {
      const breadth = (item.value / rowValue) * side;
      nodes.push({
        ...item,
        x: horizontal ? rx : rx + offset,
        y: horizontal ? ry + offset : ry,
        w: horizontal ? span : breadth,
        h: horizontal ? breadth : span,
      });
      offset += breadth;
    }
    if (horizontal) {
      rx += span;
      rw -= span;
    } else {
      ry += span;
      rh -= span;
    }
    rest = rest.slice(row.length);
  }
  return nodes;
}

function empty(width, height, theme, model) {
  return finish(model, [
    text(width / 2, height / 2, model.emptyText || 'No data', 'middle', 'middle', theme.empty, 13, 500),
  ], { x: 0, y: 0, w: width, h: height }, { kind: 'none', plot: { x: 0, y: 0, w: width, h: height }, entries: [] });
}

function finish(model, nodes, plot, hover, extra = {}) {
  const names = model.series.map((series) => series.name).filter(Boolean);
  const head = model.title || `${model.type} chart`;
  return {
    ariaLabel: names.length ? `${head}. ${names.join(', ')}.` : head,
    plot,
    gradients: [],
    nodes,
    hover,
    legend: model.series.map((series, index) => ({
      name: series.name,
      color: series.color,
      hidden: !!series.hidden,
      index,
    })),
    empty: false,
    ...extra,
  };
}

/** 0° is 12 o'clock. Positive degrees run clockwise. A missing pair is a full ring. */
function radialAngles(model) {
  if (model.start == null && model.end == null) return { a0: 0, sweep: Math.PI * 2 };
  const start = Number(model.start) || 0;
  let sweepDeg = (model.end == null ? start + 360 : Number(model.end)) - start;
  if (sweepDeg <= 0) sweepDeg += 360;
  sweepDeg = Math.min(360, sweepDeg);
  return { a0: (start * Math.PI) / 180, sweep: (sweepDeg * Math.PI) / 180 };
}

function arc(cx, cy, r0, r1, a0, a1) {
  const sweep = a1 - a0;
  if (sweep <= 1e-4 || r1 <= 0) return '';
  if (sweep >= Math.PI * 2 - 1e-3) {
    const outer = `M${round(cx - r1)},${round(cy)}A${round(r1)},${round(r1)} 0 1 1 ${round(cx + r1)},${round(cy)}A${round(r1)},${round(r1)} 0 1 1 ${round(cx - r1)},${round(cy)}Z`;
    if (r0 <= 0.5) return outer;
    return `${outer}M${round(cx - r0)},${round(cy)}A${round(r0)},${round(r0)} 0 1 0 ${round(cx + r0)},${round(cy)}A${round(r0)},${round(r0)} 0 1 0 ${round(cx - r0)},${round(cy)}Z`;
  }
  const [sx, sy] = polar(cx, cy, r1, a0);
  const [ex, ey] = polar(cx, cy, r1, a1);
  const large = sweep > Math.PI ? 1 : 0;
  if (r0 <= 0.5) {
    return `M${round(sx)},${round(sy)}A${round(r1)},${round(r1)} 0 ${large} 1 ${round(ex)},${round(ey)}L${round(cx)},${round(cy)}Z`;
  }
  const [ix, iy] = polar(cx, cy, r0, a1);
  const [jx, jy] = polar(cx, cy, r0, a0);
  return `M${round(sx)},${round(sy)}A${round(r1)},${round(r1)} 0 ${large} 1 ${round(ex)},${round(ey)}L${round(ix)},${round(iy)}A${round(r0)},${round(r0)} 0 ${large} 0 ${round(jx)},${round(jy)}Z`;
}

function polar(cx, cy, radius, angle) {
  return [cx + radius * Math.sin(angle), cy - radius * Math.cos(angle)];
}

function poly(points, close, fill, stroke, sw, opacity) {
  const d = `${points.map((point, index) => `${index ? 'L' : 'M'}${round(point[0])},${round(point[1])}`).join('')}${close ? 'Z' : ''}`;
  return { type: 'path', d, fill: fill === 'none' ? 'none' : fill, fillOpacity: opacity ?? 1, stroke, sw };
}

const SHEEN = {
  top: { x1: '0', y1: '0', x2: '0', y2: '1' },
  bottom: { x1: '0', y1: '1', x2: '0', y2: '0' },
  right: { x1: '1', y1: '0', x2: '0', y2: '0' },
  left: { x1: '0', y1: '0', x2: '1', y2: '0' },
};

/** Same white cap the columns use, on any filled rectangle that is large enough to read it. */
function pushSheen(nodes, gradients, d, side, rect) {
  const horizontal = side === 'left' || side === 'right';
  const span = horizontal ? rect.w : rect.h;
  const across = horizontal ? rect.h : rect.w;
  if (!d || span < 16 || across < 6 || !SHEEN[side]) return;
  if (!gradients.some((item) => item.kind === 'sheen' && item.id === side)) {
    gradients.push({ kind: 'sheen', id: side, ...SHEEN[side] });
  }
  nodes.push({
    type: 'path',
    d,
    fill: `url(#__sheen_${side})`,
    stroke: 'none',
    sw: 0,
    clip: true,
    sheen: true,
  });
}

function rectPath(x, y, w, h, radius) {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  if (r < 0.5) return `M${round(x)},${round(y)}h${round(w)}v${round(h)}h${round(-w)}Z`;
  return `M${round(x + r)},${round(y)}H${round(x + w - r)}Q${round(x + w)},${round(y)},${round(x + w)},${round(y + r)}V${round(y + h - r)}Q${round(x + w)},${round(y + h)},${round(x + w - r)},${round(y + h)}H${round(x + r)}Q${round(x)},${round(y + h)},${round(x)},${round(y + h - r)}V${round(y + r)}Q${round(x)},${round(y)},${round(x + r)},${round(y)}Z`;
}

function circle(cx, cy, r, color, theme) {
  return { type: 'circle', cx, cy, r, fill: color, stroke: theme.ring, sw: 1.5 };
}

function text(x, y, value, anchor, baseline, fill, size, weight) {
  return { type: 'text', x, y, text: String(value ?? ''), anchor, baseline, fill, size, weight };
}

function clip(value, max) {
  const textValue = String(value ?? '');
  return textValue.length > max ? `${textValue.slice(0, max - 1)}…` : textValue;
}

function num(value) {
  return value == null || !Number.isFinite(value) ? null : value;
}

function mix(from, to, amount) {
  const a = rgb(from);
  const b = rgb(to);
  const t = Math.max(0, Math.min(1, amount));
  const channel = (index) => Math.round(a[index] + (b[index] - a[index]) * t).toString(16).padStart(2, '0');
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

function rgb(color) {
  const hex = String(color).replace('#', '');
  const full = hex.length === 3 ? hex.split('').map((char) => char + char).join('') : hex;
  if (!/^[0-9a-fA-F]{6}/.test(full)) return [0, 143, 251];
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}
