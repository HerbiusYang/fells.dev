import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserFixture } from '../helpers/browser.mjs';
import { createAppBackend } from '../helpers/app-backend.mjs';
const fixture = createBrowserFixture(); before(() => fixture.start()); after(() => fixture.stop());
const now = Date.parse('2026-11-01T12:00:00Z'), seconds = now / 1000;
const recorded = patch => ({ known: true, observed_at: seconds - 20, eligible: true, resets_remaining_known: true, resets_remaining: 2, reset_available: true, reset_state: 'ready', reset_block_reason: '', ...patch });
async function open(t, options = {}) {
  const session = await fixture.setup(t, { viewport: { width: 390, height: 900 } }), { context, page, base } = session;
  await page.clock.install({ time: new Date(now) }); await page.clock.pauseAt(new Date(now + 1));
  const backend = createAppBackend({ preferences: { theme: 'light', prefs: { agent: '', send: 0 }, notifs: [true, true, true, false], onboarded: true, answers: [[0], [0], [0], [0]], promoClosed: true, sbHidden: false } });
  await backend.install(context);
  await context.route('**/api/app/subscriptions', route => route.fulfill({ json: { plans: [], rides: [{ subscription_id: 1, pool_id: 81, pool_name: 'Owned shared <subscription>', tier: 4, multiplier: 5, current: true, seated: true, expires_at: seconds + 86400 }] } }));
  let state = recorded(options.grant ?? {});
  const gets = [], posts = [];
  await context.route(/\/api\/app\/spend-grant(?:\?.*)?$/, route => {
    const poolID = Number(new URL(route.request().url()).searchParams.get('pool_id')); gets.push(poolID);
    return route.fulfill({ json: { ok: true, pool_id: options.wrongPool ? 82 : poolID, spend_grant: { ...state, account_name: 'INTERNAL_ACCOUNT_MUST_NOT_RENDER', org_uuid: 'INTERNAL_ORG_MUST_NOT_RENDER' } } });
  });
  await context.route('**/api/app/spend-grant/reset', async route => {
    posts.push({ body: route.request().postDataJSON(), expectedUser: route.request().headers()['x-fells-expected-user'], expectedSession: route.request().headers()['x-fells-expected-session'] });
    if (options.transport || options.failure) {
      state = { ...state, reset_available: false, reset_state: 'unknown', reset_block_reason: 'unknown' };
      if (options.transport) return route.abort('failed');
      return route.fulfill({ status: 502, json: { error: { code: options.failureCode ?? 'reset_outcome_unknown', message: 'Synthetic provider outcome is unconfirmed' } } });
    }
    if (options.unverified) return route.fulfill({ json: { ok: true, pool_id: 81, spend_grant: state } });
    state = recorded({ reset_available: false, reset_state: 'accepted', reset_block_reason: 'accepted', known: false, observed_at: 0, eligible: false, resets_remaining_known: false, resets_remaining: 0, upstream_status: 200, cooldown_cleared: true, last_reset_at: seconds });
    return route.fulfill({ json: { ok: true, pool_id: 81, spend_grant: state } });
  });
  await page.goto(base + '/app/#/billing/credits');
  await page.locator('[data-act=spend-grant][data-id="81"]').waitFor();
  assert.deepEqual(gets, [], 'status is queried only after explicit subscription selection');
  return { ...session, backend, gets, posts, setGrant: patch => { state = recorded(patch); } };
}
async function status(page) {
  await page.locator('[data-subscription-row] [data-act=spend-grant][data-id="81"]').click();
  await page.locator('[data-spend-grant-status]').waitFor();
  return page.locator('[data-spend-grant-status]');
}
async function confirm(page) {
  await page.locator('[data-spend-grant-status] [data-act=spend-grant-reset]').click();
  const dialog = page.locator('dialog[data-app-confirm]'); await dialog.waitFor(); return dialog;
}

test('unknown cached eligibility and unknown count never look like confirmed rejection or zero resets', async t => {
  const { page, gets, posts, errors } = await open(t, { grant: { known: false, observed_at: 0, eligible: false, resets_remaining_known: false, resets_remaining: 0 } });
  const panel = await status(page);
  assert.match(await panel.innerText(), /No verified eligibility record/);
  assert.match(await panel.innerText(), /Recorded resets remaining: Unknown/);
  assert.doesNotMatch(await panel.innerText(), /Not eligible in this record|resets remaining: 0|INTERNAL_/);
  assert.equal(await panel.locator('[data-act=spend-grant-reset]').isDisabled(), true);
  assert.deepEqual(gets, [81]); assert.deepEqual(posts, []); assert.deepEqual(errors, []);
});

test('a shared reset requires site confirmation and a bound real POST, then refetches without inventing health or credits', async t => {
  const { page, backend, gets, posts, errors } = await open(t);
  const allowance = backend.state.apiAllowance.micro;
  await status(page);
  const decision = await confirm(page);
  assert.match(await decision.innerText(), /other people sharing the same subscription account/);
  await decision.locator('[data-confirm-cancel]').click(); assert.deepEqual(posts, []);
  const accepted = await confirm(page); await accepted.locator('[data-confirm-accept]').click();
  await page.locator('[data-spend-grant-status] [role=status]').filter({ hasText: 'provider accepted this reset request' }).waitFor();
  assert.deepEqual(posts, [{ body: { pool_id: 81, confirm_shared_reset: true }, expectedUser: '42', expectedSession: 'c'.repeat(64) }]);
  assert.deepEqual(gets, [81, 81]);
  assert.equal(await page.locator('[data-act=spend-grant-reset]').isDisabled(), true);
  assert.match(await page.locator('[data-spend-grant-status]').innerText(), /No verified eligibility record/);
  assert.doesNotMatch(await page.locator('[data-spend-grant-status]').innerText(), /INTERNAL_|healthy|0%/);
  assert.equal(backend.state.apiAllowance.micro, allowance); assert.deepEqual(errors, []);
});

for (const failure of ['server', 'transport']) test(`an unconfirmed ${failure} outcome has no automatic retry and retains the previous recorded state`, async t => {
  const { page, posts, gets, errors, setGrant } = await open(t, { failure: failure === 'server', transport: failure === 'transport' });
  await status(page); const decision = await confirm(page); await decision.locator('[data-confirm-accept]').click();
  await page.locator('[data-spend-grant-status] [role=alert]').filter({ hasText: 'unconfirmed' }).waitFor();
  assert.equal(posts.length, 1); assert.equal(gets.length, 1);
  assert.match(await page.locator('[data-spend-grant-status]').innerText(), /Eligible in this record/);
  assert.equal(await page.locator('[data-act=spend-grant-reset]').isDisabled(), true);
  await page.locator('[data-spend-grant-status] [data-act=spend-grant]').click();
  await page.locator('[data-spend-grant-status]').waitFor();
  assert.equal(gets.length, 2); assert.equal(posts.length, 1);
  assert.equal(await page.locator('[data-act=spend-grant-reset]').isDisabled(), true);
  assert.match(await page.locator('[data-spend-reset-reason]').innerText(), /refreshing does not release/);
  await page.reload(); await status(page);
  assert.equal(await page.locator('[data-act=spend-grant-reset]').isDisabled(), true);
  assert.equal(posts.length, 1, 'refresh preserves the shared server block');
  setGrant({ observed_at: seconds, reset_available: true, reset_state: 'ready', reset_block_reason: '' });
  await page.locator('[data-spend-grant-status] [data-act=spend-grant]').click();
  await page.locator('[data-spend-grant-status]').waitFor();
  const retryDecision = await confirm(page); await retryDecision.locator('[data-confirm-cancel]').click();
  assert.equal(posts.length, 1); assert.deepEqual(errors, []);
});

test('HTTP success without an official acceptance receipt cannot mark the reset accepted', async t => {
  const { page, posts, errors } = await open(t, { unverified: true });
  await status(page); const decision = await confirm(page); await decision.locator('[data-confirm-accept]').click();
  await page.locator('[data-spend-grant-status] [role=alert]').filter({ hasText: 'unconfirmed' }).waitFor();
  assert.equal(await page.locator('[data-spend-grant-status] [role=status]').count(), 0);
  assert.equal(posts.length, 1); assert.equal(await page.locator('[data-act=spend-grant-reset]').isDisabled(), true);
  assert.deepEqual(errors, []);
});

test('a mismatched pool response cannot enable reset of another subscription', async t => {
  const { page, posts, errors } = await open(t, { wrongPool: true });
  await page.locator('[data-subscription-row] [data-act=spend-grant]').click();
  await page.locator('.dlg [role=alert]').filter({ hasText: 'unavailable' }).waitFor();
  assert.equal(await page.locator('[data-act=spend-grant-reset]').count(), 0);
  assert.deepEqual(posts, []); assert.deepEqual(errors, []);
});

test('session invalidation cancels shared-reset confirmation without submitting or preserving private status', async t => {
  const { page, backend, posts, base, errors } = await open(t);
  await status(page); await confirm(page);
  backend.state.signedIn = false;
  await page.evaluate(() => dispatchEvent(new CustomEvent('fells.session.changed', { detail: { audience: 'customer' } })));
  await page.waitForURL(url => url.origin === base && url.pathname === '/app/start/' && url.searchParams.get('session') === 'changed');
  assert.deepEqual(posts, []); assert.equal(await page.locator('[data-spend-grant-status]').count(), 0);
  assert.equal(await page.locator('dialog[data-app-confirm]').count(), 0); assert.deepEqual(errors, []);
});


test('missing, unknown or blocked server reset contracts remain read-only despite eligible records and positive counts', async t => {
  for (const grant of [
    { reset_available: undefined, reset_state: undefined, reset_block_reason: undefined },
    { reset_available: true, reset_state: 'future_state', reset_block_reason: '' },
    { reset_available: false, reset_state: 'read_only', reset_block_reason: 'identity_incomplete' },
    ...['sending', 'unknown', 'accepted', 'refused'].map(state => ({ reset_available: false, reset_state: state, reset_block_reason: state })),
  ]) {
    const { page, posts, errors } = await open(t, { grant });
    const panel = await status(page);
    assert.match(await panel.innerText(), /Eligible in this record/);
    assert.equal(await panel.locator('[data-act=spend-grant-reset]').isDisabled(), true);
    assert.ok(await panel.locator('[data-spend-reset-state]').innerText());
    assert.ok(await panel.locator('[data-spend-reset-reason]').innerText());
    await page.reload(); await status(page);
    assert.equal(await page.locator('[data-act=spend-grant-reset]').isDisabled(), true);
    assert.deepEqual(posts, []); assert.deepEqual(errors, []);
  }
});

test('an uncertain reset registration cannot be repeated after reading or reloading the shared block', async t => {
  const { page, posts, errors } = await open(t, { failure: true, failureCode: 'reset_registration_unknown' });
  await status(page); const decision = await confirm(page); await decision.locator('[data-confirm-accept]').click();
  await page.locator('[data-spend-grant-status] [role=alert]').filter({ hasText: 'unconfirmed' }).waitFor();
  assert.equal(posts.length, 1);
  await page.reload(); await status(page);
  assert.equal(await page.locator('[data-act=spend-grant-reset]').isDisabled(), true);
  assert.match(await page.locator('[data-spend-reset-reason]').innerText(), /Manual verification|new verifiable qualification/);
  assert.equal(posts.length, 1); assert.deepEqual(errors, []);
});
