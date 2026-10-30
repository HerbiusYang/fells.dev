import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserFixture } from '../helpers/browser.mjs';
import { publicCatalogFixture } from '../fixtures/public-catalog.mjs';

const fixture = createBrowserFixture();
before(() => fixture.start());
after(() => fixture.stop());
const locales = [['', 'en', 'en'], ['/zh', 'zh-CN', 'zh-CN'], ['/zh-hant', 'zh-TW', 'zh-TW'], ['/ja', 'ja', 'ja'], ['/ko', 'ko', 'ko'], ['/es', 'es', 'es']];
const installCatalog = context => context.route('**/api/app/public/catalog', route => route.fulfill({ json: publicCatalogFixture() }));
const catalogReady = page => page.waitForFunction(() => document.querySelectorAll('[data-public-catalog-state=ready]').length === 3);

test('mobile navigation closes on Escape/outside click and language switching preserves the page', async t => {
  const { page, base, errors } = await fixture.setup(t, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.goto(base + '/zh/market/');
  const burger = page.locator('[data-burger]');
  await burger.click();
  assert.equal(await burger.getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Escape');
  assert.equal(await burger.getAttribute('aria-expanded'), 'false');
  assert.equal(await burger.evaluate(element => document.activeElement === element), true);
  await burger.click();
  await page.locator('h1').click();
  assert.equal(await burger.getAttribute('aria-expanded'), 'false');
  await page.locator('[data-lang] summary').click();
  await page.locator('[data-lang] a[hreflang=ja]').click();
  await page.waitForURL(/\/ja\/market\/?$/);
  assert.equal(await page.locator('html').getAttribute('lang'), 'ja');
  await page.locator('[data-lang] summary').click();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-lang]').evaluate(element => element.open), false);
  assert.deepEqual(errors, []);
});
test('market category links and home prices use the same current sales catalog', async t => {
  const { context, page, base, errors } = await fixture.setup(t);
  await installCatalog(context);
  await page.goto(base + '/market/'); await catalogReady(page);
  assert.equal(await page.locator('.catalog-nav a').count(), 3);
  await page.locator('.catalog-nav a[href="#models"]').click();
  await page.waitForURL(url => url.hash === '#models');
  assert.equal(await page.locator('[data-public-model]').count(), 4);
  assert.equal(await page.locator('[data-public-model="price-only/unoffered"]').count(), 0);
  assert.equal(await page.locator('[data-public-model-tier]').count(), 1);
  await page.goto(base + '/'); await catalogReady(page);
  assert.equal(await page.locator('#payg [data-public-model]').count(), 4);
  assert.equal(await page.locator('#plans [data-public-product]').count(), 2);
  assert.equal(await page.locator('#group [data-public-product]').count(), 2);
  assert.deepEqual(errors, []);
});

test('all six marketing locales show current catalog terms and paused referral status', async t => {
  const { context, page, base, errors } = await fixture.setup(t);
  await installCatalog(context);
  const paused = [/paused/i, /暂未开放/, /暫未開放/, /休止中/, /중단/, /pausadas/];
  for (const [i, [prefix]] of locales.entries()) {
    await page.goto(base + prefix + '/market/'); await catalogReady(page);
    assert.match(await page.locator('[data-public-product=live-token]').innerText(), /731/);
    assert.match(await page.locator('[data-public-product=live-trial]').innerText(), /14/);
    assert.match(await page.locator('[data-public-product=current-quarter]').innerText(), /1\/4/);
    assert.equal(await page.locator('[data-public-model="supplied/native"] td').last().innerText(), 'Claude Code');
    await page.goto(base + prefix + '/'); await catalogReady(page);
    const referral = await page.locator('#referral').innerText();
    assert.match(referral, paused[i]);
    assert.match(referral, /Token Plan/);
    assert.doesNotMatch(referral, /¥\s*(?:99|100)|365/);
    await page.goto(base + prefix + '/developer-api/');
    assert.match(await page.locator('main').innerText(), /Token Plan/);
  }
  assert.deepEqual(errors, []);
});

test('developer account guide and blog categories lead to current information', async t => {
  const { context, page, base, errors } = await fixture.setup(t);
  await installCatalog(context);
  await page.goto(base + '/developer-api/');
  await page.locator('[data-public-catalog-state=ready]').waitFor();
  assert.equal(await page.locator('[data-public-account-guide]').getAttribute('href'), '/app/#/api');
  assert.equal(await page.locator('[data-public-model="supplied/native"] td').last().innerText(), 'Claude Code');
  assert.equal(await page.locator('[data-public-model="price-only/unoffered"]').count(), 0);
  await page.goto(base + '/blog/');
  await page.locator('[data-cat=models]').click();
  assert.ok(await page.locator('[data-section=models]:not([hidden])').count() > 0);
  assert.equal(await page.locator('[data-section]:not([data-section=models]):not([hidden])').count(), 0);
  await page.locator('[data-cat=""]').click();
  assert.equal(await page.locator('[data-section][hidden]').count(), 0);
  assert.deepEqual(errors, []);
});

test('all localized marketing routes expose matching locale metadata while checkout stays unindexed', async t => {
  const { context, page, base, errors } = await fixture.setup(t);
  await installCatalog(context);
  await page.goto(base + '/');
  const slugs = ['', 'market', 'developer-api', 'security', 'faq', 'blog', 'terms', 'privacy', 'refund', 'checkout'];
  for (const [prefix, lang] of locales) {
    for (const slug of slugs) {
      const path = prefix + '/' + (slug ? slug + '/' : '');
      const response = await context.request.get(base + path);
      assert.equal(response.status(), 200, path);
      const result = await page.evaluate(html => {
        const document = new DOMParser().parseFromString(html, 'text/html');
        return { lang: document.documentElement.lang, robots: document.querySelector('[name=robots]')?.getAttribute('content'), canonical: document.querySelector('[rel=canonical]')?.getAttribute('href'), og: document.querySelector('[property="og:url"]')?.getAttribute('content'), alternates: Array.from(document.querySelectorAll('[rel=alternate][hreflang]')).map(element => [element.getAttribute('hreflang'), element.getAttribute('href')]), title: document.title, description: document.querySelector('[name=description]')?.getAttribute('content') };
      }, await response.text());
      assert.equal(result.lang, lang, path);
      if (slug === 'checkout') {
        assert.match(result.robots, /noindex/, path);
        assert.equal(result.canonical, undefined, path);
        assert.equal(result.alternates.length, 0, path);
      } else {
        assert.equal(new URL(result.canonical).pathname.replace(/\/$/, ''), path.replace(/\/$/, ''), path);
        assert.equal(result.og, result.canonical, path);
        assert.equal(result.alternates.length, 7, path);
        for (const [alternatePrefix, , code] of locales) {
          const alternate = result.alternates.find(([locale]) => locale === code);
          assert.equal(new URL(alternate[1]).pathname.replace(/\/$/, ''), (alternatePrefix + '/' + slug).replace(/\/$/, ''), path + ': ' + code);
        }
      }
      assert.doesNotMatch(result.title + result.description, /\{(?:pct|zhe|trial|tp|gp|off|fx)\}/, path);
    }
    await page.goto(base + prefix + '/');
    await catalogReady(page);
    assert.equal(await page.locator('#plans [data-public-product]').count(), 2);
    assert.equal(await page.locator('#plans [data-public-product]:not(:has([data-purchase-market]))').count(), 0, 'every plan card enters the customer marketplace');
    assert.equal(await page.locator('#plans a[href*="/checkout"]').count(), 0);
    assert.doesNotMatch(await page.locator('#plans').innerText(), /\{(?:pct|zhe|off|trial|trialQuota|tp|gp|fx|days)\}/);
  }
  assert.deepEqual(errors, []);
});
