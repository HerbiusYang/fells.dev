import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createBrowserFixture } from '../helpers/browser.mjs';
import { publicCatalogFixture } from '../fixtures/public-catalog.mjs';

const fixture = createBrowserFixture();
before(() => fixture.start());
after(() => fixture.stop());
const catalogPath = '**/api/app/public/catalog';
const ready = page => page.waitForFunction(() => document.querySelectorAll('[data-public-catalog-state=ready]').length === 3);
async function capture(page, name) {
  const directory = 'test-results/package-audit';
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: join(directory, name), fullPage: true });
}
async function install(context, { catalog = publicCatalogFixture(), status = 200, deferred } = {}) {
  const state = { catalog, status, reads: [] };
  await context.route(catalogPath, async route => {
    state.reads.push({ method: route.request().method(), headers: route.request().headers() });
    if (deferred) await deferred;
    await route.fulfill({ status: state.status, json: state.status === 200 ? state.catalog : { error: 'Catalog unavailable' } });
  });
  return state;
}

for (const locale of ['', '/zh', '/zh-hant', '/ja', '/ko', '/es']) test(`live public catalog uses offered models and current terms at 320px ${locale || 'en'}`, async t => {
  const { context, page, base, errors } = await fixture.setup(t, { viewport: { width: 320, height: 900 } });
  await context.addCookies([{ name: 'portal_session', value: 'private-cookie', url: base }]);
  const state = await install(context);
  await page.goto(base + locale + '/market/'); await ready(page);
  assert.equal(state.reads.length, 1, 'all three categories share one read');
  assert.equal(state.reads[0].method, 'GET');
  assert.equal(state.reads[0].headers.cookie, undefined, 'anonymous catalog never sends session cookies');
  assert.equal(state.reads[0].headers.authorization, undefined);
  assert.equal(await page.locator('[data-public-product]').count(), 4);
  assert.equal(await page.locator('[data-public-model]').count(), 4);
  assert.equal(await page.locator('[data-public-model="price-only/unoffered"]').count(), 0);
  assert.equal(await page.locator('[data-public-model^="invalid/"]').count(), 0, 'unroutable or empty client projections are not supplied models');
  assert.equal(await page.locator('[data-public-model-tier]').count(), 1, 'long tiers exist only when configured');
  const token = page.locator('[data-public-product=live-token]');
  assert.match(await token.innerText(), /731/); assert.match(await token.innerText(), /850/); assert.match(await token.innerText(), /30/);
  const trial = page.locator('[data-public-product=live-trial]'); assert.match(await trial.innerText(), /14/);
  assert.match(await page.locator('[data-public-product=current-quarter]').innerText(), /1\/4/);
  assert.equal(await page.locator('[data-public-product=current-half]').getAttribute('data-status'), 'sold_out');
  assert.ok(await page.locator('[data-public-model="supplied/temporary"] .public-model-state').count(), 'temporary outages retain the supplied model');
  assert.ok(await page.locator('[data-public-model="supplied/unverified"] .public-model-state').count(), 'unverified routes do not disappear');
  const native = page.locator('[data-public-model="supplied/native"]');
  assert.equal(await native.locator('td').last().innerText(), 'Claude Code', 'native OAuth is not labeled as SDK/API access');
  const baseRates = await page.locator('[data-public-model="supplied/chat"] td').allTextContents();
  assert.notEqual(baseRates.at(-1), 'API · Chat Completions', 'web chat capability is shown alongside the API endpoint');
  assert.match(baseRates[0], /4[.,]25/); assert.match(baseRates[4], /8[.,]?5(?:0)?/);
  assert.equal(await page.locator('[data-public-model="supplied/chat"] td[rowspan="2"]').count(), 2, 'per-request fee and access are shared by both tiers');
  const tier = page.locator('[data-public-model-tier="supplied/chat"]');
  assert.match(await tier.innerText(), /125[,.\s]?000/); assert.equal(await tier.locator('td').count(), 5);
  assert.doesNotMatch(await page.locator('main').innerText(), /Haiku 5\.5|Fable 5\.5|Unprovided Price Only Model|1,?288|2,?288|98%/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'page does not scroll horizontally');
  const table = page.locator('.public-models-scroll');
  assert.equal(await table.evaluate(element => element.scrollWidth > element.clientWidth), true, 'wide pricing remains in its scroll region');
  for (const href of await page.locator('[data-public-product] [data-purchase-market]').evaluateAll(links => links.map(link => link.href))) {
    assert.equal(new URL(href).pathname, locale + '/app/start/');
    assert.match(new URL(href).searchParams.get('next'), /#\/billing\/market$/);
  }
  if (locale === '/zh') await capture(page, 'public-catalog-zh-mobile.png');
  assert.deepEqual(errors, []);
});

test('home page uses the same live catalog and never carries static plan/model prices', async t => {
  const { context, page, base, errors } = await fixture.setup(t);
  const state = await install(context); await page.goto(base + '/zh/'); await ready(page);
  assert.equal(state.reads.length, 1);
  assert.match(await page.locator('#plans').innerText(), /Current Token/);
  assert.match(await page.locator('#group').innerText(), /Current Quarter Seat/);
  assert.match(await page.locator('#payg').innerText(), /Supplied Chat/);
  assert.equal(await page.locator('.public-product:not(:has([data-purchase-market]))').count(), 0);
  assert.doesNotMatch(await page.locator('main').innerText(), /Haiku 5\.5|Fable 5\.5|Unprovided Price Only Model/);
  await capture(page, 'public-catalog-zh-desktop.png');
  assert.deepEqual(errors, []);
});

test('failed public catalog has no price fallback and one explicit retry refreshes all categories', async t => {
  const { context, page, base, errors } = await fixture.setup(t);
  const state = await install(context, { status: 503 });
  await page.goto(base + '/market/');
  await page.waitForFunction(() => document.querySelectorAll('[data-public-catalog-state=error]').length === 3);
  assert.equal(await page.locator('[data-public-model],[data-public-product]').count(), 0);
  assert.equal(await page.locator('.public-catalog-footer [data-purchase-market]').count(), 3);
  state.status = 200;
  await page.locator('[data-public-catalog-retry]').first().click(); await ready(page);
  assert.equal(state.reads.length, 2, 'retry is one shared read, not one request per section');
  assert.equal(await page.locator('[data-public-product]').count(), 4);
  assert.deepEqual(errors, []);
});

test('empty and malformed public catalogs remain honest and do not reconstruct static offers', async t => {
  for (const catalog of [{ schema_version: 1, models: [], token_plans: [], subscriptions: [] }, { ...publicCatalogFixture(), token_plans: [{ ...publicCatalogFixture().token_plans[0], price_micro: -1 }] }]) {
    const { context, page, base, errors } = await fixture.setup(t); await install(context, { catalog });
    await page.goto(base + '/market/');
    await page.waitForFunction(() => [...document.querySelectorAll('[data-public-catalog]')].every(element => element.dataset.publicCatalogState && element.dataset.publicCatalogState !== 'loading'));
    assert.equal(await page.locator('[data-public-model],[data-public-product]').count(), 0);
    assert.equal(await page.locator('.public-catalog-footer [data-purchase-market]').count(), 3);
    assert.deepEqual(errors, []);
  }
});

test('a slow catalog shows neutral loading and keeps account navigation available', async t => {
  const { context, page, base, errors } = await fixture.setup(t);
  let release; const deferred = new Promise(resolve => { release = resolve; });
  await install(context, { deferred });
  await page.goto(base + '/market/');
  await page.waitForFunction(() => document.querySelectorAll('[data-public-catalog-state=loading]').length === 3);
  assert.equal(await page.locator('[data-public-product],[data-public-model]').count(), 0);
  assert.equal(await page.locator('.public-catalog-footer [data-purchase-market]').count(), 3);
  release(); await ready(page);
  assert.deepEqual(errors, []);
});

test('the public request deadline exits loading and leaves account access available', async t => {
  const { context, page, base, errors } = await fixture.setup(t);
  // Accelerate only this request's configured deadline; do not delay the suite.
  await page.addInitScript(() => {
    const set = window.setTimeout.bind(window);
    window.setTimeout = (callback, delay, ...args) => set(callback, delay === 8000 ? 30 : delay, ...args);
  });
  let release; const deferred = new Promise(resolve => { release = resolve; });
  await context.route(catalogPath, async route => {
    await deferred;
    try { await route.fulfill({ json: publicCatalogFixture() }); } catch { /* Deadline aborted the request. */ }
  });
  try {
    await page.goto(base + '/market/');
    await page.waitForFunction(() => document.querySelectorAll('[data-public-catalog-state=error]').length === 3);
    assert.equal(await page.locator('[data-public-catalog][aria-busy=true]').count(), 0);
    assert.equal(await page.locator('[data-public-model],[data-public-product]').count(), 0);
    assert.equal(await page.locator('.public-catalog-footer [data-purchase-market]').count(), 3);
    assert.deepEqual(errors, []);
  } finally { release(); }
});

test('without JavaScript the public page provides account links and no stale commercial offers', async t => {
  const { context, page, base, errors } = await fixture.setup(t, { javaScriptEnabled: false });
  const state = await install(context);
  await page.goto(base + '/market/');
  assert.equal(state.reads.length, 0);
  assert.equal(await page.locator('[data-public-product],[data-public-model]').count(), 0);
  assert.equal(await page.locator('.public-catalog-footer [data-purchase-market]').count(), 3);
  assert.doesNotMatch(await page.locator('main').innerText(), /[$¥￥]\s*\d|Haiku 5\.5|Fable 5\.5/);
  assert.deepEqual(errors, []);
});

test('public catalog escapes server-owned labels and IDs rather than inserting executable markup', async t => {
  const { context, page, base, errors } = await fixture.setup(t);
  const catalog = publicCatalogFixture();
  catalog.token_plans[0].name = '<img src=x onerror="window.catalogInjected=true">';
  catalog.models[0].display_name = '<script>window.catalogInjected=true</script>';
  await install(context, { catalog }); await page.goto(base + '/market/'); await ready(page);
  assert.equal(await page.locator('[data-public-catalog] img,[data-public-catalog] script').count(), 0);
  assert.equal(await page.evaluate(() => window.catalogInjected), undefined);
  assert.match(await page.locator('[data-public-product=live-trial] h3').innerText(), /<img/);
  assert.deepEqual(errors, []);
});
