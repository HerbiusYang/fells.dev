import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserFixture } from '../helpers/browser.mjs';
import { createAppBackend } from '../helpers/app-backend.mjs';

const fixture = createBrowserFixture();
before(() => fixture.start()); after(() => fixture.stop());
const now = Date.parse('2026-11-01T12:00:00Z'), seconds = now / 1000;
const path = /\/api\/app\/subscriptions(?:\?.*)?$/;
const preferences = { theme: 'light', prefs: { agent: '', send: 0 }, notifs: [true, true, true, false], onboarded: true, answers: [[0], [0], [0], [0]], promoClosed: true, sbHidden: false };
const snapshot = () => ({
  plans: [], preferred_ride_mode: 'monthly',
  rides: [
    { subscription_id: 1, pool_id: 81, pool_name: 'Zero <img src=x onerror="window.subscriptionInjected=true">', tier: 4, multiplier: 5, current: true, seated: true, expires_at: seconds + 86400,
      overview: { state: 'ready', read_at: seconds - 10, windows: [{ kind: 'session', window_minutes: 300, used_pct: 0, reset_at: seconds + 3600 }, { kind: 'missing', window_minutes: 10080 }] } },
    { subscription_id: 2, pool_id: 82, pool_name: 'Another subscription ' + 'LongName'.repeat(12), tier: 2, multiplier: 10, current: false, seated: true, expires_at: seconds + 86400,
      overview: { state: 'scoped_full', read_at: seconds - 20, windows: [{ kind: 'weekly_scoped', scope: '<script>window.subscriptionInjected=true</script>', used_pct: 100, reset_at: seconds + 86400 }] } },
    { subscription_id: 3, pool_id: 83, pool_name: 'Older server without overview', tier: 1, multiplier: 20, current: false, seated: false, expires_at: seconds + 86400 },
  ],
});
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function open(t, { theme = 'light', viewport = { width: 1280, height: 1000 }, handler, waitForRead = true } = {}) {
  const session = await fixture.setup(t, { viewport, colorScheme: theme });
  const { context, page, base } = session;
  await page.clock.install({ time: new Date(now) });
  await page.clock.pauseAt(new Date(now + 1));
  const backend = createAppBackend({ preferences: { ...preferences, theme } });
  await backend.install(context);
  const data = snapshot(), switches = [], modes = [];
  await context.route(path, route => handler ? handler(route, data) : route.fulfill({ json: data }));
  await context.route('**/api/app/subscriptions/current', async route => {
    const body = route.request().postDataJSON(); switches.push(body);
    for (const ride of data.rides) ride.current = ride.pool_id === body.pool_id;
    await route.fulfill({ json: { ok: true, ride_pool_id: body.pool_id } });
  });
  await context.route('**/api/app/subscriptions/ride-mode', async route => { modes.push(route.request().postDataJSON()); await route.fulfill({ json: { ok: true } }); });
  const initialReads = ['/catalog', '/plans', '/wallet/ledger', '/coupons', '/invoices', '/purchase-operations/unconfirmed'].map(suffix => page.waitForResponse(response => new URL(response.url()).pathname === '/api/app' + suffix));
  await page.goto(base + '/app/#/billing/credits');
  await Promise.all((await Promise.all(initialReads)).map(response => response.finished()));
  await page.locator('[data-my-subscriptions]').waitFor();
  if (waitForRead) await page.locator('[data-subscription-row]').filter({ hasText: 'Zero <img' }).waitFor();
  return { ...session, backend, data, switches, modes };
}

test('usage details preserve real zero, unknown values, escaped names and explicit subscription switching', async t => {
  const { page, switches, modes, errors } = await open(t);
  const list = page.locator('[data-my-subscriptions]');
  const zero = list.locator('[data-subscription-row]').filter({ hasText: 'Zero <img' });
  const other = list.locator('[data-subscription-row]').filter({ hasText: 'Another subscription' });
  assert.match(await zero.innerText(), /1\/4.*5×/);
  assert.match(await other.innerText(), /1\/2.*10×/);
  assert.equal(await list.locator('[data-subscription-overview]').count(), 2);
  assert.equal(await list.locator('[data-subscription-row]').filter({ hasText: 'Older server' }).locator('details').count(), 0);
  await zero.locator('summary').focus(); await page.keyboard.press('Enter');
  await zero.locator('details[open]').waitFor();
  assert.deepEqual(await zero.locator('[data-subscription-used]').allTextContents(), ['0.0%', '—']);
  await other.locator('summary').click(); await other.locator('details[open]').waitFor();
  assert.match(await other.locator('details').innerText(), /<script>window.subscriptionInjected=true<\/script>/);
  assert.equal(await list.locator('script,img').count(), 0);
  assert.equal(await page.evaluate(() => window.subscriptionInjected), undefined);
  assert.deepEqual(switches, []); assert.deepEqual(modes, []);
  await other.locator('[data-act=set-current-ride]').click();
  await other.locator('[data-act=set-current-ride]').waitFor({ state: 'detached' });
  assert.deepEqual(switches, [{ pool_id: 82 }]); assert.deepEqual(modes, []);
  assert.equal(await zero.locator('[data-act=set-current-ride]').count(), 1);
  assert.deepEqual(errors, []);
});

test('expired snapshot windows and unknown timestamps never become fresh zero readings', async t => {
  const { page, switches, errors } = await open(t, { handler: (route, data) => {
    data.rides[0].overview = { state: 'unknown', read_at: seconds + 60, windows: [
      { kind: 'server-expired', used_pct: 0, reset: true, reset_at: seconds - 10 },
      { kind: 'expected-expired', used_pct: 95, reset_at: seconds - 10 },
      { kind: 'invalid', used_pct: null },
    ] };
    return route.fulfill({ json: data });
  } });
  const details = page.locator('[data-subscription-row]').first().locator('details');
  await details.locator('summary').click(); await details.locator('ul').waitFor();
  assert.deepEqual(await details.locator('[data-subscription-used]').allTextContents(), ['—', '—', '—']);
  assert.match(await details.innerText(), /Previous window expired/);
  assert.match(await details.innerText(), /Expected reset time passed/);
  assert.match(await details.innerText(), /Reading time unavailable/);
  assert.doesNotMatch(await details.innerText(), /0\.0%|95\.0%/);
  assert.deepEqual(switches, []); assert.deepEqual(errors, []);
});

test('cancelled subscription reads cannot manufacture an empty zero-percent panel', async t => {
  const { page, errors, switches } = await open(t, { handler: route => route.abort('aborted'), waitForRead: false });
  await page.locator('.wallet-page > .note[role=status]').waitFor();
  assert.equal(await page.locator('[data-subscription-overview]').count(), 0);
  assert.equal(await page.locator('[data-subscription-used]').count(), 0);
  assert.deepEqual(switches, []); assert.deepEqual(errors, []);
});

test('pending-read session teardown clears subscription details before and after signin navigation', { timeout: 20_000 }, async t => {
  const read = deferred(), releaseRead = deferred(), delivered = deferred();
  t.after(() => releaseRead.resolve());
  const { page, base, backend, switches, errors } = await open(t, {
    waitForRead: false,
    handler: async (route, data) => {
      read.resolve(); await releaseRead.promise;
      try { await route.fulfill({ json: data }); }
      catch (error) {
        // Only the actual request's expected navigation cancellation is benign.
        if (!/net::ERR_ABORTED/.test(route.request().failure()?.errorText ?? '')) throw error;
      } finally { delivered.resolve(); }
    },
  });
  await read.promise;
  backend.state.signedIn = false;
  try {
    const cleared = await page.evaluate(() => {
      dispatchEvent(new CustomEvent('fells.session.changed', { detail: { audience: 'customer' } }));
      // Read during the same task as invalidation. Once navigation starts,
      // Chromium makes the old execution context unavailable to Playwright.
      return { children: document.querySelector('#fx')?.childElementCount, rows: document.querySelectorAll('[data-my-subscriptions]').length };
    });
    assert.deepEqual(cleared, { children: 0, rows: 0 });
    await page.waitForURL(url => url.origin === base && url.pathname === '/app/start/' && url.searchParams.get('session') === 'changed');
    // The test observes teardown and the final page. It does not claim that
    // the departed document executes a late callback or receives HTTP200.
    releaseRead.resolve(); await delivered.promise;
    assert.equal(await page.locator('[data-my-subscriptions],[data-subscription-overview],[data-subscription-row]').count(), 0);
    t.diagnostic('pending subscription read: synchronous private-DOM clear, real signin navigation, no private details after releasing the old route; late callback not tested');
    assert.deepEqual(switches, []); assert.deepEqual(errors, []);
  } finally { releaseRead.resolve(); }
});

for (const theme of ['light', 'dark']) test(`subscription details remain keyboard accessible and contained on mobile and desktop in ${theme} theme`, async t => {
  const { page, switches, errors } = await open(t, { theme });
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 1000 });
    const details = page.locator('[data-subscription-row]').filter({ hasText: 'Another subscription' }).locator('details');
    if (await details.getAttribute('open') === null) { await details.locator('summary').focus(); await page.keyboard.press('Enter'); }
    await details.locator('ul').waitFor();
    assert.equal(await details.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, `${width}: detail text wraps`);
    assert.equal(await page.locator('.wallet-detail-content').evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, `${width}: no horizontal scrolling in the wallet`);
    await details.locator('summary').focus(); await page.keyboard.press('Enter');
    assert.equal(await details.getAttribute('open'), null);
  }
  assert.deepEqual(switches, []); assert.deepEqual(errors, []);
});
