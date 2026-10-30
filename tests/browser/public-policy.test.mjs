import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createBrowserFixture } from '../helpers/browser.mjs';
import { publicCatalogFixture } from '../fixtures/public-catalog.mjs';

const fixture = createBrowserFixture();
before(() => fixture.start()); after(() => fixture.stop());
const locales = [['', 'en'], ['/zh', 'zh-CN'], ['/zh-hant', 'zh-TW'], ['/ja', 'ja'], ['/ko', 'ko'], ['/es', 'es']];
const agreement = () => ({ version: 'synthetic-terms-v1', h1: 'Original service agreement', lede: 'Original configured introduction', updated: '2026-10-30', clauses: [{ title: 'Original clause', paragraphs: ['Original configured terms.', '&lt;img src=x onerror=window.policyInjected=1&gt;'] }], ui: {} });
const original = page => page.locator('[data-policy-original]:not([hidden])').waitFor();
async function capture(page, name) { await mkdir('test-results/package-audit', { recursive: true }); await page.screenshot({ path: `test-results/package-audit/${name}.png`, fullPage: true, animations: 'disabled' }); }

for (const [prefix, language] of locales) test(`public original policies, accurate privacy and working guide links ${language}`, async t => {
  const { context, page, base, errors } = await fixture.setup(t, { viewport: { width: 320, height: 900 } });
  await context.addCookies([{ name: 'fells_user', value: 'synthetic-cookie-not-needed-for-public-agreement', url: base }]);
  const reads = [];
  await context.route('**/api/app/agreement?*', route => { reads.push({ url: route.request().url(), headers: route.request().headers() }); return route.fulfill({ json: agreement() }); });
  await context.route('**/api/app/public/catalog', route => route.fulfill({ json: publicCatalogFixture() }));
  for (const policy of ['terms', 'privacy', 'refund']) {
    const response = await page.goto(`${base}${prefix}/${policy}/`); assert.equal(response.status(), 200); await original(page);
    assert.equal(await page.locator('html').getAttribute('lang'), language);
    assert.equal(await page.locator('[data-policy-title]').innerText(), 'Original service agreement', 'Configured original remains untranslated');
    assert.equal(await page.locator('[data-policy-original]').getAttribute('lang'), language.startsWith('zh') ? 'zh-CN' : 'en');
    assert.match(await page.locator('[data-policy-version]').innerText(), /synthetic-terms-v1/);
    assert.match(await page.locator('[data-policy-text]').innerText(), /Original configured terms/);
    assert.equal(await page.locator('[data-policy-original] img,[data-policy-original] script').count(), 0);
    assert.equal(await page.evaluate(() => window.policyInjected), undefined);
    for (const target of ['terms', 'privacy', 'refund']) assert.equal(await page.locator(`footer .policies a[href="${prefix}/${target}/"]`).count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    if (prefix === '/zh' && policy === 'privacy') await capture(page, 'public-privacy-zh-320');
  }
  assert.equal(reads.length, 3);
  for (const read of reads) {
    assert.equal(read.headers.cookie, undefined); assert.equal(read.headers.authorization, undefined);
    assert.equal(read.headers['accept-language'], language);
    assert.equal(new URL(read.url).searchParams.get('lang'), language.startsWith('zh') ? 'zh-CN' : 'en');
  }
  await page.goto(`${base}${prefix}/`);
  assert.doesNotMatch(await page.locator('main').innerText(), /Prompts and replies are not stored|Nothing retained|不留存对话|不留存對話|やり取りは保存しません|대화 내용 저장 없음|No guardamos nada/);
  await page.locator('#blog .post').first().click();
  await page.waitForURL(url => url.pathname === `${prefix}/blog/` && url.hash === '#guide-0');
  assert.ok((await page.locator('#guide-0').innerText()).length > 80);
  assert.doesNotMatch(await page.locator('main').innerText(), /GPT-6\.1|Grok 4\.7|Fable 5\.1|Sonnet 5\.5/);
  await page.goto(`${base}${prefix}/faq/`);
  assert.equal(await page.locator('.list details').count(), 10, 'All languages show the same relevant FAQ set');
  const questions = await page.locator('.list details .q').allTextContents(); assert.equal(new Set(questions).size, 10);
  const answers = await page.locator('.list details p').allTextContents(); assert.equal(new Set(answers).size, 10, 'Different questions do not share an unrelated answer');
  if (prefix === '/zh') {
    await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto(`${base}/zh/developer-api/`); await page.locator('[data-public-catalog-state=ready]').waitFor(); await capture(page, 'public-api-zh-desktop');
  }
  assert.deepEqual(errors, []);
});

for (const bad of ['unavailable', 'malformed', 'empty']) test(`public policies fail clearly and retry the actual agreement: ${bad}`, async t => {
  const { context, page, base, errors } = await fixture.setup(t); let valid = false;
  await context.route('**/api/app/agreement?*', route => route.fulfill({ status: bad === 'unavailable' && !valid ? 503 : 200, json: valid ? agreement() : bad === 'empty' ? { ...agreement(), clauses: [] } : { error: 'Synthetic unavailable agreement' } }));
  await page.goto(base + '/ja/refund/'); await page.locator('[data-policy-retry]:not([hidden])').waitFor();
  assert.equal(await page.locator('[data-policy-original]').isVisible(), false); assert.equal(await page.locator('[data-policy-agreement]').getAttribute('aria-busy'), 'false');
  valid = true; await page.locator('[data-policy-retry]').click(); await original(page); assert.deepEqual(errors, []);
});

test('public agreement deadline ends loading; no JavaScript provides original-terms contact', async t => {
  const { context, page, base, errors } = await fixture.setup(t);
  await page.addInitScript(() => { const set = window.setTimeout.bind(window); window.setTimeout = (callback, delay, ...args) => set(callback, delay === 8000 ? 30 : delay, ...args); });
  let release; const deferred = new Promise(resolve => { release = resolve; });
  await context.route('**/api/app/agreement?*', async route => { await deferred; try { await route.fulfill({ json: agreement() }); } catch { /* Deadline cancels this synthetic read. */ } });
  try { await page.goto(base + '/es/terms/'); await page.locator('[data-policy-retry]:not([hidden])').waitFor(); assert.equal(await page.locator('[data-policy-agreement]').getAttribute('aria-busy'), 'false'); }
  finally { release(); }
  const plain = await fixture.setup(t, { javaScriptEnabled: false, viewport: { width: 320, height: 900 } });
  const response = await plain.page.goto(plain.base + '/zh/refund/'); assert.equal(response.status(), 200);
  assert.ok(await plain.page.locator('main a[href^="mailto:"]').count()); assert.equal(await plain.page.locator('[data-policy-original]').isVisible(), false);
  assert.doesNotMatch(await plain.page.locator('main').innerText(), /正在读取当前条款|Loading the current agreement/); assert.deepEqual(errors, []); assert.deepEqual(plain.errors, []);
});
