import { handleFetch } from '../../edge/maintenance/worker.mjs';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserFixture } from '../helpers/browser.mjs';
import { createAppBackend } from '../helpers/app-backend.mjs';
import { supportBrowser, supportFixture } from './helpers/support-http-fixture.mjs';

const fixture = createBrowserFixture(); let supportEnvironment;
before(async () => { await fixture.start(); supportEnvironment = await supportBrowser(); });
after(async () => { await fixture.stop(); await supportEnvironment?.close(); });
const status = (mode = 'normal', revision = 0) => ({ version: 1, revision, mode, incident_id: 'planned-patch', title: '', message: 'Host patch in progress. <img src=x onerror=alert(1)>', starts_at: '2026-10-26T20:00:00Z', expected_end_at: null, next_update_at: null, updated_at: '2026-10-26T20:05:00Z', retry_after_seconds: 60, status_url: '' });
async function routeStatus(context, get) { await context.route('**/__maintenance/status', route => route.fulfill({ status: 200, headers: { 'Cache-Control': 'no-store' }, json: get() })); }
async function check(page) { await page.evaluate(() => dispatchEvent(new Event('focus'))); }
const preferences = { theme: 'light', prefs: { agent: '', send: 0 }, notifs: [true, true, true, false], onboarded: true, answers: [[0], [0], [0], [0]], promoClosed: true, sbHidden: false };

test('all six locales show escaped independent notices, state times and safe status links', async t => {
  const { context, page, base, errors } = await fixture.setup(t);
  let current = status('scheduled'); await routeStatus(context, () => current);
  for (const [prefix, heading] of [['', 'Scheduled maintenance'], ['/zh', '计划维护'], ['/zh-hant', '預定維護'], ['/ja', 'メンテナンス予定'], ['/ko', '예정된 점검'], ['/es', 'Mantenimiento programado']]) {
    await page.goto(base + prefix + '/');
    await page.locator('[data-maintenance-notice]:not([hidden])').waitFor();
    assert.equal(await page.locator('[data-maintenance-title]').innerText(), heading);
    assert.equal(await page.locator('[data-maintenance-message] img').count(), 0);
    assert.match(await page.locator('[data-maintenance-message]').innerText(), /<img src=x/);
    assert.equal(await page.locator('[data-maintenance-link]').isVisible(), false);
  }
  current = { ...status('maintenance', 1), title: 'Applying host patches', expected_end_at: '2026-10-26T21:00:00Z', next_update_at: '2026-10-26T20:30:00Z', status_url: 'https://status.fells.dev/' };
  await page.locator('[data-maintenance-check]').click();
  await page.waitForFunction(() => document.querySelector('[data-maintenance-title]').textContent === 'Applying host patches');
  assert.equal(await page.locator('[data-maintenance-link]').getAttribute('href'), current.status_url);
  current = status('recovering', 2); await page.locator('[data-maintenance-check]').click();
  await page.waitForFunction(() => document.querySelector('[data-maintenance-title]').textContent === 'Recuperación del servicio en curso');
  current = status('incident', 3); await page.locator('[data-maintenance-check]').click();
  await page.waitForFunction(() => document.querySelector('[data-maintenance-title]').textContent === 'Servicio temporalmente no disponible');
  current = status('normal', 4); await page.locator('[data-maintenance-check]').click();
  await page.locator('[data-maintenance-notice]').waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
});

test('an open login form keeps entered fields while maintenance pauses submission and restores service configuration', async t => {
  const { context, page, base, errors } = await fixture.setup(t); let current = status();
  await routeStatus(context, () => current);
  let writes = 0, githubEnabled = true;
  await context.route('**/api/app/**', route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() !== 'GET') { writes++; return route.fulfill({ status: 503, json: { error: 'unexpected write' } }); }
    if (path === '/api/app/session') return route.fulfill({ status: 401, json: { error: 'unauthorized' } });
    if (path === '/api/app/auth/config') return route.fulfill({ json: { signup_enabled: true, email_enabled: true, github_enabled: githubEnabled, min_password_length: 8, turnstile_site_key: '' } });
    if (path === '/api/app/agreement') return route.fulfill({ json: { version: 'v1', h1: 'Terms', lede: 'Service terms', clauses: [], ui: {} } });
    return route.fulfill({ status: 401, json: { error: 'unauthorized' } });
  });
  await page.goto(base + '/app/start/');
  const github = page.locator('[data-github]');
  await github.waitFor({ state: 'visible' });
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await page.locator('#auth-email:not([disabled])').waitFor();
  await page.locator('#auth-email').fill('keep-me@example.test'); await page.locator('#auth-password').fill('private-password');
  current = status('maintenance', 1); await check(page);
  await page.locator('[data-maintenance-notice]:not([hidden])').waitFor();
  assert.equal(await page.locator('[data-auth-form] [type=submit]').isDisabled(), true);
  assert.equal(await page.locator('#auth-email').inputValue(), 'keep-me@example.test');
  assert.equal(await page.locator('#auth-password').inputValue(), 'private-password');
  assert.equal(await github.isHidden(), true);
  assert.equal(await github.getAttribute('href'), null);
  await page.locator('[data-auth-form]').evaluate(form => form.requestSubmit()); assert.equal(writes, 0);
  githubEnabled = false; current = status('normal', 2); await check(page);
  await page.locator('[data-auth-form] [type=submit]:enabled').waitFor();
  assert.equal(await github.isHidden(), true);
  assert.equal(await github.getAttribute('href'), null);
  assert.equal(await page.locator('#auth-email').inputValue(), 'keep-me@example.test');
  assert.equal(await page.locator('#auth-password').inputValue(), 'private-password');
  assert.equal(writes, 0); assert.deepEqual(errors, []);
});

test('an open console retains an unsent model draft and never replays a generate after maintenance', async t => {
  const { context, page, base, errors } = await fixture.setup(t); let current = status();
  const backend = createAppBackend({ preferences, modelChat: true, workspaces: [{ id: 'maintenance-space', name: 'Maintenance workspace', region: 'auto', tz: 'UTC', created: 1700000000000, role: 'owner' }] });
  await backend.install(context); await routeStatus(context, () => current);
  await page.goto(base + '/app/#/new'); await page.locator('#fx-input:not([disabled])').waitFor();
  await page.locator('#fx-input').fill('Keep this unsent request');
  current = status('maintenance', 1); await check(page);
  await page.waitForFunction(() => document.querySelector('#fx')?.dataset.maintenance === 'true');
  const writes = backend.state.writes.length;
  await page.locator('[data-form=send] .send').click(); await page.locator('#fx-input').press('Enter');
  assert.equal(await page.locator('#fx-input').inputValue(), 'Keep this unsent request');
  assert.equal(backend.state.writes.length, writes); assert.equal(backend.state.generations.length, 0);
  current = status('recovering', 2); await check(page);
  await page.waitForFunction(() => document.querySelector('[data-maintenance-title]').textContent === 'Service recovery in progress');
  assert.equal(backend.state.generations.length, 0);
  current = status('normal', 3); await check(page);
  await page.waitForFunction(() => document.querySelector('#fx')?.dataset.maintenance === 'false');
  assert.equal(await page.locator('#fx-input').inputValue(), 'Keep this unsent request');
  assert.equal(backend.state.generations.length, 0);
  await page.locator('[data-form=send] .send').click();
  await page.locator('[data-run-status=completed]').waitFor(); assert.equal(backend.state.generations.length, 1);
  assert.deepEqual(errors, []);
});

test('maintenance sign-out clears both tabs before the server responds and retries only the original session after reload', async t => {
  const { context, page, base, errors } = await fixture.setup(t);
  const backend = createAppBackend({ preferences, modelChat: true, workspaces: [{ id: 'privacy-space', name: 'Private workspace', region: 'auto', tz: 'UTC', created: 1700000000000, role: 'owner' }] });
  await backend.install(context);
  let current = status(), fail = true;
  const deletes = [];
  await routeStatus(context, () => current);
  await context.route('**/api/app/session', async route => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    const headers = route.request().headers();
    deletes.push([headers['x-fells-expected-user'], headers['x-fells-expected-session']]);
    if (fail) return route.fulfill({ status: 503, json: { error: 'temporarily offline' } });
    // The cookie has since been replaced. The origin refuses the stale binding.
    return route.fulfill({ status: 401, json: { error: 'session changed' } });
  });
  const other = await context.newPage();
  for (const tab of [page, other]) {
    await tab.goto(base + '/app/#/new');
    await tab.locator('#fx-input:not([disabled])').fill('Private unsent message');
    await tab.evaluate(() => sessionStorage.setItem('fells.chat.relogin-draft.v1', 'old private draft'));
  }
  current = status('maintenance', 1);
  await page.bringToFront(); await check(page);
  const first = page.waitForResponse(r => r.request().method() === 'DELETE');
  await page.locator('[data-maintenance-logout]').click(); await first;
  for (const tab of [page, other]) {
    await tab.locator('#customer-logout').waitFor();
    assert.equal(await tab.locator('#fx').count(), 0);
    assert.equal(await tab.evaluate(() => sessionStorage.getItem('fells.chat.relogin-draft.v1')), null);
  }
  const original = backend.state.sessionID;
  backend.state.sessionID = 'e'.repeat(64);
  const onReload = other.waitForResponse(r => r.request().method() === 'DELETE');
  await other.reload(); await onReload; await other.locator('#customer-logout').waitFor();
  await other.locator('[data-maintenance-notice]:not([hidden])').waitFor();
  assert.equal(await other.locator('#fx').count(), 0);
  fail = false;
  await other.locator('#customer-logout button').click();
  for (const tab of [page, other]) {
    await tab.locator('#customer-logout a:visible').waitFor();
    assert.match(await tab.locator('#customer-logout p').innerText(), /sign in again/i);
  }
  current = status('normal', 2);
  for (const tab of [page, other]) await tab.locator('[data-maintenance-check]').click();
  await Promise.all([page, other].map(tab => tab.waitForURL(url => url.searchParams.get('session') === 'changed')));
  assert.ok(deletes.length >= 3);
  assert.ok(deletes.every(([user, session]) => user === '42' && session === original));
  assert.equal(backend.state.signedIn, true);
  assert.deepEqual(errors, []);
});

test('support pauses polling and sends, retains its draft and resumes without resending automatically', async t => {
  const session = await supportFixture(t, supportEnvironment); let current = status();
  await routeStatus(session.context, () => current);
  let holdBootstrap = false, releaseBootstrap;
  const bootstrapGate = new Promise(resolve => { releaseBootstrap = resolve; });
  await session.context.route('**/api/app/bootstrap', async route => { if (holdBootstrap) await bootstrapGate; await route.fallback(); });
  const page = await session.context.newPage(); await page.clock.install();
  await page.goto(supportEnvironment.base + '/zh/app/');
  await page.locator('[data-support-open]').waitFor({ state: 'visible' }); await page.locator('[data-support-open]').click();
  const input = page.locator('#support-widget [data-support-text]'), send = page.locator('#support-widget [data-support-send]');
  await input.fill('维护期间保留这条草稿');
  await page.waitForLoadState('networkidle');
  const refreshRequest = page.waitForRequest(request => new URL(request.url()).pathname === '/api/app/bootstrap');
  holdBootstrap = true; current = status('maintenance', 1); await check(page);
  await refreshRequest;
  await page.locator('[data-maintenance-notice]:not([hidden])').waitFor();
  holdBootstrap = false; releaseBootstrap();
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => document.querySelector('#support-widget [data-support-error]').textContent.includes('维护期间'));
  assert.equal(await send.isDisabled(), true); assert.equal(await input.inputValue(), '维护期间保留这条草稿');
  await page.locator('#support-widget form').evaluate(form => form.requestSubmit());
  assert.equal(session.state.messages.length, 0);
  await page.waitForLoadState('networkidle');
  const calls = session.calls.length; await page.clock.fastForward(40000);
  assert.equal(session.calls.length, calls, 'maintenance stops new customer business polling and heartbeats');
  current = status('normal', 2); await check(page);
  await page.waitForFunction(() => !document.querySelector('#support-widget [data-support-send]').disabled);
  assert.equal(await input.inputValue(), '维护期间保留这条草稿'); assert.equal(session.state.messages.length, 0);
  await send.click(); await page.locator('#support-widget [data-support-message]').filter({ hasText: '维护期间保留这条草稿' }).waitFor();
  assert.equal(session.state.messages.length, 1); assert.deepEqual(session.errors, []);
});

test('an operator desk preserves its reply draft while business controls and heartbeats pause', async t => {
  const session = await supportFixture(t, supportEnvironment); let current = status();
  await routeStatus(session.context, () => current);
  const page = await session.operatorPage('/zh');
  const input = page.locator('[data-support-console] [data-support-text]');
  await input.fill('客服回复草稿');
  current = status('maintenance', 1); await check(page);
  await page.waitForFunction(() => document.querySelector('[data-support-console] [data-support-error]').textContent.includes('维护期间'));
  assert.equal(await page.locator('[data-support-console] [data-support-send]').isDisabled(), true);
  assert.equal(await input.inputValue(), '客服回复草稿');
  current = status('normal', 2); await check(page);
  await page.waitForFunction(() => !document.querySelector('[data-support-console] [data-support-send]').disabled);
  assert.equal(await input.inputValue(), '客服回复草稿'); assert.equal(session.state.messages.length, 0);
  assert.deepEqual(session.errors, []);
});

test('operator retries maintenance logout after reload without opening a replacement session', async t => {
  const desk = await supportFixture(t, supportEnvironment);
  let current = status();
  await routeStatus(desk.context, () => current);
  const page = await desk.operatorPage();
  current = status('maintenance', 1);
  await check(page);
  await page.waitForFunction(() => document.querySelector('[data-support-console] [data-support-error]').textContent.includes('维护期间'));
  const attempts = [];
  let reads = 0;
  await desk.context.route('**/api/support/session', route => {
    const req = route.request();
    if (req.method() !== 'DELETE') { reads++; return route.fallback(); }
    attempts.push(req.headers());
    if (attempts.length === 1) return route.fulfill({ status: 503, json: { error: 'Try again' } });
    return route.fallback();
  });
  await page.locator('[data-support-logout]').click();
  await page.locator('[data-support-session-error]').filter({ hasText: '退出登录尚未完成，请重新点击退出登录。' }).waitFor();
  const readsBeforeReload = reads;
  await page.reload();
  await page.locator('[data-support-logout]').waitFor();
  assert.equal(await page.locator('.support-console-workspace').count(), 0);
  await page.locator('[data-support-logout]').click();
  await page.waitForURL(url => url.pathname === '/cdn-cgi/access/logout');
  assert.equal(reads, readsBeforeReload, "a pending logout must not bootstrap an operator on reload");
  assert.equal(attempts.length, 2);
  for (const headers of attempts) {
    assert.equal(headers['x-fells-support-audience'], 'operator');
    assert.equal(headers['x-fells-expected-operator'], '84');
    assert.equal(headers['x-fells-expected-operator-session'], 'b'.repeat(64));
    assert.equal(headers.origin, new URL(supportEnvironment.base).origin);
  }
  assert.equal(desk.state.operatorSignedIn, false);
});

for (const operator of [false, true]) test(`the actual blocked edge document can finish a pending ${operator ? 'operator' : 'customer'} logout after reload`, async t => {
  const { context, page, base } = await fixture.setup(t);
  const host = new URL(base).hostname;
  const state = status('maintenance', 11);
  const env = { PUBLIC_HOSTS: operator ? '' : host, OPERATOR_HOSTS: operator ? host : '',
    MAINTENANCE: { idFromName: () => 1, get: () => ({ fetch: () => Response.json(state) }) } };
  const key = operator ? 'fells.operator.pending-logout.v1' : 'fells.customer.logout.v1';
  const binding = 'd'.repeat(64);
  const record = operator ? { id: '84', fingerprint: binding, authMethod: 'access' } : { at: Date.now(), identity: { userId: 42, sessionId: binding } };
  await page.goto(base + '/');
  await page.evaluate(([k, v, isOperator]) => {
    localStorage.setItem(k, JSON.stringify(v));
    document.cookie = (isOperator ? '__Host-fells-pending-operator-logout' : '__Host-fells-pending-logout') + '=1; Path=/; Secure; SameSite=Strict';
  }, [key, record, operator]);
  const path = operator ? '/zh/support/desk/' : '/zh/app/';
  const api = operator ? '/api/support/session' : '/api/app/session';
  const attempts = [];
  await context.route('**/cdn-cgi/access/logout', route => route.fulfill({ contentType: 'text/html', body: '<title>Signed out</title>' }));
  await context.route(url => [path, api].includes(url.pathname), async route => {
    const req = route.request();
    const incoming = new Request(req.url(), { method: req.method(), headers: await req.allHeaders() });
    const reply = await handleFetch(incoming, env, forwarded => {
      assert.equal(new URL(forwarded.url).pathname, api);
      assert.equal(forwarded.method, 'DELETE');
      attempts.push(forwarded.headers.get(operator ? 'X-Fells-Expected-Operator-Session' : 'X-Fells-Expected-Session'));
      return attempts.length === 1 ? Response.json({}, { status: 503 }) : Response.json(operator ? { ok: true, data: null } : { ok: true });
    });
    await route.fulfill({ status: reply.status, headers: Object.fromEntries(reply.headers), body: await reply.text() });
  });
  assert.equal((await page.goto(base + path)).status(), 503);
  const button = page.locator('#pending-logout button');
  await button.click();
  await page.waitForFunction(() => !document.querySelector('#pending-logout button').disabled);
  assert.equal(await page.evaluate(k => localStorage.getItem(k), key), JSON.stringify(record));
  await page.reload();
  await button.click();
  if (operator) await page.waitForURL(url => url.pathname === '/cdn-cgi/access/logout');
  else await page.locator('#pending-logout p').filter({ hasText: '已退出' }).waitFor();
  assert.deepEqual(attempts, [binding, binding]);
  const saved = await page.evaluate(k => JSON.parse(localStorage.getItem(k)), key);
  if (operator) assert.equal(saved, null);
  else assert.deepEqual(saved, { at: record.at, changed: false });
});
