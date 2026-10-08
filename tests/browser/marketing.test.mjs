import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tokenPlans, FX } from '../../src/data/catalog.ts';
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

test('the landing agent deck supports arrows, dragging, reduced motion and IME-safe prompt submission', async t => {
  const { page, base, errors } = await fixture.setup(t);
  await page.goto(base + '/');
  const selected = () => page.locator('[data-card][aria-selected=true]');
  const first = await selected().getAttribute('data-name');
  await page.locator('[data-next]').click();
  const next = await selected().getAttribute('data-name');
  assert.notEqual(next, first);
  assert.ok((await page.locator('[data-prompt]').getAttribute('placeholder')).includes(next));
  await page.locator('[data-deck]').focus();
  await page.keyboard.press('ArrowLeft');
  assert.equal(await selected().getAttribute('data-name'), first);
  const rect = await page.locator('[data-deck]').boundingBox();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width / 2 - 100, rect.y + rect.height / 2);
  await page.mouse.up();
  assert.equal(await selected().getAttribute('data-name'), next);
  const prompt = page.locator('[data-prompt]');
  await prompt.fill('A composed draft');
  await prompt.dispatchEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true });
  assert.equal(await page.locator('[data-toast]').evaluate(element => element.classList.contains('show')), false);
  await prompt.press('Shift+Enter');
  assert.match(await prompt.inputValue(), /\n/);
  await prompt.press('Enter');
  assert.equal(await page.locator('[data-toast]').evaluate(element => element.classList.contains('show')), true);
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
  const filter = page.locator('[data-provider-filter=Anthropic]');
  await filter.click();
  assert.ok(await page.locator('.mcard:not([hidden])').count() > 0);
  assert.equal(await page.locator('.mcard:not([hidden]):not([data-provider=Anthropic])').count(), 0);
  await page.goto(base + '/');
  const payg = page.locator('[data-payg]');
  await payg.locator('[data-filter=Anthropic]').click();
  assert.ok(await payg.locator('tbody tr:not([hidden])').count() > 0);
  assert.equal(await payg.locator('tbody tr:not([hidden]):not([data-provider=Anthropic])').count(), 0);
  await payg.locator('[data-filter=Anthropic]').press('Home');
  assert.equal(await payg.locator('[data-filter=""]').getAttribute('aria-selected'), 'true');
  assert.equal(await payg.locator('tbody tr[hidden]').count(), 0);
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

test('marketing agent selection updates the composer in every locale', async t => {
  const { page, base, errors } = await fixture.setup(t);
  for (const [prefix] of locales) {
    await page.goto(base + prefix + '/agents/');
    const picker = page.locator('[data-picker]');
    const options = picker.locator('[data-agent]');
    for (let index = 0; index < await options.count(); index++) {
      const option = options.nth(index), name = await option.getAttribute('data-agent');
      await option.click();
      assert.equal(await picker.locator('[aria-checked=true]').count(), 1);
      assert.equal(await option.getAttribute('aria-checked'), 'true');
      assert.ok((await picker.locator('[data-composer]').innerText()).includes(name));
    }
  }
  assert.deepEqual(errors, []);
});

test('all localized marketing routes expose matching language, canonical and hreflang metadata', async t => {
  const { context, page, base, errors } = await fixture.setup(t);
  await page.goto(base + '/');
  const slugs = ['', 'market', 'developer-api', 'workspace', 'agents', 'security', 'faq', 'blog', 'checkout', ...['codex', 'claude-code', 'grok-build', 'opencode', 'kimi'].map(agent => 'agents/' + agent)];
  for (const [prefix, lang] of locales) {
    for (const slug of slugs) {
      const path = prefix + '/' + (slug ? slug + '/' : '');
      const response = await context.request.get(base + path);
      assert.equal(response.status(), 200, path);
      const result = await page.evaluate(html => {
        const document = new DOMParser().parseFromString(html, 'text/html');
        return { lang: document.documentElement.lang, canonical: document.querySelector('[rel=canonical]')?.getAttribute('href'), og: document.querySelector('[property="og:url"]')?.getAttribute('content'), alternates: Array.from(document.querySelectorAll('[rel=alternate][hreflang]')).map(element => [element.getAttribute('hreflang'), element.getAttribute('href')]), title: document.title, description: document.querySelector('[name=description]')?.getAttribute('content') };
      }, await response.text());
      assert.equal(result.lang, lang, path);
      assert.equal(new URL(result.canonical).pathname.replace(/\/$/, ''), path.replace(/\/$/, ''), path);
      assert.equal(result.og, result.canonical, path);
      assert.equal(result.alternates.length, 7, path);
      for (const [alternatePrefix, , code] of locales) {
        const alternate = result.alternates.find(([locale]) => locale === code);
        assert.equal(new URL(alternate[1]).pathname.replace(/\/$/, ''), (alternatePrefix + '/' + slug).replace(/\/$/, ''), path + ': ' + code);
      }
      assert.doesNotMatch(result.title + result.description, /\{(?:pct|zhe|trial|tp|gp|off|fx)\}/, path);
    }
    await page.goto(base + prefix + '/');
    const prices = await page.locator('#plans .tier .price .amt').allTextContents();
    const quotas = await page.locator('#plans .tier .quota > b').allTextContents();
    const official = await page.locator('#plans .tier .anchor s').allTextContents();
    assert.deepEqual(prices, tokenPlans.map(plan => '¥' + plan.price.toLocaleString('en-US')));
    assert.deepEqual(quotas, tokenPlans.map(plan => '$' + plan.quota.toLocaleString('en-US')));
    assert.deepEqual(official, tokenPlans.map(plan => '¥' + (plan.quota * FX).toLocaleString('en-US')));
    assert.doesNotMatch(await page.locator('#plans').innerText(), /\{(?:pct|zhe|off|trial|trialQuota|tp|gp|fx|days)\}/);
    for (const plan of tokenPlans) assert.equal(await page.locator(`#plans a[href="${prefix}/checkout?plan=${plan.id}"]`).count(), 1);
  }
  assert.deepEqual(errors, []);
});

test('theme previews support mobile menus, sheets, pairings, shelves and switcher focus restoration', async t => {
  const { page, base, errors } = await fixture.setup(t, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.goto(base + '/themes/apple-launch/');
  const menu = page.locator('[data-nav-toggle]');
  await menu.click();
  assert.equal(await menu.getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Escape');
  assert.equal(await menu.getAttribute('aria-expanded'), 'false');
  await page.locator('[data-sheet=real]').click();
  await page.locator('#sheet').waitFor({ state: 'visible' });
  assert.ok((await page.locator('#sheet-copy').innerText()).length > 20);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#sheet').isVisible(), false);
  await page.locator('[data-pair="1"]').click();
  assert.equal(await page.locator('[data-pair="1"]').getAttribute('aria-expanded'), 'true');
  assert.equal(await page.locator('[data-pair="0"]').getAttribute('aria-expanded'), 'false');
  const track = page.locator('[data-scroller] .track').first();
  await track.focus();
  await track.press('End');
  await page.waitForFunction(() => document.querySelector('[data-scroller] .track').scrollLeft > 0);
  await track.press('Home');
  await page.waitForFunction(() => document.querySelector('[data-scroller] .track').scrollLeft <= 1);
  const switcher = page.locator('[data-theme-switcher]');
  await switcher.locator('summary').click();
  await switcher.locator('a[href="/themes/synara/"]').focus();
  await page.keyboard.press('Escape');
  assert.equal(await switcher.evaluate(element => element.open), false);
  assert.equal(await switcher.locator('summary').evaluate(element => document.activeElement === element), true);
  await switcher.locator('summary').click();
  await switcher.locator('a[href="/themes/synara/"]').click();
  await page.waitForURL(/\/themes\/synara\/?$/);
  const theme = page.locator('[data-theme-toggle]');
  const previous = await page.locator('html').getAttribute('data-theme');
  await theme.click();
  assert.notEqual(await page.locator('html').getAttribute('data-theme'), previous);
  await page.locator('[data-menu]').click();
  assert.equal(await page.locator('[data-menu]').getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-menu]').getAttribute('aria-expanded'), 'false');
  await page.locator('[data-theme-switcher] summary').click();
  await page.locator('h1').click();
  assert.equal(await page.locator('[data-theme-switcher]').evaluate(element => element.open), false);
  assert.deepEqual(errors, []);
});

test('Apple preview shelves adapt to resizing and detail sheets restore their trigger', async t => {
  const { page, base, errors } = await fixture.setup(t);
  await page.goto(base + '/themes/apple-launch/');
  await page.setViewportSize({ width: 390, height: 844 });
  const track = page.locator('[data-scroller] .track').first();
  await track.waitFor();
  await page.waitForFunction(() => document.querySelector('[data-scroller] .track').tabIndex === 0);
  await track.focus();
  await track.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('[data-scroller] .track').scrollLeft > 0);
  await track.press('Home');
  await page.waitForFunction(() => document.querySelector('[data-scroller] .track').scrollLeft <= 1);
  const trigger = page.locator('[data-sheet=pure]');
  await trigger.click();
  await page.locator('#sheet').waitFor({ state: 'visible' });
  await page.locator('#sheet [data-close]').click();
  assert.equal(await page.locator('#sheet').isVisible(), false);
  assert.equal(await trigger.evaluate(element => document.activeElement === element), true);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForFunction(() => {
    const track = document.querySelector('[data-scroller] .track');
    return track.tabIndex === (track.scrollWidth - track.clientWidth > 2 ? 0 : -1);
  });
  assert.deepEqual(errors, []);
});
