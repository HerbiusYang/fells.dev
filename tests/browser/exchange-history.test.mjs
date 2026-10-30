import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createBrowserFixture } from '../helpers/browser.mjs';
import { createAppBackend } from '../helpers/app-backend.mjs';

const fixture = createBrowserFixture();
before(() => fixture.start());
after(() => fixture.stop());
const historyPath = /\/api\/app\/exchange-rates(?:\?.*)?$/;
const sourceURL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml';
const preferences = { theme: 'light', prefs: { agent: '', send: 0 }, notifs: [true, true, true, false], onboarded: true, answers: [[0], [0], [0], [0]], promoClosed: true, sbHidden: false };
const key = { id: 17, name: 'History fixture key', prefix: 'sk-history…', kind: 'user', expires_at: 0, revoked: false, created_at: 1700000000 };
const workspace = { id: 'history-workspace', name: 'History workspace', region: 'auto', tz: 'UTC', created: 1700000000000, role: 'owner' };
const history = (days = 30, patch = {}) => ({
  source: 'ECB', source_url: sourceURL, days, as_of: '2026-10-23', fetched_at: '2026-10-24T00:00:00Z', fresh_until: '2026-10-25T00:00:00Z', stale: false, fee_bps: 10,
  points: [
    { date: '2026-10-21', reference_rate: '7.10000000', exchange_rate: '7.10710000' },
    { date: '2026-10-22', reference_rate: '7.20000000', exchange_rate: '7.20720000' },
    { date: '2026-10-23', reference_rate: days === 7 ? '7.40000000' : days === 90 ? '7.60000000' : '7.30000000', exchange_rate: days === 7 ? '7.40740000' : days === 90 ? '7.60760000' : '7.30730000' },
  ], ...patch,
});

async function expand(page) {
  const button = page.locator('[data-act=history-toggle]'); await button.waitFor();
  assert.equal(await button.getAttribute('aria-controls'), 'wallet-exchange-history');
  if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
  await page.locator('#wallet-exchange-history:not([hidden])').waitFor();
}

async function open(t, { initial = 'billing/credits', prefix = '', viewport, configure, theme = 'light', expandHistory = true } = {}) {
  const session = await fixture.setup(t, viewport ? { viewport } : {});
  const backend = createAppBackend({ preferences: { ...preferences, theme }, modelChat: true, keys: [{ ...key }], workspaces: [{ ...workspace }] });
  await backend.install(session.context);
  await session.context.route(/\/api\/app\/catalog(?:\?.*)?$/, route => route.fulfill({ json: {
    key_id: 17, models: [{ model: 'history/text', offered: true, formats: ['openai-responses'], client_formats: { api: ['openai-responses'], claude_code: [], web_chat: [] }, routable: true }],
  } }));
  const reads = [], responses = [], mutations = [];
  session.page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === '/api/app/exchange-rates') reads.push({ days: Number(url.searchParams.get('days')), method: request.method(), headers: request.headers() });
    if (url.pathname.startsWith('/api/app/') && !['GET', 'HEAD'].includes(request.method())) mutations.push(url.pathname);
  });
  session.page.on('response', response => { if (new URL(response.url()).pathname === '/api/app/exchange-rates') responses.push(response); });
  await configure?.({ ...session, backend });
  await session.page.goto(`${session.base}${prefix}/app/#/${initial}`);
  await session.page.locator('#fx .sb').waitFor();
  await session.page.waitForFunction(() => document.querySelector('#fx')?.getAttribute('aria-busy') !== 'true');
  if (expandHistory && initial === 'billing/credits') await expand(session.page);
  const panel = session.page.locator('.exchange-history[data-exchange-history]');
  return { ...session, backend, reads, responses, mutations, panel };
}

async function table(panel) {
  const details = panel.locator('[data-history-table]');
  await details.waitFor();
  if (!await details.evaluate(node => node.open)) await details.locator('summary').click();
  return details.locator('tbody tr');
}

for (const [prefix, disclaimer] of [
  ['', /Historical reference only.*not a manual-service quotation/], ['/zh', /仅供历史参考.*不构成人工开通报价/], ['/zh-hant', /僅供歷史參考.*不構成人工開通報價/],
  ['/ja', /過去の参考情報.*見積もりではありません/], ['/ko', /과거 참고 자료.*견적이 아닙니다/], ['/es', /Solo referencia histórica.*No es un presupuesto/],
]) test(`historical reference defaults collapsed without a request and leaves support activation available ${prefix || 'en'}`, async t => {
  const { page, panel, reads, mutations, errors } = await open(t, { prefix, viewport: { width: 320, height: 900 }, expandHistory: false, configure: async ({ page }) => {
    await page.addInitScript(() => {
      window.historyConsultations = [];
      document.addEventListener('fells:support-open', event => { window.historyConsultations.push(event.detail); event.stopImmediatePropagation(); }, true);
    });
  } });
  const toggle = page.locator('[data-act=history-toggle]'); await toggle.waitFor();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(await toggle.getAttribute('aria-controls'), 'wallet-exchange-history');
  assert.equal(await page.locator('#wallet-exchange-history').isVisible(), false);
  assert.equal(await panel.count(), 0); assert.equal(reads.length, 0);
  const contact = page.locator('[data-act=contact-purchase][data-support-product=allowance]');
  assert.equal(await contact.isEnabled(), true); await contact.click();
  assert.equal(await page.evaluate(() => window.historyConsultations.length), 1);
  assert.equal(await page.evaluate(() => window.historyConsultations[0].product), 'allowance');
  assert.equal(reads.length, 0, 'contacting support does not fetch or authorize historical conversion');
  if (prefix === '/zh') { await mkdir('test-results/package-audit', { recursive: true }); await page.screenshot({ path: 'test-results/package-audit/wallet-history-collapsed-zh320.png', fullPage: true }); }
  await expand(page); await panel.locator('svg.exchange-history-chart').waitFor();
  assert.equal(reads.length, 1); assert.equal(reads[0].method, 'GET');
  assert.match(await page.locator('#wallet-exchange-history').innerText(), disclaimer);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await toggle.click(); assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('#wallet-exchange-history').isVisible(), false); assert.equal(reads.length, 1);
  assert.deepEqual(mutations, []); assert.deepEqual(errors, []);
});

test('expanded historical reference shows an attributed 30-day ECB chart and exact daily table without any financial request', async t => {
  const { panel, reads, responses, mutations, backend, errors } = await open(t);
  await panel.locator('svg.exchange-history-chart').waitFor();
  const payload = await responses.at(-1).json();
  assert.equal(reads.length, 1); assert.equal(reads[0].days, 30); assert.equal(reads[0].method, 'GET');
  assert.equal(reads[0].headers['x-fells-expected-user'], '42');
  assert.equal(reads[0].headers['x-fells-expected-session'], 'c'.repeat(64));
  assert.equal(await panel.locator('[data-history-range="30"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await panel.locator(`a[href="${sourceURL}"]`).count(), 1);
  assert.match(await panel.innerText(), /ECB|1\.001/);
  assert.ok((await panel.innerText()).includes('1.001'));
  assert.ok((await panel.innerText()).includes(payload.as_of));
  assert.equal(await panel.locator('svg[role=img] polyline').count(), 2);
  assert.equal(await panel.locator('svg circle').count(), payload.points.length);
  assert.equal(await panel.locator('[data-history-stale]').count(), 0);
  const rows = await table(panel);
  assert.equal(await rows.count(), payload.points.length);
  assert.deepEqual(await rows.locator('th').allTextContents(), payload.points.map(point => point.date).reverse());
  assert.deepEqual(await rows.locator('td').allTextContents(), [...payload.points].reverse().flatMap(point => [point.reference_rate, point.exchange_rate]));
  assert.deepEqual(mutations, []); assert.equal(backend.state.writes.length, 0); assert.deepEqual(errors, []);
});

test('expanded desktop history permits vertical scrolling and keeps chart, publication metadata, source and daily table reachable', async t => {
  const { page, panel, responses, errors } = await open(t, { viewport: { width: 1280, height: 820 } });
  await panel.locator('svg.exchange-history-chart').waitFor();
  const payload = await responses.at(-1).json();
  const layout = await page.evaluate(() => {
    const body = document.querySelector('.wallet-exchange-panel .wallet-panel-body');
    const details = document.querySelector('.exchange-history [data-history-table]');
    return { width: innerWidth, documentWidth: document.documentElement.scrollWidth,
      bodyHeight: body.clientHeight, bodyScrollHeight: body.scrollHeight,
      overflowY: getComputedStyle(body).overflowY, detailsOpen: details.open };
  });
  assert.equal(layout.detailsOpen, false);
  assert.ok(layout.documentWidth <= layout.width);
  if (layout.bodyScrollHeight > layout.bodyHeight + 2) assert.ok(['auto', 'scroll'].includes(layout.overflowY), 'long historical references must be scrollable');
  async function reachable(locator) {
    await locator.scrollIntoViewIfNeeded();
    const available = await locator.evaluate(element => {
      const box = element.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2;
      const hit = document.elementFromPoint(x, y);
      return box.width > 0 && box.height > 0 && y >= 0 && y < innerHeight && x >= 0 && x < innerWidth && (hit === element || element.contains(hit));
    });
    assert.equal(available, true, 'the scrolled content remains inside the viewport and is not covered by another layer');
  }
  await reachable(panel.locator('svg.exchange-history-chart'));
  await reachable(panel.locator('p.hint').filter({ hasText: payload.as_of }).first());
  await reachable(panel.locator(`a[href="${sourceURL}"]`));
  await mkdir('test-results/package-audit', { recursive: true });
  await page.screenshot({ path: 'test-results/package-audit/wallet-history-expanded-source-desktop.png', fullPage: true });
  await reachable(panel.locator('[data-history-table] summary'));
  const rows = await table(panel); await reachable(rows.last());
  assert.deepEqual(errors, []);
});

for (const theme of ['light', 'dark']) test(`both rate curves remain distinguishable against the ${theme} wallet`, async t => {
  const { page, panel, errors } = await open(t, { theme });
  await panel.locator('.exchange-history-chart').waitFor();
  const colors = await page.evaluate(() => {
    const chart = document.querySelector('.exchange-history-chart');
    return { reference: getComputedStyle(chart.querySelector('.reference')).stroke,
      exchange: getComputedStyle(chart.querySelector('.exchange')).stroke,
      point: getComputedStyle(chart.querySelector('circle')).fill,
      background: getComputedStyle(document.querySelector('.wallet-exchange-panel')).backgroundColor };
  });
  const luminance = css => {
    const [r, g, b] = css.match(/[\d.]+/g).slice(0, 3).map(Number).map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4);
    return .2126 * r + .7152 * g + .0722 * b;
  };
  const background = luminance(colors.background);
  for (const line of [colors.reference, colors.exchange]) {
    const value = luminance(line);
    assert.ok((Math.max(value, background) + .05) / (Math.min(value, background) + .05) >= 3, `${line} needs readable chart contrast on ${colors.background}`);
  }
  assert.notEqual(colors.reference, colors.exchange);
  assert.equal(colors.point, colors.reference);
  assert.deepEqual(errors, []);
});

test('history is lazy outside the wallet and range controls request exactly 7, 30 and 90 days', async t => {
  const { page, panel, reads, mutations, backend, errors } = await open(t, { initial: 'api', configure: async ({ context }) => {
    await context.route(historyPath, route => route.fulfill({ json: history(Number(new URL(route.request().url()).searchParams.get('days'))) }));
  } });
  await page.locator('.api-page').waitFor(); assert.equal(reads.length, 0);
  await page.evaluate(() => { location.hash = '#/new'; });
  await page.locator('#fx[data-route="#/new"]').waitFor(); assert.equal(reads.length, 0);
  await page.evaluate(() => { location.hash = '#/billing/credits'; });
  assert.equal(reads.length, 0, 'entering the wallet keeps historical reference collapsed');
  await expand(page);
  await panel.locator('svg.exchange-history-chart').waitFor();
  for (const days of [7, 90, 30]) {
    const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/app/exchange-rates' && Number(new URL(response.url()).searchParams.get('days')) === days);
    await panel.locator(`[data-history-range="${days}"]`).click(); await (await response).finished();
    await panel.locator('.exchange-history-values strong').filter({ hasText: history(days).points.at(-1).exchange_rate }).waitFor();
    assert.equal(await panel.locator(`[data-history-range="${days}"]`).getAttribute('aria-pressed'), 'true');
  }
  assert.deepEqual(reads.map(read => read.days), [30, 7, 90, 30]);
  assert.ok(reads.every(read => read.method === 'GET' && read.headers['x-fells-expected-session'] === 'c'.repeat(64)));
  assert.deepEqual(mutations, []); assert.equal(backend.state.writes.length, 0); assert.deepEqual(errors, []);
});

test('a delayed old range response cannot replace the latest selected history', async t => {
  let release, started;
  const delayed = new Promise(resolve => { release = resolve; }), entered = new Promise(resolve => { started = resolve; });
  t.after(() => release());
  const { page, panel, reads, mutations, errors } = await open(t, { configure: async ({ context }) => {
    await context.route(historyPath, async route => {
      const days = Number(new URL(route.request().url()).searchParams.get('days'));
      if (days === 7) { started(); await delayed; }
      await route.fulfill({ json: history(days) });
    });
  } });
  await panel.locator('svg.exchange-history-chart').waitFor();
  const oldResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/app/exchange-rates' && new URL(response.url()).searchParams.get('days') === '7');
  await panel.locator('[data-history-range="7"]').click(); await entered;
  await panel.locator('[data-history-range="90"]').click();
  await panel.locator('.exchange-history-values strong').filter({ hasText: '7.60760000' }).waitFor();
  release(); await (await oldResponse).finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await panel.locator('[data-history-range="90"]').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(await panel.locator('.exchange-history-values strong').allTextContents(), ['7.60000000', '7.60760000']);
  assert.deepEqual(reads.map(read => read.days), [30, 7, 90]); assert.deepEqual(mutations, []); assert.deepEqual(errors, []);
});

test('stale history remains useful on mobile and is distinct from a manual support quotation', async t => {
  const { context, page, panel, mutations, backend, errors } = await open(t, { viewport: { width: 390, height: 844 }, configure: async ({ context }) => {
    await context.route(historyPath, route => route.fulfill({ json: history(30, { stale: true }) }));
    await context.route('**/api/app/allowance/quote', route => route.fulfill({ status: 503, json: { error: 'ECB 参考汇率暂不可用，请稍后重新报价' } }));
  } });
  await panel.locator('[data-history-stale]').waitFor();
  assert.match(await panel.locator('[data-history-stale]').innerText(), /last fetched reference.*support.*quotation/);
  assert.equal(await panel.locator('svg circle').count(), 3);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(mutations, [], 'opening historical data cannot obtain or confirm a quote');
  assert.equal(await page.locator('[data-act=contact-purchase][data-support-product=allowance]').isEnabled(),true);
  assert.equal(await page.locator('[data-form=exchange-quote],[data-act=exchange-confirm]').count(),0);
  assert.equal(await panel.locator('[data-history-stale]').count(),1);
  assert.deepEqual(mutations,[], 'historical rates never authorize a new charge');
  assert.equal(backend.state.writes.length, 0); assert.deepEqual(errors, []);
});

for (const failure of ['503', 'network', 'malformed']) test(`history ${failure} shows a controlled read-only error and explicit retry restores data`, async t => {
  let fail = true;
  const { page, panel, reads, mutations, backend, errors } = await open(t, { configure: async ({ context }) => {
    await context.route(historyPath, route => {
      if (!fail) return route.fulfill({ json: history() });
      if (failure === 'network') return route.abort('failed');
      return route.fulfill({ status: failure === '503' ? 503 : 200, json: failure === '503'
        ? { error: 'private-provider.internal secret failure' }
        : { ...history(), points: [{ ...history().points[0], reference_rate: 'not-a-rate' }] } });
    });
  } });
  await panel.getByRole('status').filter({ hasText: 'Exchange-rate history is unavailable. Try again.' }).waitFor();
  assert.equal(await panel.locator('svg.exchange-history-chart,[data-history-table],[data-history-stale]').count(), 0);
  assert.doesNotMatch(await panel.innerText(), /private-provider|secret failure|fresh ECB quote is unavailable/);
  assert.equal(await page.locator('[data-act=contact-purchase][data-support-product=allowance]').isEnabled(), true, 'history failure does not disable contacting support');
  assert.deepEqual(mutations, []); fail = false;
  await panel.locator('[data-history-retry]').click();
  await panel.locator('svg.exchange-history-chart').waitFor();
  assert.deepEqual(reads.map(read => read.days), [30, 30]);
  assert.equal(await panel.getByRole('status').count(), 0);
  assert.deepEqual(await panel.locator('.exchange-history-values strong').allTextContents(), ['7.30000000', '7.30730000']);
  assert.deepEqual(mutations, []); assert.equal(backend.state.writes.length, 0); assert.deepEqual(errors, []);
});

test('a single published day produces a finite chart and one real table row without invented weekend data', async t => {
  const point = history().points.at(-1);
  const { panel, mutations, errors } = await open(t, { configure: async ({ context }) => {
    await context.route(historyPath, route => route.fulfill({ json: history(30, { points: [point] }) }));
  } });
  await panel.locator('svg.exchange-history-chart').waitFor();
  assert.equal(await panel.locator('svg circle').count(), 1);
  for (const points of await panel.locator('svg polyline').evaluateAll(nodes => nodes.map(node => node.getAttribute('points')))) {
    assert.doesNotMatch(points, /NaN|Infinity/); assert.equal(points.trim().split(/\s+/).length, 1);
  }
  const rows = await table(panel); assert.equal(await rows.count(), 1);
  assert.equal(await rows.locator('th').innerText(), point.date);
  assert.deepEqual(mutations, []); assert.deepEqual(errors, []);
});
