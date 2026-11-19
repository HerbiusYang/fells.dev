import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserFixture } from '../helpers/browser.mjs';
import { createAppBackend } from '../helpers/app-backend.mjs';

const fixture = createBrowserFixture();
before(() => fixture.start());
after(() => fixture.stop());

const preferences = { theme: 'light', prefs: { agent: '', send: 0 }, notifs: [true, true, true, false], onboarded: true, answers: [[0], [0], [0], [0]], promoClosed: true, sbHidden: false };
// Synthetic plan state only; amounts are chosen to be recognisable, not real.
function currentPlan(overrides = {}) {
  return {
    id: 7, user_id: 42, plan_id: 3, plan_code: '1000', name: 'Token Plan 1000', price_micro: 1288000000,
    quota_usd_micro: 1000000000, burst_usd_micro: 0, period_start: 1890000000, period_end: 1900000000,
    used_usd_micro: 480000, status: 'active', ref: 'synthetic-plan', created_at: 1890000000,
    remaining_guaranteed_usd_micro: 999520000, remaining_burst_usd_micro: 0, burst_allowed: false,
    term_months: 12, bonus_usd_micro: 300000000, bonus_used_usd_micro: 0, remaining_bonus_usd_micro: 300000000, queued_periods: 11,
    ...overrides,
  };
}
async function open(t, { locale = 'zh', current = null, unlimitedAllowance = false } = {}) {
  const session = await fixture.setup(t, { viewport: { width: 1280, height: 900 } });
  const backend = createAppBackend({ preferences, unlimitedAllowance, apiAllowance: { user_id: 42, micro: 300420000, expires_at: 0 },
    tokenPlans: { plans: [], burst_allowed: false, bonus_models: ['*glm*', '*kimi*'], current } });
  await backend.install(session.context);
  // Token Plans load once at start-up; wait for that read and the render after it.
  const plansRead = session.page.waitForResponse(response => new URL(response.url()).pathname === '/api/app/plans');
  await session.page.goto(session.base + (locale === 'en' ? '/app/' : `/${locale}/app/`) + '#/settings/0');
  await session.page.locator('[data-act=account]').waitFor();
  await plansRead;
  await session.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return { ...session, backend };
}

test('the sidebar and account menu show the current Token Plan with its bonus and paid periods still to start', async t => {
  const { page, errors } = await open(t, { current: currentPlan() });
  const line = page.locator('.me-btn [data-sidebar-token-plan]');
  await line.waitFor();
  assert.equal((await line.textContent()).trim(), 'Token Plan 1000 $999.52 · +$300.00 GLM、Kimi');
  assert.equal(await line.getAttribute('title'), 'Token Plan 1000 $999.52 · +$300.00 GLM、Kimi');
  assert.deepEqual(await line.evaluate(element => { const style = getComputedStyle(element); return [style.textOverflow, style.whiteSpace, style.overflow]; }), ['ellipsis', 'nowrap', 'hidden']);
  assert.match(await page.locator('.me-btn small').first().textContent(), /\$300\.42/, 'the allowance line stays on its own and excludes the plan');
  await page.locator('[data-act=account]').click();
  const menu = page.locator('.account-pop');
  const row = menu.locator('[data-account-token-plan]');
  assert.equal(await row.count(), 1);
  assert.match(await row.locator('[data-account-token-plan-name]').textContent(), /^Token Plan 1000 · 到期 /);
  assert.equal((await row.locator('b').textContent()).trim(), '$999.52');
  assert.equal((await row.locator('[data-account-token-plan-quota]').textContent()).trim(), '/ 总额度 $1000.00');
  assert.equal((await row.locator('[data-account-token-plan-bonus]').textContent()).trim(), '+$300.00 GLM、Kimi 赠送额度');
  assert.equal((await row.locator('[data-account-token-plan-queued]').textContent()).trim(), '已付款待生效 11 期');
  assert.equal(await menu.locator('.credit-row').count(), 2, 'one allowance row and one plan row');
  assert.equal(await menu.locator('[data-go="billing/market"] .end').count(), 0, 'the plan name tag on Marketplace is gone');
  assert.doesNotMatch(await menu.innerText(), /弹性|burst/i);
  assert.equal(await page.locator('.me-btn [data-sidebar-token-plan]').count(), 1, 'opening the menu refreshes the line in place');
  await row.click();
  await page.waitForFunction(() => document.querySelector('#fx')?.dataset.route === '#/billing/credits');
  await page.locator('[data-token-plan]').waitFor();
  assert.deepEqual(errors, []);
});

test('a plan without bonus or queued periods shows only its guaranteed quota, labelled as a Token Plan', async t => {
  const { page, errors } = await open(t, { locale: 'en', current: currentPlan({ name: 'Starter', plan_code: 'starter', quota_usd_micro: 80000000, remaining_guaranteed_usd_micro: 80000000, term_months: 0, bonus_usd_micro: 0, remaining_bonus_usd_micro: 0, queued_periods: 0 }) });
  const line = page.locator('.me-btn [data-sidebar-token-plan]');
  await line.waitFor();
  assert.equal((await line.textContent()).trim(), 'Token Plan · Starter $80.00');
  await page.locator('[data-act=account]').click();
  const row = page.locator('.account-pop [data-account-token-plan]');
  assert.match(await row.locator('[data-account-token-plan-name]').textContent(), /^Starter · Ends /);
  assert.equal((await row.locator('[data-account-token-plan-quota]').textContent()).trim(), 'of $80.00');
  assert.equal(await row.locator('[data-account-token-plan-bonus], [data-account-token-plan-queued]').count(), 0);
  assert.deepEqual(errors, []);
});

test('without a current Token Plan the sidebar and menu show nothing extra', async t => {
  const { page, errors } = await open(t);
  await page.locator('[data-act=account]').click();
  await page.locator('.account-pop [data-act=lang]').waitFor();
  assert.equal(await page.locator('[data-sidebar-token-plan], [data-account-token-plan]').count(), 0);
  assert.equal(await page.locator('.account-pop .credit-row').count(), 1);
  assert.deepEqual(errors, []);
});

test('a super account is unchanged even when a plan is reported', async t => {
  const { page, errors } = await open(t, { current: currentPlan(), unlimitedAllowance: true });
  await page.locator('[data-act=account]').click();
  await page.locator('.account-pop [data-unlimited-allowance]').waitFor();
  assert.equal(await page.locator('[data-sidebar-token-plan], [data-account-token-plan]').count(), 0);
  assert.deepEqual(errors, []);
});
