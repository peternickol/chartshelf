import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chromeCandidates = [
  process.env.CHROME_PATH,
  '/root/.cache/ms-playwright/chromium-1148/chrome-linux/chrome',
  '/root/.hermes/tools/chromium-1208/chrome-linux64/chrome',
].filter(Boolean);

async function loadChromium() {
  const chrome = chromeCandidates.find((candidate) => fs.existsSync(candidate));
  if (!chrome) return null;
  const modules = [
    'playwright',
    'playwright-core',
    '/root/.bun/install/cache/playwright-core@1.63.0@@@1/index.mjs',
  ];
  for (const specifier of modules) {
    try {
      const imported = await import(specifier);
      if (imported.chromium) return { chromium: imported.chromium, chrome };
    } catch {
      // Try the next install of Playwright.
    }
  }
  return null;
}

async function serve(directory) {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/favicon.ico') {
      response.writeHead(204);
      response.end();
      return;
    }
    const decoded = decodeURIComponent(url.pathname);
    const file = path.resolve(directory, `.${decoded}`);
    if (file !== directory && !file.startsWith(directory + path.sep)) {
      response.writeHead(403);
      response.end();
      return;
    }
    const target = fs.existsSync(file) && fs.statSync(file).isDirectory()
      ? path.join(file, 'index.html')
      : file;
    fs.readFile(target, (error, data) => {
      if (error) {
        response.writeHead(404);
        response.end('not found');
        return;
      }
      const types = {
        '.js': 'text/javascript',
        '.html': 'text/html',
        '.css': 'text/css',
        '.png': 'image/png',
        '.svg': 'image/svg+xml',
      };
      const type = types[path.extname(target)] || 'application/octet-stream';
      response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      response.end(data);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return { server, url: `http://127.0.0.1:${address.port}` };
}

test('demo renders, updates, and answers the pointer', { timeout: 60000 }, async (t) => {
  const loaded = await loadChromium();
  if (!loaded) {
    t.skip('Chromium is not installed');
    return;
  }
  const { chromium, chrome } = loaded;
  const { server, url } = await serve(root);
  const browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(`${url}/demo/index.html`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#users svg path');
    await page.waitForTimeout(500);

    const summary = await page.evaluate(() => {
      const ids = ['users', 'revenue', 'latency', 'paths', 'share', 'trials'];
      return ids.map((id) => {
        const host = document.getElementById(id);
        return {
          label: host.querySelector('svg')?.getAttribute('aria-label') || '',
          paths: host.querySelectorAll('svg path').length,
          circles: host.querySelectorAll('svg circle').length,
          texts: [...host.querySelectorAll('svg text')].map((node) => node.textContent),
        };
      });
    });
    assert.equal(summary.length, 6);
    for (const chart of summary) {
      assert.ok(chart.paths + chart.circles > 0, chart.label);
      assert.ok(chart.label.length > 0);
    }
    assert.equal(summary.some((chart) => chart.texts.includes('<b>')), false);

    const before = await page.locator('#users svg path').first().getAttribute('d');
    const stage = await page.locator('#users .csh-stage').boundingBox();
    await page.mouse.move(stage.x + stage.width * 0.55, stage.y + stage.height * 0.45);
    await page.waitForTimeout(50);
    const tip = page.locator('#users .csh-tip');
    assert.equal(await tip.isVisible(), true);
    const tipText = await tip.innerText();
    assert.match(tipText, /New|Returning/);
    assert.match(tipText, /\d/);

    const legend = page.locator('#users .csh-legend button').first();
    const pathsBefore = await page.locator('#users svg path').count();
    await legend.click();
    await page.waitForTimeout(80);
    assert.equal(await legend.getAttribute('aria-pressed'), 'false');
    const pathsAfter = await page.locator('#users svg path').count();
    assert.ok(pathsAfter < pathsBefore);
    await legend.click();
    await page.waitForTimeout(400);

    await page.locator('#scramble').click();
    await page.waitForTimeout(120);
    const during = await page.locator('#users svg path').first().getAttribute('d');
    assert.notEqual(during, before);

    await page.waitForSelector('#shelf-line svg path');
    await page.waitForSelector('#shelf-donut svg path');
    await page.waitForSelector('#shelf-combo svg path');
    const lineBefore = await page.locator('#shelf-line svg path').first().getAttribute('d');
    const shelfInfo = await page.evaluate(() => ({
      line: document.querySelectorAll('#shelf-line svg path').length,
      donut: document.querySelectorAll('#shelf-donut svg path').length,
      combo: document.querySelectorAll('#shelf-combo svg path').length,
      registered: window.ChartShelf?.Line?.type === 'line' && window.ChartShelf?.Donut?.type === 'donut',
      title: document.querySelector('#shelf-line .csh-title')?.textContent || '',
    }));
    assert.ok(shelfInfo.line >= 1);
    assert.ok(shelfInfo.donut >= 3);
    assert.ok(shelfInfo.combo >= 2);
    assert.equal(shelfInfo.registered, true);
    assert.match(shelfInfo.title, /Monthly revenue/);
    await page.locator('#shelf-line').scrollIntoViewIfNeeded();
    const lineStage = await page.locator('#shelf-line .csh-stage').boundingBox();
    await page.mouse.move(lineStage.x + lineStage.width * 0.45, lineStage.y + lineStage.height * 0.55);
    await page.waitForTimeout(80);
    const lineTip = await page.locator('#shelf-line .csh-tip').innerText();
    assert.match(lineTip, /Revenue/);
    assert.match(lineTip, /\$|\d/);
    await page.locator('#shelf-update').click();
    await page.waitForTimeout(80);
    const lineDuring = await page.locator('#shelf-line svg path').first().getAttribute('d');
    assert.notEqual(lineDuring, lineBefore);

    await page.locator('#paths .csh-stage').click({ position: { x: 180, y: 140 } });
    await page.waitForTimeout(50);
    const picked = await page.locator('#picked').innerText();
    assert.notEqual(picked, 'Click a bar.');
    assert.match(picked, /views/);

    await page.screenshot({ path: '/tmp/chartshelf-desktop.png', fullPage: true });
    await page.locator('#theme').click();
    await page.waitForTimeout(400);
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    assert.equal(await page.locator('#users').getAttribute('data-theme'), 'dark');
    assert.equal(await page.locator('#shelf-line').getAttribute('data-theme'), 'dark');
    assert.equal(await page.locator('#shelf-donut').getAttribute('data-theme'), 'dark');
    await page.screenshot({ path: '/tmp/chartshelf-dark.png', fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow < 2, `page overflowed by ${overflow}px`);
    await page.screenshot({ path: '/tmp/chartshelf-mobile.png', fullPage: true });
    assert.deepEqual(errors, []);

    const rangePage = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    const rangeErrors = [];
    rangePage.on('pageerror', (error) => rangeErrors.push(String(error)));
    rangePage.on('console', (message) => {
      if (message.type() === 'error') rangeErrors.push(message.text());
    });
    await rangePage.goto(`${url}/test/fixtures/range.html`, { waitUntil: 'networkidle' });
    await rangePage.waitForSelector('#main svg.csh-svg path');
    await rangePage.waitForSelector('#sensor svg path[stroke-dasharray]');
    await rangePage.waitForSelector('#brush [data-brush]');
    await rangePage.waitForSelector('#gauge svg text');
    const gaugeText = await rangePage.locator('#gauge svg text').allTextContents();
    assert.ok(gaugeText.includes('12'));
    assert.ok(gaugeText.includes('Queued payloads'));

    const domainOf = () => rangePage.evaluate(() => {
      const chart = window.ChartShelf.lookup('trend');
      return { min: chart?.config?.x?.min ?? null, max: chart?.config?.x?.max ?? null };
    });
    assert.deepEqual(await domainOf(), { min: null, max: null });
    const main = await rangePage.locator('#main .csh-stage').boundingBox();
    await rangePage.mouse.move(main.x + main.width * 0.35, main.y + main.height * 0.5);
    await rangePage.mouse.down();
    await rangePage.mouse.move(main.x + main.width * 0.7, main.y + main.height * 0.45, { steps: 8 });
    await rangePage.mouse.up();
    await rangePage.waitForTimeout(50);
    const windowed = await domainOf();
    assert.equal(typeof windowed.min, 'number');
    assert.ok(windowed.max > windowed.min);
    assert.ok(windowed.max - windowed.min < 24 * 60 * 60 * 1000);
    await rangePage.mouse.move(main.x + main.width * 0.5, main.y + main.height * 0.45);
    await rangePage.mouse.wheel(0, -200);
    await rangePage.waitForTimeout(50);
    const wheeled = await domainOf();
    assert.ok(wheeled.max - wheeled.min < windowed.max - windowed.min);
    const rangeTip = await rangePage.locator('#main .csh-tip').innerText();
    assert.match(rangeTip, /Load/);
    await rangePage.locator('#main .csh-stage').dblclick({ position: { x: main.width * 0.5, y: main.height * 0.5 } });
    await rangePage.waitForTimeout(50);
    assert.deepEqual(await domainOf(), { min: null, max: null });
    const toolButtons = rangePage.locator('#main .csh-tools button');
    assert.equal(await toolButtons.count(), 5);
    assert.equal(await rangePage.locator('#main .csh-tools [data-tool="select"]').getAttribute('aria-pressed'), 'true');
    await rangePage.locator('#main .csh-tools [data-tool="in"]').click();
    await rangePage.waitForTimeout(50);
    const zoomedIn = await domainOf();
    assert.equal(typeof zoomedIn.min, 'number');
    assert.ok(zoomedIn.max > zoomedIn.min);
    assert.ok(zoomedIn.max - zoomedIn.min < 24 * 60 * 60 * 1000);
    await rangePage.locator('#main .csh-tools [data-tool="pan"]').click();
    assert.equal(await rangePage.locator('#main .csh-tools [data-tool="pan"]').getAttribute('aria-pressed'), 'true');
    await rangePage.mouse.move(main.x + main.width * 0.55, main.y + main.height * 0.5);
    await rangePage.mouse.down();
    await rangePage.mouse.move(main.x + main.width * 0.3, main.y + main.height * 0.5, { steps: 6 });
    await rangePage.mouse.up();
    await rangePage.waitForTimeout(50);
    const panned = await domainOf();
    assert.ok(panned.min > zoomedIn.min);
    await rangePage.locator('#main .csh-tools [data-tool="reset"]').click();
    await rangePage.waitForTimeout(50);
    assert.deepEqual(await domainOf(), { min: null, max: null });
    assert.equal(await rangePage.locator('#brush .csh-tools').count(), 0);

    const brush = await rangePage.locator('#brush .csh-stage').boundingBox();
    await rangePage.mouse.move(brush.x + brush.width * 0.15, brush.y + brush.height * 0.5);
    await rangePage.mouse.down();
    await rangePage.mouse.move(brush.x + brush.width * 0.45, brush.y + brush.height * 0.5, { steps: 6 });
    await rangePage.mouse.up();
    await rangePage.waitForTimeout(50);
    const brushed = await domainOf();
    assert.equal(typeof brushed.min, 'number');
    assert.ok(brushed.max > brushed.min);
    const resilient = await rangePage.evaluate(() => {
      const chart = window.ChartShelf.lookup('trend');
      const kept = { min: chart.config.x.min, max: chart.config.x.max };
      chart.setRange(Number.NaN, 10);
      chart.setRange(Infinity, 10);
      const ignored = chart.config.x.min === kept.min && chart.config.x.max === kept.max;
      chart.setRange(kept.min + 1000, kept.max + 1000);
      chart.setRange(kept.max + 1000, kept.min + 1000);
      chart.update({ x: { title: chart.config.x.title || '' } }, false);
      const merged = chart.config.x.min === kept.min + 1000
        && chart.config.x.max === kept.max + 1000
        && chart.model.x.min === kept.min + 1000
        && chart.model.x.max === kept.max + 1000;
      let rejected = false;
      try {
        chart.update({ type: 'sankey' });
      } catch {
        rejected = true;
      }
      const stayed = rejected && chart.model.type === 'line' && chart.config.type === 'line';
      let threw = false;
      chart.model.onPoint = () => { throw new Error('listener failed'); };
      try {
        chart.emitPoint({
          index: 0,
          label: 'now',
          rows: [{ name: 'Load', value: 1, color: '#000', seriesIndex: 0 }],
        });
      } catch {
        threw = true;
      }
      chart.resetRange();
      return {
        ignored,
        merged,
        stayed,
        threw,
        cleared: chart.config.x.min == null && chart.config.x.max == null && chart.model.x.min == null,
      };
    });
    assert.deepEqual(resilient, { ignored: true, merged: true, stayed: true, threw: false, cleared: true });
    const reused = await rangePage.evaluate(() => {
      const chart = window.ChartShelf.lookup('trend');
      const start = Date.UTC(2026, 9, 7, 0, 0, 0);
      const hour = 3600000;
      chart.update({ markers: false, y: { min: 0, max: 30 } }, false);
      chart.setRange(start + 2 * hour, start + 10 * hour);
      const layer = document.querySelector('#main svg.csh-svg g');
      const path = layer.querySelector('path');
      const grid = layer.querySelector('line[stroke-dasharray]');
      const before = path.getAttribute('d');
      const beforeKinds = [...layer.children].map((el) => el.dataset.kind || el.tagName).join(',');
      chart.setRange(start + 4 * hour, start + 12 * hour);
      const afterKinds = [...layer.children].map((el) => el.dataset.kind || el.tagName).join(',');
      return {
        samePath: path.isConnected,
        moved: path.getAttribute('d') !== before && (path.getAttribute('d') || '').length > 10,
        dash: grid.isConnected ? grid.getAttribute('stroke-dasharray') : '',
        dashed: layer.querySelectorAll('line[stroke-dasharray]').length,
        kindsMatch: beforeKinds === afterKinds,
        beforeKinds,
        afterKinds,
      };
    });
    assert.equal(reused.kindsMatch, true, `${reused.beforeKinds} -> ${reused.afterKinds}`);
    assert.equal(reused.samePath, true);
    assert.equal(reused.moved, true);
    assert.equal(reused.dash, '3');
    assert.ok(reused.dashed > 0);
    const removed = await rangePage.evaluate(async () => {
      const host = document.querySelector('#gauge');
      host.remove();
      await new Promise((resolve) => setTimeout(resolve, 0));
      return host.classList.contains('csh-host') || host.childElementCount > 0;
    });
    assert.equal(removed, false);
    const stable = await rangePage.evaluate(() => {
      const chart = window.ChartShelf.lookup('trend');
      chart.update({
        responsive: [{ maxWidth: 240, height: 160 }],
      }, false);
      const model = chart.model;
      const start = Date.UTC(2026, 9, 7, 4, 0, 0);
      const hour = 3600000;
      chart.setRange(start, start + 8 * hour);
      chart.setRange(start + hour, start + 9 * hour);
      return {
        same: model === chart.model,
        min: chart.config.x.min,
        height: chart.model.height,
      };
    });
    assert.equal(stable.same, true);
    assert.equal(stable.min, Date.UTC(2026, 9, 7, 5, 0, 0));
    assert.equal(stable.height, 280);
    assert.deepEqual(rangeErrors, []);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
