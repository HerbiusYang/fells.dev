import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserFixture } from '../helpers/browser.mjs';

const fixture = createBrowserFixture();
before(() => fixture.start());
after(() => fixture.stop());
const locales = [['', 'en', 'en'], ['/zh', 'zh-CN', 'zh-CN'], ['/zh-hant', 'zh-TW', 'zh-TW'], ['/ja', 'ja', 'ja'], ['/ko', 'ko', 'ko'], ['/es', 'es', 'es']];

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
test('market and PAYG filters update visible content and keyboard tab selection', async t => {
  const { page, base, errors } = await fixture.setup(t);
  await page.goto(base + '/market/');
  await page.locator('[data-set-kind=payg]').click();
  assert.equal(await page.locator('[data-group=sub]').isVisible(), false);
  assert.equal(await page.locator('[data-group=payg]').isVisible(), true);
  await page.locator('[data-set-view=compare]').click();
  assert.ok(await page.locator('.compare tbody tr:not([hidden])').count() > 0);
  assert.equal(await page.locator('.compare tbody tr[data-kind=sub]:not([hidden])').count(), 0);
  await page.locator('[data-set-tab=models]').click();
  // Only Anthropic models are live, so the models tab has no provider filter.
  assert.equal(await page.locator('[data-provider-filter]').count(), 0);
  assert.ok(await page.locator('.mcard:not([hidden])').count() > 0);
  assert.equal(await page.locator('.mcard:not([data-provider=Anthropic])').count(), 0);
  assert.ok(await page.locator('.mcard dl .over').count() > 0, 'tiered Haiku price shows on the market page');
  await page.goto(base + '/');
  // Only Anthropic models are live, so the table lists them without provider filters.
  const payg = page.locator('[data-payg]');
  assert.ok(await payg.locator('tbody tr:not([hidden])').count() > 0);
  assert.equal(await payg.locator('tbody tr:not([data-provider=Anthropic])').count(), 0);
  assert.equal(await payg.locator('[data-filter]').count(), 0);
  assert.equal(await payg.locator('tbody tr[hidden]').count(), 0);
  assert.deepEqual(errors, []);
});

test('all six marketing locales show backend-matching debit rates, whole-request long tier, 30-day plans and paused referral status', async t => {
  const { page, base, errors } = await fixture.setup(t);
  const paused = [/paused/i, /暂未开放/, /暫未開放/, /休止中/, /중단/, /pausadas/];
  const wholeRequest = [/entire request/, /整笔/, /整筆/, /リクエスト全体/, /요청 전체/, /toda la solicitud/];
  for (const [i, [prefix]] of locales.entries()) {
    await page.goto(base + prefix + '/market/');
    const rates = await page.locator('.mcard').evaluateAll(cards => Object.fromEntries(cards.map(card => [card.querySelector('h3')?.textContent.trim(), [...card.querySelectorAll('dd b')].map(node => node.textContent.trim())])));
    assert.deepEqual(rates['Claude Opus 5.5'], ['$4.00', '$20.00']);
    assert.deepEqual(rates['Claude Sonnet 5.5'], ['$2.00', '$10.00']);
    assert.deepEqual(rates['Claude Haiku 5.5'], ['$0.10', '$0.50', '$0.50', '$2.50']);
    assert.match(await page.locator('.mcard:has(h3:text("Claude Haiku 5.5")) .over').textContent(), wholeRequest[i]);
    assert.match(await page.locator('[data-group=sub]').innerText(), /¥1,?288/);
    assert.match(await page.locator('#plans').innerText(), /30/);
    await page.goto(base + prefix + '/');
    const referral = await page.locator('#referral').innerText();
    assert.match(referral, paused[i]);
    assert.match(referral, /Token Plan/);
    assert.doesNotMatch(referral, /¥\s*(?:99|100)|365/);
    await page.goto(base + prefix + '/developer-api/');
    assert.match(await page.locator('main').innerText(), /Token Plan/);
  }
  assert.deepEqual(errors, []);
});

test('developer installation/configuration tabs, clipboard and blog categories execute their actions', async t => {
  const { page, base, errors } = await fixture.setup(t);
  await page.addInitScript(() => { window.copied = []; navigator.clipboard.writeText = async value => window.copied.push(value); });
  await page.goto(base + '/developer-api/');
  const client = page.locator('[data-client]').first();
  await client.locator('[data-os="1"]').click();
  assert.equal(await client.locator('[data-os-pane="1"]').isVisible(), true);
  assert.equal(await client.locator('[data-os-pane="0"]').isVisible(), false);
  const cfg = page.locator('[data-cfg]');
  for (const id of ['claude', 'opencode', 'codex']) {
    await cfg.locator(`[data-cfg-tab=${id}]`).click();
    const pane = cfg.locator(`[data-cfg-pane=${id}]`);
    assert.equal(await pane.isVisible(), true);
    const text = await pane.locator('pre').innerText();
    await pane.locator('[data-copy]').click();
    assert.equal(await page.evaluate(() => window.copied.at(-1)), text);
  }
  const setup = page.locator('[data-setup]');
  await setup.locator('summary').click();
  await page.waitForFunction(() => document.querySelector('[data-setup-label]').textContent === document.querySelector('[data-setup]').dataset.show);
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
  await page.goto(base + '/');
  const slugs = ['', 'market', 'developer-api', 'security', 'faq', 'blog', 'checkout'];
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
    assert.ok(await page.locator('#plans article.tier').count() >= 4);
    assert.equal(await page.locator('#plans article.tier:not(:has([data-purchase-market]))').count(), 0, 'every plan card enters the customer marketplace');
    assert.equal(await page.locator('#plans a[href*="/checkout"]').count(), 0);
    assert.doesNotMatch(await page.locator('#plans').innerText(), /\{(?:pct|zhe|off|trial|trialQuota|tp|gp|fx|days)\}/);
  }
  assert.deepEqual(errors, []);
});
