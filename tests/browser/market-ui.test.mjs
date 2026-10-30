import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createBrowserFixture } from '../helpers/browser.mjs';
import { createAppBackend } from '../helpers/app-backend.mjs';

const fixture = createBrowserFixture();
before(() => fixture.start());
after(() => fixture.stop());

// Deliberately different from the static marketing catalog: the account API is
// the authority for availability, names, price, quota and purchase context.
const tokenPlans = {
  plans: [
    { code: 'orbit-trial', name: 'Orbit 新客体验', enabled: true, new_user_only: true, price_micro: 79000000, quota_usd_micro: 125000000, burst_usd_micro: 125000000, period_days: 14 },
    { code: 'orbit-starter', name: 'Orbit Starter', enabled: true, new_user_only: false, price_micro: 680000000, quota_usd_micro: 750000000, burst_usd_micro: 1500000000, period_days: 30 },
    { code: 'orbit-builder', name: 'Orbit Builder', enabled: true, new_user_only: false, price_micro: 1260000000, quota_usd_micro: 1500000000, burst_usd_micro: 3000000000, period_days: 30 },
    { code: 'orbit-studio', name: 'Orbit Studio', enabled: true, new_user_only: false, price_micro: 2200000000, quota_usd_micro: 3000000000, burst_usd_micro: 6000000000, period_days: 30 },
    { code: 'hidden-plan', name: 'Disabled secret plan', enabled: false, new_user_only: false, price_micro: 1000000, quota_usd_micro: 999000000, period_days: 30 },
  ],
  api_keys_will_enable: false,
  current: {
    name: 'Current Orbit', plan_code: 'current-orbit', period_end: 1900000000,
    remaining_guaranteed_usd_micro: 350000000, quota_usd_micro: 750000000,
    remaining_burst_usd_micro: 500000000, burst_usd_micro: 1500000000, burst_allowed: true,
    queued: { plan_code: 'queued-orbit', period_start: 1900000000, period_end: 1902592000 },
  },
};
for(const plan of tokenPlans.plans) { plan.terms_hash='a'.repeat(64); plan.period='month'; }
const subscriptions = {
  plans: [
    { pool_id: 81, name: 'Orbit Max · 5×', blurb: '四分之一份额 · 适合设计协作', price_micro: 450000000, period_days: 30, tier: 4, multiplier: 5, free: 0, capacity: 4 },
    { pool_id: 82, name: 'Orbit Max · 10×', blurb: '二分之一份额 · 适合高频开发', price_micro: 850000000, period_days: 30, tier: 2, multiplier: 10, free: 0, capacity: 2, held: true },
  ],
  preferred_ride_mode: 'monthly',
  rides: [
    { pool_id: 81, pool_name: 'Current Monthly', tier: 4, expires_at: 1900000000, seated: true, current: true },
    { pool_id: 82, pool_name: 'Next Monthly', tier: 2, expires_at: 1900000000, seated: false, current: false },
  ],
};
const catalog = {
  models: [
    { model: 'orbit-opus', display_name: 'Orbit Opus', protocols: ['anthropic'], list_priced: true, usd_in: 4500000, usd_out: 22500000 },
    { model: 'orbit-reasoning', display_name: 'Orbit Reasoning', protocols: ['openai'], list_priced: true, usd_in: 2750000, usd_out: 13750000 },
    { model: 'custom-unquoted', display_name: 'Custom Unquoted', protocols: ['openai'], list_priced: false, usd_in: 0, usd_out: 0 },
  ],
};
for (const model of catalog.models) {
  model.offered = true;
  model.routable = true;
  model.formats = ['openai-completions'];
  model.client_formats = { api: ['openai-completions'], claude_code: [], web_chat: [] };
}
// References and wire compatibility alone do not constitute a supplied model.
catalog.models.push({model:'unavailable-price-only',display_name:'Unavailable Reference',offered:false,routable:true,list_priced:true,usd_in:100000,usd_out:500000,client_formats:{api:['openai-completions']}});

async function open(t, options = {}) {
  const { theme = 'light', viewport = { width: 1440, height: 1100 }, locale = 'zh', empty = false, failed = false } = options;
  const backend = createAppBackend({
    preferences: { theme, prefs: { agent: '', send: 0 }, notifs: [true, true, true, false], onboarded: true, answers: [[0], [0], [0], [0]], promoClosed: true, sbHidden: false },
    tokenPlans: empty ? { plans: [], current: null } : tokenPlans,
  });
  const session = await fixture.setup(t, { viewport, colorScheme: theme });
  const { context, page, base } = session;
  await backend.install(context);
  await page.addInitScript(() => { window.manualIntents = []; document.addEventListener('fells:support-open', event => { window.manualIntents.push(event.detail); event.stopImmediatePropagation(); }, true); });
  await context.route('**/api/app/catalog', route => route.fulfill({ status: failed ? 503 : 200, json: failed ? { error: 'Market catalog temporarily unavailable' } : empty ? { models: [] } : catalog }));
  await context.route('**/api/app/subscriptions', route => route.fulfill({ status: failed ? 503 : 200, json: failed ? { error: 'Subscriptions temporarily unavailable' } : empty ? { plans: [], rides: [] } : subscriptions }));
  if (failed) await context.route('**/api/app/plans', route => route.fulfill({ status: 503, json: { error: 'Token plans temporarily unavailable' } }));
  await page.goto(base + (locale === 'en' ? '/app/' : `/${locale}/app/`) + '#/billing/market');
  await page.locator('.market-heading').waitFor();
  if (failed) await page.locator('.market-page > .note[role=status]').waitFor();
  else if (empty) await page.waitForFunction(() => document.querySelectorAll('.market-empty').length === 3 && !document.querySelector('.market-page')?.textContent.includes('加载'));
  else await page.locator('.market-model-table tbody tr').filter({ hasText: 'Orbit Opus' }).waitFor();
  return { ...session, backend };
}

const products = page => page.locator('.market-plan, .market-trial, .market-subscription, .market-model-table tbody tr');

test('market renders only enabled API products with separate CNY prices and USD allowances', async t => {
  const { page, errors } = await open(t);
  assert.equal(await page.locator('.market-trial').count(), 1);
  assert.equal(await page.locator('.market-plan').count(), 3);
  assert.equal(await page.locator('.market-subscription').count(), 2);
  assert.equal(await page.locator('.market-model-table tbody tr').count(), 3);
  assert.equal(await page.getByText('Disabled secret plan', { exact: true }).count(), 0);
  assert.equal(await page.getByText('Unavailable Reference', {exact:true}).count(),0);
  assert.equal(await page.locator('.market-trial-price').innerText(), '¥79');
  assert.match(await page.locator('.market-trial-copy').innerText(), /\$125/);
  assert.match(await page.locator('.market-trial-copy').innerText(), /14/);
  const starter = page.locator('.market-plan').filter({ hasText: 'Orbit Starter' });
  assert.match(await starter.locator('.market-plan-price').innerText(), /¥680/);
  assert.match(await starter.locator('.market-plan-quota').innerText(), /\$750/);
  assert.match(await starter.locator('.market-plan-burst').innerText(), /\$1,500/);
  assert.match(await page.locator('.market-plan.is-featured h3').innerText(), /Orbit Studio/);
  const opus = page.locator('.market-model-table tbody tr').filter({ hasText: 'Orbit Opus' });
  assert.deepEqual(await opus.locator('td').allTextContents(), ['$4.50', '$22.50', '开发者 API']);
  const unknown = page.locator('.market-model-table tbody tr').filter({ hasText: 'Custom Unquoted' });
  assert.deepEqual(await unknown.locator('td').allTextContents(), ['—', '—', '开发者 API']);
  assert.equal(await page.locator('.market-page svg path[d=""]').count(), 0, 'marketplace icons must have actual paths');
  assert.equal(await page.locator('.market-page [data-token-plan]').count(), 0, 'usage management has its own destination');
  assert.deepEqual(errors, []);
});

test('search includes every category and preserves the active filter when cleared', async t => {
  const { page, errors } = await open(t);
  const search = page.locator('[data-input=marketQ]');
  await search.fill('Orbit');
  assert.equal(await products(page).count(), 8);
  assert.match(await page.locator('.market-result-count').innerText(), /8/);
  await page.locator('.market-tabs [data-v=subscriptions]').click();
  assert.equal(await page.locator('.market-tabs [data-v=subscriptions]').getAttribute('aria-pressed'), 'true');
  assert.equal(await products(page).count(), 2);
  assert.equal(await page.locator('.market-plan').count(), 0);
  await search.fill('设计协作');
  assert.equal(await products(page).count(), 1, 'search includes the API subscription description');
  assert.match(await products(page).innerText(), /Orbit Max · 5×/);
  await search.fill('not-an-offered-product');
  await page.locator('[data-act=market-clear]').waitFor();
  assert.equal(await products(page).count(), 0);
  await page.locator('[data-act=market-clear]').click();
  assert.equal(await search.inputValue(), '');
  assert.equal(await search.evaluate(input => input === document.activeElement), true);
  assert.equal(await products(page).count(), 2, 'clearing does not leave the chosen category');
  await page.locator('.market-tabs [data-v=tokens]').click();
  await search.fill('orbit-builder');
  assert.equal(await products(page).count(), 1, 'token plan codes are searchable');
  assert.match(await products(page).innerText(), /Orbit Builder/);
  await page.locator('.market-tabs [data-v=models]').click();
  await search.fill('anthropic');
  assert.equal(await products(page).count(), 1, 'model protocols are searchable');
  assert.match(await products(page).innerText(), /Orbit Opus/);
  await search.fill('');
  assert.equal(await products(page).count(), 3);
  await page.locator('.market-tabs [data-v=all]').click();
  assert.equal(await products(page).count(), 9);
  assert.deepEqual(errors, []);
});

test('IME composition keeps the original search input until the final query is committed', async t => {
  const { page, errors } = await open(t);
  const search = page.locator('[data-input=marketQ]');
  await search.focus();
  const original = await search.elementHandle();
  assert.ok(original);
  await original.evaluate(input => {
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
    input.value = '设计';
    input.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: '设计' }));
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: '设计', isComposing: true }));
  });
  assert.equal(await original.evaluate(input => input.isConnected && input === document.querySelector('[data-input=marketQ]')), true,
    'rendering must not replace the native IME composition target');
  assert.equal(await search.inputValue(), '设计');
  assert.equal(await products(page).count(), 9, 'intermediate composition text does not filter products');
  assert.equal(await page.locator('.market-result-count').count(), 0);
  await original.evaluate(input => {
    input.value = '设计协作';
    input.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: '设计协作' }));
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: '设计协作', isComposing: true }));
  });
  assert.equal(await original.evaluate(input => input.isConnected && input === document.activeElement), true);
  assert.equal(await search.inputValue(), '设计协作');
  assert.equal(await products(page).count(), 9);
  await original.evaluate(input => input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '设计协作' })));
  assert.equal(await search.inputValue(), '设计协作');
  assert.equal(await products(page).count(), 1, 'compositionend applies the complete query');
  assert.match(await products(page).innerText(), /Orbit Max · 5×/);
  assert.equal(await search.evaluate(input => input === document.activeElement), true, 'focus returns to the search after filtering');
  await search.fill('Orbit');
  assert.equal(await products(page).count(), 8, 'regular input still filters after composition ends');
  assert.deepEqual(errors, []);
});

test('a delayed catalog updates a focused search without another keystroke', async t => {
  const { context, page, base, errors } = await fixture.setup(t);
  await createAppBackend({
    preferences: { theme: 'light', prefs: { agent: '', send: 0 }, notifs: [true, true, true, false], onboarded: true, answers: [[0], [0], [0], [0]], promoClosed: true, sbHidden: false },
    tokenPlans,
  }).install(context);
  let releaseCatalog;
  const catalogGate = new Promise(resolve => { releaseCatalog = resolve; });
  t.after(() => releaseCatalog());
  await context.route('**/api/app/catalog', async route => {
    await catalogGate;
    await route.fulfill({ json: catalog });
  });
  await context.route('**/api/app/subscriptions', route => route.fulfill({ json: subscriptions }));
  await page.goto(base + '/zh/app/#/billing/market');
  const search = page.locator('[data-input=marketQ]');
  await search.fill('Orbit');
  await search.evaluate(input => input.setSelectionRange(1, 4));
  assert.equal(await page.locator('.market-model-table tbody tr').count(), 0, 'model catalog has not been released');
  assert.equal(await products(page).count(), 6, 'already loaded plans and subscriptions remain available');
  releaseCatalog();
  await page.locator('.market-model-table tbody tr').filter({ hasText: 'Orbit Opus' }).waitFor();
  assert.equal(await products(page).count(), 8);
  assert.match(await page.locator('.market-result-count').innerText(), /8/);
  assert.equal(await search.inputValue(), 'Orbit');
  assert.deepEqual(await search.evaluate(input => ({ focused: input === document.activeElement, start: input.selectionStart, end: input.selectionEnd })), { focused: true, start: 1, end: 4 });
  assert.deepEqual(errors, []);
});

test('manual sales carries selected server products to support and management retains current and queued entitlements', async t => {
  const { page, backend, errors } = await open(t);
  await page.locator('.market-trial [data-act=contact-purchase]').click();
  await page.locator('.market-plan').filter({hasText:'Orbit Builder'}).locator('[data-act=contact-purchase]').click();
  await page.locator('.market-subscription').filter({hasText:'Orbit Max · 10×'}).locator('[data-act=contact-purchase]').click();
  const intents=await page.evaluate(()=>window.manualIntents);
  assert.equal(intents.length,3);assert.equal(intents[0].publicCode,'orbit-trial');assert.equal(intents[0].amountMicro,79000000);assert.equal(intents[1].publicCode,'orbit-builder');assert.equal(intents[2].poolId,82);assert.equal(intents[2].amountMicro,850000000);assert.match(intents[2].title,/1\/2/);
  assert.deepEqual(backend.state.writes,[],'consultation never debits or activates');
  await page.locator('.market-account-link').click();await page.waitForURL(/#\/billing\/credits$/);await page.locator('[data-token-plan]').waitFor();
  assert.match(await page.locator('[data-token-plan]').innerText(),/Current Orbit/);assert.match(await page.locator('[data-token-plan]').innerText(),/queued-orbit/);
  assert.equal(await page.locator('[data-act=set-ride-mode]').count(),2);assert.equal(await page.locator('[data-act=set-current-ride][data-id="82"]').count(),1);assert.deepEqual(errors,[]);
});

test('empty catalog does not invent products or purchase prices', async t => {
  const { page, errors } = await open(t, { empty: true });
  assert.equal(await products(page).count(), 0);
  assert.equal(await page.locator('.market-page [data-act=contact-purchase]').count(), 0);
  assert.equal(await page.locator('.market-empty').count(), 3);
  await page.locator('[data-input=marketQ]').fill('Orbit');
  await page.locator('[data-act=market-clear]').waitFor();
  assert.match(await page.locator('.market-result-count').innerText(), /0/);
  assert.deepEqual(errors, []);
});

test('failed catalog loads remain unavailable instead of showing false empty search results', async t => {
  const { page, errors } = await open(t, { failed: true });
  assert.equal(await products(page).count(), 0);
  assert.equal(await page.locator('.market-page [data-act=contact-purchase]').count(), 0);
  assert.equal(await page.locator('.market-empty').count(), 3);
  await page.locator('[data-input=marketQ]').fill('Orbit');
  assert.match(await page.locator('.market-result-count').innerText(), /暂无法读取目录/);
  assert.equal(await page.locator('[data-act=market-clear]').count(), 0, 'a failed catalog is not a successful zero-result search');
  assert.deepEqual(errors, []);
});

for (const theme of ['light', 'dark']) {
  for (const viewport of [{ width: 1440, height: 1100 }, { width: 390, height: 844 }, { width: 320, height: 640 }]) {
    test(`market fits ${viewport.width}px in ${theme} mode`, async t => {
      const { page, errors } = await open(t, { theme, viewport });
      assert.equal(await page.locator('#fx').getAttribute('data-theme'), theme);
      const layout = await page.evaluate(() => {
        const market = document.querySelector('.market-page');
        const scroll = market.parentElement;
        const active = document.querySelector('.market-tabs [aria-pressed=true]');
        return {
          pageOverflow: market.scrollWidth - market.clientWidth,
          mainOverflow: scroll.scrollWidth - scroll.clientWidth,
          activeBorder: getComputedStyle(active).borderBottomColor,
          activeText: getComputedStyle(active).color,
          canvas: getComputedStyle(market).backgroundColor,
          cards: [...market.querySelectorAll('.market-plan')].map(card => {
            const box = card.getBoundingClientRect(), action = card.querySelector('.market-plan-action').getBoundingClientRect();
            return { x: box.x, y: box.y, width: box.width, right: box.right, actionBottom: action.bottom };
          }),
        };
      });
      assert.ok(layout.pageOverflow <= 1 && layout.mainOverflow <= 1, `no page-level horizontal overflow: ${JSON.stringify(layout)}`);
      assert.equal(layout.activeBorder, layout.activeText, 'the active category has a visible underline');
      assert.equal(layout.canvas, theme === 'light' ? 'rgb(248, 248, 245)' : 'rgb(21, 23, 19)');
      if (viewport.width === 1440) {
        assert.ok(layout.cards.every(card => Math.abs(card.y - layout.cards[0].y) <= 1), 'desktop plans share one row');
        assert.ok(layout.cards.every(card => Math.abs(card.actionBottom - layout.cards[0].actionBottom) <= 1), 'purchase controls align');
      } else {
        assert.ok(layout.cards[1].y > layout.cards[0].y, 'mobile plans are stacked');
        assert.ok(layout.cards.every(card => card.x >= 0 && card.right <= viewport.width), 'cards stay inside the viewport');
        const table = page.locator('.market-model-table-wrap');
        await table.scrollIntoViewIfNeeded();
        assert.equal(await table.evaluate(el => el.scrollWidth > el.clientWidth), true, 'the complete pricing table scrolls inside its own region');
        await table.focus();
        await page.keyboard.press('End');
        await page.locator('.market-heading').scrollIntoViewIfNeeded();
      }
      if (process.env.MARKET_SCREENSHOT_DIR) {
        await mkdir(process.env.MARKET_SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({ path: join(process.env.MARKET_SCREENSHOT_DIR, `market-${theme}-${viewport.width}.png`), fullPage: true });
      }
      assert.deepEqual(errors, []);
    });
  }
}

test('monthly inventory disables new sales while an existing seat can renew', async t => {
  const {page,errors} = await open(t);
  assert.equal(await page.locator('[data-act=contact-purchase][data-support-pool="81"]').isDisabled(),true);
  assert.equal(await page.locator('[data-act=contact-purchase][data-support-pool="82"]').isEnabled(),true);
  assert.match(await page.locator('[data-monthly-share]').first().innerText(),/1\/4.*5×.*30/);
  assert.match(await page.locator('[data-monthly-share]').nth(1).innerText(),/1\/2.*10×.*30/);
  assert.deepEqual(errors,[]);
});
