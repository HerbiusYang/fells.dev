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
function catalogWithOpenAI() {
  const catalog = publicCatalogFixture();
  // Deliberately synthetic prices and ID: real public products never become fixtures.
  catalog.models.push({ ...catalog.models[0], model: 'gpt-fixture', display_name: 'Synthetic GPT', vendor: 'OpenAI', formats: ['openai-responses', 'openai-completions'], client_formats: { api: ['openai-responses', 'openai-completions'], claude_code: [], web_chat: [] }, usd_in: 7130000, usd_out: 29990000, usd_cache_w_30m: 12000000, usd_cache_w_12h: 21000000, long_threshold: 0 });
  return catalog;
}
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
  const state = await install(context, { catalog: catalogWithOpenAI() });
  await page.goto(base + locale + '/market/'); await ready(page);
  assert.equal(state.reads.length, 1, 'all three categories share one read');
  assert.equal(state.reads[0].method, 'GET');
  assert.equal(state.reads[0].headers.cookie, undefined, 'anonymous catalog never sends session cookies');
  assert.equal(state.reads[0].headers.authorization, undefined);
  assert.equal(await page.locator('[data-public-product]').count(), 4);
  assert.equal(await page.locator('[data-public-model]').count(), 5);
  assert.equal(await page.locator('[data-public-model="price-only/unoffered"]').count(), 0);
  assert.equal(await page.locator('[data-public-model^="invalid/"]').count(), 0, 'unroutable or empty client projections are not supplied models');
  assert.equal(await page.locator('[data-public-model-tier]').count(), 1, 'long tiers exist only when configured');
  const token = page.locator('[data-public-product=live-token]');
  assert.match(await token.innerText(), /731/); assert.match(await token.innerText(), /850/); assert.match(await token.innerText(), /30/);
  const trial = page.locator('[data-public-product=live-trial]'); assert.match(await trial.innerText(), /14/);
  assert.match(await trial.locator('[data-trial-model-scope]').innerText(), /Claude/);
  assert.match(await trial.locator('[data-trial-model-scope]').innerText(), /GPT/);
  const debitNote=await page.locator('[data-public-catalog][data-kind=token_plans]').innerText();
  assert.match(debitNote,/Fells/);assert.match(debitNote,/USD/);assert.doesNotMatch(debitNote,/Allowance is measured at official API list prices|额度按官方 API 标价计量/);
  assert.match(await page.locator('[data-public-product=current-quarter]').innerText(), /1\/4/);
  assert.equal(await page.locator('[data-public-product=current-half]').getAttribute('data-status'), 'sold_out');
  assert.equal(await page.locator('[data-public-model="supplied/temporary"]').count(), 1, 'temporary outages retain the supplied model');
  assert.equal(await page.locator('[data-public-model="supplied/unverified"]').count(), 1, 'unverified routes do not disappear');
  assert.equal(await page.locator('.public-model-state').count(), 0, 'public model prices carry no transient availability badges');
  const gpt = page.locator('[data-public-model=gpt-fixture]');
  assert.deepEqual(await gpt.locator('td').evaluateAll(cells => cells.map(cell => cell.dataset.rate)), ['usd_in', 'usd_out'], 'the public board lists input and output only');
  const gptRates = await gpt.locator('td').allTextContents();
  assert.match(gptRates[0], /7[.,]13/); assert.match(gptRates[1], /29[.,]99/);
  const models = page.locator('[data-public-catalog][data-kind=models]');
  assert.equal(await models.locator('thead th').count(), 3);
  assert.equal(await models.locator('[data-rate^=usd_cache]').count(), 0, 'cache prices stay with each Key in the account');
  assert.equal(await models.locator('.pm-group').count(), 2, 'models are grouped by vendor');
  const native = page.locator('[data-public-model="supplied/native"]');
  assert.match(await native.locator('[data-rate=usd_req]').innerText(), /0[.,]012/, 'a per-request charge stays visible beside the model');
  const baseRates = await page.locator('[data-public-model="supplied/chat"] td').allTextContents();
  assert.match(baseRates[0], /4[.,]25/); assert.match(baseRates[1], /21[.,]25/);
  const tier = page.locator('[data-public-model-tier="supplied/chat"]');
  assert.equal(await tier.locator('td').count(), 2);
  assert.match(await tier.locator('[data-rate=usd_in]').innerText(), /8[.,]50/); assert.match(await tier.locator('[data-rate=usd_out]').innerText(), /31[.,]875/);
  assert.match(await models.locator('[data-long-note]').innerText(), /125[,.\s]?000/, 'the long-context threshold is explained once');
  assert.doesNotMatch(await page.locator('main').innerText(), /Haiku 5\.5|Fable 5\.5|Unprovided Price Only Model|1,?288|2,?288|98%/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'page does not scroll horizontally');
  const board = page.locator('[data-public-catalog][data-kind=models] .pm');
  assert.equal(await board.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, 'model prices fit without horizontal scrolling');
  const contact = page.locator('[data-public-product=live-token] [data-open-customer-support]');
  assert.equal(await contact.getAttribute('data-support-title'), 'Current Token');
  assert.equal(await contact.getAttribute('data-support-code'), 'live-token');
  assert.equal(await contact.getAttribute('data-support-product'), 'token_plan');
  assert.equal(await contact.getAttribute('data-support-amount'), '731000000');
  assert.equal(await contact.getAttribute('data-support-days'), '30');
  assert.equal(await page.locator('[data-public-product] a[href*="/checkout"]').count(), 0);
  if (locale === '/zh') await capture(page, 'public-catalog-zh-mobile.png');
  assert.deepEqual(errors, []);
});

test('home page uses the same live catalog and never carries static plan/model prices', async t => {
  const { context, page, base, errors } = await fixture.setup(t);
  const state = await install(context, { catalog: catalogWithOpenAI() }); await page.goto(base + '/zh/'); await ready(page);
  assert.equal(state.reads.length, 1);
  assert.match(await page.locator('#plans').innerText(), /Current Token/);
  assert.match(await page.locator('#group').innerText(), /Current Quarter Seat/);
  assert.match(await page.locator('#payg').innerText(), /Supplied Chat/);
  assert.equal(await page.locator('[data-public-model=gpt-fixture]').count(), 1);
  assert.equal(await page.locator('.public-model-state').count(), 0);
  assert.equal(await page.locator('.public-product:not(:has([data-purchase-market]))').count(), 0);
  assert.doesNotMatch(await page.locator('main').innerText(), /Haiku 5\.5|Fable 5\.5|Unprovided Price Only Model/);
  await capture(page, 'public-catalog-zh-desktop.png');
  assert.deepEqual(errors, []);
});

test('a zero-burst Token Plan keeps all homepage catalog categories usable', async t => {
  const { context, page, base, errors } = await fixture.setup(t);
  const catalog = publicCatalogFixture();
  // This is the real API meaning used by its seeded trial: guaranteed credit,
  // with burst_usd_micro=0 for no optional burst. Prices here stay synthetic.
  assert.ok(catalog.token_plans[0].quota_usd_micro > 0);
  assert.equal(catalog.token_plans[0].burst_usd_micro, 0);
  const state = await install(context, { catalog });
  await page.goto(base + '/zh/'); await ready(page);
  assert.equal(state.reads.length, 1);
  assert.equal(await page.locator('[data-public-catalog-state=error]').count(), 0);
  const trial = page.locator('[data-public-product=live-trial]');
  assert.equal(await trial.locator('dl > div').count(), 1, 'no extra burst entitlement is invented');
  assert.match(await trial.innerText(), /110/);
  assert.equal(await trial.locator('[data-open-customer-support]').count(), 1);
  assert.match(await page.locator('#group').innerText(), /Current Quarter Seat/);
  assert.match(await page.locator('#payg').innerText(), /Supplied Chat/);
  assert.deepEqual(errors, []);
});

test('a nonzero Token Plan burst below its guarantee remains invalid', async t => {
  const { context, page, base, errors } = await fixture.setup(t);
  const catalog = publicCatalogFixture();
  catalog.token_plans[0].burst_usd_micro = catalog.token_plans[0].quota_usd_micro - 1;
  await install(context, { catalog });
  await page.goto(base + '/zh/');
  await page.waitForFunction(() => document.querySelectorAll('[data-public-catalog-state=error]').length === 3);
  assert.equal(await page.locator('[data-public-product],[data-public-model]').count(), 0);
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


test('public plan selection opens support and retains the selected consultation through sign-in navigation', async t => {
  const { context, page, base, errors } = await fixture.setup(t);
  await install(context);
  await context.route('**/api/app/session', route => route.fulfill({ status: 401, json: { error: 'signed out' } }));
  await context.route('**/api/app/bootstrap', route => route.fulfill({ status: 401, json: { error: 'signed out' } }));
  await page.goto(base + '/zh/market/'); await ready(page);
  await page.locator('[data-public-product=live-token] [data-open-customer-support]').click();
  await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('fells.support.purchase.v1') ?? 'null')?.publicCode === 'live-token');
  const intent = await page.evaluate(() => JSON.parse(sessionStorage.getItem('fells.support.purchase.v1')));
  assert.equal(intent.title, 'Current Token'); assert.equal(intent.product, 'token_plan');
  assert.equal(intent.amountMicro, 731000000); assert.equal(intent.serviceDays, 30);
  assert.equal(Object.hasOwn(intent, 'poolId') && intent.poolId > 0, false, 'anonymous consultation carries no private pool identity');
  const login = page.locator('#support-panel a[href*="/app/start"]'); await login.waitFor();
  const href = new URL(await login.getAttribute('href'), base);
  assert.equal(href.pathname.replace(/\/$/, ''), '/zh/app/start');
  assert.equal(href.searchParams.get('next'), '/zh/app/?support=1');
  await page.goto(href.href);
  assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('fells.support.purchase.v1')).publicCode), 'live-token');
  assert.deepEqual(errors, []);
});

test('native OpenAI long-context prices use separate actual API fields', async t => {
  const {context,page,base,errors}=await fixture.setup(t);
  const catalog=catalogWithOpenAI();
  Object.assign(catalog.models.at(-1),{long_threshold:250000,usd_in_long:14000000,usd_out_long:59000000,usd_cache_r_long:1100000,usd_cache_w_30m_long:24000000,usd_cache_w_12h_long:42000000});
  await install(context,{catalog});await page.goto(base+'/market/');await ready(page);
  const tier=page.locator('[data-public-model-tier=gpt-fixture]');
  assert.match(await tier.locator('th').innerText(),/250K/);
  assert.match(await tier.locator('[data-rate=usd_in]').innerText(),/14[.,]00/);
  assert.match(await tier.locator('[data-rate=usd_out]').innerText(),/59[.,]00/);
  assert.equal(await tier.locator('td').count(),2);
  assert.equal(await page.locator('[data-public-catalog][data-kind=models] [data-long-note]').count(),2,'each distinct threshold is explained');
  assert.deepEqual(errors,[]);
});

const sellingDiscount={'':/30% below official/,'/zh':/官方价 7 折/,'/zh-hant':/官方價 7 折/,'/ja':/30%/,'/ko':/30%/,'/es':/30 %/};
for(const locale of ['', '/zh', '/zh-hant', '/ja', '/ko', '/es'])test(`public selling unit prices use the server tariff in locale ${locale || 'en'}`,async t=>{
  const {context,page,base,errors}=await fixture.setup(t);const catalog=catalogWithOpenAI();
  Object.assign(catalog.models.at(-1),{long_threshold:250000,usd_in_long:14260000,usd_out_long:59980000,selling_prices:{price_bp:7000,usd_in:4991000,usd_out:20993000,usd_cache_r:297500,usd_cache_w_30m:8400000,usd_cache_w_12h:14700000,usd_req:8400,long_threshold:250000,usd_in_long:9982000,usd_out_long:41986000,usd_cache_w_30m_long:16800000,usd_cache_w_12h_long:29400000}});
  await install(context,{catalog});await page.goto(base+locale+'/market/');await ready(page);
  const row=page.locator('[data-public-model=gpt-fixture]');assert.equal(await row.getAttribute('data-price-source'),'selling');
  assert.match(await row.locator('[data-rate=usd_in]').innerText(),/4[.,]991/);
  assert.match(await row.locator('[data-rate=usd_req] [data-price=fells]').innerText(),/0[.,]0084/);
  assert.match(await page.locator('[data-public-model-tier=gpt-fixture] [data-rate=usd_in]').innerText(),/9[.,]982/);
  assert.match(await row.locator('[data-rate=usd_in] s[data-price=official]').innerText(),/7[.,]13/,'the official price sits struck through under the Fells price');
  assert.match(await page.locator('[data-public-model-tier=gpt-fixture] [data-rate=usd_in] [data-price=official]').innerText(),/14[.,]26/);
  assert.match(await row.locator('[data-model-discount]').innerText(),sellingDiscount[locale]);
  assert.equal(await page.locator('[data-public-catalog][data-kind=models] [data-price-legend]').count(),1);
  const legacy=page.locator('[data-public-model="supplied/chat"]');assert.equal(await legacy.getAttribute('data-price-source'),'reference');
  assert.equal(await legacy.locator('[data-price=official]').count(),0,'an official-only row has nothing to compare');
  assert.notEqual(await row.locator('[data-model-price-label]').innerText(),await legacy.locator('[data-model-price-label]').innerText());assert.deepEqual(errors,[]);
});
test('invalid selling prices remain unavailable without displaying the official rate as a sale',async t=>{
  const {context,page,base,errors}=await fixture.setup(t);const catalog=catalogWithOpenAI();catalog.models.at(-1).selling_prices={price_bp:7000,usd_in:'bad',usd_out:1};
  await install(context,{catalog});await page.goto(base+'/market/');await ready(page);const row=page.locator('[data-public-model=gpt-fixture]');
  assert.equal(await row.getAttribute('data-price-source'),'unavailable');assert.equal(await row.locator('[data-rate=usd_in]').innerText(),'—');assert.equal(await row.locator('[data-model-price-label]').innerText(),'Price unavailable');assert.equal(await row.locator('[data-price=official]').count(),0);assert.deepEqual(errors,[]);
});
