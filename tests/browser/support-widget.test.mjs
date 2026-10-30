import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserFixture } from '../helpers/browser.mjs';

const fixture = createBrowserFixture();
before(() => fixture.start());
after(() => fixture.stop());
const locales = [ ['', ''], ['/zh', '/zh'], ['/zh-hant', '/zh-hant'], ['/ja', '/ja'], ['/ko', '/ko'], ['/es', '/es'] ];

test('public customer widget presents a localized sign-in prompt without a real session', async t => {
  for (const [locale, signInPrefix] of locales) {
    const { context, page, base, portal, errors } = await fixture.setup(t, { viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true });
    assert.equal(portal, 'support', 'operator pages use a fixed console-only route independent of legacy build configuration');
    await context.route('**/api/app/bootstrap', route => route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"unauthorized"}' }));
    await page.goto(base + (locale || '/') );
    const launcher = page.locator('[data-support-open]');
    await launcher.waitFor({ state: 'visible' });
    await launcher.focus();
    await launcher.press('Enter');
    await page.locator('#support-panel').waitFor({ state: 'visible' });
    for (const selector of ['#support-panel', '[data-support-form]']) {
      const size = await page.locator(selector).evaluate(element => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, overflow: element.scrollWidth - element.clientWidth, width: innerWidth, height: innerHeight };
      });
      assert.ok(size.left >= -1 && size.right <= size.width + 1 && size.top >= -1 && size.bottom <= size.height + 1 && size.overflow <= 1, `${locale} ${selector}: ${JSON.stringify(size)}`);
    }
    const signIn = page.locator('#support-panel .support-greeting a.support-primary-button');
    assert.equal(await page.locator('#support-panel a[href="mailto:hello@fells.dev"]').count(),1);
    assert.equal(await page.locator('[data-support-availability-text]').first().innerText(),await signIn.innerText(),'signed-out state must not wait indefinitely for protected presence');
    assert.equal(new URL(await signIn.getAttribute('href'), base).pathname, `${signInPrefix}/app/start`);
    for (const selector of ['[data-support-close]', '[data-support-send]', '.support-attach']) {
      const rect = await page.locator(selector).boundingBox();
      assert.ok(rect.width >= 44 && rect.height >= 44, `${locale} ${selector} touch target`);
    }
    assert.equal(await page.locator('[data-support-text]').isDisabled(), true);
    assert.equal(await page.locator('[data-support-file]').isDisabled(), true);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

for (const trigger of ['event', 'button']) test(`lazy widget preserves the first ${trigger} purchase context while its chunk loads`, async t => {
  const { page, base, errors } = await fixture.setup(t);
  await page.addInitScript(() => { window.requestIdleCallback = () => 1; });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  let requested;
  const chunkRequested = new Promise(resolve => { requested = resolve; });
  await page.route(/\/_astro\/support-widget\.[^/]+\.js$/, async route => {
    requested();
    await gate;
    await route.continue();
  });
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  const intent = { title: 'Customer-confirmed reference purchase', product: 'token_plan', poolId: 11, amountMicro: 88000000 };
  if (trigger === 'event') await page.evaluate(detail => document.dispatchEvent(new CustomEvent('fells:support-open', { detail })), intent);
  else {
    await page.evaluate(detail => {
      const button = document.createElement('button');
      button.dataset.openCustomerSupport = '';
      button.dataset.supportTitle = detail.title;
      button.dataset.supportProduct = detail.product;
      button.dataset.supportPool = String(detail.poolId);
      button.dataset.supportAmount = String(detail.amountMicro);
      document.body.append(button);
      button.click();
    }, intent);
  }
  let chunkTimeout;
  await Promise.race([chunkRequested, new Promise((_, reject) => { chunkTimeout = setTimeout(() => reject(new Error('Deferred support chunk was not requested')), 8000); })]).finally(() => clearTimeout(chunkTimeout));
  release();
  await page.locator('#support-panel').waitFor({ state: 'visible' });
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('fells.support.purchase.v1')));
  for (const [name, value] of Object.entries(intent)) assert.equal(saved[name], value, name);
  assert.deepEqual(errors, []);
});

test('a failed lazy support chunk leaves an explicit public email contact', async t => {
  const {context,page,base,errors} = await fixture.setup(t);
  await page.addInitScript(() => { window.requestIdleCallback = () => 1; });
  await context.route(/\/_astro\/support-widget\.[^/]+\.js$/, route => route.abort());
  await page.goto(base + '/zh/', {waitUntil:'domcontentloaded'});
  const trigger = page.locator('[data-open-customer-support]').first();
  await trigger.click();
  await page.locator('#support-load-fallback').waitFor({state:'visible'});
  assert.equal(await page.locator('#support-load-fallback a').getAttribute('href'),'mailto:hello@fells.dev');
  await page.locator('[data-support-fallback-close]').click();
  await page.locator('#support-load-fallback').waitFor({state:'hidden'});
  assert.deepEqual(errors,[]);
});
