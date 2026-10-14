import { formatNumber, measureText } from './format.js';
import { buildChart } from './geometry.js';
import { applyResponsive, mergeConfig, normalize } from './normalize.js';
import { CSS } from './style.js';
import { resolveTheme } from './theme.js';
import { fail } from './util.js';

const NS = 'http://www.w3.org/2000/svg';
const STYLE_ID = 'chartshelf-style';
const live = new WeakMap();
const byId = new Map();
const watched = new Set();
let nextId = 1;
let sheetUsers = 0;
let domObserver = null;

export class Chart {
  constructor(target, config = {}) {
    this.el = resolveTarget(target);
    const stored = cloneConfig(config);
    const model = normalize(stored);
    const previous = live.get(this.el);
    if (previous) previous.destroy();
    live.set(this.el, this);
    this.id = `csh${nextId}`;
    nextId += 1;
    this.config = stored;
    this.model = model;
    this._publicId = '';
    this._brushRange = null;
    this._drag = null;
    this._bindId();
    this._dead = false;
    this._alive = false;
    this._shown = null;
    this._token = 0;
    this._raf = 0;
    this._rangeRaf = 0;
    this._rangePaint = false;
    this._spec = null;
    this._theme = null;
    this._inside = false;
    this._pointer = null;
    this._legendKey = '';
    this._box = '';
    this._tool = 'select';
    this.tools = null;
  }

  render() {
    if (this._dead) fail('chart was destroyed');
    if (!this._alive) {
      this._alive = true;
      retainSheet();
      this.build();
    }
    this.paint(true);
    return this;
  }

  update(partial = {}, animate) {
    if (this._dead) fail('chart was destroyed');
    const nextConfig = mergeConfig(this.config, partial);
    const next = normalize(applyResponsive(nextConfig, this._hostWidth()));
    this.config = nextConfig;
    this._bindId();
    carryHidden(this.model, next);
    this.model = next;
    if (this._alive) this.paint(animate !== false);
    return this;
  }

  updateSeries(series) {
    return this.update({ series });
  }

  /** Show an x window. A second call replaces it. Double-click resets it when zoom is on. */
  setRange(min, max) {
    const pending = this._rangePaint;
    this.dropPendingRange();
    const changed = this.writeRange(min, max);
    if (this._alive && (changed || pending)) this.paint(false);
    return this;
  }

  resetRange() {
    const pending = this._rangePaint;
    this.dropPendingRange();
    const changed = this.writeRange(null, null);
    if (this._alive && (changed || pending)) this.paint(false);
    return this;
  }

  /**
   * Move the x window without re-parsing series.
   * `null` clears a bound. A non-finite bound leaves the current window alone.
   * Returns whether the window changed. Painting is the caller's job.
   */
  writeRange(min, max) {
    if (this._dead) fail('chart was destroyed');
    const lo = rangeBound(min);
    const hi = rangeBound(max);
    if (lo === undefined || hi === undefined) return false;
    if (lo != null && hi != null && !(hi > lo)) return false;
    const axis = this.model?.x;
    const current = this.config?.x;
    if (
      axis
      && axis.min === lo
      && axis.max === hi
      && axis.minFn == null
      && axis.maxFn == null
      && current
      && typeof current === 'object'
      && !Array.isArray(current)
      && current.min === lo
      && current.max === hi
    ) return false;
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      this.config.x = { min: lo, max: hi };
    } else {
      current.min = lo;
      current.max = hi;
    }
    if (axis) {
      axis.min = lo;
      axis.max = hi;
      axis.minFn = null;
      axis.maxFn = null;
    }
    return true;
  }

  dropPendingRange() {
    this._rangePaint = false;
    if (this._rangeRaf) cancelAnimationFrame(this._rangeRaf);
    this._rangeRaf = 0;
  }

  /**
   * Record a window now and paint it once per frame.
   * Pan and the wheel call this so a burst of events shares one draw.
   */
  queueRange(min, max) {
    if (this._dead) return;
    if (!this.writeRange(min, max)) return;
    this._rangePaint = true;
    if (this._rangeRaf) return;
    this._rangeRaf = requestAnimationFrame(() => {
      this._rangeRaf = 0;
      this.flushRange();
    });
  }

  flushRange() {
    if (this._rangeRaf) {
      cancelAnimationFrame(this._rangeRaf);
      this._rangeRaf = 0;
    }
    if (!this._rangePaint || this._dead) {
      this._rangePaint = false;
      return;
    }
    this._rangePaint = false;
    if (this._alive) this.paint(false);
  }

  static lookup(id) {
    return byId.get(String(id || '')) || null;
  }

  destroy() {
    if (this._dead) return;
    this._dead = true;
    this._token += 1;
    if (this._raf) cancelAnimationFrame(this._raf);
    this.dropPendingRange();
    this.releasePointer();
    unwatchHost(this);
    this._ro?.disconnect();
    this._mq?.removeEventListener('change', this._onScheme);
    if (this._publicId && byId.get(this._publicId) === this) byId.delete(this._publicId);
    if (live.get(this.el) === this) live.delete(this.el);
    this.el.replaceChildren();
    this.el.classList.remove('csh-host');
    this.el.style.height = '';
    this.el.style.width = '';
    this.el.removeAttribute('data-theme');
    if (this._alive) releaseSheet();
    this._alive = false;
  }

  build() {
    this.el.classList.add('csh-host');
    this.head = document.createElement('div');
    this.head.className = 'csh-head';
    this.head.setAttribute('aria-hidden', 'true');
    this.body = document.createElement('div');
    this.body.className = 'csh-body';
    this.stage = document.createElement('div');
    this.stage.className = 'csh-stage';
    this.legend = document.createElement('div');
    this.legend.className = 'csh-legend';
    this.svg = document.createElementNS(NS, 'svg');
    this.svg.setAttribute('class', 'csh-svg');
    this.svg.setAttribute('role', 'img');
    this.defs = document.createElementNS(NS, 'defs');
    this.layer = document.createElementNS(NS, 'g');
    this.hover = document.createElementNS(NS, 'g');
    this.svg.append(this.defs, this.layer, this.hover);
    this.tip = document.createElement('div');
    this.tip.className = 'csh-tip';
    this.tip.hidden = true;
    this.stage.append(this.svg, this.tip);
    this.body.append(this.stage, this.legend);
    this.el.replaceChildren(this.head, this.body);

    this._onMove = (event) => {
      if (this._dead) return;
      this._inside = true;
      this._pointer = this.localPoint(event);
      if (this._drag?.mode === 'pan') {
        this.shiftRange(this._drag, this._pointer.x);
        return;
      }
      if (this._drag?.mode === 'select') {
        this._drag.x1 = this._pointer.x;
        this.tip.hidden = true;
        this.paintSelection(this._drag.x0, this._drag.x1);
        return;
      }
      if (this._spec?.hover?.deferred) {
        this.paint(false);
        return;
      }
      this.applyHover();
    };
    this._onLeave = () => {
      if (this._dead || this._drag) return;
      this._inside = false;
      this._pointer = null;
      this.clearHover();
    };
    this._onDown = (event) => {
      if (this._dead) return;
      this._inside = true;
      this._pointer = this.localPoint(event);
      if (this._spec?.hover?.deferred) this.paint(false);
      if (this.beginDrag(event)) return;
      this.emitPoint(this.applyHover());
    };
    this._onUp = (event) => {
      if (this._dead || !this._drag) return;
      const drag = this._drag;
      this._drag = null;
      this._pointerId = null;
      this._pointer = this.localPoint(event);
      if (drag.mode === 'pan') {
        this.shiftRange(drag, this._pointer.x);
        this.flushRange();
        this.setCursor(chartCursor(this));
        return;
      }
      drag.x1 = this._pointer.x;
      if (Math.abs(drag.x1 - drag.x0) < 6) {
        this.clearHover();
        this.emitPoint(this.applyHover());
        return;
      }
      const range = this.pixelSpan(drag.x0, drag.x1);
      this.clearHover();
      if (range) this.applySpan(range);
    };
    this._onDbl = () => {
      if (this._dead) return;
      if (this.model.brush?.target) {
        Chart.lookup(this.model.brush.target)?.resetRange();
        this._brushRange = null;
        this.paint(false);
        return;
      }
      if (this.model.zoom) this.resetRange();
    };
    this._onWheel = (event) => {
      if (this._dead || !this.wheelZoom(event)) return;
      event.preventDefault();
    };
    this._onCancel = () => {
      if (this._dead || !this._drag) return;
      this._drag = null;
      this._pointerId = null;
      this.clearHover();
      this.setCursor(chartCursor(this));
      this.flushRange();
    };
    this.stage.addEventListener('pointermove', this._onMove);
    this.stage.addEventListener('pointerleave', this._onLeave);
    this.stage.addEventListener('pointerdown', this._onDown);
    this.stage.addEventListener('pointerup', this._onUp);
    this.stage.addEventListener('pointercancel', this._onCancel);
    this.stage.addEventListener('lostpointercapture', this._onCancel);
    this.stage.addEventListener('dblclick', this._onDbl);
    this.stage.addEventListener('wheel', this._onWheel, { passive: false });

    this._mq = window.matchMedia('(prefers-color-scheme: dark)');
    this._reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    this._onScheme = () => {
      if (this._dead) return;
      if (this._mounted && !this.el.isConnected) {
        this.destroy();
        return;
      }
      if (!this.model.theme || this.model.theme === 'auto') this.paint(false);
    };
    this._mq.addEventListener('change', this._onScheme);

    this._ro = new ResizeObserver(() => {
      if (this._dead) return;
      if (this._mounted && !this.el.isConnected) {
        this.destroy();
        return;
      }
      const width = Math.floor(this.stage.clientWidth);
      const height = Math.floor(this.stage.clientHeight);
      if (width === this._width && height === this._height) return;
      if (width < 2 || height < 2) return;
      this.paint(false);
    });
    this._ro.observe(this.stage);
    watchHost(this);
  }

  paint(animate) {
    if (this._dead || !this._alive) return;
    if (Array.isArray(this.config.responsive)) {
      const width = this._hostWidth();
      const key = responsiveKey(this.config.responsive, width);
      if (key !== this._responsiveKey) {
        this._responsiveKey = key;
        const next = normalize(applyResponsive(this.config, width));
        carryHidden(this.model, next);
        this.model = next;
      }
    } else if (this._responsiveKey) {
      this._responsiveKey = '';
    }
    this.applyBox();
    this.renderHead();
    this.renderLegend();
    const width = Math.floor(this.stage.clientWidth);
    const height = Math.floor(this.stage.clientHeight);
    if (width < 2 || height < 2) return;
    this._width = width;
    this._height = height;
    const sized = `${width}x${height}`;
    if (sized !== this._sized) {
      this._sized = sized;
      this.svg.setAttribute('width', String(width));
      this.svg.setAttribute('height', String(height));
    }
    this.setCursor(this._drag?.mode === 'pan' ? 'grabbing' : chartCursor(this));
    this.renderTools();

    this._token += 1;
    const token = this._token;
    if (this._raf) cancelAnimationFrame(this._raf);
    const target = this.model;
    const theme = resolveTheme(target.theme, this._mq.matches);
    this._theme = theme;
    if (this._themeName !== theme.name) {
      this._themeName = theme.name;
      applyTheme(this.el, theme);
    }

    const drawFrame = (shown) => {
      if (token !== this._token || this._dead) return;
      const spec = buildChart(shown, width, height, measureText, theme, target, {
        hover: this._inside && !this._drag,
      });
      this._spec = spec;
      if (spec.ariaLabel !== this._aria) {
        this._aria = spec.ariaLabel;
        this.svg.setAttribute('aria-label', spec.ariaLabel);
      }
      this.drawSpec(spec);
      if (this._inside && !this._drag) this.applyHover();
    };

    const reduce = this._reduce.matches;
    if (!animate || !target.animate || reduce) {
      if (this._shownBase !== target) {
        this._shown = cloneModel(target);
        this._shownBase = target;
      }
      drawFrame(target);
      return;
    }
    const from = this._shown && sameShape(this._shown, target) ? this._shown : zeroLike(target);
    const started = performance.now();
    const step = (now) => {
      if (token !== this._token || this._dead) return;
      const t = Math.min(1, (now - started) / 340);
      const eased = 1 - (1 - t) ** 3;
      const shown = lerpModel(from, target, eased);
      this._shown = shown;
      drawFrame(shown);
      if (t < 1) this._raf = requestAnimationFrame(step);
      else this._shownBase = target;
    };
    this._raf = requestAnimationFrame(step);
  }

  applyBox() {
    const { height, width, background, fontFamily } = this.model;
    const next = `${height}|${width}|${background || ''}|${fontFamily || ''}`;
    if (next === this._box) return;
    this._box = next;
    this.el.style.height = typeof height === 'number' ? `${height}px` : height;
    if (typeof width === 'number') this.el.style.width = `${width}px`;
    else if (typeof width === 'string' && width) this.el.style.width = width;
    else this.el.style.width = '';
    this.el.style.background = background || '';
    this.el.style.fontFamily = fontFamily || '';
  }

  renderHead() {
    const { title, subtitle } = this.model;
    const align = this.model.titleAlign || 'left';
    const key = `${title}\n${subtitle}\n${align}`;
    if (key === this._headKey) return;
    this._headKey = key;
    this.head.dataset.align = align;
    this.head.replaceChildren();
    if (title) {
      const node = document.createElement('div');
      node.className = 'csh-title';
      node.textContent = title;
      this.head.append(node);
    }
    if (subtitle) {
      const node = document.createElement('div');
      node.className = 'csh-sub';
      node.textContent = subtitle;
      this.head.append(node);
    }
  }

  renderLegend() {
    const { legend, series } = this.model;
    const key = `${legend.show}:${legend.position}:${series.map((item) => `${item.name}\0${item.color}\0${item.hidden}`).join('\n')}`;
    if (key === this._legendKey) return;
    this._legendKey = key;
    this.body.dataset.legend = legend.show ? legend.position : 'none';
    this.legend.replaceChildren();
    if (!legend.show) return;
    series.forEach((item, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-pressed', item.hidden ? 'false' : 'true');
      const swatch = document.createElement('span');
      swatch.className = 'csh-swatch';
      swatch.style.background = item.color;
      swatch.style.boxShadow = `0 0 8px color-mix(in srgb, ${item.color} 50%, transparent)`;
      if (this.model.type === 'bar') swatch.style.borderRadius = '2px';
      const name = document.createElement('span');
      name.className = 'csh-name';
      name.textContent = item.name;
      button.append(swatch, name);
      button.addEventListener('click', () => {
        this.model.series[index].hidden = !this.model.series[index].hidden;
        this.paint(true);
        const listener = this.model.onLegend;
        if (typeof listener !== 'function') return;
        try {
          listener(index, item.name);
        } catch {
          // A listener cannot stall the legend.
        }
      });
      this.legend.append(button);
    });
  }

  drawSpec(spec) {
    const clipId = `${this.id}-clip`;
    this.restoreSliceFade();
    this.syncDefs(spec, clipId);
    this.syncLayer(spec, clipId);
    this._hoverKey = '';
    if (this.hover.childNodes.length) this.hover.replaceChildren();
    this.paintBrush();
  }

  /** Keep the clip and gradients. A pan frame usually changes neither shape. */
  syncDefs(spec, clipId) {
    const plot = spec.plot;
    let clip = this.defs.querySelector('clipPath');
    if (!clip || clip.id !== clipId) {
      this.defs.replaceChildren();
      clip = svgEl('clipPath');
      clip.id = clipId;
      clip.append(svgEl('rect'));
      this.defs.append(clip);
      this._gradKey = '';
      this._plotKey = '';
    }
    const rect = clip.firstChild;
    const across = !!this.model?.horizontal;
    const plotKey = `${plot.x}|${plot.y}|${plot.w}|${plot.h}|${across ? 1 : 0}`;
    const plotMoved = plotKey !== this._plotKey;
    if (plotMoved) {
      this._plotKey = plotKey;
      rect.setAttribute('x', plot.x);
      rect.setAttribute('y', plot.y);
      rect.setAttribute('width', Math.max(0, plot.w));
      rect.setAttribute('height', Math.max(0, plot.h));
    }
    const x2 = String(across ? plot.x + plot.w : plot.x);
    const y2 = String(across ? plot.y : plot.y + plot.h);
    const gradKey = spec.gradients.map((item) => (
      item.kind === 'sheen' ? `sheen:${item.id}` : `${item.id}:${item.color}:${item.opacity}`
    )).join('|');
    const existing = this.defs.querySelectorAll('linearGradient');
    if (gradKey === this._gradKey && existing.length === spec.gradients.length) {
      if (plotMoved) {
        existing.forEach((node) => {
          if (node.getAttribute('gradientUnits') === 'objectBoundingBox') return;
          node.setAttribute('x1', String(plot.x));
          node.setAttribute('y1', String(plot.y));
          node.setAttribute('x2', x2);
          node.setAttribute('y2', y2);
        });
      }
      return;
    }
    this._gradKey = gradKey;
    for (const node of existing) node.remove();
    for (const gradient of spec.gradients) {
      if (gradient.kind === 'sheen') {
        const node = svgEl('linearGradient');
        node.id = `${this.id}-sheen-${gradient.id}`;
        node.setAttribute('gradientUnits', 'objectBoundingBox');
        node.setAttribute('x1', gradient.x1);
        node.setAttribute('y1', gradient.y1);
        node.setAttribute('x2', gradient.x2);
        node.setAttribute('y2', gradient.y2);
        const cap = svgEl('stop');
        cap.setAttribute('offset', '0');
        cap.setAttribute('stop-color', '#fff');
        cap.setAttribute('stop-opacity', '0.28');
        const fade = svgEl('stop');
        fade.setAttribute('offset', '0.45');
        fade.setAttribute('stop-color', '#fff');
        fade.setAttribute('stop-opacity', '0');
        node.append(cap, fade);
        this.defs.append(node);
        continue;
      }
      const node = svgEl('linearGradient');
      node.id = `${this.id}-${gradient.id}`;
      node.setAttribute('gradientUnits', 'userSpaceOnUse');
      node.setAttribute('x1', String(plot.x));
      node.setAttribute('y1', String(plot.y));
      node.setAttribute('x2', x2);
      node.setAttribute('y2', y2);
      const top = svgEl('stop');
      top.setAttribute('offset', '0');
      top.setAttribute('stop-color', gradient.color);
      top.setAttribute('stop-opacity', String(gradient.opacity));
      const mid = svgEl('stop');
      mid.setAttribute('offset', '0.42');
      mid.setAttribute('stop-color', gradient.color);
      mid.setAttribute('stop-opacity', String(gradient.opacity * 0.38));
      const bottom = svgEl('stop');
      bottom.setAttribute('offset', '1');
      bottom.setAttribute('stop-color', gradient.color);
      bottom.setAttribute('stop-opacity', '0');
      node.append(top, mid, bottom);
      this.defs.append(node);
    }
  }

  /** Reuse SVG nodes when the frame has the same shape, and write the new geometry into them. */
  syncLayer(spec, clipId) {
    const nodes = spec.nodes;
    const previous = this._drawn;
    const same = previous
      && previous.length === nodes.length
      && previous.every((el, index) => el.dataset.kind === nodeKind(nodes[index]) && el.parentNode === this.layer);
    if (!same) {
      this._drawn = nodes.map((node) => makeNode(node, clipId, this.id));
      const fragment = document.createDocumentFragment();
      for (const el of this._drawn) fragment.append(el);
      this.layer.replaceChildren(fragment);
      return;
    }
    for (let index = 0; index < nodes.length; index += 1) {
      patchNode(previous[index], nodes[index], clipId, this.id);
    }
  }

  _hostWidth() {
    return Math.floor(this.el?.clientWidth || this._width || 0);
  }

  _bindId() {
    const next = this.config?.id ? String(this.config.id) : '';
    if (this._publicId && this._publicId !== next && byId.get(this._publicId) === this) {
      byId.delete(this._publicId);
    }
    this._publicId = next;
    if (next) byId.set(next, this);
  }

  /** Domain the next paint will use. A queued wheel has not redrawn the spec yet. */
  liveDomain() {
    const axis = this.model?.x;
    if (this._rangePaint && axis && axis.min != null && axis.max != null && axis.max > axis.min) {
      return { min: axis.min, max: axis.max };
    }
    return this._spec?.xDomain || null;
  }

  beginDrag(event) {
    const plot = this._spec?.plot;
    const domain = this.liveDomain();
    const point = this._pointer;
    const armed = this.model.zoom || this.model.brush?.target;
    if (!armed || !plot || !domain || !point) return false;
    if (point.x < plot.x || point.x > plot.x + plot.w || point.y < plot.y || point.y > plot.y + plot.h) return false;
    const pan = (event.shiftKey || this._tool === 'pan') && this.model.zoom && !this.model.brush?.target;
    if (pan) {
      this._drag = { mode: 'pan', x0: point.x, min: domain.min, max: domain.max };
      this.setCursor('grabbing');
    } else {
      this._drag = { mode: 'select', x0: point.x, x1: point.x };
    }
    this._pointerId = event.pointerId;
    try { this.stage.setPointerCapture(event.pointerId); } catch { /* The pointer still ends on pointerup. */ }
    return true;
  }

  releasePointer() {
    if (this._pointerId == null) return;
    try { this.stage?.releasePointerCapture(this._pointerId); } catch { /* The browser already released it. */ }
    this._pointerId = null;
  }

  setCursor(cursor) {
    if (cursor === this._cursor) return;
    this._cursor = cursor;
    if (this.stage) this.stage.style.cursor = cursor;
  }

  shiftRange(drag, x) {
    const plot = this._spec?.plot;
    if (!plot?.w) return;
    const span = drag.max - drag.min;
    const shift = -((x - drag.x0) / plot.w) * span;
    this.queueRange(drag.min + shift, drag.max + shift);
  }

  /**
   * Wheel zooms the x window around the pointer.
   * Scrolling down while already on the full series leaves the page free to scroll.
   */
  wheelZoom(event) {
    const plot = this._spec?.plot;
    const domain = this.liveDomain();
    if (!this.model.zoom || !plot?.w || !domain || this._drag) return false;
    const point = this.localPoint(event);
    if (point.x < plot.x || point.x > plot.x + plot.w || point.y < plot.y || point.y > plot.y + plot.h) return false;
    let delta = event.deltaY;
    if (event.deltaMode === 1) delta *= 16;
    else if (event.deltaMode === 2) delta *= 400;
    if (!delta) return false;
    const zoomIn = delta < 0;
    const windowed = this.model.x?.min != null || this.model.x?.max != null;
    if (!zoomIn && !windowed) return false;
    const stats = seriesXStats(this.model);
    const span0 = domain.max - domain.min;
    const minSpan = minWindow(this.model, stats, span0);
    if (zoomIn && span0 <= minSpan * 1.02) return true;
    const notches = Math.max(0.15, Math.min(6, Math.abs(delta) / 100));
    const factor = zoomIn ? 0.8 ** notches : 1.25 ** notches;
    let span = span0 * factor;
    if (span < minSpan) span = minSpan;
    const fraction = Math.min(1, Math.max(0, (point.x - plot.x) / plot.w));
    const anchor = domain.min + fraction * span0;
    const min = anchor - fraction * span;
    const max = min + span;
    if (!(max > min)) return false;
    this._pointer = point;
    this._inside = true;
    if (!zoomIn && stats && min <= stats.min && max >= stats.max) {
      this.resetRange();
      return true;
    }
    this.queueRange(min, max);
    return true;
  }

  pixelSpan(a, b) {
    const domain = this._spec?.xDomain;
    const plot = this._spec?.plot;
    if (!domain || !plot?.w) return null;
    const lo = Math.max(plot.x, Math.min(a, b));
    const hi = Math.min(plot.x + plot.w, Math.max(a, b));
    const min = domain.min + ((lo - plot.x) / plot.w) * (domain.max - domain.min);
    const max = domain.min + ((hi - plot.x) / plot.w) * (domain.max - domain.min);
    if (!(max > min)) return null;
    return { min, max };
  }

  applySpan(range) {
    if (this.model.brush?.target) {
      this._brushRange = range;
      Chart.lookup(this.model.brush.target)?.setRange(range.min, range.max);
      this.paintBrush();
      return;
    }
    if (this.model.zoom) this.setRange(range.min, range.max);
  }

  /** Zoom around the middle of the current x window. `factor` below 1 zooms in. */
  zoomBy(factor) {
    const domain = this._spec?.xDomain;
    if (!this.model.zoom || !domain || !(domain.max > domain.min) || !(factor > 0)) return;
    const stats = seriesXStats(this.model);
    const span0 = domain.max - domain.min;
    const minSpan = minWindow(this.model, stats, span0);
    const zoomIn = factor < 1;
    if (zoomIn && span0 <= minSpan * 1.02) return;
    const span = Math.max(minSpan, span0 * factor);
    const mid = (domain.min + domain.max) / 2;
    let min = mid - span / 2;
    let max = mid + span / 2;
    if (stats) {
      const full = stats.max - stats.min;
      if (span >= full - 1e-6) {
        this.resetRange();
        return;
      }
      if (min < stats.min) {
        max += stats.min - min;
        min = stats.min;
      }
      if (max > stats.max) {
        min -= max - stats.max;
        max = stats.max;
      }
    }
    if (max > min) this.setRange(min, max);
  }

  renderTools() {
    if (!this.model.zoom) {
      this.tools?.remove();
      this.tools = null;
      this._toolMode = '';
      return;
    }
    if (!this.tools) {
      this.tools = document.createElement('div');
      this.tools.className = 'csh-tools';
      this.tools.setAttribute('role', 'toolbar');
      this.tools.setAttribute('aria-label', 'Chart window');
      const buttons = [
        ['in', 'Zoom in', ICON_IN, false],
        ['out', 'Zoom out', ICON_OUT, false],
        ['select', 'Select a window', ICON_SELECT, true],
        ['pan', 'Pan', ICON_PAN, true],
        ['reset', 'Reset the window', ICON_RESET, false],
      ];
      for (const [tool, label, svg, toggle] of buttons) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.tool = tool;
        button.title = label;
        button.setAttribute('aria-label', label);
        if (toggle) button.setAttribute('aria-pressed', 'false');
        button.innerHTML = svg;
        button.addEventListener('pointerdown', (event) => {
          event.stopPropagation();
        });
        button.addEventListener('dblclick', (event) => event.stopPropagation());
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          this.onTool(tool);
        });
        this.tools.append(button);
      }
      this.stage.append(this.tools);
    }
    this.syncToolPressed();
  }

  syncToolPressed() {
    if (!this.tools) return;
    const mode = this._tool === 'pan' ? 'pan' : 'select';
    if (mode === this._toolMode) return;
    this._toolMode = mode;
    for (const button of this.tools.querySelectorAll('[data-tool="select"], [data-tool="pan"]')) {
      button.setAttribute('aria-pressed', String(button.dataset.tool === mode));
    }
  }

  onTool(tool) {
    if (tool === 'in') {
      this.zoomBy(0.7);
      return;
    }
    if (tool === 'out') {
      this.zoomBy(1 / 0.7);
      return;
    }
    if (tool === 'reset') {
      this.resetRange();
      return;
    }
    if (tool === 'select' || tool === 'pan') {
      this._tool = tool;
      this.syncToolPressed();
      this.setCursor(chartCursor(this));
    }
  }

  emitPoint(hit) {
    if (!hit || typeof this.model.onPoint !== 'function') return;
    const payload = {
      index: hit.index,
      label: hit.label,
      points: hit.rows.map((row) => ({
        name: row.name,
        value: row.value,
        color: row.color,
        seriesIndex: row.seriesIndex,
      })),
    };
    try {
      this.model.onPoint(payload);
    } catch {
      // A listener cannot stall the pointer.
    }
  }

  spanRect(range) {
    const domain = this._spec?.xDomain;
    const plot = this._spec?.plot;
    if (!domain || !plot?.w || range.min == null || range.max == null) return null;
    const span = domain.max - domain.min || 1;
    const x0 = plot.x + ((Math.min(range.min, range.max) - domain.min) / span) * plot.w;
    const x1 = plot.x + ((Math.max(range.min, range.max) - domain.min) / span) * plot.w;
    const rect = svgEl('rect');
    rect.setAttribute('data-brush', 'true');
    rect.setAttribute('x', String(Math.max(plot.x, x0)));
    rect.setAttribute('y', String(plot.y));
    rect.setAttribute('width', String(Math.max(1, Math.min(plot.x + plot.w, x1) - Math.max(plot.x, x0))));
    rect.setAttribute('height', String(plot.h));
    rect.setAttribute('rx', '4');
    rect.setAttribute('fill', this._theme?.fg || '#3d6bf5');
    rect.setAttribute('fill-opacity', '0.1');
    rect.setAttribute('stroke', this._theme?.fg || '#3d6bf5');
    rect.setAttribute('stroke-opacity', '0.45');
    rect.setAttribute('stroke-width', '1');
    rect.setAttribute('pointer-events', 'none');
    return rect;
  }

  paintSelection(a, b) {
    this._hoverKey = '';
    this.hover.replaceChildren();
    const range = this.pixelSpan(a, b);
    const rect = range && this.spanRect(range);
    if (rect) this.hover.append(rect);
    this.paintBrush();
  }

  paintBrush() {
    this.layer?.querySelector('[data-brush]')?.remove();
    const range = this._brushRange || (
      this.model.brush && this.model.brush.min != null && this.model.brush.max != null
        ? this.model.brush
        : null
    );
    const rect = range && this.spanRect(range);
    if (rect) this.layer.append(rect);
  }

  localPoint(event) {
    const rect = this.stage.getBoundingClientRect();
    const width = this._width || rect.width || 1;
    const height = this._height || rect.height || 1;
    return {
      x: ((event.clientX - rect.left) * width) / (rect.width || 1),
      y: ((event.clientY - rect.top) * height) / (rect.height || 1),
    };
  }

  applyHover() {
    if (!this.model.tooltip && !this.model.onPoint) return null;
    const hit = this._pointer && this._spec ? hitTest(this._spec.hover, this._pointer.x, this._pointer.y) : null;
    if (!hit) {
      this.clearHover();
      return null;
    }
    const key = `${hit.index}:${hit.seriesIndex ?? ''}:${hit.x}:${hit.y}:${hit.label ?? ''}`;
    if (key === this._hoverKey) {
      if (this.model.tooltip) this.placeTip();
      return hit;
    }
    this._hoverKey = key;
    if (this.model.tooltip) this.renderTooltip(hit);
    else this.tip.hidden = true;
    this.renderCrosshair(hit);
    this.fadeOtherSlices(hit);
    return hit;
  }

  clearHover() {
    this._hoverKey = '';
    this.restoreSliceFade();
    this.hover.replaceChildren();
    this.tip.hidden = true;
  }

  fadeOtherSlices(hit) {
    this.restoreSliceFade();
    if (!hit?.d || this._spec?.hover?.kind !== 'pie') return;
    const paths = new Set(this._spec.hover.entries.map((entry) => entry.d).filter(Boolean));
    this._faded = [];
    for (const el of this.layer.querySelectorAll('path')) {
      const d = el.getAttribute('d');
      if (!paths.has(d) || d === hit.d) continue;
      this._faded.push([el, el.getAttribute('fill-opacity')]);
      el.setAttribute('fill-opacity', '0.4');
    }
  }

  restoreSliceFade() {
    if (!this._faded) return;
    for (const [el, opacity] of this._faded) {
      if (opacity == null) el.removeAttribute('fill-opacity');
      else el.setAttribute('fill-opacity', opacity);
    }
    this._faded = null;
  }

  renderCrosshair(hit) {
    const theme = this._theme;
    const plot = this._spec.plot;
    const kind = this._spec.hover.kind;
    this.hover.replaceChildren();
    if (hit.d) {
      const edge = svgEl('path');
      edge.setAttribute('d', hit.d);
      edge.setAttribute('fill', 'none');
      edge.setAttribute('stroke', '#fff');
      edge.setAttribute('stroke-opacity', '0.72');
      edge.setAttribute('stroke-width', '1.5');
      edge.setAttribute('fill-rule', 'evenodd');
      edge.setAttribute('pointer-events', 'none');
      this.hover.append(edge);
    }
    if (kind === 'band' || kind === 'point') {
      const at = Math.min(plot.x + plot.w, Math.max(plot.x, hit.x));
      this.hover.append(hairline(at, plot.y, at, plot.y + plot.h, theme));
    } else if (kind === 'cell' && hit.x0 != null) {
      const mark = svgEl('rect');
      mark.setAttribute('x', hit.x0);
      mark.setAttribute('y', hit.y0);
      mark.setAttribute('width', Math.max(0, hit.x1 - hit.x0));
      mark.setAttribute('height', Math.max(0, hit.y1 - hit.y0));
      mark.setAttribute('fill', 'none');
      mark.setAttribute('stroke', theme.fg);
      mark.setAttribute('stroke-opacity', '0.45');
      mark.setAttribute('stroke-width', '1.5');
      this.hover.append(mark);
    } else if (kind === 'band-y') {
      this.hover.append(hairline(plot.x, hit.y, plot.x + plot.w, hit.y, theme));
    }
    const dots = hit.markers || hit.rows;
    for (const row of dots) {
      const x = row.x ?? hit.x;
      const y = row.y ?? hit.y;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < plot.x - 2 || x > plot.x + plot.w + 2 || y < plot.y - 2 || y > plot.y + plot.h + 2) continue;
      const radius = this.model.hoverSize != null ? this.model.hoverSize : Math.max(4, this.model.markerSize + 1.25);
      if (!(radius > 0)) continue;
      const halo = svgEl('circle');
      halo.setAttribute('cx', x);
      halo.setAttribute('cy', y);
      halo.setAttribute('r', radius + 6);
      halo.setAttribute('fill', row.color);
      halo.setAttribute('fill-opacity', '0.2');
      halo.setAttribute('stroke', 'none');
      const dot = svgEl('circle');
      dot.setAttribute('cx', x);
      dot.setAttribute('cy', y);
      dot.setAttribute('r', radius);
      dot.setAttribute('fill', row.color);
      dot.setAttribute('stroke', theme.ring);
      dot.setAttribute('stroke-width', '2');
      const spark = svgEl('circle');
      spark.setAttribute('cx', x - radius * 0.32);
      spark.setAttribute('cy', y - radius * 0.36);
      spark.setAttribute('r', Math.max(1.2, radius * 0.34));
      spark.setAttribute('fill', '#fff');
      spark.setAttribute('fill-opacity', '0.9');
      spark.setAttribute('stroke', 'none');
      this.hover.append(halo, dot, spark);
    }
  }

  renderTooltip(hit) {
    this.tip.replaceChildren();
    const title = document.createElement('div');
    title.className = 'csh-tip-title';
    title.textContent = hit.label ?? '';
    this.tip.append(title);
    const total = this._spec.hover.kind === 'pie'
      ? this._spec.hover.entries.reduce((sum, entry) => sum + (entry.value || 0), 0)
      : 0;
    const pie = this._spec.hover.kind === 'pie';
    for (const row of hit.rows) {
      const line = document.createElement('div');
      line.className = 'csh-tip-row';
      const swatch = document.createElement('span');
      swatch.className = 'csh-swatch';
      swatch.style.background = row.color;
      const value = document.createElement('span');
      value.className = 'csh-tip-val';
      const formatted = formatTip(this.model, row, hit);
      if (pie && total > 0 && Number.isFinite(row.value)) {
        value.textContent = `${formatted} · ${Math.round((row.value / total) * 100)}%`;
      } else {
        value.textContent = formatted;
      }
      if (!pie) {
        const name = document.createElement('span');
        name.className = 'csh-name';
        name.textContent = row.name;
        line.append(swatch, name, value);
      } else {
        value.style.marginLeft = '0';
        line.append(swatch, value);
      }
      this.tip.append(line);
    }
    this.tip.hidden = false;
    this._tipWidth = this.tip.offsetWidth;
    this._tipHeight = this.tip.offsetHeight;
    this.placeTip();
  }

  placeTip() {
    const anchorX = this._pointer?.x ?? 0;
    const anchorY = this._pointer?.y ?? 0;
    const pad = 8;
    const width = this._tipWidth || this.tip.offsetWidth;
    const height = this._tipHeight || this.tip.offsetHeight;
    let left = anchorX + 14;
    let top = anchorY - height / 2;
    if (left + width > this._width - pad) left = anchorX - width - 14;
    if (left < pad) left = pad;
    if (top < pad) top = pad;
    if (top + height > this._height - pad) top = Math.max(pad, this._height - height - pad);
    this.tip.style.left = `${left}px`;
    this.tip.style.top = `${top}px`;
  }
}

const statsCache = new WeakMap();

function seriesXStats(model) {
  const stamp = statsStamp(model);
  const hit = statsCache.get(model);
  if (hit && hit.stamp === stamp) return hit.stats;
  const stats = measureSeriesX(model);
  statsCache.set(model, { stamp, stats });
  return stats;
}

function statsStamp(model) {
  let stamp = `${model.pointMode}|${model.categories?.length || 0}`;
  for (const series of model.series || []) {
    stamp += `|${series.hidden ? 1 : 0},${series.points?.length || 0},${series.values?.length || 0}`;
  }
  return stamp;
}

function measureSeriesX(model) {
  let min = Infinity;
  let max = -Infinity;
  let gap = Infinity;
  for (const series of model.series || []) {
    if (series.hidden) continue;
    let prev = null;
    for (const point of series.points || []) {
      if (!point || !Number.isFinite(point.x)) continue;
      if (point.x < min) min = point.x;
      if (point.x > max) max = point.x;
      if (prev != null && point.x > prev && point.x - prev < gap) gap = point.x - prev;
      prev = point.x;
    }
  }
  if (!(max > min) && model.pointMode === 'index') {
    const count = Math.max(
      model.categories?.length || 0,
      ...(model.series || []).map((series) => Math.max(series.values?.length || 0, series.extras?.length || 0)),
    );
    if (count >= 2) return { min: -0.5, max: count - 0.5, gap: 1 };
  }
  if (!(max > min)) return null;
  if (!(gap > 0) || !Number.isFinite(gap)) gap = max - min;
  return { min, max, gap };
}

function minWindow(model, stats, span0) {
  if (!stats) return Math.max(span0 / 80, 1);
  if (model.pointMode === 'index') return 1.5;
  return Math.max(stats.gap / 4, 1);
}

function chartCursor(chart) {
  if (chart.model.brush) return 'crosshair';
  if (chart.model.zoom) return chart._tool === 'pan' ? 'grab' : 'crosshair';
  return chart.model.onPoint ? 'pointer' : '';
}

/*
 * Zoom, search, hand, and house marks are Lucide v0.542.0 (ISC).
 * Copyright Lucide Contributors. Permission to use, copy, modify, and/or
 * distribute these marks for any purpose with or without fee is granted,
 * provided this notice appears in all copies.
 */
const ICON_IN = toolIcon('<circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="11" x2="11" y1="8" y2="14"/><line x1="8" x2="14" y1="11" y2="11"/>');
const ICON_OUT = toolIcon('<circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="8" x2="14" y1="11" y2="11"/>');
const ICON_SELECT = toolIcon('<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>');
const ICON_PAN = toolIcon('<path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>');
const ICON_RESET = toolIcon('<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>');

function toolIcon(body) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export function hitTest(hover, x, y) {
  if (!hover || hover.kind === 'none') return null;
  if (hover.kind === 'cell') {
    return hover.entries.find((entry) => x >= entry.x0 && x < entry.x1 && y >= entry.y0 && y < entry.y1) || null;
  }
  if (hover.kind === 'pie') {
    for (const entry of hover.entries) {
      const dx = x - entry.cx;
      const dy = y - entry.cy;
      const radius = Math.hypot(dx, dy);
      if (radius < entry.r0 - 1 || radius > entry.r1 + 3) continue;
      let angle = Math.atan2(dx, -dy);
      if (angle < 0) angle += Math.PI * 2;
      const sweep = entry.end - entry.start;
      if (sweep >= Math.PI * 2 - 1e-3) return entry;
      const start = wrapAngle(entry.start);
      const end = wrapAngle(entry.end);
      const hit = end >= start
        ? angle >= start - 1e-4 && angle <= end + 1e-4
        : angle >= start - 1e-4 || angle <= end + 1e-4;
      if (hit) return entry;
    }
    return null;
  }
  const plot = hover.plot;
  if (x < plot.x || x > plot.x + plot.w || y < plot.y || y > plot.y + plot.h) return null;
  if (hover.kind === 'band') {
    return hover.entries.find((entry) => x >= entry.x0 && x < entry.x1) || hover.entries.at(-1) || null;
  }
  if (hover.kind === 'band-y') {
    return hover.entries.find((entry) => y >= entry.y0 && y < entry.y1) || hover.entries.at(-1) || null;
  }
  if (hover.kind === 'point') {
    if (hover.locate && hover.connected && hover.fast) return hitLocate(hover, x, plot);
    if (hover.cols) {
      return hover.connected && hover.fast
        ? hitSortedColumns(hover, x, plot)
        : hitLinearColumns(hover, x, y, plot);
    }
    return hover.connected && hover.fast
      ? hitSortedPoints(hover, x, plot)
      : hitLinearPoints(hover, x, y, plot);
  }
  return null;
}

/** First index in `[from, to)` whose x fails `before`. */
function boundByX(entries, from, to, target, before) {
  let lo = from;
  let hi = to;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (before(entries[mid].x, target)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Nearest sample on a line whose x pixels never go backwards.
 * An equal distance keeps the earlier sample, matching a forward scan.
 */
function hitSortedPoints(hover, x, plot) {
  const entries = hover.entries;
  const spans = hover.spans || [];
  let anyInside = false;
  const ranges = spans.map((span) => {
    const left = boundByX(entries, span.from, span.to, plot.x - 1, (value, target) => value < target);
    const right = boundByX(entries, span.from, span.to, plot.x + plot.w + 1, (value, target) => value <= target);
    if (right > left) anyInside = true;
    return { span, left, right };
  });
  let best = null;
  let bestDistance = Infinity;
  const consider = (entry) => {
    const distance = Math.abs(entry.x - x);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = entry;
    }
  };
  for (const range of ranges) {
    const from = anyInside ? range.left : range.span.from;
    const to = anyInside ? range.right : range.span.to;
    if (from >= to) continue;
    const at = boundByX(entries, from, to, x, (value, target) => value < target);
    if (at > from) consider(entries[at - 1]);
    if (at < to) consider(entries[at]);
  }
  const limit = plot.w + 2;
  if (!best || bestDistance > limit) return null;
  const group = [];
  for (const span of spans) {
    const left = boundByX(entries, span.from, span.to, best.x - 1.5, (value, target) => value < target);
    const right = boundByX(entries, span.from, span.to, best.x + 1.5, (value, target) => value <= target);
    for (let index = left; index < right; index += 1) group.push(entries[index]);
  }
  return {
    ...best,
    rows: group.flatMap((entry) => entry.rows),
    markers: group.flatMap((entry) => entry.rows.map((row) => ({ ...row, x: entry.x, y: row.y }))),
  };
}

function lowerBoundPoints(points, target, from = 0, to = points.length) {
  let lo = from;
  let hi = to;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].x < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperBoundPoints(points, target, from = 0, to = points.length) {
  let lo = from;
  let hi = to;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].x <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Nearest sample on sorted series. Pixel x follows data x, so the search stays on the samples. */
function hitLocate(hover, x, plot) {
  const locate = hover.locate;
  const span = locate.xMax - locate.xMin || 1;
  const width = plot.w || 1;
  const invert = (pixel) => locate.xMin + ((pixel - plot.x) / width) * span;
  const slope = width / span;
  let anyInside = false;
  const ranges = locate.spans.map((series) => {
    const left = lowerBoundPoints(series.points, invert(plot.x - 1));
    const right = upperBoundPoints(series.points, invert(plot.x + plot.w + 1));
    if (right > left) anyInside = true;
    return { series, left, right };
  });
  let best = null;
  const consider = (series, index) => {
    if (index < 0 || index >= series.points.length) return;
    const px = locate.xScale(series.points[index].x);
    const distance = Math.abs(px - x);
    if (!best || distance < best.distance) best = { series, index, distance, px };
  };
  for (const range of ranges) {
    const from = anyInside ? range.left : 0;
    const to = anyInside ? range.right : range.series.points.length;
    if (from >= to) continue;
    const at = lowerBoundPoints(range.series.points, invert(x), from, to);
    if (at > from) consider(range.series, at - 1);
    if (at < to) consider(range.series, at);
  }
  if (!best || best.distance > plot.w + 2) return null;
  const dataTol = slope > 0 ? (1.5 + 1e-6) / slope : span;
  const bestX = best.series.points[best.index].x;
  const group = [];
  for (const series of locate.spans) {
    const left = lowerBoundPoints(series.points, bestX - dataTol);
    const right = upperBoundPoints(series.points, bestX + dataTol);
    for (let index = left; index < right; index += 1) {
      const point = series.points[index];
      const px = locate.xScale(point.x);
      if (Math.abs(px - best.px) > 1.5) continue;
      group.push({
        series,
        index,
        px,
        py: (series.yScale || locate.yScale)(point.y),
        point,
      });
    }
  }
  const rows = [];
  const markers = [];
  for (const item of group) {
    const seriesIndex = item.series.seriesIndex;
    const row = {
      name: locate.names[seriesIndex],
      value: item.point.y,
      color: locate.colors[seriesIndex],
      y: item.py,
      seriesIndex,
    };
    rows.push(row);
    markers.push({ ...row, x: item.px, y: item.py });
  }
  const picked = best.series.points[best.index];
  return {
    index: best.series.origin + best.index,
    seriesIndex: best.series.seriesIndex,
    x: best.px,
    y: (best.series.yScale || locate.yScale)(picked.y),
    xValue: picked.x,
    label: locate.formatLabel(picked.x),
    rows,
    markers,
  };
}

function boundColumn(values, from, to, target, before) {
  let lo = from;
  let hi = to;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (before(values[mid], target)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function columnHit(cols, at, group) {
  const rows = [];
  const markers = [];
  for (let index = 0; index < group.length; index += 1) {
    const slot = group[index];
    const seriesIndex = cols.series[slot];
    const row = {
      name: cols.names[seriesIndex],
      value: cols.dataY[slot],
      color: cols.colors[seriesIndex],
      y: cols.y[slot],
      seriesIndex,
    };
    rows.push(row);
    markers.push({ ...row, x: cols.x[slot], y: row.y });
  }
  return {
    index: cols.index[at],
    seriesIndex: cols.series[at],
    x: cols.x[at],
    y: cols.y[at],
    xValue: cols.xValue[at],
    label: cols.formatLabel(cols.xValue[at]),
    rows,
    markers,
  };
}

/** Nearest sample when pixel x is stored in columns and never goes backwards. */
function hitSortedColumns(hover, x, plot) {
  const cols = hover.cols;
  const values = cols.x;
  const spans = hover.spans || [];
  let anyInside = false;
  const ranges = spans.map((span) => {
    const left = boundColumn(values, span.from, span.to, plot.x - 1, (value, target) => value < target);
    const right = boundColumn(values, span.from, span.to, plot.x + plot.w + 1, (value, target) => value <= target);
    if (right > left) anyInside = true;
    return { span, left, right };
  });
  let best = -1;
  let bestDistance = Infinity;
  const consider = (at) => {
    const distance = Math.abs(values[at] - x);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = at;
    }
  };
  for (const range of ranges) {
    const from = anyInside ? range.left : range.span.from;
    const to = anyInside ? range.right : range.span.to;
    if (from >= to) continue;
    const at = boundColumn(values, from, to, x, (value, target) => value < target);
    if (at > from) consider(at - 1);
    if (at < to) consider(at);
  }
  if (best < 0 || bestDistance > plot.w + 2) return null;
  const bestX = values[best];
  const group = [];
  for (const span of spans) {
    const left = boundColumn(values, span.from, span.to, bestX - 1.5, (value, target) => value < target);
    const right = boundColumn(values, span.from, span.to, bestX + 1.5, (value, target) => value <= target);
    for (let index = left; index < right; index += 1) group.push(index);
  }
  return columnHit(cols, best, group);
}

function hitLinearColumns(hover, x, y, plot) {
  const cols = hover.cols;
  const count = cols.x.length;
  const inside = [];
  if (hover.connected) {
    for (let index = 0; index < count; index += 1) {
      if (cols.x[index] >= plot.x - 1 && cols.x[index] <= plot.x + plot.w + 1) inside.push(index);
    }
  }
  const pool = hover.connected && inside.length ? inside : null;
  let best = -1;
  let bestDistance = Infinity;
  if (pool) {
    for (let index = 0; index < pool.length; index += 1) {
      const slot = pool[index];
      const distance = Math.abs(cols.x[slot] - x);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = slot;
      }
    }
  } else {
    for (let index = 0; index < count; index += 1) {
      const distance = hover.connected
        ? Math.abs(cols.x[index] - x)
        : Math.hypot(cols.x[index] - x, (cols.y[index] - y) * 0.35);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    }
  }
  const limit = hover.connected ? plot.w + 2 : 32;
  if (best < 0 || bestDistance > limit) return null;
  const bestX = cols.x[best];
  const group = [];
  for (let index = 0; index < count; index += 1) {
    if (Math.abs(cols.x[index] - bestX) <= 1.5) group.push(index);
  }
  return columnHit(cols, best, group);
}

function hitLinearPoints(hover, x, y, plot) {
  const inside = [];
  for (const entry of hover.entries) {
    if (entry.x >= plot.x - 1 && entry.x <= plot.x + plot.w + 1) inside.push(entry);
  }
  const pool = hover.connected && inside.length ? inside : hover.entries;
  let best = null;
  let bestDistance = Infinity;
  for (const entry of pool) {
    const distance = hover.connected
      ? Math.abs(entry.x - x)
      : Math.hypot(entry.x - x, (entry.y - y) * 0.35);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = entry;
    }
  }
  const limit = hover.connected ? plot.w + 2 : 32;
  if (!best || bestDistance > limit) return null;
  const group = hover.entries.filter((entry) => Math.abs(entry.x - best.x) <= 1.5);
  return {
    ...best,
    rows: group.flatMap((entry) => entry.rows),
    markers: group.flatMap((entry) => entry.rows.map((row) => ({ ...row, x: entry.x, y: row.y }))),
  };
}

function resolveFill(fill, instanceId) {
  if (typeof fill !== 'string') return fill || 'none';
  return fill
    .replace(/__grad_(\d+)/g, `${instanceId}-s$1`)
    .replace(/__sheen_([a-z]+)/g, `${instanceId}-sheen-$1`);
}

function nodeKind(node) {
  if (node.type === 'line' || node.type === 'path' || node.type === 'circle') return node.type;
  return 'text';
}

function makeNode(node, clipId, instanceId) {
  const el = createNode(node, clipId, instanceId);
  el.dataset.kind = nodeKind(node);
  return el;
}

function createNode(node, clipId, instanceId) {
  if (node.type === 'line') {
    const line = svgEl('line');
    line.setAttribute('x1', node.x1);
    line.setAttribute('y1', node.y1);
    line.setAttribute('x2', node.x2);
    line.setAttribute('y2', node.y2);
    line.setAttribute('stroke', node.stroke);
    line.setAttribute('stroke-width', node.sw || 1);
    if (node.dash) line.setAttribute('stroke-dasharray', node.dash);
    if (node.clip) line.setAttribute('clip-path', `url(#${clipId})`);
    line.setAttribute('shape-rendering', 'crispEdges');
    return line;
  }
  if (node.type === 'path') {
    const path = svgEl('path');
    path.setAttribute('d', node.d || '');
    const fill = resolveFill(node.fill, instanceId);
    path.setAttribute('fill', fill);
    if (node.fillOpacity != null && node.fillOpacity !== 1) path.setAttribute('fill-opacity', String(node.fillOpacity));
    path.setAttribute('stroke', node.stroke || 'none');
    if (node.strokeOpacity != null && node.strokeOpacity !== 1) path.setAttribute('stroke-opacity', String(node.strokeOpacity));
    if (node.sw) path.setAttribute('stroke-width', node.sw);
    if (node.cap) path.setAttribute('stroke-linecap', node.cap);
    if (node.join) path.setAttribute('stroke-linejoin', node.join);
    if (node.dash) path.setAttribute('stroke-dasharray', node.dash);
    if (node.fillRule) path.setAttribute('fill-rule', node.fillRule);
    if (node.clip) path.setAttribute('clip-path', `url(#${clipId})`);
    return path;
  }
  if (node.type === 'circle') {
    const circle = svgEl('circle');
    circle.setAttribute('cx', node.cx);
    circle.setAttribute('cy', node.cy);
    circle.setAttribute('r', node.r);
    circle.setAttribute('fill', node.fill || 'none');
    if (node.fillOpacity != null && node.fillOpacity !== 1) circle.setAttribute('fill-opacity', String(node.fillOpacity));
    circle.setAttribute('stroke', node.stroke || 'none');
    if (node.sw) circle.setAttribute('stroke-width', node.sw);
    return circle;
  }
  const text = svgEl('text');
  text.textContent = node.text ?? '';
  text.setAttribute('x', node.x);
  text.setAttribute('y', node.y);
  text.setAttribute('text-anchor', node.anchor || 'start');
  text.setAttribute('dominant-baseline', node.baseline || 'auto');
  text.setAttribute('fill', node.fill || 'currentColor');
  text.setAttribute('font-size', node.size || 12);
  text.setAttribute('font-family', 'inherit');
  text.setAttribute('font-weight', node.weight || 400);
  text.style.fontVariantNumeric = 'tabular-nums';
  if (node.rotate) text.setAttribute('transform', `rotate(${node.rotate} ${node.x} ${node.y})`);
  return text;
}

/** Write one frame's geometry into an element created for the same kind of mark. */
function patchNode(el, node, clipId, instanceId) {
  if (node.type === 'line') {
    const key = `${node.x1}\0${node.y1}\0${node.x2}\0${node.y2}\0${node.stroke}\0${node.sw || 1}\0${node.dash || ''}\0${node.clip ? clipId : ''}`;
    if (el._style === key) return;
    el._style = key;
    el.setAttribute('x1', node.x1);
    el.setAttribute('y1', node.y1);
    el.setAttribute('x2', node.x2);
    el.setAttribute('y2', node.y2);
    el.setAttribute('stroke', node.stroke);
    el.setAttribute('stroke-width', node.sw || 1);
    setOptional(el, 'stroke-dasharray', node.dash);
    setOptional(el, 'clip-path', node.clip ? `url(#${clipId})` : '');
    return;
  }
  if (node.type === 'path') {
    const fill = resolveFill(node.fill, instanceId);
    const opacity = node.fillOpacity != null && node.fillOpacity !== 1 ? String(node.fillOpacity) : '';
    const strokeOpacity = node.strokeOpacity != null && node.strokeOpacity !== 1 ? String(node.strokeOpacity) : '';
    const key = `${fill}\0${opacity}\0${strokeOpacity}\0${node.stroke || 'none'}\0${node.sw || ''}\0${node.cap || ''}\0${node.join || ''}\0${node.dash || ''}\0${node.fillRule || ''}\0${node.clip ? clipId : ''}`;
    const d = node.d || '';
    if (el._style === key) {
      if (el._d !== d) {
        el._d = d;
        el.setAttribute('d', d);
      }
      return;
    }
    el._style = key;
    el._d = d;
    el.setAttribute('d', d);
    el.setAttribute('fill', fill);
    if (opacity) el.setAttribute('fill-opacity', opacity);
    else el.removeAttribute('fill-opacity');
    el.setAttribute('stroke', node.stroke || 'none');
    setOptional(el, 'stroke-opacity', strokeOpacity);
    setOptional(el, 'stroke-width', node.sw);
    setOptional(el, 'stroke-linecap', node.cap);
    setOptional(el, 'stroke-linejoin', node.join);
    setOptional(el, 'stroke-dasharray', node.dash);
    setOptional(el, 'fill-rule', node.fillRule);
    setOptional(el, 'clip-path', node.clip ? `url(#${clipId})` : '');
    return;
  }
  if (node.type === 'circle') {
    el.setAttribute('cx', node.cx);
    el.setAttribute('cy', node.cy);
    el.setAttribute('r', node.r);
    el.setAttribute('fill', node.fill || 'none');
    setOptional(el, 'fill-opacity', node.fillOpacity != null && node.fillOpacity !== 1 ? String(node.fillOpacity) : '');
    el.setAttribute('stroke', node.stroke || 'none');
    setOptional(el, 'stroke-width', node.sw);
    return;
  }
  const text = node.text ?? '';
  const anchor = node.anchor || 'start';
  const baseline = node.baseline || 'auto';
  const fill = node.fill || 'currentColor';
  const size = node.size || 12;
  const weight = node.weight || 400;
  const rotate = node.rotate ? `${node.rotate} ${node.x} ${node.y}` : '';
  const key = `${text}\0${node.x}\0${node.y}\0${anchor}\0${baseline}\0${fill}\0${size}\0${weight}\0${rotate}`;
  if (el._style === key) return;
  el._style = key;
  if (el.textContent !== text) el.textContent = text;
  el.setAttribute('x', node.x);
  el.setAttribute('y', node.y);
  el.setAttribute('text-anchor', anchor);
  el.setAttribute('dominant-baseline', baseline);
  el.setAttribute('fill', fill);
  el.setAttribute('font-size', size);
  el.setAttribute('font-weight', weight);
  if (rotate) el.setAttribute('transform', `rotate(${rotate})`);
  else el.removeAttribute('transform');
}

function setOptional(el, name, value) {
  if (value) el.setAttribute(name, value);
  else el.removeAttribute(name);
}

function svgEl(name) {
  return document.createElementNS(NS, name);
}

/** A solid 1px guide. Dashes would sit on top of the grid and flicker while panning. */
function hairline(x1, y1, x2, y2, theme) {
  const line = svgEl('line');
  line.setAttribute('x1', x1);
  line.setAttribute('y1', y1);
  line.setAttribute('x2', x2);
  line.setAttribute('y2', y2);
  line.setAttribute('stroke', theme.fg);
  line.setAttribute('stroke-opacity', '0.4');
  line.setAttribute('stroke-width', '1');
  line.setAttribute('pointer-events', 'none');
  return line;
}

/** Which responsive rules match. The same key means the parsed chart can be reused. */
function responsiveKey(rules, width) {
  if (!(width > 0)) return 'pending';
  let key = '';
  for (let index = 0; index < rules.length; index += 1) {
    const max = Number(rules[index]?.maxWidth);
    if (Number.isFinite(max) && width <= max) key += `${index}|`;
  }
  return key || 'none';
}

/** Drop a chart whose element left the document, so a theme listener cannot keep it alive. */
function watchHost(chart) {
  if (chart.el?.isConnected) chart._mounted = true;
  watched.add(chart);
  if (domObserver || typeof document === 'undefined') return;
  domObserver = new MutationObserver(() => {
    for (const item of watched) {
      if (item.el?.isConnected) {
        item._mounted = true;
        continue;
      }
      if (item._mounted) item.destroy();
    }
  });
  domObserver.observe(document.documentElement, { childList: true, subtree: true });
}

function unwatchHost(chart) {
  watched.delete(chart);
  if (watched.size || !domObserver) return;
  domObserver.disconnect();
  domObserver = null;
}

function resolveTarget(target) {
  if (typeof document === 'undefined') fail('charts render in the browser');
  if (typeof target === 'string') {
    const found = document.querySelector(target);
    if (!found) fail(`no element matches ${target}`);
    return found;
  }
  if (target && target.nodeType === 1) return target;
  fail('target must be an element or a CSS selector');
}

function cloneConfig(config) {
  if (!config || typeof config !== 'object') return {};
  const next = { ...config };
  for (const key of ['x', 'y', 'legend', 'grid']) {
    if (config[key] && typeof config[key] === 'object' && !Array.isArray(config[key])) {
      next[key] = { ...config[key] };
    }
  }
  return next;
}

function carryHidden(previous, next) {
  if (!previous) return;
  for (const series of next.series) {
    if (series.hiddenSet) continue;
    const old = previous.series.find((item) => item.name === series.name);
    if (old) series.hidden = old.hidden;
  }
}

function cloneModel(model) {
  return {
    ...model,
    series: model.series.map((series) => ({
      ...series,
      values: series.values ? series.values.slice() : null,
      extras: series.extras ? series.extras.map((extra) => (extra ? extra.slice() : null)) : null,
      points: series.points ? series.points.map((point) => (point ? { ...point, extra: point.extra ? point.extra.slice() : undefined } : null)) : null,
    })),
    categories: model.categories ? model.categories.slice() : null,
  };
}

function zeroLike(model) {
  const zero = cloneModel(model);
  for (const series of zero.series) {
    if (series.values) series.values = series.values.map((value) => (value == null ? null : 0));
    if (series.extras) series.extras = series.extras.map((extra) => (extra ? extra.map((value) => (value == null ? null : 0)) : null));
    if (series.points) {
      series.points = series.points.map((point) => (
        point ? { x: point.x, y: 0, extra: point.extra ? point.extra.map(() => 0) : undefined } : null
      ));
    }
  }
  return zero;
}

function sameShape(a, b) {
  if (a.type !== b.type || a.pointMode !== b.pointMode || !!a.stacked !== !!b.stacked || !!a.horizontal !== !!b.horizontal) {
    return false;
  }
  if (a.series.length !== b.series.length) return false;
  if ((a.categories?.length || 0) !== (b.categories?.length || 0)) return false;
  return a.series.every((series, index) => (
    (series.values?.length || 0) === (b.series[index].values?.length || 0)
    && (series.points?.length || 0) === (b.series[index].points?.length || 0)
  ));
}

function lerpModel(from, to, t) {
  const shown = cloneModel(to);
  shown.series.forEach((series, index) => {
    const previous = from.series[index];
    if (series.values) {
      series.values = series.values.map((value, valueIndex) => lerpNumber(previous?.values?.[valueIndex], value, t));
    }
    if (series.extras) {
      series.extras = series.extras.map((extra, extraIndex) => {
        if (!extra) return null;
        const before = previous?.extras?.[extraIndex];
        return extra.map((value, valueIndex) => lerpNumber(before?.[valueIndex], value, t));
      });
    }
    if (series.points) {
      series.points = series.points.map((point, pointIndex) => {
        if (!point) return null;
        const before = previous?.points?.[pointIndex];
        return {
          x: point.x,
          y: lerpNumber(before ? before.y : point.y, point.y, t),
          extra: point.extra ? point.extra.map((value, valueIndex) => lerpNumber(before?.extra?.[valueIndex], value, t)) : undefined,
        };
      });
    }
  });
  return shown;
}

function lerpNumber(from, to, t) {
  if (to == null || !Number.isFinite(to)) return null;
  if (from == null || !Number.isFinite(from)) return to;
  return from + (to - from) * t;
}

export function formatTip(model, row, hit) {
  if (typeof model.tooltipFormat === 'function') {
    try {
      const text = model.tooltipFormat(row.value, {
        series: model.series.map((series) => series.values),
        seriesIndex: row.seriesIndex ?? 0,
        dataPointIndex: hit?.index ?? 0,
      });
      if (text != null) return String(text);
    } catch {
      // A formatter that throws falls back to the plain number.
    }
  }
  let value = row.value;
  if (model.stackType === '100%' && value != null && hit?.index != null) {
    let total = 0;
    for (const series of model.series) {
      if (series.hidden) continue;
      const part = series.values?.[hit.index];
      if (part != null && Number.isFinite(part)) total += Math.abs(part);
    }
    if (total) value = (value / total) * 100;
  }
  if (value == null || !Number.isFinite(value)) return '–';
  const axis = axisFor(model, row.seriesIndex ?? 0);
  if (axis?.format) {
    try {
      return String(axis.format(value));
    } catch {
      return formatNumber(value);
    }
  }
  return formatNumber(value);
}

/** `null` clears a bound. `undefined` means the number cannot be used. */
function rangeBound(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'boolean') return undefined;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function axisFor(model, seriesIndex) {
  const index = model.series?.[seriesIndex]?.yIndex || 0;
  return model.yAxes?.[index] || model.y;
}

function wrapAngle(angle) {
  const full = Math.PI * 2;
  let value = angle % full;
  if (value < 0) value += full;
  return value;
}

function applyTheme(host, theme) {
  host.dataset.theme = theme.name;
  host.style.setProperty('--csh-fg', theme.fg);
  host.style.setProperty('--csh-muted', theme.muted);
  host.style.setProperty('--csh-tip-bg', theme.tipBg);
  host.style.setProperty('--csh-tip-fg', theme.tipFg);
}

function retainSheet() {
  sheetUsers += 1;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.append(style);
}

function releaseSheet() {
  sheetUsers = Math.max(0, sheetUsers - 1);
  if (sheetUsers === 0) document.getElementById(STYLE_ID)?.remove();
}
