import { areaBand, areaPath, lineCoords, linePath, segments } from './curve.js';
import { formatNumber, formatTime } from './format.js';
import { buildSpecial } from './special.js';
import { stackSeries } from './normalize.js';
import { bands, categoryWindow, resolveDomain, scaleLinear, timeTicks } from './scale.js';
import { centerContent, clamp, finite, finiteExtent, inkOn, isIsoDate, round } from './util.js';

const FONT = 12;

/**
 * Pure chart geometry. `display` supplies the values drawn this frame
 * (so animations can interpolate). `domainModel` supplies the scale and
 * the numbers shown in the tooltip, which stay on the final data.
 */
export function buildChart(display, width, height, measure, theme, domainModel = display, options) {
  if (!(width > 0) || !(height > 0)) {
    return blank(width, height, domainModel);
  }
  const special = buildSpecial(display, width, height, measure, theme, domainModel);
  if (special) return special;
  if (domainModel.type === 'pie' || domainModel.type === 'donut') {
    return buildPie(display, width, height, measure, theme, domainModel);
  }
  return buildCartesian(display, width, height, measure, theme, domainModel, options);
}

function blank(width, height, model) {
  return {
    ariaLabel: aria(model),
    plot: { x: 0, y: 0, w: 0, h: 0 },
    gradients: [],
    nodes: [],
    hover: { kind: 'none', plot: { x: 0, y: 0, w: 0, h: 0 }, entries: [] },
    legend: legendOf(model),
    empty: true,
  };
}

const frameCache = new WeakMap();

/** Window, theme, and series ink. Data edits replace the model, so the key can stay this short. */
function frameKey(model, width, height, theme) {
  const x = model.x;
  const y = model.y;
  let key = `${width}x${height}|${theme.name}|${x?.min ?? ''}|${x?.max ?? ''}|${x?.minFn ? 1 : 0}|${x?.maxFn ? 1 : 0}|${y?.min ?? ''}|${y?.max ?? ''}|${y?.zero ? 1 : 0}|${y?.refit === false ? 0 : 1}|${model.curve}|${model.strokeWidth}|${model.markers}|${model.markerSize}|${model.fillOpacity}|${model.barRadius}|${model.zoom ? 1 : 0}|${model.showValues ? 1 : 0}|${model.solidFill ? 1 : 0}|${model.axes ? 1 : 0}|${model.grid?.x ? 1 : 0}|${model.grid?.y ? 1 : 0}|${prepareStamp(model)}`;
  const series = model.series;
  for (let index = 0; index < series.length; index += 1) {
    const item = series[index];
    key += `|${item.color}|${item.dash || ''}|${item.curve || ''}|${item.strokeWidth ?? ''}|${item.yIndex || 0}|${item.seriesType || ''}|${item.fillOpacity ?? ''}`;
  }
  const axes = model.yAxes;
  if (axes) {
    for (let index = 0; index < axes.length; index += 1) {
      const axis = axes[index];
      key += `|a${axis.min ?? ''}|${axis.max ?? ''}|${axis.opposite ? 1 : 0}|${axis.show === false ? 0 : 1}`;
    }
  }
  return key;
}

function reuseFrame(model, width, height, theme, options) {
  const hit = frameCache.get(model);
  if (!hit || hit.key !== frameKey(model, width, height, theme)) return null;
  return { ...hit.rest, hover: hit.makeHover(options?.hover === false) };
}

function keepFrame(model, display, width, height, theme, rest, makeHover, options) {
  if (display === model) {
    frameCache.set(model, { key: frameKey(model, width, height, theme), rest, makeHover });
  }
  return { ...rest, hover: makeHover(options?.hover === false) };
}

function buildCartesian(display, width, height, measure, theme, model, options) {
  if (display === model) {
    const reused = reuseFrame(model, width, height, theme, options);
    if (reused) return reused;
  }
  if (needsMixed(model)) return buildMulti(display, width, height, measure, theme, model, options);
  const horizontal = !!model.horizontal;
  const prepared = prepareCartesian(display, model);
  if (!prepared.count) return withEmpty(blank(width, height, model), width, height, theme, model);

  const xDomain = independentDomain(model, prepared);
  const yDomain = valueDomain(model, prepared, xDomain);
  const yTicks = yDomain.ticks.map((value) => ({
    value,
    label: formatValue(model, value),
  }));
  const xLabels = xTickLabels(model, prepared, xDomain);

  const margin = margins({
    model,
    width,
    height,
    measure,
    horizontal,
    yLabels: horizontal ? prepared.labels : yTicks.map((tick) => tick.label),
    xLabels: horizontal ? yTicks.map((tick) => tick.label) : xLabels.labels,
    xLabelPlan: horizontal ? null : xLabels,
  });

  const plot = {
    x: margin.left,
    y: margin.top,
    w: Math.max(8, width - margin.left - margin.right),
    h: Math.max(8, height - margin.top - margin.bottom),
  };
  if (!horizontal) fitTimeTicks(model, xLabels, plot.w, measure, margin);

  const valueScale = horizontal
    ? scaleLinear(yDomain.min, yDomain.max, plot.x, plot.x + plot.w)
    : scaleLinear(yDomain.min, yDomain.max, plot.y + plot.h, plot.y);
  const slotScale = categorySlots(model, prepared, xDomain, plot, horizontal);

  const nodes = [];
  if (model.axes && model.grid.y) {
    nodes.push(...gridLines(model, yTicks, valueScale, slotScale, plot, theme, horizontal, 'value'));
  }
  if (model.axes && model.grid.x) {
    nodes.push(...gridLines(model, xLabels, slotScale.scale, valueScale, plot, theme, horizontal, 'independent'));
  }
  if (model.axes && yDomain.min < 0 && yDomain.max > 0) {
    const at = valueScale(0);
    nodes.push(horizontal
      ? { type: 'line', x1: at, y1: plot.y, x2: at, y2: plot.y + plot.h, stroke: theme.zero, sw: 1 }
      : { type: 'line', x1: plot.x, y1: at, x2: plot.x + plot.w, y2: at, stroke: theme.zero, sw: 1 });
  }

  const drawn = drawSeries(model, display, prepared, plot, valueScale, slotScale, theme, horizontal);
  nodes.push(...drawn.nodes);

  if (model.axes) {
    nodes.push(...axisLabels({
      model,
      theme,
      measure,
      plot,
      horizontal,
      yTicks,
      valueScale,
      xLabels,
      slotScale,
      margin,
    }));
  }

  if (model.annotations) nodes.push(...drawAnnotations(model, prepared, plot, valueScale, slotScale, theme));

  const rest = {
    ariaLabel: aria(model),
    plot,
    gradients: drawn.gradients,
    nodes,
    legend: legendOf(model),
    empty: drawn.empty,
    xDomain: xDomain ? { min: xDomain.min, max: xDomain.max } : null,
  };
  const makeHover = (deferred) => (
    deferred ? deferredHover(plot) : hoverFor(model, prepared, plot, valueScale, slotScale, horizontal)
  );
  return keepFrame(model, display, width, height, theme, rest, makeHover, options);
}

function withEmpty(spec, width, height, theme, model) {
  spec.nodes.push({
    type: 'text',
    x: width / 2,
    y: height / 2,
    text: model?.emptyText || 'No data',
    anchor: 'middle',
    baseline: 'middle',
    fill: theme.empty,
    size: 13,
    weight: 500,
  });
  return spec;
}

const preparedCache = new WeakMap();

/**
 * Point tables do not depend on the x window. Pan paints the same model,
 * so the tables stay cached until the series data or a legend toggle changes.
 * Animated frames pass a different display and skip the cache.
 */
function prepareCartesian(display, model) {
  if (display !== model) return buildPrepared(display, model);
  const stamp = prepareStamp(model);
  const hit = preparedCache.get(model);
  if (hit && hit.stamp === stamp) return hit.prepared;
  const prepared = buildPrepared(display, model);
  preparedCache.set(model, { stamp, prepared });
  return prepared;
}

function prepareStamp(model) {
  let stamp = `${model.pointMode}|${model.stackType || ''}|${model.categories?.length || 0}`;
  const series = model.series || [];
  for (let index = 0; index < series.length; index += 1) {
    const item = series[index];
    stamp += `|${item.hidden ? 1 : 0},${item.values?.length || 0},${item.points?.length || 0}`;
  }
  return stamp;
}

function buildPrepared(display, model) {
  if (model.pointMode === 'index') {
    const count = Math.max(
      model.categories?.length || 0,
      ...model.series.map((series) => series.values?.length || 0),
    );
    const labels = prettifyAxisLabels(Array.from({ length: count }, (_, index) => {
      const label = model.categories?.[index];
      return label != null && label !== '' ? String(label) : String(index + 1);
    }));
    const values = model.series.map((series, seriesIndex) => {
      const source = display.series[seriesIndex]?.values || series.values || [];
      return Array.from({ length: count }, (_, index) => {
        const value = source[index];
        return value == null || !Number.isFinite(value) ? null : value;
      });
    });
    const finalValues = model.series.map((series) => (
      Array.from({ length: count }, (_, index) => {
        const value = series.values?.[index];
        return value == null || !Number.isFinite(value) ? null : value;
      })
    ));
    if (model.stackType === '100%') {
      return {
        count,
        labels,
        values: percentMatrix(values, model.series),
        finalValues: percentMatrix(finalValues, model.series),
        points: null,
      };
    }
    return { count, labels, values, finalValues, points: null };
  }

  const points = model.series.map((series, seriesIndex) => {
    const source = display.series[seriesIndex]?.points || series.points || [];
    return source.map((point) => (point && Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null));
  });
  const finalPoints = model.series.map((series) => (
    (series.points || []).map((point) => (point && Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null))
  ));
  const count = points.reduce((max, list) => Math.max(max, list.length), 0);
  return {
    count,
    labels: [],
    values: null,
    finalValues: null,
    points,
    finalPoints,
    sortedPoints: points.map(seriesSorted),
    sortedFinal: finalPoints.map(seriesSorted),
  };
}

/** True when every sample has a finite x and those x values never go backwards. */
function seriesSorted(points) {
  let previous = -Infinity;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (!point || !Number.isFinite(point.x)) return false;
    if (point.x < previous) return false;
    previous = point.x;
  }
  return true;
}

function valueDomain(model, prepared, xDomain) {
  if (model.stackType === '100%') {
    return resolveDomain(0, 100, { zero: true, pad: 0, min: 0, max: 100, ticks: 5 });
  }
  let min = Infinity;
  let max = -Infinity;
  if (model.stacked && prepared.values) {
    if (prepared.yExtent) {
      min = prepared.yExtent.min;
      max = prepared.yExtent.max;
    } else {
      const stacked = stackSeries(model.series.map((series, index) => ({
        hidden: series.hidden,
        values: prepared.finalValues[index],
      })));
      min = stacked.min;
      max = stacked.max;
      prepared.yExtent = { min, max };
    }
  } else if (prepared.finalValues) {
    if (prepared.yExtent) {
      min = prepared.yExtent.min;
      max = prepared.yExtent.max;
    } else {
      for (let s = 0; s < model.series.length; s += 1) {
        if (model.series[s].hidden) continue;
        for (const value of prepared.finalValues[s]) {
          if (value == null) continue;
          min = Math.min(min, value);
          max = Math.max(max, value);
        }
        for (const extra of model.series[s].extras || []) {
          for (const value of extra || []) {
            if (value == null) continue;
            min = Math.min(min, value);
            max = Math.max(max, value);
          }
        }
      }
      prepared.yExtent = { min, max };
    }
  } else if (model.y.refit === false && prepared.yExtent) {
    min = prepared.yExtent.min;
    max = prepared.yExtent.max;
  } else {
    const extent = extentOfSeries(model, prepared, model.y.refit === false ? null : xWindowOf(xDomain), () => true);
    min = extent.min;
    max = extent.max;
    if (model.y.refit === false) prepared.yExtent = { min, max };
  }
  const minOpt = applyBound(model.y, 'min', min);
  const maxOpt = applyBound(model.y, 'max', max);
  return resolveDomain(min, max, {
    zero: model.y.zero,
    min: minOpt,
    max: maxOpt,
    ticks: 5,
    headroom: model.type === 'bar',
  });
}

function independentDomain(model, prepared) {
  if (model.pointMode === 'index') {
    const edges = lineToEdges(model, prepared.count);
    const explicit = model.zoom || model.x?.min != null || model.x?.max != null || model.x?.minFn || model.x?.maxFn;
    if (!explicit && !edges) return null;
    return categoryWindow(
      prepared.count,
      applyBound(model.x, 'min', edges ? 0 : -0.5),
      applyBound(model.x, 'max', edges ? Math.max(prepared.count - 1, 1) : prepared.count - 0.5),
      edges,
    );
  }
  const pinned = pinnedWindow(model.x);
  if (pinned && model.pointMode === 'time') {
    const ticks = timeTicks(pinned.min, pinned.max, 8, { utc: !!model.x.utc });
    return { min: pinned.min, max: pinned.max, ticks: ticks.ticks, windowed: true };
  }
  if (pinned) {
    const domain = resolveDomain(pinned.min, pinned.max, {
      zero: false,
      min: pinned.min,
      max: pinned.max,
      ticks: 5,
    });
    return { ...domain, windowed: true };
  }
  let min = Infinity;
  let max = -Infinity;
  for (let s = 0; s < model.series.length; s += 1) {
    if (model.series[s].hidden) continue;
    for (const point of prepared.finalPoints[s]) {
      if (!point) continue;
      min = Math.min(min, point.x);
      max = Math.max(max, point.x);
    }
  }
  if (model.pointMode === 'time') {
    const anchor = Number.isFinite(min) ? min : (Number.isFinite(max) ? max : Date.now());
    const ranged = max > min;
    if (!ranged) {
      min = anchor;
      max = anchor;
    }
    const span = ranged ? max - min : 86_400_000;
    const boundMin = applyBound(model.x, 'min', min);
    const boundMax = applyBound(model.x, 'max', max);
    // A pure line meets the first and last sample. A column on the same axis
    // keeps a small inset so the end bars stay inside the plot.
    const inset = ranged && !lineToEdges(model, 2) ? span * 0.02 : 0;
    let lo = boundMin ?? (ranged ? min - inset : anchor - span);
    let hi = boundMax ?? (ranged ? max + inset : anchor + span);
    if (!(hi > lo)) {
      lo = anchor - span;
      hi = anchor + span;
    }
    const ticks = timeTicks(lo, hi, 8, { utc: !!model.x.utc });
    return {
      min: lo,
      max: hi,
      ticks: ticks.ticks,
      windowed: boundMin != null || boundMax != null,
    };
  }
  const minOpt = applyBound(model.x, 'min', min);
  const maxOpt = applyBound(model.x, 'max', max);
  const domain = resolveDomain(min, max, {
    zero: false,
    min: minOpt,
    max: maxOpt,
    ticks: 5,
  });
  return { ...domain, windowed: minOpt != null || maxOpt != null };
}

/** Line and area samples run from one side of the plot to the other. Columns stay in bands. */
function lineToEdges(model, count) {
  if (!(count > 1)) return false;
  if (model.type !== 'line' && model.type !== 'area') return false;
  return model.series.every((series) => series.hidden || series.seriesType !== 'bar');
}

/** Both x ends are plain numbers, so the window does not need another pass over the samples. */
function pinnedWindow(axis) {
  if (!axis || axis.minFn || axis.maxFn) return null;
  if (axis.min == null || axis.max == null) return null;
  if (!(axis.max > axis.min)) return null;
  return { min: axis.min, max: axis.max };
}

function xTickLabels(model, prepared, xDomain) {
  if (model.pointMode === 'index') {
    if (!xDomain?.windowed) return { labels: prepared.labels, ticks: null };
    return {
      labels: xDomain.ticks.map((index) => prepared.labels[index] ?? String(index + 1)),
      ticks: xDomain.ticks,
      span: xDomain.max - xDomain.min,
    };
  }
  const span = xDomain.max - xDomain.min;
  const labels = xDomain.ticks.map((value) => formatX(model, value, span));
  return { labels, ticks: xDomain.ticks, span };
}

/** Swap in a shorter clock when the full time pattern would hide ticks. */
function fitTimeTicks(model, plan, plotW, measure, margin) {
  if (!plan?.ticks?.length || model.pointMode !== 'time' || !(plotW > 0)) return;
  const widthOf = (labels) => labels.reduce((max, label) => Math.max(max, measure(label, FONT)), 0);
  const gap = plotW / plan.labels.length;
  const everyFor = (width) => Math.max(1, Math.ceil((width + 8) / Math.max(gap, 1)));
  if (everyFor(widthOf(plan.labels)) > 1) {
    const short = plan.ticks.map((value) => formatTime(value, plan.span || 0, !!model.x.utc));
    const distinct = new Set(short).size === short.length;
    if (distinct && everyFor(widthOf(short)) < everyFor(widthOf(plan.labels))) {
      plan.labels.splice(0, plan.labels.length, ...short);
    }
  }
  margin.every = everyFor(widthOf(plan.labels));
}

function categorySlots(model, prepared, xDomain, plot, horizontal) {
  if (model.pointMode === 'index' && !xDomain) {
    const start = horizontal ? plot.y : plot.x;
    const size = horizontal ? plot.h : plot.w;
    const inner = model.band != null ? model.band : (model.type === 'bar' ? 0.72 : 1);
    return { kind: 'band', slots: bands(prepared.count, start, size, inner), scale: null };
  }
  if (model.pointMode === 'index') {
    const scale = horizontal
      ? scaleLinear(xDomain.min, xDomain.max, plot.y + plot.h, plot.y)
      : scaleLinear(xDomain.min, xDomain.max, plot.x, plot.x + plot.w);
    const inner = model.band != null ? model.band : (model.type === 'bar' ? 0.72 : 1);
    const step = Math.abs(scale(1) - scale(0)) || 1;
    const width = step * inner;
    const slots = [];
    for (let index = 0; index < prepared.count; index += 1) {
      const mid = scale(index);
      slots.push({ i: index, x: mid - width / 2, w: width, mid, step });
    }
    return { kind: 'band', slots, scale, domain: xDomain };
  }
  const scale = horizontal
    ? scaleLinear(xDomain.min, xDomain.max, plot.y + plot.h, plot.y)
    : scaleLinear(xDomain.min, xDomain.max, plot.x, plot.x + plot.w);
  return { kind: 'linear', slots: null, scale, domain: xDomain };
}

function margins({ model, width, height, measure, horizontal, yLabels, xLabels, xLabelPlan }) {
  let top = model.zoom ? 36 : 14;
  let right = 18;
  let bottom = model.axes ? 32 : 8;
  let left = 12;
  let rotate = false;
  let every = 1;

  if (!model.axes) return { top: 8, right: 8, bottom: 8, left: 8, rotate, every };

  const longest = (labels) => labels.reduce((max, label) => Math.max(max, measure(truncate(label, 18), FONT)), 0);

  if (!horizontal) {
    const yWidth = Math.min(88, yLabels.reduce((max, label) => Math.max(max, measure(label, FONT)), 0));
    left += yWidth + 8;
    if (model.y.title) left += 18;
    const plotW = Math.max(40, width - left - right);
    const slot = xLabels.length ? plotW / xLabels.length : plotW;
    const maxLabel = xLabels.reduce((max, label) => Math.max(max, measure(label, FONT)), 0);
    if (xLabelPlan?.ticks) {
      const gap = plotW / Math.max(xLabels.length, 1);
      every = Math.max(1, Math.ceil((maxLabel + 12) / Math.max(gap, 1)));
    } else if (maxLabel > slot - 8 && xLabels.length > 1 && xLabels.length <= 14 && maxLabel < 110) {
      rotate = true;
      bottom = 14 + Math.min(84, Math.sin((40 * Math.PI) / 180) * maxLabel + 10);
    } else if (maxLabel > slot - 8) {
      every = Math.max(1, Math.ceil((maxLabel + 8) / Math.max(slot, 1)));
    }
    if (model.x.title) bottom += 18;
  } else {
    const catWidth = Math.min(width * 0.42, Math.max(24, longest(yLabels)));
    left += catWidth + 8;
    if (model.x.title) left += 18;
    if (model.y.title) bottom += 18;
    right = 20;
  }

  if (top + bottom > height - 24) {
    const overflow = top + bottom - (height - 24);
    bottom = Math.max(16, bottom - overflow);
  }
  return { top, right, bottom, left, rotate, every };
}

function gridLines(model, ticks, along, other, plot, theme, horizontal, which) {
  const lines = [];
  if (which === 'value') {
    const list = horizontal ? null : ticks;
    if (!horizontal) {
      for (const tick of list) {
        const y = Math.round(along(tick.value)) + 0.5;
        if (y < plot.y - 0.5 || y > plot.y + plot.h + 0.5) continue;
        lines.push(gridLine(plot.x, y, plot.x + plot.w, y, theme));
      }
    } else {
      for (const tick of ticks) {
        const x = Math.round(along(tick.value)) + 0.5;
        if (x < plot.x - 0.5 || x > plot.x + plot.w + 0.5) continue;
        lines.push(gridLine(x, plot.y, x, plot.y + plot.h, theme));
      }
    }
    return lines;
  }

  if (model.pointMode === 'index') return lines;
  const scale = along;
  for (const value of ticks.ticks || []) {
    const at = scale(value);
    if (horizontal) {
      lines.push(gridLine(plot.x, at, plot.x + plot.w, at, theme));
    } else {
      const x = Math.round(at) + 0.5;
      lines.push(gridLine(x, plot.y, x, plot.y + plot.h, theme));
    }
  }
  return lines;
}

function gridLine(x1, y1, x2, y2, theme) {
  return { type: 'line', x1, y1, x2, y2, stroke: theme.grid, sw: 1, dash: '3' };
}

function needsMixed(model) {
  if (model.yAxes && model.yAxes.length > 1) return true;
  return model.series.some((series) => series.seriesType && series.seriesType !== model.type);
}

function buildMulti(display, width, height, measure, theme, model, options) {
  if (display === model) {
    const reused = reuseFrame(model, width, height, theme, options);
    if (reused) return reused;
  }
  const horizontal = !!model.horizontal;
  const prepared = prepareCartesian(display, model);
  if (!prepared.count) return withEmpty(blank(width, height, model), width, height, theme, model);

  const axes = model.yAxes?.length ? model.yAxes : [model.y];
  const xDomain = independentDomain(model, prepared);
  const domains = axes.map((axis, axisIndex) => domainForAxis(model, prepared, axis, axisIndex, xDomain));
  const formatTick = (axis, value) => (
    axis.format
      ? safeFormat(axis.format, value, formatNumber(value))
      : formatValue({ ...model, y: axis }, value)
  );
  const left = [];
  const right = [];
  axes.forEach((axis, index) => {
    (axis.opposite ? right : left).push({ axis, index });
  });
  if (!left.length && right.length) left.push(right.shift());

  const gutterOf = (entry) => {
    if (!entry || entry.axis.show === false) return { width: 0, text: 0, labels: [], values: [] };
    const values = domains[entry.index].ticks;
    const labels = values.map((value) => formatTick(entry.axis, value));
    const text = Math.min(88, labels.reduce((max, tick) => Math.max(max, measure(tick, FONT)), 0));
    return {
      width: text + 12 + (entry.axis.title ? 18 : 0),
      text,
      labels,
      values,
    };
  };
  const leftGutters = left.map(gutterOf);
  const rightGutters = right.map(gutterOf);
  const primaryAt = Math.max(0, left.findIndex((entry) => entry.axis.show !== false));
  const primary = left[primaryAt] || left[0];
  const primaryGutter = leftGutters[primaryAt] || leftGutters[0];
  const yTicks = (primaryGutter?.values || []).map((value, index) => ({
    value,
    label: primaryGutter.labels[index],
  }));
  const xLabels = xTickLabels(model, prepared, xDomain);
  const margin = margins({
    model: {
      ...model,
      y: {
        ...model.y,
        title: primary?.axis.show === false ? '' : (primary?.axis.title || ''),
        color: primary?.axis.color || null,
      },
    },
    width,
    height,
    measure,
    horizontal,
    yLabels: horizontal ? prepared.labels : yTicks.map((tick) => tick.label),
    xLabels: horizontal ? yTicks.map((tick) => tick.label) : xLabels.labels,
    xLabelPlan: horizontal ? null : xLabels,
  });
  if (!horizontal) {
    left.forEach((entry, index) => {
      if (index === primaryAt || entry.axis.show === false) return;
      margin.left += leftGutters[index].width;
    });
    rightGutters.forEach((gutter) => {
      margin.right += gutter.width;
    });
  }

  const plot = {
    x: margin.left,
    y: margin.top,
    w: Math.max(8, width - margin.left - margin.right),
    h: Math.max(8, height - margin.top - margin.bottom),
  };
  if (!horizontal) fitTimeTicks(model, xLabels, plot.w, measure, margin);
  const scales = domains.map((domain) => (
    horizontal
      ? scaleLinear(domain.min, domain.max, plot.x, plot.x + plot.w)
      : scaleLinear(domain.min, domain.max, plot.y + plot.h, plot.y)
  ));
  const scaleOf = (seriesIndex) => {
    const index = model.series[seriesIndex]?.yIndex || 0;
    return scales[Math.min(index, scales.length - 1)] || scales[0];
  };
  const slotScale = categorySlots(model, prepared, xDomain, plot, horizontal);
  const nodes = [];
  if (model.axes && model.grid.y && primary) {
    nodes.push(...gridLines(model, yTicks, scales[primary.index], slotScale, plot, theme, horizontal, 'value'));
  }
  const drawn = drawCombo(model, prepared, plot, scaleOf, slotScale, theme, horizontal);
  nodes.push(...drawn.nodes);
  if (model.axes && primary) {
    nodes.push(...axisLabels({
      model: {
        ...model,
        y: {
          ...(primary.axis.show === false ? { ...primary.axis, title: '' } : primary.axis),
          title: primary.axis.show === false ? '' : primary.axis.title,
        },
      },
      theme,
      measure,
      plot,
      horizontal,
      yTicks: primary.axis.show === false ? [] : yTicks,
      valueScale: scales[primary.index],
      xLabels,
      slotScale,
      margin,
    }));
    if (!horizontal) {
      drawSideAxes(nodes, left, leftGutters, scales, plot, theme, 'left', primaryAt, primaryGutter);
      drawSideAxes(nodes, right, rightGutters, scales, plot, theme, 'right', -1, null);
    }
  }
  if (model.annotations && primary) {
    nodes.push(...drawAnnotations(model, prepared, plot, scales[primary.index], slotScale, theme));
  }
  const rest = {
    ariaLabel: aria(model),
    plot,
    gradients: drawn.gradients,
    nodes,
    legend: legendOf(model),
    empty: drawn.empty,
    xDomain: xDomain ? { min: xDomain.min, max: xDomain.max } : null,
  };
  const makeHover = (deferred) => (
    deferred ? deferredHover(plot) : hoverCombo(model, prepared, plot, scaleOf, slotScale, horizontal)
  );
  return keepFrame(model, display, width, height, theme, rest, makeHover, options);
}

function drawSideAxes(nodes, entries, gutters, scales, plot, theme, side, skip, primaryGutter) {
  let x = side === 'right'
    ? plot.x + plot.w + 8
    : plot.x - 8 - (primaryGutter?.text || 0) - 22 - (primaryGutter?.width > (primaryGutter?.text || 0) + 12 ? 16 : 0);
  entries.forEach((entry, index) => {
    if (index === skip || entry.axis.show === false) return;
    const gutter = gutters[index];
    if (!gutter?.width) return;
    const scale = scales[entry.index];
    const ink = entry.axis.color || theme.muted;
    if (side === 'left') x -= gutter.text;
    gutter.labels.forEach((text, tickIndex) => {
      const y = scale(gutter.values[tickIndex]);
      if (y < plot.y - 1 || y > plot.y + plot.h + 1) return;
      nodes.push(label(x, y, text, side === 'right' ? 'start' : 'end', 'middle', ink));
    });
    if (entry.axis.title) {
      const titleX = side === 'right' ? x + gutter.text + 14 : x - 16;
      nodes.push({
        ...label(titleX, plot.y + plot.h / 2, entry.axis.title, 'middle', 'middle', ink),
        rotate: side === 'right' ? 90 : -90,
        weight: 600,
      });
    }
    x += side === 'right' ? gutter.width : -(gutter.width - gutter.text);
  });
}

function domainForAxis(model, prepared, axis, axisIndex, xDomain) {
  const mine = (seriesIndex) => (model.series[seriesIndex].yIndex || 0) === axisIndex;
  let min = Infinity;
  let max = -Infinity;
  const consider = (value) => {
    if (value == null || !Number.isFinite(value)) return;
    min = Math.min(min, value);
    max = Math.max(max, value);
  };
  if (prepared.finalValues) {
    for (let s = 0; s < model.series.length; s += 1) {
      if (!mine(s) || model.series[s].hidden) continue;
      const values = model.stacked ? null : prepared.finalValues[s];
      if (values) values.forEach(consider);
      if (model.stacked) {
        const stacked = stackSeries(model.series.map((series, index) => ({
          hidden: series.hidden || !mine(index),
          values: prepared.finalValues[index],
        })));
        consider(stacked.min);
        consider(stacked.max);
        break;
      }
    }
  } else if (axis.refit === false && prepared.axisExtent?.[axisIndex]) {
    min = prepared.axisExtent[axisIndex].min;
    max = prepared.axisExtent[axisIndex].max;
  } else {
    const extent = extentOfSeries(model, prepared, axis.refit === false ? null : xWindowOf(xDomain), mine);
    min = extent.min;
    max = extent.max;
    if (axis.refit === false) {
      if (!prepared.axisExtent) prepared.axisExtent = [];
      prepared.axisExtent[axisIndex] = { min, max };
    }
  }
  const bars = model.series.some((series, index) => mine(index) && (series.seriesType || model.type) === 'bar');
  const areas = model.series.some((series, index) => mine(index) && (series.seriesType || model.type) === 'area');
  const minOpt = applyBound(axis, 'min', min);
  const maxOpt = applyBound(axis, 'max', max);
  return resolveDomain(min, max, {
    zero: axis.zero != null ? axis.zero : bars || areas || model.stacked,
    min: minOpt,
    max: maxOpt,
    ticks: 5,
    headroom: bars,
  });
}

function drawCombo(model, prepared, plot, scaleOf, slotScale, theme, horizontal) {
  const nodes = [];
  const gradients = [];
  let drew = false;
  const kindOf = (index) => model.series[index].seriesType || (model.type === 'column' ? 'bar' : model.type);
  const barIndexes = model.series.map((_, index) => index).filter((index) => kindOf(index) === 'bar' && !model.series[index].hidden);
  const barSlots = barIndexes.length ? (slotScale.slots || linearBarSlots(model, prepared, slotScale)) : [];
  if (barIndexes.length && barSlots.length) {
    const gap = !model.stacked && barIndexes.length > 1 ? Math.min(4, 10 / barIndexes.length) : 0;
    const readBar = (seriesIndex, index, slot) => (
      prepared.values
        ? prepared.values[seriesIndex][index]
        : pointValue(prepared.finalPoints?.[seriesIndex] || prepared.points?.[seriesIndex], slot.valueX)
    );
    for (let index = 0; index < barSlots.length; index += 1) {
      const slot = barSlots[index];
      const group = barIndexes.filter((seriesIndex) => readBar(seriesIndex, index, slot) != null);
      if (!group.length) continue;
      const thickness = model.stacked ? slot.w : Math.max(1, (slot.w - gap * (group.length - 1)) / group.length);
      const running = new Map();
      let cap = null;
      group.forEach((seriesIndex, order) => {
        const raw = readBar(seriesIndex, index, slot);
        if (raw == null) return;
        const scale = scaleOf(seriesIndex);
        const key = `${model.series[seriesIndex].yIndex || 0}:${raw >= 0 ? 1 : 0}`;
        const baseValue = model.stacked ? (running.get(key) || 0) : 0;
        const topValue = model.stacked ? baseValue + raw : raw;
        if (model.stacked) running.set(key, topValue);
        const start = scale(baseValue);
        const end = scale(topValue);
        const cross = model.stacked ? slot.x : slot.x + order * (thickness + gap);
        const rect = barRect(start, end, cross, thickness, horizontal);
        if (rect.w < 0.4 && rect.h < 0.4) return;
        drew = true;
        const positive = raw >= 0;
        const side = horizontal ? (positive ? 'right' : 'left') : (positive ? 'top' : 'bottom');
        const d = barPath(rect.x, rect.y, rect.w, rect.h, model.barRadius, side);
        nodes.push({
          type: 'path',
          d,
          fill: model.series[seriesIndex].color,
          stroke: 'none',
          sw: 0,
          clip: true,
          series: seriesIndex,
          index,
        });
        const lit = (horizontal ? rect.w : rect.h) >= 16;
        if (model.stacked) {
          if (lit) cap = { d, side, rect };
        } else if (lit) pushSheen(nodes, gradients, { d, side, rect }, horizontal);
      });
      if (cap) pushSheen(nodes, gradients, cap, horizontal);
    }
  }

  const pathIndexes = model.series.map((_, index) => index).filter((index) => {
    const kind = kindOf(index);
    return (kind === 'line' || kind === 'area') && !model.series[index].hidden;
  });
  for (const seriesIndex of pathIndexes) {
    const series = model.series[seriesIndex];
    const scale = scaleOf(seriesIndex);
    const kind = kindOf(seriesIndex);
    const samples = sampleSeries(model, prepared, seriesIndex, scale, slotScale, horizontal);
    const parts = segments(samples);
    if (!parts.length) continue;
    drew = true;
    const curve = series.curve || model.curve;
    const strokeWidth = series.strokeWidth == null ? model.strokeWidth : series.strokeWidth;
    for (const part of parts) {
      if (kind === 'area' && part.length > 1) {
        const top = part.map((point) => ({ x: point.x, y: point.y }));
        const base = part.map((point) => ({ x: point.x, y: point.base }));
        const fill = areaPath(top, base, curve);
        if (fill) {
          nodes.push({
            type: 'path',
            d: fill,
            ...areaPaint(model, series, seriesIndex, gradients),
            stroke: 'none',
            sw: 0,
            clip: true,
          });
        }
      }
      if (part.length === 1) {
        if (markerInside(part[0], plot, slotScale.domain)) {
          paintMarker(nodes, part[0].x, part[0].y, Math.max(series.markerSize ?? model.markerSize, 3), series.color, theme, false);
        }
        continue;
      }
      if (strokeWidth > 0) pushStroke(nodes, linePath(part, curve), series.color, strokeWidth, series.dash, true, part.length);
    }
    if (series.markerSize > 0) {
      for (const point of samples) {
        if (point && markerInside(point, plot, slotScale.domain)) {
          nodes.push(marker(point.x, point.y, series.markerSize, series.color, theme));
        }
      }
    }
  }

  for (const seriesIndex of model.series.map((_, index) => index)) {
    if (kindOf(seriesIndex) !== 'scatter' || model.series[seriesIndex].hidden) continue;
    const samples = sampleSeries(model, prepared, seriesIndex, scaleOf(seriesIndex), slotScale, horizontal);
    const halo = samples.length <= 80;
    for (const point of samples) {
      if (!point || !markerInside(point, plot, slotScale.domain)) continue;
      drew = true;
      paintMarker(nodes, point.x, point.y, Math.max(model.series[seriesIndex].markerSize ?? model.markerSize, 4), model.series[seriesIndex].color, theme, halo);
    }
  }

  if (!drew) nodes.push(emptyText(plot, theme, model));
  return { nodes, gradients, empty: !drew };
}

function sampleSeries(model, prepared, seriesIndex, scale, slotScale, horizontal) {
  if (prepared.values) {
    return prepared.values[seriesIndex].map((value, index) => {
      if (value == null) return null;
      const along = slotScale.slots[index].mid;
      const across = scale(value);
      const base = scale(0);
      return horizontal ? { x: across, y: along, base } : { x: along, y: across, base };
    });
  }
  return windowedPoints(prepared.points?.[seriesIndex] || [], slotScale.domain, true, prepared.sortedPoints?.[seriesIndex]).map((point) => {
    if (!point) return null;
    const x = horizontal ? scale(point.y) : slotScale.scale(point.x);
    const y = horizontal ? slotScale.scale(point.x) : scale(point.y);
    return { x, y, base: horizontal ? scale(0) : scale(0) };
  });
}

/**
 * Samples inside an x window, plus one neighbor on each side when `neighbors`
 * is set so the stroke still enters the plot. Far samples stay out of the
 * path. Their pixel positions would otherwise bend the visible curve.
 */
function windowedPoints(points, domain, neighbors, sorted) {
  if (!domain?.windowed || !points?.length) return points || [];
  if (sorted) return windowedSorted(points, domain, neighbors);
  let first = -1;
  let last = -1;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (!point || !Number.isFinite(point.x)) continue;
    if (point.x >= domain.min && point.x <= domain.max) {
      if (first < 0) first = index;
      last = index;
    }
  }
  if (first < 0) {
    if (!neighbors) return [];
    let before = -1;
    let after = -1;
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      if (!point || !Number.isFinite(point.x)) continue;
      if (point.x < domain.min) before = index;
      else if (after < 0) after = index;
    }
    if (before < 0 && after < 0) return [];
    const lo = before < 0 ? after : before;
    const hi = after < 0 ? before : after;
    const start = Math.min(lo, hi);
    const slice = points.slice(start, Math.max(lo, hi) + 1);
    slice.origin = start;
    return slice;
  }
  let lo = first;
  let hi = last;
  if (neighbors) {
    for (let index = first - 1; index >= 0; index -= 1) {
      if (points[index] && Number.isFinite(points[index].x)) {
        lo = index;
        break;
      }
    }
    for (let index = last + 1; index < points.length; index += 1) {
      if (points[index] && Number.isFinite(points[index].x)) {
        hi = index;
        break;
      }
    }
  }
  const slice = points.slice(lo, hi + 1);
  slice.origin = lo;
  return slice;
}

function windowedSorted(points, domain, neighbors) {
  let lo = lowerBound(points, domain.min);
  let hi = upperBound(points, domain.max) - 1;
  if (lo > hi) {
    if (!neighbors) return [];
    const before = lo > 0 ? lo - 1 : -1;
    const after = lo < points.length ? lo : -1;
    if (before < 0 && after < 0) return [];
    const start = Math.min(before < 0 ? after : before, after < 0 ? before : after);
    const end = Math.max(before < 0 ? after : before, after < 0 ? before : after);
    const slice = points.slice(start, end + 1);
    slice.origin = start;
    return slice;
  }
  if (neighbors) {
    if (lo > 0) lo -= 1;
    if (hi < points.length - 1) hi += 1;
  }
  const slice = points.slice(lo, hi + 1);
  slice.origin = lo;
  return slice;
}

function lowerBound(points, target) {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].x < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperBound(points, target) {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].x <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function markerInside(point, plot, domain) {
  if (!domain?.windowed) return true;
  return point.x >= plot.x - 1 && point.x <= plot.x + plot.w + 1
    && point.y >= plot.y - 1 && point.y <= plot.y + plot.h + 1;
}

function hoverCombo(model, prepared, plot, scaleOf, slotScale, horizontal) {
  if (!prepared.values || !slotScale.slots) {
    return hoverFor(model, prepared, plot, scaleOf(0), slotScale, horizontal, scaleOf);
  }
  const entries = slotScale.slots.map((slot, index) => {
    const rows = [];
    model.series.forEach((series, seriesIndex) => {
      if (series.hidden) return;
      const value = series.values?.[index];
      const shown = value == null || !Number.isFinite(value) ? null : value;
      const scale = scaleOf(seriesIndex);
      const y = shown == null ? null : (horizontal ? slot.mid : scale(shown));
      rows.push({
        name: series.name,
        value: shown,
        color: series.color,
        y,
        x: horizontal && shown != null ? scale(shown) : slot.mid,
        seriesIndex,
      });
    });
    return {
      index,
      label: prepared.labels[index],
      x: horizontal ? plot.x : slot.mid,
      y: horizontal ? slot.mid : plot.y,
      x0: horizontal ? plot.x : slot.mid - slot.step / 2,
      x1: horizontal ? plot.x + plot.w : slot.mid + slot.step / 2,
      y0: horizontal ? slot.mid - slot.step / 2 : plot.y,
      y1: horizontal ? slot.mid + slot.step / 2 : plot.y + plot.h,
      rows,
    };
  });
  return { kind: horizontal ? 'band-y' : 'band', plot, entries, horizontal };
}

function percentMatrix(matrix, series) {
  const count = matrix.reduce((max, row) => Math.max(max, row.length), 0);
  const totals = Array(count).fill(0);
  for (let s = 0; s < matrix.length; s += 1) {
    if (series[s]?.hidden) continue;
    for (let i = 0; i < count; i += 1) {
      const value = matrix[s][i];
      if (value != null) totals[i] += Math.abs(value);
    }
  }
  return matrix.map((row, s) => Array.from({ length: count }, (_, i) => {
    const value = row[i];
    if (value == null) return null;
    if (series[s]?.hidden || !totals[i]) return 0;
    return (value / totals[i]) * 100;
  }));
}

/** An explicit x min or max. Null when the axis is still on the full series. */
function xWindowOf(xDomain) {
  if (!xDomain?.windowed) return null;
  if (!Number.isFinite(xDomain.min) || !Number.isFinite(xDomain.max) || !(xDomain.max > xDomain.min)) return null;
  return xDomain;
}

/**
 * Points inside a sorted window, plus one neighbor on each side.
 * Ties keep the earliest sample at that x, matching the linear scan.
 */
function absorbSortedExtent(extent, points, xWindow) {
  const start = lowerBound(points, xWindow.min);
  const end = upperBound(points, xWindow.max);
  for (let index = start; index < end; index += 1) extent = absorbY(extent, points[index]);
  if (start > 0) {
    let before = start - 1;
    const x = points[before].x;
    while (before > 0 && points[before - 1].x === x) before -= 1;
    extent = absorbY(extent, points[before]);
  }
  if (end < points.length) extent = absorbY(extent, points[end]);
  return extent;
}

function absorbY(extent, point) {
  if (!point) return extent;
  let { min, max } = extent;
  if (Number.isFinite(point.y)) {
    min = Math.min(min, point.y);
    max = Math.max(max, point.y);
  }
  for (const value of point.extra || []) {
    if (value == null || !Number.isFinite(value)) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return { min, max };
}

/**
 * Y extent for the series `mine` accepts.
 * A window keeps points inside it plus the nearest sample on each side,
 * so a slice between two samples still has a scale.
 */
function extentOfSeries(model, prepared, xWindow, mine) {
  let extent = { min: Infinity, max: -Infinity };
  for (let s = 0; s < model.series.length; s += 1) {
    if (!mine(s) || model.series[s].hidden) continue;
    const points = prepared.finalPoints[s] || [];
    if (!xWindow) {
      for (const point of points) extent = absorbY(extent, point);
      continue;
    }
    if (prepared.sortedFinal?.[s]) {
      extent = absorbSortedExtent(extent, points, xWindow);
      continue;
    }
    let before = null;
    let after = null;
    for (const point of points) {
      if (!point || !Number.isFinite(point.x)) continue;
      if (point.x >= xWindow.min && point.x <= xWindow.max) {
        extent = absorbY(extent, point);
      } else if (point.x < xWindow.min && (!before || point.x > before.x)) {
        before = point;
      } else if (point.x > xWindow.max && (!after || point.x < after.x)) {
        after = point;
      }
    }
    extent = absorbY(extent, before);
    extent = absorbY(extent, after);
  }
  return extent;
}

function applyBound(axis, key, computed) {
  if (!axis) return null;
  const fn = key === 'min' ? axis.minFn : axis.maxFn;
  if (typeof fn === 'function') {
    try {
      const next = finite(fn(Number.isFinite(computed) ? computed : 0));
      if (next != null) return next;
    } catch {
      return axis[key];
    }
  }
  return axis[key];
}

function drawAnnotations(model, prepared, plot, valueScale, slotScale, theme) {
  const nodes = [];
  const notes = model.annotations;
  if (!notes) return nodes;
  for (const item of notes.y) {
    const y = valueScale(item.y);
    if (y < plot.y - 1 || y > plot.y + plot.h + 1) continue;
    const ink = item.color || theme.muted;
    nodes.push({ type: 'line', x1: plot.x, y1: y, x2: plot.x + plot.w, y2: y, stroke: ink, sw: 1, dash: '2 3' });
    if (item.text) {
      const labelY = y <= plot.y + 12 ? y + 12 : y - 8;
      nodes.push(label(plot.x + plot.w - 28, labelY, item.text, 'end', 'auto', ink, 600, 11));
    }
  }
  for (const item of notes.x) {
    const x = annotationX(model, prepared, slotScale, item.x);
    if (x == null || x < plot.x || x > plot.x + plot.w) continue;
    nodes.push({ type: 'line', x1: x, y1: plot.y, x2: x, y2: plot.y + plot.h, stroke: item.color || theme.muted, sw: 1 });
    if (item.text) nodes.push(label(x + 4, plot.y + 12, item.text, 'start', 'hanging', item.color || theme.muted, 600, 11));
  }
  for (const item of notes.points) {
    const x = annotationX(model, prepared, slotScale, item.x);
    const y = valueScale(item.y);
    if (x == null) continue;
    nodes.push(marker(x, y, 4, item.color || theme.fg, theme));
    if (item.text) nodes.push(label(x + 8, y - 8, item.text, 'start', 'auto', theme.fg, 600, 11));
  }
  return nodes;
}

function annotationX(model, prepared, slotScale, value) {
  if (slotScale.slots) {
    const label = String(value);
    let index = prepared.labels?.indexOf(label) ?? -1;
    if (index < 0 && model.categories) index = model.categories.indexOf(label);
    if (index < 0 && Number.isFinite(Number(value))) index = Number(value);
    const slot = slotScale.slots[index];
    return slot ? slot.mid : null;
  }
  const number = finite(value);
  if (number == null || !slotScale.scale) return null;
  return slotScale.scale(number);
}

function areaPaint(model, series, seriesIndex, gradients, opacity) {
  const amount = opacity == null
    ? (series.fillOpacity == null ? model.fillOpacity : series.fillOpacity)
    : opacity;
  if (model.stacked || model.solidFill) return { fill: series.color, fillOpacity: amount };
  gradients.push({ id: `s${seriesIndex}`, color: series.color, opacity: amount });
  return { fill: `url(#__grad_${seriesIndex})`, fillOpacity: 1 };
}

function drawSeries(model, display, prepared, plot, valueScale, slotScale, theme, horizontal) {
  if (model.type === 'bar') return drawBars(model, prepared, plot, valueScale, slotScale, theme, horizontal);
  if (model.type === 'scatter' || model.pointMode !== 'index') {
    return drawPoints(model, prepared, plot, valueScale, slotScale, theme, horizontal, model.type !== 'scatter');
  }
  return drawPathSeries(model, prepared, plot, valueScale, slotScale, theme);
}

function drawPathSeries(model, prepared, plot, valueScale, slotScale, theme) {
  const nodes = [];
  const gradients = [];
  const stacked = model.stacked ? stackFrame(model, prepared) : null;
  const order = model.stacked
    ? model.series.map((_, index) => index)
    : model.series.map((_, index) => index).reverse();
  let drew = false;
  const showMarkers = markersOn(model, prepared.count);
  const domain = slotScale.domain;
  const keepIndex = (index) => !domain?.windowed || (index >= domain.min - 1 && index <= domain.max + 1);
  const onPlot = (x) => x >= plot.x - 1 && x <= plot.x + plot.w + 1;

  for (const seriesIndex of order) {
    const series = model.series[seriesIndex];
    if (series.hidden) continue;
    const samples = prepared.values[seriesIndex].map((value, index) => {
      if (!keepIndex(index)) return null;
      if (value == null && !stacked) return null;
      const yValue = stacked ? stacked.displayTop[seriesIndex][index] : value;
      if (yValue == null) return null;
      const baseValue = stacked ? stacked.displayBase[seriesIndex][index] : 0;
      return {
        x: slotScale.slots[index].mid,
        y: valueScale(yValue),
        base: valueScale(baseValue ?? 0),
      };
    });
    const parts = segments(samples);
    if (!parts.length) continue;
    drew = true;
    const curve = series.curve || model.curve;
    const strokeWidth = series.strokeWidth == null ? model.strokeWidth : series.strokeWidth;
    const fillOpacity = series.fillOpacity == null ? model.fillOpacity : series.fillOpacity;
    for (const part of parts) {
      if (model.type === 'area' && part.length > 1) {
        const top = part.map((point) => ({ x: point.x, y: point.y }));
        const base = part.map((point) => ({ x: point.x, y: point.base }));
        const fill = areaPath(top, base, curve);
        if (fill) {
          nodes.push({
            type: 'path',
            d: fill,
            ...areaPaint(model, series, seriesIndex, gradients, fillOpacity),
            stroke: 'none',
            sw: 0,
            clip: true,
          });
        }
      }
      if (part.length === 1) {
        if (!showMarkers && onPlot(part[0].x)) paintMarker(nodes, part[0].x, part[0].y, Math.max(model.markerSize, 3), series.color, theme, false);
        continue;
      }
      if (strokeWidth > 0 && model.type !== 'scatter') {
        pushStroke(nodes, linePath(part, curve), series.color, strokeWidth, series.dash, true, part.length);
      }
    }
    if (showMarkers) {
      for (const point of samples) {
        if (!point || (domain?.windowed && !onPlot(point.x))) continue;
        nodes.push(marker(point.x, point.y, model.markerSize, series.color, theme));
      }
    }
  }

  if (!drew) nodes.push(emptyText(plot, theme, model));
  return { nodes, gradients, empty: !drew };
}

const scratchX = [];
const scratchY = [];
const scratchMark = [];

function drawPoints(model, prepared, plot, valueScale, slotScale, theme, horizontal, connect) {
  const nodes = [];
  const gradients = [];
  let drew = false;
  const yScale = valueScale;
  const xScale = slotScale.scale;
  const order = model.series.map((_, index) => index).reverse();
  const zero = yScale(0);
  const baseline = horizontal ? { x: zero } : { y: zero };

  for (const seriesIndex of order) {
    const series = model.series[seriesIndex];
    if (series.hidden) continue;
    const source = windowedPoints(prepared.points[seriesIndex], slotScale.domain, connect, prepared.sortedPoints?.[seriesIndex]);
    const curve = series.curve || model.curve;
    const strokeWidth = series.strokeWidth == null ? model.strokeWidth : series.strokeWidth;
    const connectLine = connect && model.type !== 'scatter';
    const mark = model.type === 'scatter' || markersOn(model, source.length);
    const radius = model.type === 'scatter' ? Math.max(model.markerSize, 4) : model.markerSize;
    const xs = scratchX;
    const ys = scratchY;
    const marks = scratchMark;
    xs.length = 0;
    ys.length = 0;
    marks.length = 0;
    let any = false;
    const flush = () => {
      if (connectLine && xs.length > 1) {
        if (model.type === 'area') {
          const fill = areaBand(xs, ys, curve, baseline);
          if (fill) {
            nodes.push({
              type: 'path',
              d: fill,
              ...areaPaint(model, series, seriesIndex, gradients),
              stroke: 'none',
              sw: 0,
              clip: true,
            });
          }
        }
        if (strokeWidth > 0) pushStroke(nodes, lineCoords(xs, ys, curve), series.color, strokeWidth, series.dash, true, xs.length);
      }
      xs.length = 0;
      ys.length = 0;
    };
    for (let index = 0; index < source.length; index += 1) {
      const point = source[index];
      if (!point) {
        flush();
        continue;
      }
      const px = horizontal ? yScale(point.y) : xScale(point.x);
      const py = horizontal ? xScale(point.x) : yScale(point.y);
      if (!Number.isFinite(px) || !Number.isFinite(py)) {
        flush();
        continue;
      }
      any = true;
      if (connectLine) {
        xs.push(px);
        ys.push(py);
      }
      if (mark && markerInside({ x: px, y: py }, plot, slotScale.domain)) marks.push(px, py);
    }
    flush();
    if (!any) continue;
    drew = true;
    const halo = model.type === 'scatter' && marks.length <= 160;
    for (let index = 0; index < marks.length; index += 2) {
      paintMarker(nodes, marks[index], marks[index + 1], radius, series.color, theme, halo);
    }
  }
  if (!drew) nodes.push(emptyText(plot, theme, model));
  return { nodes, gradients, empty: !drew };
}

function pointValue(list, x) {
  if (!list) return null;
  for (const point of list) {
    if (point && Math.abs(point.x - x) <= 0.5) return point.y;
  }
  return null;
}

/** Equal-width bars along a time or linear axis, aligned by x. */
function linearBarSlots(model, prepared, slotScale) {
  const scale = slotScale.scale;
  if (!scale) return [];
  const xs = [];
  for (const list of prepared.finalPoints || prepared.points || []) {
    for (const point of list || []) {
      if (point && Number.isFinite(point.x)) xs.push(point.x);
    }
  }
  xs.sort((a, b) => a - b);
  const unique = [];
  for (const x of xs) {
    if (!unique.length || x - unique[unique.length - 1] > 0.5) unique.push(x);
  }
  if (!unique.length) return [];
  const domain = slotScale.domain;
  let gap = domain && domain.max > domain.min ? (domain.max - domain.min) / unique.length : 1;
  for (let index = 1; index < unique.length; index += 1) gap = Math.min(gap, unique[index] - unique[index - 1]);
  const inner = model.band != null ? model.band : 0.72;
  const width = Math.max(1, Math.abs(scale(unique[0] + gap) - scale(unique[0])) * inner);
  return unique.map((x) => {
    const mid = scale(x);
    return { x: mid - width / 2, w: width, mid, step: width, valueX: x };
  });
}

function drawBars(model, prepared, plot, valueScale, slotScale, theme, horizontal) {
  const nodes = [];
  const gradients = [];
  const visible = model.series.map((series, index) => index).filter((index) => !model.series[index].hidden);
  const slots = slotScale.slots || linearBarSlots(model, prepared, slotScale);
  const aligned = prepared.values ? null : {
    values: (prepared.points || []).map((list) => slots.map((slot) => pointValue(list, slot.valueX))),
    finalValues: (prepared.finalPoints || prepared.points || []).map((list) => slots.map((slot) => pointValue(list, slot.valueX))),
  };
  const stacked = model.stacked
    ? stackFrame(model, aligned ? { ...prepared, values: aligned.values, finalValues: aligned.finalValues } : prepared)
    : null;
  let drew = false;
  const gap = !model.stacked && visible.length > 1 ? Math.min(4, 10 / visible.length) : 0;

  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    const read = (seriesIndex, which) => {
      if (prepared.values) return prepared.values[seriesIndex][index];
      return (which === 'final' ? aligned.finalValues : aligned.values)[seriesIndex][index];
    };
    const group = visible.filter((seriesIndex) => {
      const value = stacked ? stacked.displayTop[seriesIndex][index] : read(seriesIndex);
      return value != null;
    });
    if (!group.length) continue;
    const thickness = model.stacked ? slot.w : Math.max(1, (slot.w - gap * (group.length - 1)) / group.length);
    let cap = null;
    group.forEach((seriesIndex, order) => {
      const raw = read(seriesIndex);
      const top = stacked ? stacked.displayTop[seriesIndex][index] : raw;
      const base = stacked ? (stacked.displayBase[seriesIndex][index] ?? 0) : 0;
      if (top == null) return;
      const start = valueScale(base);
      const end = valueScale(top);
      const cross = model.stacked ? slot.x : slot.x + order * (thickness + gap);
      const rect = barRect(start, end, cross, thickness, horizontal);
      if (rect.w < 0.4 && rect.h < 0.4) return;
      drew = true;
      const outer = !stacked || stacked.outer[seriesIndex][index];
      const positive = (stacked ? top : raw) >= (stacked ? base : 0);
      const side = horizontal ? (positive ? 'right' : 'left') : (positive ? 'top' : 'bottom');
      const radius = outer ? model.barRadius : 0;
      const color = model.distributed && model.colors?.length
        ? model.colors[index % model.colors.length]
        : model.series[seriesIndex].color;
      const d = barPath(rect.x, rect.y, rect.w, rect.h, radius, side);
      nodes.push({
        type: 'path',
        d,
        fill: color,
        stroke: 'none',
        sw: 0,
        clip: true,
        series: seriesIndex,
        index,
      });
      const lit = (horizontal ? rect.w : rect.h) >= 16;
      if (model.stacked) {
        if (lit) cap = { d, side, rect };
      } else if (lit) pushSheen(nodes, gradients, { d, side, rect }, horizontal);
      const labelFits = horizontal ? rect.w >= 28 && rect.h >= 14 : rect.h >= 16 && rect.w >= 14;
      if (model.showValues && labelFits) {
        const text = formatValue(model, raw);
        nodes.push({
          type: 'text',
          x: rect.x + rect.w / 2,
          y: rect.y + rect.h / 2,
          text,
          anchor: 'middle',
          baseline: 'middle',
          fill: inkOn(color),
          size: 11,
          weight: 700,
        });
      }
    });
    if (cap) pushSheen(nodes, gradients, cap, horizontal);
  }

  if (!drew) nodes.push(emptyText(plot, theme, model));
  return { nodes, gradients, empty: !drew };
}

function stackFrame(model, prepared) {
  const finalSeries = model.series.map((series, index) => ({
    hidden: series.hidden,
    values: prepared.finalValues[index],
  }));
  const displaySeries = model.series.map((series, index) => ({
    hidden: series.hidden,
    values: prepared.values[index],
  }));
  const finalStack = stackSeries(finalSeries);
  const displayStack = stackSeries(displaySeries);
  return {
    displayTop: displayStack.top,
    displayBase: displayStack.base,
    outer: finalStack.outer,
  };
}

function barRect(start, end, cross, thickness, horizontal) {
  if (horizontal) {
    const x = Math.min(start, end);
    return { x, y: cross, w: Math.abs(end - start), h: thickness };
  }
  const y = Math.min(start, end);
  return { x: cross, y, w: thickness, h: Math.abs(end - start) };
}

function barPath(x, y, w, h, radius, side) {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  const x2 = x + w;
  const y2 = y + h;
  if (r < 0.5) return `M${round(x)},${round(y)}h${round(w)}v${round(h)}h${round(-w)}Z`;
  if (side === 'top') {
    return `M${round(x)},${round(y2)}V${round(y + r)}Q${round(x)},${round(y)},${round(x + r)},${round(y)}H${round(x2 - r)}Q${round(x2)},${round(y)},${round(x2)},${round(y + r)}V${round(y2)}Z`;
  }
  if (side === 'bottom') {
    return `M${round(x)},${round(y)}V${round(y2 - r)}Q${round(x)},${round(y2)},${round(x + r)},${round(y2)}H${round(x2 - r)}Q${round(x2)},${round(y2)},${round(x2)},${round(y2 - r)}V${round(y)}Z`;
  }
  if (side === 'right') {
    return `M${round(x)},${round(y)}H${round(x2 - r)}Q${round(x2)},${round(y)},${round(x2)},${round(y + r)}V${round(y2 - r)}Q${round(x2)},${round(y2)},${round(x2 - r)},${round(y2)}H${round(x)}Z`;
  }
  return `M${round(x2)},${round(y)}H${round(x + r)}Q${round(x)},${round(y)},${round(x)},${round(y + r)}V${round(y2 - r)}Q${round(x)},${round(y2)},${round(x + r)},${round(y2)}H${round(x2)}Z`;
}

function axisLabels({ model, theme, measure, plot, horizontal, yTicks, valueScale, xLabels, slotScale, margin }) {
  const nodes = [];
  if (!horizontal) {
    nodes.push({
      type: 'line',
      x1: plot.x,
      y1: plot.y + plot.h + 0.5,
      x2: plot.x + plot.w,
      y2: plot.y + plot.h + 0.5,
      stroke: theme.axis,
      sw: 1,
    });
    const yInk = model.y.color || theme.muted;
    for (const tick of yTicks) {
      const y = valueScale(tick.value);
      if (y < plot.y - 1 || y > plot.y + plot.h + 1) continue;
      nodes.push(label(plot.x - 8, y, tick.label, 'end', 'middle', yInk));
    }
    const step = margin.every || 1;
    xLabels.labels.forEach((text, index) => {
      if (index % step !== 0) return;
      const x = xLabels.ticks && slotScale.scale
        ? slotScale.scale(xLabels.ticks[index])
        : slotScale.slots[index].mid;
      if (margin.rotate) {
        nodes.push({
          ...label(x, plot.y + plot.h + 10, text, 'end', 'middle', theme.muted),
          rotate: -40,
        });
      } else {
        nodes.push(label(x, plot.y + plot.h + 16, text, 'middle', 'hanging', theme.muted));
      }
    });
    if (model.y.title) {
      nodes.push({
        ...label(14, plot.y + plot.h / 2, model.y.title, 'middle', 'middle', model.y.color || theme.muted),
        rotate: -90,
        weight: 600,
      });
    }
    if (model.x.title) {
      nodes.push(label(
        plot.x + plot.w / 2,
        plot.y + plot.h + margin.bottom - 11,
        model.x.title,
        'middle',
        'middle',
        theme.muted,
        600,
      ));
    }
  } else {
    nodes.push({
      type: 'line',
      x1: plot.x - 0.5,
      y1: plot.y,
      x2: plot.x - 0.5,
      y2: plot.y + plot.h,
      stroke: theme.axis,
      sw: 1,
    });
    const maxCat = plot.x - (model.x.title ? 28 : 12);
    preparedLabels(model, slotScale).forEach((text, index) => {
      const y = slotScale.slots[index].mid;
      nodes.push(label(plot.x - 8, y, truncateTo(text, maxCat, measure), 'end', 'middle', theme.muted));
    });
    for (const tick of yTicks) {
      const x = valueScale(tick.value);
      if (x < plot.x - 1 || x > plot.x + plot.w + 1) continue;
      nodes.push(label(x, plot.y + plot.h + 16, tick.label, 'middle', 'hanging', theme.muted));
    }
    if (model.x.title) {
      nodes.push({
        ...label(16, plot.y + plot.h / 2, model.x.title, 'middle', 'middle', theme.muted),
        rotate: -90,
        weight: 600,
      });
    }
    if (model.y.title) {
      nodes.push(label(plot.x + plot.w / 2, plot.y + plot.h + margin.bottom - 11, model.y.title, 'middle', 'middle', theme.muted, 600));
    }
  }
  return nodes;
}

function preparedLabels(model, slotScale) {
  return slotScale.slots.map((_, index) => model.categories?.[index] ?? String(index + 1));
}

function deferredHover(plot) {
  return { kind: 'none', plot, entries: [], deferred: true };
}

/** Hover rows stay packed until a test or a hit reads one. */
function pointHover(hover) {
  let entries = null;
  Object.defineProperty(hover, 'entries', {
    enumerable: true,
    get() {
      if (!entries) entries = hover.cols ? pointEntries(hover.cols) : locateEntries(hover.locate);
      return entries;
    },
  });
  return hover;
}

function locateEntries(locate) {
  const entries = [];
  for (const span of locate.spans) {
    for (let offset = 0; offset < span.points.length; offset += 1) {
      const point = span.points[offset];
      const seriesIndex = span.seriesIndex;
      const xValue = point.x;
      const py = (span.yScale || locate.yScale)(point.y);
      entries.push({
        index: span.origin + offset,
        seriesIndex,
        x: locate.xScale(point.x),
        y: py,
        xValue,
        get label() {
          return locate.formatLabel(xValue);
        },
        rows: [{
          name: locate.names[seriesIndex],
          value: point.y,
          color: locate.colors[seriesIndex],
          y: py,
          seriesIndex,
        }],
      });
    }
  }
  return entries;
}

function pointEntries(cols) {
  const entries = new Array(cols.x.length);
  for (let index = 0; index < entries.length; index += 1) {
    const xValue = cols.xValue[index];
    const seriesIndex = cols.series[index];
    const py = cols.y[index];
    entries[index] = {
      index: cols.index[index],
      seriesIndex,
      x: cols.x[index],
      y: py,
      xValue,
      get label() {
        return cols.formatLabel(xValue);
      },
      rows: [{
        name: cols.names[seriesIndex],
        value: cols.dataY[index],
        color: cols.colors[seriesIndex],
        y: py,
        seriesIndex,
      }],
    };
  }
  return entries;
}

function hoverFor(model, prepared, plot, valueScale, slotScale, horizontal, scaleOf) {
  const yOf = (seriesIndex) => (scaleOf ? scaleOf(seriesIndex) : valueScale);
  if (model.pointMode !== 'index') {
    const names = model.series.map((series) => series.name);
    const colors = model.series.map((series) => series.color);
    const formatLabel = (xValue) => formatX(
      model,
      xValue,
      (slotScale.domain?.max ?? 0) - (slotScale.domain?.min ?? 0),
    );
    const direct = !horizontal
      && model.type !== 'scatter'
      && slotScale.scale
      && slotScale.domain
      && model.series.every((series, index) => series.hidden || prepared.sortedFinal?.[index]);
    if (direct) {
      const locate = {
        names,
        colors,
        formatLabel,
        xScale: slotScale.scale,
        yScale: valueScale,
        xMin: slotScale.domain.min,
        xMax: slotScale.domain.max,
        spans: [],
      };
      model.series.forEach((series, seriesIndex) => {
        if (series.hidden) return;
        const list = prepared.finalPoints?.[seriesIndex] || series.points || [];
        const visible = slotScale.domain.windowed
          ? windowedPoints(list, slotScale.domain, true, true)
          : list;
        if (!visible.length) return;
        locate.spans.push({
          points: visible,
          origin: visible.origin || 0,
          seriesIndex,
          yScale: yOf(seriesIndex),
        });
      });
      return pointHover({
        kind: 'point',
        plot,
        spans: locate.spans.map((span) => ({ from: 0, to: span.points.length, monotonic: true })),
        horizontal,
        connected: true,
        fast: locate.spans.length > 0,
        cols: null,
        locate,
      });
    }
    const cols = {
      x: [],
      y: [],
      index: [],
      xValue: [],
      dataY: [],
      series: [],
      names,
      colors,
      formatLabel,
    };
    const spans = [];
    model.series.forEach((series, seriesIndex) => {
      if (series.hidden) return;
      const list = prepared.finalPoints?.[seriesIndex] || series.points || [];
      const visible = slotScale.domain?.windowed
        ? windowedPoints(list, slotScale.domain, true, prepared.sortedFinal?.[seriesIndex])
        : list;
      const origin = visible.origin || 0;
      const from = cols.x.length;
      const scale = yOf(seriesIndex);
      let monotonic = !horizontal && !!prepared.sortedFinal?.[seriesIndex];
      let previous = -Infinity;
      for (let offset = 0; offset < visible.length; offset += 1) {
        const point = visible[offset];
        if (!point) continue;
        const px = horizontal ? scale(point.y) : slotScale.scale(point.x);
        const py = horizontal ? slotScale.scale(point.x) : scale(point.y);
        if (px < previous) monotonic = false;
        previous = px;
        cols.x.push(px);
        cols.y.push(py);
        cols.index.push(origin + offset);
        cols.xValue.push(point.x);
        cols.dataY.push(point.y);
        cols.series.push(seriesIndex);
      }
      if (cols.x.length > from) spans.push({ from, to: cols.x.length, monotonic });
    });
    const fast = spans.length > 0 && spans.every((span) => span.monotonic);
    return pointHover({
      kind: 'point',
      plot,
      spans,
      horizontal,
      connected: model.type !== 'scatter',
      fast,
      cols,
      locate: null,
    });
  }

  const stacked = model.stacked
    ? stackSeries(model.series.map((item) => ({ hidden: item.hidden, values: item.values })))
    : null;
  const entries = slotScale.slots.map((slot, index) => {
    const rows = [];
    model.series.forEach((series, seriesIndex) => {
      if (series.hidden) return;
      const value = series.values?.[index];
      const shown = value == null || !Number.isFinite(value) ? null : value;
      let y = null;
      if (shown != null) {
        if (stacked) {
          y = horizontal ? null : valueScale(stacked.top[seriesIndex][index]);
          if (horizontal) {
            rows.push({
              name: series.name,
              value: shown,
              color: series.color,
              y: slot.mid,
              x: valueScale(stacked.top[seriesIndex][index]),
              seriesIndex,
            });
            return;
          }
        } else {
          y = horizontal ? slot.mid : valueScale(shown);
        }
      }
      rows.push({
        name: series.name,
        value: shown,
        color: series.color,
        y: horizontal ? slot.mid : y,
        x: horizontal && shown != null ? valueScale(shown) : slot.mid,
        seriesIndex,
      });
    });
    return {
      index,
      label: prepared.labels[index],
      x: horizontal ? plot.x : slot.mid,
      y: horizontal ? slot.mid : plot.y,
      x0: horizontal ? plot.x : slot.mid - slot.step / 2,
      x1: horizontal ? plot.x + plot.w : slot.mid + slot.step / 2,
      y0: horizontal ? slot.mid - slot.step / 2 : plot.y,
      y1: horizontal ? slot.mid + slot.step / 2 : plot.y + plot.h,
      rows,
    };
  });
  return { kind: horizontal ? 'band-y' : 'band', plot, entries, horizontal };
}

function buildPie(display, width, height, measure, theme, model) {
  const slices = model.series.map((series, index) => {
    const raw = display.series[index]?.values?.[0];
    const final = series.values?.[0];
    const value = series.hidden ? 0 : Math.max(0, Number.isFinite(final) ? final : 0);
    const shown = series.hidden ? 0 : Math.max(0, Number.isFinite(raw) ? raw : value);
    return { index, series, value, shown };
  });
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const shownTotal = slices.reduce((sum, slice) => sum + slice.shown, 0);
  const legend = legendOf(model);
  if (!(total > 0) && !(shownTotal > 0)) {
    return withEmpty({ ...blank(width, height, model), legend }, width, height, theme, model);
  }

  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.max(8, Math.min(width, height) / 2 - 14);
  const inner = radius * clamp(model.inner, 0, 0.86);
  const nodes = [];
  const entries = [];
  let angle = 0;
  const sweepTotal = shownTotal > 0 ? shownTotal : total;
  const openSlices = slices.filter((item) => item.shown > 0).length;
  const gapPx = model.gap > 0 && openSlices > 1 ? model.gap : 0;
  for (const slice of slices) {
    if (!(slice.shown > 0)) continue;
    const sweep = (slice.shown / sweepTotal) * Math.PI * 2;
    const start = angle;
    const end = angle + sweep;
    angle = end;
    const inset = gapPx ? Math.min(sweep * 0.4, gapPx / Math.max(radius, 1)) : 0;
    const path = arcPath(cx, cy, inner, radius, start + inset / 2, end - inset / 2);
    nodes.push({
      type: 'path',
      d: path,
      fill: slice.series.color,
      stroke: gapPx ? 'none' : theme.ring,
      sw: gapPx ? 0 : (openSlices > 1 ? 1.5 : 0),
      fillRule: end - start >= Math.PI * 2 - 1e-3 && inner > 0 ? 'evenodd' : null,
    });
    const fraction = total > 0 ? slice.value / total : 0;
    if (model.showValues !== false && fraction >= 0.04 && sweep > 0.28) {
      const at = polar(cx, cy, inner > 0 ? (inner + radius) / 2 : radius * 0.62, (start + end) / 2);
      nodes.push({
        type: 'text',
        x: at[0],
        y: at[1],
        text: `${(fraction * 100).toFixed(1)}%`,
        anchor: 'middle',
        baseline: 'middle',
        fill: inkOn(slice.series.color),
        size: 12,
        weight: 700,
      });
    }
    entries.push({
      index: slice.index,
      name: slice.series.name,
      value: slice.value,
      color: slice.series.color,
      start,
      end,
      cx,
      cy,
      r0: inner,
      r1: radius,
      label: slice.series.name,
      d: path,
      rows: [{ name: slice.series.name, value: slice.value, color: slice.series.color, seriesIndex: slice.index }],
    });
  }

  if ((model.type === 'donut' || inner > 0) && model.center !== false && model.center !== '') {
    const parts = model.center == null
      ? { label: 'Total', text: formatNumber(total), captionBelow: true }
      : centerContent(model.center, total);
    if (parts) {
      let size = inner > 36 ? 22 : 16;
      while (size > 11 && measure(parts.text, size, 700) > inner * 1.35) size -= 1;
      if (parts.label && !parts.captionBelow) {
        nodes.push(label(cx, cy - 10, parts.label, 'middle', 'auto', theme.muted, 600, 13));
        nodes.push({
          type: 'text',
          x: cx,
          y: cy + size * 0.28,
          text: parts.text,
          anchor: 'middle',
          baseline: 'middle',
          fill: theme.fg,
          size,
          weight: 700,
        });
      } else {
        nodes.push({
          type: 'text',
          x: cx,
          y: parts.captionBelow ? cy - (size > 14 ? 6 : 0) : cy,
          text: parts.text,
          anchor: 'middle',
          baseline: 'middle',
          fill: theme.fg,
          size,
          weight: 700,
        });
        if (parts.captionBelow) {
          nodes.push(label(cx, cy + size * 0.55, parts.label, 'middle', 'hanging', theme.muted, 500, 11));
        }
      }
    }
  }

  return {
    ariaLabel: aria(model),
    plot: { x: cx - radius, y: cy - radius, w: radius * 2, h: radius * 2 },
    gradients: [],
    nodes,
    hover: { kind: 'pie', plot: { x: cx - radius, y: cy - radius, w: radius * 2, h: radius * 2 }, entries },
    legend,
    empty: false,
  };
}

/** Angle 0 is 12 o'clock. Positive sweeps clockwise, which matches SVG. */
export function arcPath(cx, cy, r0, r1, a0, a1) {
  const sweep = a1 - a0;
  if (sweep <= 1e-4 || r1 <= 0) return '';
  if (sweep >= Math.PI * 2 - 1e-3) {
    const outer = circlePath(cx, cy, r1);
    if (r0 <= 0.5) return outer;
    return `${outer}${circlePath(cx, cy, r0)}`;
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

function circlePath(cx, cy, r) {
  return `M${round(cx - r)},${round(cy)}A${round(r)},${round(r)} 0 1 1 ${round(cx + r)},${round(cy)}A${round(r)},${round(r)} 0 1 1 ${round(cx - r)},${round(cy)}Z`;
}

export function polar(cx, cy, radius, angle) {
  return [cx + radius * Math.sin(angle), cy - radius * Math.cos(angle)];
}

function pushStroke(nodes, d, color, sw, dash, clip, count) {
  if (!d || !(sw > 0)) return;
  if (!dash && count > 1 && count <= 96) {
    nodes.push({
      type: 'path',
      d,
      fill: 'none',
      stroke: color,
      sw: sw + 6,
      strokeOpacity: 0.18,
      cap: 'round',
      join: 'round',
      clip,
      glow: true,
    });
  }
  nodes.push({
    type: 'path',
    d,
    fill: 'none',
    stroke: color,
    sw,
    dash: dash || null,
    cap: 'round',
    join: 'round',
    clip,
  });
}

function paintMarker(nodes, x, y, radius, color, theme, halo) {
  if (halo && radius >= 3) {
    nodes.push({
      type: 'circle',
      cx: x,
      cy: y,
      r: radius + 6,
      fill: color,
      fillOpacity: 0.2,
      stroke: 'none',
    });
  }
  nodes.push(marker(x, y, radius, color, theme));
  if (halo && radius >= 4) {
    nodes.push({
      type: 'circle',
      cx: x - radius * 0.28,
      cy: y - radius * 0.32,
      r: Math.max(1.4, radius * 0.28),
      fill: '#fff',
      fillOpacity: 0.9,
      stroke: 'none',
    });
  }
}

const SHEEN = {
  top: { x1: '0', y1: '0', x2: '0', y2: '1' },
  bottom: { x1: '0', y1: '1', x2: '0', y2: '0' },
  right: { x1: '1', y1: '0', x2: '0', y2: '0' },
  left: { x1: '0', y1: '0', x2: '1', y2: '0' },
};

function pushSheen(nodes, gradients, cap, horizontal) {
  const sheen = sheenPaint(gradients, cap.side, cap.rect, horizontal);
  if (!sheen) return;
  nodes.push({
    type: 'path',
    d: cap.d,
    fill: sheen,
    stroke: 'none',
    sw: 0,
    clip: true,
    sheen: true,
  });
}

/** A short white fade at the outer end of a bar. The data path stays the solid color underneath. */
function sheenPaint(gradients, side, rect, horizontal) {
  const span = horizontal ? rect.w : rect.h;
  const across = horizontal ? rect.h : rect.w;
  if (span < 16 || across < 6 || !SHEEN[side]) return null;
  if (!gradients.some((item) => item.kind === 'sheen' && item.id === side)) {
    gradients.push({ kind: 'sheen', id: side, ...SHEEN[side] });
  }
  return `url(#__sheen_${side})`;
}

function marker(x, y, radius, color, theme) {
  return {
    type: 'circle',
    cx: x,
    cy: y,
    r: radius,
    fill: color,
    stroke: theme.ring,
    sw: 1.5,
  };
}

function label(x, y, text, anchor, baseline, fill, weight = 400, size = FONT) {
  return { type: 'text', x, y, text: String(text ?? ''), anchor, baseline, fill, size, weight };
}

function emptyText(plot, theme, model) {
  return label(plot.x + plot.w / 2, plot.y + plot.h / 2, model?.emptyText || 'No data', 'middle', 'middle', theme.empty, 500, 13);
}

function markersOn(model, count) {
  if (model.markers === true) return true;
  if (model.markers === false) return false;
  return model.type === 'line' && count <= 36;
}

function formatValue(model, value) {
  if (value == null || !Number.isFinite(value)) return '–';
  if (model.y.format) return safeFormat(model.y.format, value, formatNumber(value));
  return formatNumber(value);
}

function formatX(model, value, span) {
  const fallback = () => {
    if (model.pointMode === 'time') return formatTime(value, span || 0, !!model.x.utc);
    if (typeof value === 'number' && model.pointMode === 'linear') return formatNumber(value);
    return String(value ?? '');
  };
  if (!model.x.format) return fallback();
  return safeFormat(model.x.format, value, fallback);
}

/** A user formatter that throws falls back to the plain label. */
function safeFormat(fn, value, fallback) {
  try {
    return String(fn(value));
  } catch {
    return typeof fallback === 'function' ? fallback() : fallback;
  }
}

function legendOf(model) {
  return model.series.map((series, index) => ({
    name: series.name,
    color: series.color,
    hidden: !!series.hidden,
    index,
  }));
}

function aria(model) {
  const head = model.title || `${model.type} chart`;
  const names = model.series.map((series) => series.name).filter(Boolean);
  return names.length ? `${head}. ${names.join(', ')}.` : head;
}

function prettifyAxisLabels(labels) {
  const times = labels.map((label) => (isIsoDate(label) ? Date.parse(label) : NaN));
  if (!times.length || times.some((time) => !Number.isFinite(time))) return labels;
  const { min, max } = finiteExtent(times);
  const span = max - min;
  return times.map((time) => formatTime(time, span || 1));
}

function truncate(text, max) {
  const value = String(text ?? '');
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function truncateTo(text, maxWidth, measure) {
  const value = String(text ?? '');
  if (measure(value, FONT) <= maxWidth) return value;
  let size = value.length;
  while (size > 1 && measure(`${value.slice(0, size)}…`, FONT) > maxWidth) size -= 1;
  return `${value.slice(0, size)}…`;
}
