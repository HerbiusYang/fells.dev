import nodeTest, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { trackCoverage } from '../helpers/browser.mjs';
const test = (name, fn) => process.env.FELLS_BACKEND_ORIGIN
  ? nodeTest(name, fn)
  : nodeTest(name, { skip: 'Set FELLS_BACKEND_ORIGIN and seed isolated browser accounts' }, fn);

// Production assets and headers, with a test-only same-origin proxy to a REAL
// isolated local backend. No app records or successful API replies are mocked.
// Seed two disposable users with self_keys=true before running this suite.
const dist = resolve(process.env.TEST_DIST_DIR || 'dist');
const backend = new URL(process.env.FELLS_BACKEND_ORIGIN || 'http://127.0.0.1:18080');
const username = process.env.FELLS_BROWSER_USER || 'browser-test';
const otherUsername = process.env.FELLS_BROWSER_USER2 || 'browser-test2';
const password = process.env.FELLS_BROWSER_PASSWORD || 'FellsLocal2026!';
const runPrefix = `security-${randomUUID().slice(0, 8)}-`;
const baselines = new Map();
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.json': 'application/json' };
let server, browser, base, sequence = 0;

function proxy(req, res) {
  const transport = backend.protocol === 'https:' ? httpsRequest : httpRequest;
  const headers = { ...req.headers };
  // Preserve browser Host/Origin and Set-Cookie so CSRF and session checks run
  // exactly as they do through the frontend development proxy.
  delete headers.connection;
  const upstream = transport(new URL(req.url, backend), { method: req.method, headers }, reply => {
    res.writeHead(reply.statusCode, reply.headers);
    reply.pipe(res);
  });
  req.on('aborted', () => upstream.destroy());
  res.on('close', () => upstream.destroy());
  upstream.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' }); res.end('{"error":"Local test backend unavailable"}'); });
  req.pipe(upstream);
}

before(async () => {
  if (!process.env.FELLS_BACKEND_ORIGIN) return;
  const headerText = await readFile(resolve(dist, '_headers'), 'utf8');
  const headers = Object.fromEntries([...headerText.matchAll(/^  ([^:]+): (.+)$/gm)].map(([, k, v]) => [k, v]));
  server = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname.startsWith('/api/app/') || pathname.startsWith('/api/support/')) { proxy(req, res); return; }
    try {
      let path = resolve(dist, '.' + decodeURIComponent(pathname));
      if (!path.startsWith(dist + '/') && path !== dist) { res.writeHead(403).end(); return; }
      if ((await stat(path)).isDirectory()) path += '/index.html';
      res.writeHead(200, { ...headers, 'content-type': mime[extname(path)] || 'application/octet-stream' });
      res.end(await readFile(path));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (!existsSync(chromium.executablePath()) && existsSync(chrome) ? chrome : undefined);
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  for (const user of [username, otherUsername]) {
    const context = await browser.newContext();
    try {
      await loginAPI(context, user);
      // Remove only this suite's named fixtures left by an interrupted run.
      const fixtureName = /^security-[a-f0-9]{8}-\d+-/;
      for (const w of (await data(context, '/api/app/workspaces')).workspaces || []) if (w.role === 'owner' && fixtureName.test(w.name)) {
        assert.equal((await raw(context, `/api/app/workspaces/${w.id}`, { method: 'DELETE' })).status(), 204);
      }
      for (const key of (await data(context, '/api/app/keys')).keys || []) if (fixtureName.test(key.name)) {
        assert.equal((await raw(context, `/api/app/keys/${key.id}`, { method: 'DELETE' })).status(), 200);
      }
      baselines.set(user, { profile: (await data(context, '/api/app/profile')).profile, preferences: await data(context, '/api/app/preferences') });
      await endAPI(context);
    } finally { await context.close(); }
  }
});
after(async () => {
  await browser?.close();
  if (server) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

function identityHeaders(b) {
  return { Origin: base, 'X-Fells-Expected-User': String(b.user.id), 'X-Fells-Expected-Session': b.session_id };
}
async function bootstrap(context) {
  const response = await context.request.get(base + '/api/app/bootstrap');
  assert.equal(response.status(), 200, 'real authenticated bootstrap');
  return response.json();
}
async function raw(context, path, options = {}) {
  const { identity, ...requestOptions } = options;
  const b = identity || await bootstrap(context);
  return context.request.fetch(base + path, { ...requestOptions, headers: { ...identityHeaders(b), ...requestOptions.headers } });
}
async function data(context, path, options = {}, expectedStatus = 200) {
  const response = await raw(context, path, options);
  assert.equal(response.status(), expectedStatus, `${options.method || 'GET'} ${path}`);
  return response.json();
}
async function loginAPI(context, user = username) {
  const response = await context.request.post(base + '/api/app/session', { headers: { Origin: base }, data: { username: user, password, turnstile_token: '' } });
  assert.equal(response.status(), 200, 'real test-user login');
  return bootstrap(context);
}
async function endAPI(context) {
  const b = await bootstrap(context);
  const response = await raw(context, '/api/app/session', { method: 'DELETE', identity: b });
  assert.equal(response.status(), 200, 'revoke test session');
}
async function cleanup(user) {
  // Separate cookie jar: cleanup remains possible after the tested cookie has
  // been revoked/replaced, without sharing any human browser's session.
  const context = await browser.newContext();
  try {
    await loginAPI(context, user);
    const { workspaces } = await data(context, '/api/app/workspaces');
    for (const w of workspaces || []) if (w.role === 'owner' && w.name.startsWith(runPrefix)) {
      const response = await raw(context, `/api/app/workspaces/${w.id}`, { method: 'DELETE' });
      assert.equal(response.status(), 204, 'remove test-owned workspace');
    }
    const { keys } = await data(context, '/api/app/keys');
    for (const key of keys || []) if (key.name.startsWith(runPrefix)) {
      const response = await raw(context, `/api/app/keys/${key.id}`, { method: 'DELETE' });
      assert.equal(response.status(), 200, 'remove test-owned API key');
    }
    const initial = baselines.get(user);
    await data(context, '/api/app/profile', { method: 'POST', data: { name: initial.profile.name, ...(typeof initial.profile.avatar === 'number' ? { avatar: initial.profile.avatar } : {}) } });
    await data(context, '/api/app/preferences', { method: 'POST', data: initial.preferences });
    await endAPI(context);
  } finally { await context.close(); }
}
async function setup(t, options = {}) {
  const context = await browser.newContext({ reducedMotion: 'reduce', ...options });
  await trackCoverage(context, options);
  const touchedUsers = new Set();
  t.after(async () => {
    try { for (const user of touchedUsers) await cleanup(user); }
    finally { await context.unrouteAll({ behavior: 'ignoreErrors' }); await context.close(); }
  });
  const errors = [], writes = [];
  context.on('page', page => {
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', req => { if (new URL(req.url()).pathname.startsWith('/api/app/') && !['GET', 'HEAD'].includes(req.method())) writes.push({ path: new URL(req.url()).pathname, method: req.method() }); });
  });
  await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.__testUsers = touchedUsers;
  page.__testErrors = errors;
  return { context, page, errors, writes, touchedUsers };
}
async function idle(page) { await page.waitForFunction(() => document.querySelector('#fx')?.getAttribute('aria-busy') !== 'true'); }
async function enter(page, prefix = '', user = username) {
  page.__testUsers?.add(user);
  await page.goto(base + prefix + '/app/start/');
  await page.locator('#auth-email:not([disabled])').fill(user);
  await page.locator('#auth-password').fill(password);
  await page.locator('[data-auth-form] [type=submit]').click();
  try { await page.locator('#fx .sb').waitFor(); }
  catch (error) {
    const state = { url: page.url(), app: await page.locator('#fx').textContent().catch(() => ''), message: await page.locator('[data-msg]').first().textContent().catch(() => ''), pageErrors: page.__testErrors || [] };
    throw new Error(`Real app did not initialize: ${JSON.stringify(state)}`, { cause: error });
  }
  // The test users may already have persisted onboarding preferences.
  const skip = page.locator('[data-act=ob-skip]');
  if (await skip.count()) { await skip.click(); await page.locator('.scrim').waitFor({ state: 'detached' }); }
  await idle(page);
}
function uniqueName(label) { return runPrefix + (++sequence) + '-' + label; }
async function openSidebar(page) {
  const needsOpening = await page.evaluate(() => {
    const root = document.querySelector('#fx');
    return innerWidth <= 860 ? !root.classList.contains('sb-open') : root.classList.contains('sb-hidden');
  });
  if (needsOpening) { await page.locator('[data-act=sb]').click(); await idle(page); }
  // The class identifies intent; actual position and hit testing identify when
  // the responsive transition has finished enough for a normal user click.
  await page.waitForFunction(() => {
    const root = document.querySelector('#fx'), button = root?.querySelector('[data-act=switcher]');
    if (!button || (innerWidth <= 860 ? !root.classList.contains('sb-open') : root.classList.contains('sb-hidden'))) return false;
    const box = button.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0 || box.left < 0 || box.top < 0 || box.right > innerWidth || box.bottom > innerHeight || getComputedStyle(button).visibility !== 'visible') return false;
    return button.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
  });
}
async function workspace(page, name = uniqueName('workspace')) {
  await openSidebar(page);
  await page.locator('[data-act=switcher]').click();
  await page.locator('.pop [data-act=new-ws]').click();
  await page.locator('[data-form=new-ws] [name=name]').fill(name);
  await page.locator('[data-form=new-ws] .btn.pri').click();
  await page.locator('.scrim').waitFor({ state: 'detached' });
  await page.locator('#fx-input').waitFor();
  const list = await data(page.context(), '/api/app/workspaces');
  const w = list.workspaces.find(w => w.name === name);
  assert.ok(w, 'UI created a real backend workspace');
  return w;
}
async function go(page, path) {
  await idle(page);
  await page.evaluate(path => { location.hash = '#/' + path; }, path);
  await page.waitForFunction(path => document.querySelector('#fx')?.dataset.route === '#/' + path, path);
}
async function chats(context, ws) { return (await data(context, `/api/app/workspaces/${ws.id}/chats`)).chats || []; }
async function send(page, text) {
  await page.locator('#fx-input').fill(text);
  await page.locator('[data-form=send] .send').click();
  await idle(page);
}
async function logout(page) {
  await page.locator('[data-act=account]').click();
  await page.locator('[data-act=logout]').click();
  await page.waitForURL(/\/app\/start\/?$/);
}
async function storageDump(page) {
  return page.evaluate(async () => ({ local: { ...localStorage }, session: { ...sessionStorage }, databases: await indexedDB.databases() }));
}
async function disableSync(context) {
  await context.addInitScript(() => {
    window.BroadcastChannel = undefined;
    const add = window.addEventListener.bind(window);
    window.addEventListener = (type, ...args) => { if (!['focus', 'pageshow', 'fells.session.changed'].includes(type)) add(type, ...args); };
  });
}

for (const prefix of ['', '/zh', '/zh-hant', '/ja', '/ko', '/es']) {
  test(`localized real-account entry and read-only example route smoke: ${prefix || 'en'}`, async t => {
    const { page, errors } = await setup(t);
    await page.goto(base + prefix + '/app/start/');
    assert.equal(await page.locator('#auth-password').getAttribute('type'), 'password');
    await enter(page, prefix);
    assert.equal((await bootstrap(page.context())).user.username, username);
    await page.locator('[data-act=switcher]').click();
    await page.locator('.pop [data-act=switch][data-id=example]').click();
    await idle(page);
    for (const path of ['new', 'members', 'ws-settings/0', 'ws-settings/1', 'ws-settings/2', 'ws-settings/3', 'ws-settings/4', 'settings/0', 'settings/1', 'settings/2', 'api', 'billing/credits', 'billing/market']) {
      await go(page, path);
      assert.ok((await page.locator('#fx-main').innerText()).length > 20, path);
    }
    assert.equal((await storageDump(page)).databases.some(db => db.name === 'fells.preview.v2'), false);
    assert.deepEqual(errors, []);
  });
}

test('workspace/chat/profile/preferences/API-key UI writes persist on the real server without XSS', async t => {
  const { context, page, errors } = await setup(t);
  page.on('dialog', dialog => dialog.accept());
  await enter(page);
  const ws = await workspace(page);
  const body = '<img src=x onerror="window.__injected=1"> literal text';
  await send(page, body);
  assert.equal(await page.locator('.msg-body').innerText(), body);
  assert.equal(await page.evaluate(() => window.__injected), undefined);
  assert.match(await page.locator('#fx-main').innerText(), /not configured/);
  await send(page, 'Second instruction');
  const [chat] = await chats(context, ws);
  assert.deepEqual(chat.messages, [['you', body], ['you', 'Second instruction']]);
  assert.equal(chat.message_metadata.every(m => !m.imported && m.author_user_id === (chat.message_metadata[0].author_user_id)), true);
  const profileName = '<svg onload=window.__injected=2>';
  await go(page, 'settings/0');
  await page.locator('[data-form=profile] [name=name]').fill(profileName);
  await page.locator('[data-form=profile] .btn.pri').click(); await idle(page);
  assert.equal((await data(context, '/api/app/profile')).profile.name, profileName, 'profile submit persists the typed name immediately');
  const avatarChooser = page.waitForEvent('filechooser');
  await page.locator('[data-act=avatar-upload]').click();
  const avatarSaved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/app/avatar' && response.request().method() === 'POST' && response.status() === 200);
  await (await avatarChooser).setFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1UAAAAASUVORK5CYII=', 'base64') });
  await avatarSaved; await idle(page);
  const uploadedProfile = (await data(context, '/api/app/profile')).profile;
  assert.equal(uploadedProfile.name, profileName, 'avatar upload preserves the saved name');
  const privateAvatar = uploadedProfile.avatar;
  assert.match(privateAvatar, /^(?:data:image\/jpeg;base64,|\/api\/app\/avatar(?:\?|$))/);
  assert.equal(JSON.stringify(await storageDump(page)).includes('data:image/jpeg'), false);
  const avatarResponse = await raw(context, '/api/app/avatar');
  assert.equal(avatarResponse.status(), 200);
  assert.equal(avatarResponse.headers()['content-type'], 'image/jpeg');
  assert.match(avatarResponse.headers()['cache-control'], /private.*no-store/);
  const anonymous = await browser.newContext();
  try { assert.equal((await anonymous.request.get(base + '/api/app/avatar')).status(), 401); }
  finally { await anonymous.close(); }
  await page.locator('[data-act=avatar-remove]').click(); await idle(page);
  const removedProfile = (await data(context, '/api/app/profile')).profile;
  assert.equal(removedProfile.avatar, 0);
  assert.equal(removedProfile.name, profileName, 'avatar removal preserves the saved name');
  await go(page, 'settings/1');
  await page.locator('[data-act=theme][data-v=dark]').click(); await idle(page);
  await page.locator('[data-input=prefAgent]').selectOption('claude'); await idle(page);
  await page.locator('[data-act=send-key][data-i="1"]').click(); await idle(page);
  await go(page, 'settings/2');
  const before = await data(context, '/api/app/preferences');
  await page.locator('[data-act=notif][data-i="0"]').click(); await idle(page);
  await go(page, 'api');
  for (const range of [1, 2, 0]) {
    const since = await page.evaluate(range => range === 2 ? Math.floor(new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime() / 1000) : Math.floor(Date.now() / 1000) - [7, 30][range] * 86400, range);
    const requests = ['/api/app/usage', '/api/app/logs'].map(path => page.waitForRequest(req => {
      const url = new URL(req.url());
      return url.pathname === path && Math.abs(Number(url.searchParams.get('since')) - since) <= 2;
    }));
    await page.locator(`[data-act=api-range][data-i="${range}"]`).click();
    for (const request of await Promise.all(requests)) {
      assert.ok(Math.abs(Number(new URL(request.url()).searchParams.get('since')) - since) <= 2, '7-day/30-day/month-to-date API window matches its selected label');
      assert.equal(request.headers()['x-fells-expected-user'], String((await bootstrap(context)).user.id));
    }
  }
  await page.locator('[data-act=new-key]').click();
  const keyName = uniqueName('key');
  await page.locator('[data-form=key] [name=name]').fill(keyName);
  await page.locator('[data-form=key] [name=limit]').fill('5');
  await page.locator('[data-form=key] .btn.pri').click();
  await page.locator('.dlg pre').waitFor();
  const secret = await page.locator('.dlg pre').innerText();
  assert.ok(secret.length >= 30 && secret.startsWith('sk-'), 'one-time real key is displayed');
  const keyList = await data(context, '/api/app/keys');
  const key = keyList.keys.find(k => k.name === keyName);
  assert.ok(key, 'server issued the UI key');
  assert.equal(key.monthly_allow_limit_micro, 5_000_000);
  assert.equal(JSON.stringify(keyList).includes(secret), false);
  assert.equal(JSON.stringify(await storageDump(page)).includes(secret), false);
  await page.locator('.dlg [data-act=close]').last().click();
  await page.locator(`[data-act=key-limit][data-id="${key.id}"]`).click();
  await page.locator('[data-form=key-limit] [name=limit]').fill('7.000001');
  await page.locator('[data-form=key-limit] .btn.pri').click();
  await page.locator('.scrim').waitFor({ state: 'detached' });
  assert.equal((await data(context, '/api/app/keys')).keys.find(k => k.id === key.id).monthly_allow_limit_micro, 7_000_001);
  await page.reload(); await page.locator('#fx .sb').waitFor();
  const profile = (await data(context, '/api/app/profile')).profile;
  const prefs = await data(context, '/api/app/preferences');
  assert.equal(profile.name, profileName); assert.equal(prefs.theme, 'dark');
  assert.equal(prefs.prefs.agent, 'claude'); assert.equal(prefs.prefs.send, 1); assert.equal(prefs.notifs[0], !before.notifs[0]);
  assert.equal(await page.evaluate(() => window.__injected), undefined);
  assert.equal(await page.locator('#fx .me-btn img').count(), 0);
  await page.locator(`[data-act=revoke][data-id="${key.id}"]`).click(); await idle(page);
  const revoked = (await data(context, '/api/app/keys')).keys.find(k => k.id === key.id);
  assert.ok(!revoked || revoked.revoked, 'revoked key is no longer usable');
  await go(page, 'chat/' + chat.id);
  assert.equal(await page.locator('.msg-body').count(), 2);
  await page.locator('[data-act=del-chat]').click(); await idle(page);
  assert.deepEqual(await chats(context, ws), []);
  assert.deepEqual(errors, []);
});

test('a delayed real usage response cannot replace a focused profile draft before it is saved', async t => {
  const { context, page, errors } = await setup(t);
  await enter(page); await go(page, 'api');
  const since = await page.evaluate(() => Math.floor(Date.now() / 1000) - 30 * 86400);
  const isDelayedQuery = req => {
    const url = new URL(req.url());
    return url.pathname === '/api/app/usage' && Math.abs(Number(url.searchParams.get('since')) - since) <= 2;
  };
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  let delayed = false;
  await page.route('**/api/app/usage?*', async route => {
    if (!delayed && isDelayedQuery(route.request())) {
      delayed = true;
      const response = await route.fetch(); // Actual authenticated backend reply.
      await blocked;
      await route.fulfill({ response }); // Delay delivery without modifying it.
    } else await route.continue();
  });
  try {
    const requested = page.waitForRequest(isDelayedQuery);
    const delivered = page.waitForResponse(response => isDelayedQuery(response.request()));
    await page.locator('[data-act=api-range][data-i="1"]').click();
    await requested;
    await go(page, 'settings/0');
    const name = uniqueName('focused-name');
    const input = page.locator('[data-form=profile] [name=name]');
    await input.fill(name);
    release();
    const response = await delivered;
    assert.equal(response.status(), 200, 'delayed reply came from the real backend');
    await response.finished();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await input.inputValue(), name, 'background reading preserves the focused draft');
    await page.locator('[data-form=profile] .btn.pri').click(); await idle(page);
    assert.equal((await data(context, '/api/app/profile')).profile.name, name, 'the retained draft is genuinely saved');
    assert.deepEqual(errors, []);
  } finally { release(); }
});

test('explicit JSON history import retains provenance and a later real user message cannot erase system history', async t => {
  const { context, page, errors } = await setup(t);
  page.on('dialog', dialog => dialog.accept());
  await enter(page); const ws = await workspace(page);
  const history = { title: 'Imported historical session', agent: 'codex', model: 'historical-model', messages: [['you', 'Old instruction'], ['sys', 'Historical status, not a live execution'], ['agent', '<img src=x onerror="window.__injected=1"> historical reply']] };
  await go(page, 'import');
  const chooser = page.waitForEvent('filechooser');
  await page.locator('[data-act=import-history]').click();
  const saved = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/chats/import') && response.status() === 201);
  await (await chooser).setFiles({ name: 'history.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(history)) });
  await saved; await page.waitForFunction(() => document.querySelector('#fx')?.dataset.route === '#/new'); await idle(page);
  const [chat] = await chats(context, ws);
  assert.deepEqual(chat.messages, history.messages);
  assert.equal(chat.message_metadata.every(m => m.imported), true);
  assert.equal(chat.message_metadata[0].author_user_id, (await bootstrap(context)).user.id);
  assert.equal((await raw(context, `/api/app/chats/${chat.id}/messages/${chat.message_metadata[0].id}`, { method: 'PATCH', data: { body: 'Forbidden imported-history edit' } })).status(), 403);
  await go(page, 'chat/' + chat.id);
  assert.equal(await page.locator('.thread .msg-who .tag').filter({ hasText: 'Imported history' }).count(), 2);
  assert.equal(await page.evaluate(() => window.__injected), undefined);
  assert.equal(await page.locator('.thread img').count(), 0);
  await send(page, 'Current real user instruction');
  const updated = (await data(context, '/api/app/chats/' + chat.id)).chat;
  assert.deepEqual(updated.messages, [...history.messages, ['you', 'Current real user instruction']]);
  assert.equal(updated.message_metadata.at(-1).imported, false);
  assert.equal(updated.message_metadata.at(-1).author_user_id, (await bootstrap(context)).user.id);
  assert.equal(await page.locator('.thread .msg').last().locator('.msg-who .tag').count(), 0, 'the newly appended real instruction is not labeled as imported history');
  await page.reload(); await page.locator('.sys').waitFor();
  assert.equal(await page.locator('.sys').innerText(), history.messages[1][1]);
  assert.deepEqual(errors, []);
});

test('a failed second history import reports partial delivery and later saves use the refreshed server snapshot', async t => {
  const { context, page, errors } = await setup(t);
  page.on('dialog', dialog => dialog.accept());
  await enter(page); const ws = await workspace(page);
  let imports = 0;
  await page.route('**/api/app/workspaces/*/chats/import', async route => {
    if (++imports === 2) await route.fulfill({ status: 503, json: { error: 'Deliberate second-history failure' } });
    else await route.continue();
  });
  await go(page, 'import');
  const chooser = page.waitForEvent('filechooser');
  await page.locator('[data-act=import-history]').click();
  const failed = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/chats/import') && response.status() === 503);
  const history = { chats: [1, 2].map(i => ({ title: `Partial history ${i}`, agent: 'codex', model: 'historical-model', messages: [['agent', `Historical reply ${i}`]] })) };
  await (await chooser).setFiles({ name: 'partial-history.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(history)) });
  await failed; await idle(page);
  await page.locator('.toast').filter({ hasText: /1.*2|1.*saved|1.*imported/i }).waitFor();
  const stored = await chats(context, ws);
  assert.equal(stored.length, 1); assert.equal(stored[0].title, 'Partial history 1');
  assert.equal(stored[0].message_metadata[0].imported, true);
  await go(page, 'new'); await send(page, 'New instruction after partial import');
  const next = await chats(context, ws);
  assert.equal(next.length, 2, 'fresh snapshot permits a subsequent real mutation');
  assert.equal(next.some(c => c.messages.length === 1 && c.messages[0][0] === 'you' && c.messages[0][1] === 'New instruction after partial import'), true);
  assert.deepEqual(errors, []);
});

test('retired environment/files/plugins/schedules routes cannot create secrets or simulate execution', async t => {
  const { context, page, writes } = await setup(t);
  await enter(page); const ws = await workspace(page);
  const capabilities = (await bootstrap(context)).capabilities;
  for (const key of ['agent_execution', 'cloud_computer', 'workspace_files', 'plugins', 'scheduled_tasks']) assert.equal(capabilities[key], false);
  const start = writes.length;
  for (const path of ['files','canvas','plugins','sites','schedules']) {
    await go(page, path);
    assert.match(await page.locator('#fx-main').innerText(), /404/);
    assert.equal(await page.locator('[data-form=env],[data-form=prompt],[data-form=schedule],[data-act=upload],[data-act=restart]').count(), 0);
  }
  await go(page, 'ws-settings/1');
  assert.equal(await page.locator('[data-form=env]').count(), 0);
  assert.deepEqual(writes.slice(start), []);
  assert.equal(JSON.stringify(await data(context, `/api/app/workspaces/${ws.id}`)).includes('TEST-SECRET'), false);
  assert.deepEqual(await chats(context, ws), []);
});

test('real logout revokes server cookie, resets other tabs and cannot recover through back navigation', async t => {
  const { context, page, touchedUsers } = await setup(t);
  await enter(page); const ws = await workspace(page);
  await send(page, 'Persisted before logout');
  const old = await bootstrap(context), cookie = await context.cookies(base);
  const second = await context.newPage(); second.__testUsers = touchedUsers;
  await second.goto(base + '/app/'); await second.locator('#fx .sb').waitFor();
  await logout(page); await second.waitForURL(/\/app\/start\/?$/);
  assert.equal((await context.request.get(base + '/api/app/bootstrap')).status(), 401);
  // Replaying the original signed cookie in an independent jar must fail too.
  const replay = await browser.newContext();
  try {
    await replay.addCookies(cookie);
    assert.equal((await raw(replay, `/api/app/workspaces/${ws.id}`, { method: 'PATCH', identity: old, data: { name: uniqueName('forbidden') } })).status(), 401);
  } finally { await replay.close(); }
  await page.goto(base + '/app/'); await page.waitForURL(/\/app\/start\/?$/);
  await page.goBack(); await page.waitForURL(/\/app\/start\/?$/);
  assert.equal(await page.locator('#fx-input').count(), 0);
  await enter(page);
  assert.equal((await chats(context, ws))[0].messages[0][1], 'Persisted before logout');
});

for (const nextUser of [username, otherUsername]) {
  test(`replacement login rejects old-tab and old-cookie writes: ${nextUser === username ? 'same user' : 'different user'}`, async t => {
    const { context, page, touchedUsers } = await setup(t);
    await disableSync(context);
    await enter(page); const ws = await workspace(page);
    await send(page, 'Private original-user instruction');
    const old = await bootstrap(context), cookie = await context.cookies(base);
    const next = await context.newPage(); next.__testUsers = touchedUsers;
    touchedUsers.add(nextUser); await loginAPI(context, nextUser);
    await next.goto(base + '/app/'); await next.locator('#fx .sb').waitFor();
    const replacement = await bootstrap(context);
    assert.notEqual(replacement.session_id, old.session_id);
    assert.equal(replacement.user.username, nextUser);
    // Disable all app notifications to prove this is server authorization.
    await go(page, 'settings/0');
    await page.locator('[data-form=profile] [name=name]').fill('Forbidden stale profile');
    await page.locator('[data-form=profile] .btn.pri').click();
    await page.waitForURL(/\/app\/start\/?$/);
    assert.notEqual((await data(context, '/api/app/profile')).profile.name, 'Forbidden stale profile');
    assert.equal((await raw(context, '/api/app/session', { method: 'DELETE', identity: old })).status(), 401);
    assert.equal((await bootstrap(context)).session_id, replacement.session_id, 'stale logout cannot revoke the replacement cookie');
    const replay = await browser.newContext();
    try {
      await replay.addCookies(cookie);
      assert.equal((await raw(replay, `/api/app/workspaces/${ws.id}`, { method: 'PATCH', identity: old, data: { name: uniqueName('forbidden') } })).status(), 401);
    } finally { await replay.close(); }
    if (nextUser !== username) {
      assert.equal((await data(context, '/api/app/workspaces')).workspaces.some(w => w.id === ws.id), false);
      assert.equal((await raw(context, `/api/app/workspaces/${ws.id}`)).status(), 404);
      assert.equal((await next.locator('#fx').innerText()).includes('Private original-user instruction'), false);
    }
  });
}

test('stale tabs cannot resurrect a deleted workspace when every synchronization notification is disabled', async t => {
  const { context, page } = await setup(t);
  await disableSync(context);
  await enter(page); const ws = await workspace(page);
  const second = await context.newPage(); await second.goto(base + '/app/#/settings/1');
  await second.locator('[data-act=theme][data-v=dark]').waitFor();
  await go(page, 'ws-settings/4');
  await page.locator('[data-form=del-ws] [name=name]').fill(ws.name);
  await page.locator('[data-form=del-ws] button').click(); await idle(page);
  const prefs = await data(context, '/api/app/preferences'), choice = prefs.theme === 'dark' ? 'light' : 'dark';
  await second.locator(`[data-act=theme][data-v=${choice}]`).click(); await idle(second);
  assert.match(await second.locator('.toast').innerText(), /Another tab/);
  assert.equal((await data(context, '/api/app/workspaces')).workspaces.some(w => w.id === ws.id), false);
  assert.equal((await data(context, '/api/app/preferences')).theme, prefs.theme);
  await second.locator(`[data-act=theme][data-v=${choice}]`).click(); await idle(second);
  assert.equal((await data(context, '/api/app/preferences')).theme, choice);
  assert.equal((await data(context, '/api/app/workspaces')).workspaces.some(w => w.id === ws.id), false);
});

test('actual chat API errors retain input, show no fake success and allow a real retry', async t => {
  const { context, page, errors } = await setup(t);
  await enter(page); const ws = await workspace(page);
  let failed = false;
  await page.route('**/api/app/chats', async route => {
    if (route.request().method() === 'POST' && !failed) {
      failed = true;
      await route.fulfill({ status: 503, json: { error: 'Deliberate test API failure' } });
    } else await route.continue();
  });
  await send(page, 'Retain my real draft');
  assert.equal(await page.locator('#fx-input').inputValue(), 'Retain my real draft');
  assert.match(await page.locator('.toast').innerText(), /Deliberate test API failure/);
  assert.deepEqual(await chats(context, ws), []);
  assert.equal(await page.locator('.msg-body').count(), 0);
  await send(page, 'Retried instruction');
  assert.deepEqual((await chats(context, ws))[0].messages, [['you', 'Retried instruction']]);
  let appendFailed = false;
  await page.route('**/api/app/chats/*/messages', async route => {
    if (route.request().method() === 'POST' && !appendFailed) {
      appendFailed = true;
      await route.fulfill({ status: 503, json: { error: 'Deliberate append API failure' } });
    } else await route.continue();
  });
  await send(page, 'Retain my existing-conversation draft');
  assert.equal(await page.locator('#fx-input').inputValue(), 'Retain my existing-conversation draft');
  assert.match(await page.locator('.toast').innerText(), /Deliberate append API failure/);
  assert.equal((await chats(context, ws))[0].messages.length, 1);
  await send(page, 'Retried appended instruction');
  assert.deepEqual((await chats(context, ws))[0].messages, [['you', 'Retried instruction'], ['you', 'Retried appended instruction']]);
  assert.deepEqual(errors, []);
});

test('oversize instruction is rejected without poisoning later real writes', async t => {
  const { context, page } = await setup(t);
  await enter(page); const ws = await workspace(page);
  await page.locator('#fx-input').evaluate(el => {
    el.value = 'x'.repeat(32769);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('[data-form=send] .send').click();
  await page.locator('.toast').filter({ hasText: /limit|限制|上限/i }).waitFor();
  assert.deepEqual(await chats(context, ws), []);
  await send(page, 'Small instruction');
  assert.deepEqual((await chats(context, ws))[0].messages, [['you', 'Small instruction']]);
});

test('malformed resource IDs are rejected by the real API and cannot inject HTML', async t => {
  const { context, page } = await setup(t);
  await enter(page); const ws = await workspace(page);
  const response = await raw(context, `/api/app/workspaces/${ws.id}/chats`, { method: 'POST', data: { id: 'x"><img src=x onerror="window.__injected=1">', ws: ws.id, title: 'Invalid ID', agent: 'codex', model: 'example-model', created: Date.now(), messages: [['you', 'Safe']] } });
  assert.equal(response.status(), 400);
  await page.reload(); await page.locator('#fx .sb').waitFor();
  assert.deepEqual(await chats(context, ws), []);
  assert.equal(await page.evaluate(() => window.__injected), undefined);
  assert.equal(await page.locator('#fx img').count(), 0);
});

test('no-script account form stays disabled and purchase page has no credential or money form', async t => {
  const { page } = await setup(t, { javaScriptEnabled: false });
  await page.goto(base + '/app/start/');
  const form = page.locator('[data-auth-form]');
  assert.equal(await form.getAttribute('method'), 'post');
  assert.equal(await form.locator('input:not([disabled]),button[type=submit]:not([disabled])').count(), 0);
  await page.goto(base + '/checkout/?mode=redeem');
  assert.equal(await page.locator('[data-checkout],input[name=cdk],input[type=password]').count(), 0);
  assert.equal(await page.locator('[data-open-customer-support]').count(), 1);
});

test('real support purchase entry tolerates missing IntersectionObserver and retired CDK/SKU parameters', async t => {
  const { context, page, touchedUsers, writes, errors } = await setup(t);
  touchedUsers.add(username); await loginAPI(context);
  await page.addInitScript(() => { window.IntersectionObserver = undefined; });
  for (const query of ['mode=redeem', 'plan=3500']) {
    await page.goto(base + '/checkout/?'+query);
    await page.locator('[data-open-customer-support]').waitFor();
    assert.equal(await page.locator('[data-checkout],input[name=cdk],[data-submit]').count(), 0);
    await page.locator('[data-open-customer-support]').click();
    await page.locator('#support-panel').waitFor({state:'visible'});
  }
  assert.deepEqual(writes, []);
  assert.deepEqual(errors, []);
});

test('retired workspace design previews are not published', async t => {
  const { page } = await setup(t);
  const response = await page.request.get(base + '/themes/synara/');
  assert.equal(response.status(), 404);
});

test('framing headers are emitted and app/entry fail closed if a host omits them', async t => {
  const { context, page } = await setup(t);
  const response = await page.goto(base + '/app/start/');
  assert.equal(response.headers()['x-frame-options'], 'DENY');
  assert.match(response.headers()['content-security-policy'], /frame-ancestors 'none'/);
  await context.route('**/app/**', async route => {
    const response = await route.fetch(), headers = response.headers();
    delete headers['content-security-policy']; delete headers['x-frame-options'];
    await route.fulfill({ response, headers });
  });
  await page.goto(base + '/');
  await page.evaluate(() => { const frame = document.createElement('iframe'); frame.src = '/app/'; document.body.append(frame); });
  const app = page.frameLocator('iframe');
  await app.locator('#fx').filter({ hasText: /own browser tab/ }).waitFor();
  assert.equal(await app.locator('.sb').count(), 0);
  await page.locator('iframe').evaluate(el => { el.src = '/app/start/'; });
  await app.locator('[data-msg]').filter({ hasText: /own browser tab/ }).waitFor();
  assert.equal(await app.locator('[type=submit]').isDisabled(), true);
});

test('native account submit remains POST and support purchase cannot leak retired CDK fields', async t => {
  const { page } = await setup(t);
  await page.goto(base + '/app/start/');
  await page.locator('#auth-email:not([disabled])').fill(username);
  await page.locator('#auth-password').fill('DUMMY-NATIVE-SECRET');
  const request = page.waitForRequest(req => req.isNavigationRequest() && req.method() === 'POST');
  await page.locator('[data-auth-form]').evaluate(form => HTMLFormElement.prototype.submit.call(form));
  const actual = await request;
  assert.equal(actual.url().includes(username), false);
  assert.equal(actual.url().includes('DUMMY-NATIVE'), false);
  assert.ok(actual.postData().includes('password=DUMMY-NATIVE-SECRET'));
  await page.goto(base + '/checkout/?mode=redeem');
  assert.equal(await page.locator('[data-checkout],input[name=cdk]').count(), 0);
  assert.equal(new URL(page.url()).search.includes('DUMMY-NATIVE'), false);

});

test('initial real API failure cannot enter a falsely successful app and reload can recover', async t => {
  const { context, page, touchedUsers, errors } = await setup(t);
  touchedUsers.add(username); await loginAPI(context);
  await page.route('**/api/app/bootstrap', route => route.fulfill({ status: 503, json: { error: 'Deliberate initial API outage' } }));
  await page.goto(base + '/app/');
  await page.locator('#fx').filter({ hasText: /Deliberate initial API outage/ }).waitFor();
  assert.equal(await page.locator('#fx .sb').count(), 0);
  assert.equal(await page.locator('#fx-input').count(), 0);
  await page.unroute('**/api/app/bootstrap');
  await page.reload(); await page.locator('#fx .sb').waitFor();
  assert.equal((await bootstrap(context)).user.username, username);
  assert.deepEqual(errors, []);
});

test('blocked browser storage cannot prevent real login or falsely claim local persistence', async t => {
  const { context, page, errors } = await setup(t);
  await page.addInitScript(() => {
    indexedDB.open = () => { throw new DOMException('Blocked IndexedDB', 'SecurityError'); };
    for (const name of ['localStorage', 'sessionStorage']) Object.defineProperty(window, name, { configurable: true, get() { throw new DOMException('Blocked optional storage', 'SecurityError'); } });
  });
  await enter(page); const ws = await workspace(page);
  await send(page, 'Server persistence works with optional browser storage blocked');
  await page.reload(); await page.locator('#fx .sb').waitFor();
  assert.deepEqual((await chats(context, ws))[0].messages, [['you', 'Server persistence works with optional browser storage blocked']]);
  assert.deepEqual(errors, []);
});

test('real owner/member UI and server permissions isolate a read-only workspace member', async t => {
  const { context, page, touchedUsers, errors } = await setup(t);
  await enter(page); const ws = await workspace(page);
  await send(page, 'Workspace-owner instruction');
  await go(page, 'members');
  await page.locator('[data-act=invite-link][data-role=viewer]').waitFor();
  await page.locator('[data-act=invite-link][data-role=viewer]').click();
  await page.locator('[data-form=prompt] [name=v]').fill(otherUsername);
  await page.locator('[data-form=prompt] .btn.pri').click();
  await page.locator('.scrim').waitFor({ state: 'detached' });
  await page.locator('.sb [data-go=members] .end').filter({ hasText: '2/32' }).waitFor();
  const { members } = await data(context, `/api/app/workspaces/${ws.id}/members`);
  const member = members.find(m => m.role === 'viewer');
  assert.ok(member, 'real account added by username');
  const viewer = await browser.newContext();
  touchedUsers.add(otherUsername);
  try {
    const b = await loginAPI(viewer, otherUsername);
    assert.equal(member.user_id, b.user.id);
    const { workspace: shared } = await data(viewer, `/api/app/workspaces/${ws.id}`);
    assert.equal(shared.role, 'viewer');
    const [chat] = await chats(viewer, ws);
    assert.match(chat.messages[0][0], /^user:/);
    assert.equal(chat.messages[0][1], 'Workspace-owner instruction');
    await viewer.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    const viewerPage = await viewer.newPage(); viewerPage.setDefaultTimeout(10000);
    viewerPage.on('pageerror', error => errors.push(error.message));
    await viewerPage.goto(base + '/app/'); await viewerPage.locator('#fx .sb').waitFor();
    const skip = viewerPage.locator('[data-act=ob-skip]');
    if (await skip.count()) { await skip.click(); await viewerPage.locator('.scrim').waitFor({ state: 'detached' }); }
    await viewerPage.locator('[data-act=switcher]').click();
    await viewerPage.locator(`.pop [data-act=switch][data-id="${ws.id}"]`).click(); await idle(viewerPage);
    await go(viewerPage, 'chat/' + chat.id);
    const authorName = chat.message_metadata[0].author_name;
    assert.ok(authorName, 'server supplies the real owner name');
    const displayedAuthor = await viewerPage.locator('.thread .msg-who').first().innerText();
    assert.ok(displayedAuthor.includes(authorName), 'shared instruction displays the real owner author');
    assert.doesNotMatch(displayedAuthor.trim(), /^(you|你)$/i, 'shared owner instruction must not be attributed to the visiting viewer');
    assert.equal(await viewerPage.locator('.thread .msg-who .av').first().count(), 1);
    assert.equal((await raw(viewer, `/api/app/chats/${chat.id}/messages`, { method: 'POST', data: { body: 'Forbidden viewer instruction' } })).status(), 403);
    assert.equal((await raw(viewer, `/api/app/workspaces/${ws.id}/members`, { method: 'POST', data: { username: 'no-such-account', role: 'editor' } })).status(), 403);
    await endAPI(viewer);
  } finally { await viewer.close(); }
  await page.locator(`[data-act=remove-member][data-id="${member.user_id}"]`).waitFor();
  await page.locator(`[data-act=remove-member][data-id="${member.user_id}"]`).click(); await idle(page);
  assert.equal((await data(context, `/api/app/workspaces/${ws.id}/members`)).members.length, 1);
  assert.deepEqual(errors, []);
});

test('mobile real workspace/model/chat rename and switching stay usable', async t => {
  const { context, page, errors } = await setup(t, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await enter(page); const ws = await workspace(page, uniqueName('mobile'));
  await page.locator('[data-act=agent][data-id=claude]').click();
  await page.locator('[data-act=model]').click();
  const modelName = await page.locator('[data-act=pick-model]').first().getAttribute('data-name');
  await page.locator('[data-act=pick-model]').first().click();
  await send(page, 'Mobile instruction');
  assert.equal((await chats(context, ws))[0].model, modelName);
  assert.deepEqual((await chats(context, ws))[0].messages, [['you', 'Mobile instruction']]);
  await go(page, 'ws-settings/0');
  const renamed = uniqueName('renamed');
  await page.locator('[data-form=rename] [name=name]').fill(renamed);
  await page.locator('[data-form=rename] button').click(); await idle(page);
  assert.equal((await data(context, `/api/app/workspaces/${ws.id}`)).workspace.name, renamed);
  await go(page, 'ws-settings/4');
  assert.equal(await page.locator('[data-act=export]').count(), 0, 'retired export action is not offered');
  await openSidebar(page); await page.locator('[data-act=switcher]').click();
  await page.locator('.pop [data-act=new-ws]').click();
  const secondName = uniqueName('mobile-second');
  await page.locator('[data-form=new-ws] [name=name]').fill(secondName);
  await page.locator('[data-form=new-ws] .btn.pri').click();
  await page.locator('.scrim').waitFor({ state: 'detached' });
  assert.equal((await data(context, '/api/app/workspaces')).workspaces.some(w => w.name === secondName), true);
  await openSidebar(page); await page.locator('[data-act=switcher]').click();
  await page.locator(`[data-act=switch][data-id="${ws.id}"]`).click(); await idle(page);
  assert.equal(await page.locator('.ws-btn > span:nth-child(2)').innerText(), renamed);
  await page.reload(); await page.locator('#fx .sb').waitFor();
  assert.equal(await page.locator('.ws-btn > span:nth-child(2)').innerText(), renamed);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
});
