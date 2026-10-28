import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserFixture } from '../helpers/browser.mjs';
import { createAppBackend } from '../helpers/app-backend.mjs';

const fixture = createBrowserFixture();
before(() => fixture.start());
after(() => fixture.stop());
const modules = /\/_astro\/[^/]+\.js(?:\?.*)?$/;

async function assertReadable(page, path) {
  await page.locator('h1').first().waitFor({ state: 'visible' });
  const hidden = await page.locator('.reveal').evaluateAll(elements => elements.filter(element => {
    const rect = element.getBoundingClientRect();
    return rect.top < innerHeight && rect.bottom > 0 && getComputedStyle(element).opacity !== '1';
  }).length);
  assert.equal(hidden, 0, `${path}: content in the current viewport must be readable while external modules are unavailable`);
  if (path.includes('/app/')) {
    const shell = page.locator('[data-app-boot]');
    assert.equal(await shell.isVisible(), true, `${path}: public loading UI renders without the app module`);
    assert.ok((await shell.locator('[role=status]').innerText()).length > 0);
    const rect = await shell.boundingBox();
    const viewport = page.viewportSize();
    assert.ok(rect.width > 250 && rect.x >= 0 && rect.x + rect.width <= viewport.width + 1, `${path}: loading UI fits the viewport`);
  }
}

// The shared fixture defaults to reduced motion, which previously forced hidden
// reveal content visible and masked the failed/slow module regression.
for (const width of [390, 1280]) for (const path of ['/zh/market/', '/zh/app/']) {
  test(`${width}px ${path} paints HTML before delayed modules, including a hard refresh`, async t => {
    const { page, base } = await fixture.setup(t, { viewport: { width, height: 844 }, reducedMotion: 'no-preference' });
    let release;
    let gate = new Promise(resolve => { release = resolve; });
    t.after(() => release());
    await page.route(modules, async route => { await gate; await route.continue(); });
    await page.goto(base + path, { waitUntil: 'commit' });
    await assertReadable(page, path);
    release();
    await page.waitForLoadState('domcontentloaded');
    gate = new Promise(resolve => { release = resolve; });
    await page.reload({ waitUntil: 'commit' });
    await assertReadable(page, path);
    release();
    await page.waitForLoadState('domcontentloaded');
  });

  test(`${width}px ${path} stays readable when modules fail on refresh`, async t => {
    const { page, base } = await fixture.setup(t, { viewport: { width, height: 844 }, reducedMotion: 'no-preference' });
    await page.route(modules, route => route.abort('failed'));
    await page.goto(base + path);
    await assertReadable(page, path);
    await page.reload();
    await assertReadable(page, path);
  });
}

test('all six locales render meaningful app loading and JavaScript guidance with scripting disabled', async t => {
  const { page, base } = await fixture.setup(t, { javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  for (const prefix of ['', '/zh', '/zh-hant', '/ja', '/ko', '/es']) {
    await page.goto(base + prefix + '/app/');
    await assertReadable(page, prefix + '/app/');
    assert.match(await page.locator('noscript').innerText(), /JavaScript/);
    assert.equal(await page.locator('[data-app-boot] a').getAttribute('href'), prefix + '/app/start/');
  }
});

test('all marketing content is visible when JavaScript is disabled', async t => {
  const { page, base } = await fixture.setup(t, { javaScriptEnabled: false, reducedMotion: 'no-preference' });
  await page.goto(base + '/zh/market/');
  const opacities = await page.locator('.reveal').evaluateAll(elements => elements.map(element => getComputedStyle(element).opacity));
  assert.ok(opacities.length > 0);
  assert.ok(opacities.every(opacity => opacity === '1'));
});

test('the loading shell follows a dark system theme before JavaScript or account data arrives', async t => {
  const { page, base } = await fixture.setup(t, { javaScriptEnabled: false, colorScheme: 'dark' });
  await page.goto(base + '/app/');
  assert.equal(await page.locator('#fx').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(13, 14, 16)');
  assert.equal(await page.locator('#fx').getAttribute('data-theme'), null);
});

test('slow account APIs keep the public shell visible until a verified session is ready', async t => {
  const backend = createAppBackend();
  backend.state.preferences.onboarded = true;
  const { context, page, base, errors } = await fixture.setup(t, { reducedMotion: 'no-preference' });
  await backend.install(context);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  await context.route('**/api/app/bootstrap', async route => { await gate; await route.fallback(); });
  await page.goto(base + '/app/');
  await assertReadable(page, '/app/');
  assert.equal(await page.locator('#fx').getAttribute('aria-busy'), 'true');
  assert.equal(await page.locator('#fx .sb').count(), 0, 'private navigation is not fabricated before identity validation');
  release();
  await page.locator('#fx .sb').waitFor();
  assert.equal(await page.locator('[data-app-boot]').count(), 0);
  assert.equal(await page.locator('#fx').getAttribute('aria-busy'), null);
  assert.deepEqual(errors, []);
});

test('an initial API outage has an accessible error and reload recovers the original route', async t => {
  const backend = createAppBackend();
  backend.state.preferences.onboarded = true;
  const { context, page, base, errors } = await fixture.setup(t);
  await backend.install(context);
  const failBootstrap = route => route.fulfill({ status: 503, json: { error: 'Synthetic startup outage' } });
  await context.route('**/api/app/bootstrap', failBootstrap);
  await page.goto(base + '/app/#/api');
  await page.locator('.boot-failure [role=alert]').waitFor();
  assert.equal(await page.locator('.boot-failure [role=alert]').innerText(), 'Synthetic startup outage');
  assert.equal(await page.locator('#fx').getAttribute('aria-busy'), null);
  await context.unroute('**/api/app/bootstrap', failBootstrap);
  await page.locator('.boot-failure button').click();
  await page.locator('#fx .sb').waitFor();
  assert.equal(new URL(page.url()).hash, '#/api');
  assert.deepEqual(errors, []);
});

for (const observer of ['unavailable', 'throws']) test(`decorative observer ${observer} leaves all static content visible`, async t => {
  const { page, base, errors } = await fixture.setup(t, { reducedMotion: 'no-preference' });
  await page.addInitScript(mode => {
    window.IntersectionObserver = mode === 'unavailable' ? undefined : class { constructor() { throw new Error('Synthetic unsupported observer'); } };
  }, observer);
  await page.goto(base + '/zh/market/');
  await assertReadable(page, '/zh/market/');
  assert.deepEqual(errors, []);
});

test('a delayed reveal module never hides content already visible in a scrolled viewport', async t => {
  const { page, base, errors } = await fixture.setup(t, { reducedMotion: 'no-preference' });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  await page.route(modules, async route => { await gate; await route.continue(); });
  await page.goto(base + '/zh/market/', { waitUntil: 'commit' });
  const content = page.locator('.reveal').first();
  await content.scrollIntoViewIfNeeded();
  release();
  await page.waitForLoadState('domcontentloaded');
  assert.equal(await content.evaluate(element => getComputedStyle(element).opacity), '1');
  assert.deepEqual(errors, []);
});
