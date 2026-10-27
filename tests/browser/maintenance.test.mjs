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
  let writes = 0;
  await context.route('**/api/app/**', route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() !== 'GET') { writes++; return route.fulfill({ status: 503, json: { error: 'unexpected write' } }); }
    if (path === '/api/app/session') return route.fulfill({ status: 401, json: { error: 'unauthorized' } });
    if (path === '/api/app/auth/config') return route.fulfill({ json: { signup_enabled: true, email_enabled: true, github_enabled: true, min_password_length: 8, turnstile_site_key: '' } });
    if (path === '/api/app/agreement') return route.fulfill({ json: { version: 'v1', h1: 'Terms', lede: 'Service terms', clauses: [], ui: {} } });
    return route.fulfill({ status: 401, json: { error: 'unauthorized' } });
  });
  await page.goto(base + '/app/start/');
  await page.locator('#auth-email:not([disabled])').waitFor();
  await page.locator('#auth-email').fill('keep-me@example.test'); await page.locator('#auth-password').fill('private-password');
  current = status('maintenance', 1); await check(page);
  await page.locator('[data-maintenance-notice]:not([hidden])').waitFor();
  assert.equal(await page.locator('[data-auth-form] [type=submit]').isDisabled(), true);
  assert.equal(await page.locator('#auth-email').inputValue(), 'keep-me@example.test');
  assert.equal(await page.locator('#auth-password').inputValue(), 'private-password');
  await page.locator('[data-github]').click(); assert.match(page.url(), /\/app\/start\/$/);
  await page.locator('[data-auth-form]').evaluate(form => form.requestSubmit()); assert.equal(writes, 0);
  current = status('normal', 2); await check(page);
  await page.locator('#auth-email:not([disabled])').waitFor();
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
