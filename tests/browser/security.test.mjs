import { trackCoverage } from '../helpers/browser.mjs';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';

// Exercise the production build, with the repository's static response headers.
// No running dev server or real account/payment endpoint is required.
const dist = resolve(process.env.TEST_DIST_DIR || 'dist');
let server, browser, base;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.json': 'application/json' };
before(async () => {
  const headerText = await readFile(resolve(dist, '_headers'), 'utf8');
  const headers = Object.fromEntries([...headerText.matchAll(/^  ([^:]+): (.+)$/gm)].map(([, k, v]) => [k, v]));
  server = createServer(async (req, res) => {
    try {
      let path = resolve(dist, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
      if (!path.startsWith(dist + '/') && path !== dist) { res.writeHead(403).end(); return; }
      if ((await stat(path)).isDirectory()) path += '/index.html';
      res.writeHead(200, { ...headers, 'content-type': mime[extname(path)] || 'application/octet-stream' });
      res.end(await readFile(path));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
});
after(async () => { await browser?.close(); if (server) await new Promise(r => server.close(r)); });

async function setup(t, options = {}) {
  const context = await browser.newContext({ reducedMotion: 'reduce', ...options });
  await trackCoverage(context, options);
  t.after(() => context.close());
  const errors = [];
  context.on('page', p => p.on('pageerror', e => errors.push(e.message)));
  await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  return { context, page, errors };
}
async function idle(page) { await page.waitForFunction(() => document.querySelector('#fx')?.getAttribute('aria-busy') !== 'true'); }
async function enter(page, prefix = '', email = 'tester@example.invalid') {
  await page.goto(base + prefix + '/app/start/');
  await page.locator('#auth-email').fill(email);
  await page.locator('[data-auth-form] [type=submit]').click();
  await page.locator('#fx .sb').waitFor();
  await page.locator('[data-act=ob-skip]').click();
  await page.locator('.scrim').waitFor({ state: 'detached' });
}
async function workspace(page, name = 'Test workspace') {
  await page.locator('[data-act=new-ws]').first().click();
  await page.locator('[data-form=new-ws] [name=name]').fill(name);
  await page.locator('[data-form=new-ws] .btn.pri').click();
  await page.locator('.scrim').waitFor({ state: 'detached' });
  await page.locator('#fx-input').waitFor();
}
async function go(page, path) {
  await idle(page);
  await page.evaluate(path => { location.hash = '#/' + path; }, path);
  await page.waitForFunction(path => document.querySelector('#fx')?.dataset.route === '#/' + path, path);
}
async function record(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('fells.preview.v2', 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result, tx = db.transaction('preview'), read = tx.objectStore('preview').get('active');
      read.onsuccess = () => resolve(read.result ?? null);
      tx.oncomplete = () => db.close();
    };
  }));
}
async function overwrite(page, value) {
  await page.evaluate(value => new Promise((resolve, reject) => {
    const req = indexedDB.open('fells.preview.v2', 1);
    req.onsuccess = () => {
      const db = req.result, tx = db.transaction('preview', 'readwrite');
      tx.objectStore('preview').put(value, 'active');
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error);
    };
  }), value);
}
async function environment(page) {
  await go(page, 'ws-settings/1');
  await page.locator('[data-form=env] [name=k]').fill('DUMMY_TOKEN');
  await page.locator('[data-form=env] [data-env-value]').fill('TEST-SECRET-DO-NOT-PERSIST');
  await page.locator('[data-form=env] button').click();
  assert.equal(await page.locator('[data-act=env-del]').count(), 1);
}
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

for (const prefix of ['', '/zh', '/zh-hant', '/ja', '/ko', '/es']) {
  test(`localized preview entry, example project and route smoke: ${prefix || 'en'}`, async t => {
    const { page, errors } = await setup(t);
    await page.goto(base + prefix + '/app/start/');
    assert.equal(await page.locator('input[type=password]').count(), 0);
    await enter(page, prefix);
    await page.locator('[data-act=open-example]').first().click();
    await idle(page);
    for (const path of ['new', 'files', 'canvas', 'members', 'plugins', 'sites', 'schedules', 'ws-settings/0', 'ws-settings/1', 'ws-settings/2', 'ws-settings/3', 'ws-settings/4', 'settings/0', 'settings/1', 'settings/2', 'api', 'billing/credits', 'billing/market']) {
      await go(page, path);
      assert.ok((await page.locator('#fx-main').innerText()).length > 20, path);
    }
    assert.deepEqual(errors, []);
  });
}

test('workspace/chat/file/schedule/profile/theme/notification/API-key CRUD still persists', async t => {
  const { page, errors } = await setup(t);
  page.on('dialog', d => d.accept());
  await enter(page); await workspace(page);
  const body = '<img src=x onerror="window.__injected=1"> literal text';
  await send(page, body);
  assert.equal(await page.locator('.msg-body').innerText(), body);
  assert.equal(await page.evaluate(() => window.__injected), undefined);
  await send(page, 'Second message');
  assert.equal((await record(page)).state.chats[0].messages.filter(m => m[0] === 'you').length, 2);
  const chatId = (await record(page)).state.chats[0].id;
  await go(page, 'files');
  await page.locator('[data-act=new-folder]').click();
  await page.locator('[data-form=prompt] [name=v]').fill('Folder');
  await page.locator('[data-form=prompt] .btn.pri').click();
  await page.locator('.scrim').waitFor({ state: 'detached' });
  const fileChooser = page.waitForEvent('filechooser');
  await page.locator('[data-act=upload]').first().click();
  await (await fileChooser).setFiles({ name: 'sample.txt', mimeType: 'text/plain', buffer: Buffer.from('sample') });
  await idle(page);
  assert.equal((await record(page)).state.files.length, 2);
  await go(page, 'schedules');
  await page.locator('[data-act=new-schedule]').first().click();
  await page.locator('[data-form=schedule] [name=name]').fill('Daily review');
  await page.locator('[data-form=schedule] [name=prompt]').fill('Review sample code');
  await page.locator('[data-form=schedule] .btn.pri').click();
  await page.locator('.scrim').waitFor({ state: 'detached' });
  await page.locator('[data-act=sched-pause]').click(); await idle(page);
  assert.equal((await record(page)).state.schedules[0].paused, true);
  await go(page, 'settings/0');
  await page.locator('[data-form=profile] [name=name]').fill('Test Name');
  await page.locator('[data-form=profile] .btn.pri').click(); await idle(page);
  await go(page, 'settings/1');
  await page.locator('[data-act=theme][data-v=dark]').click(); await idle(page);
  await page.locator('[data-input=prefAgent]').selectOption('claude'); await idle(page);
  await page.locator('[data-act=send-key][data-i="1"]').click(); await idle(page);
  await go(page, 'settings/2');
  await page.locator('[data-act=notif][data-i="0"]').click(); await idle(page);
  await go(page, 'api');
  await page.locator('[data-act=new-key]').click();
  await page.locator('[data-form=key] [name=name]').fill('Example key');
  await page.locator('[data-form=key] .btn.pri').click();
  await page.locator('.dlg pre').waitFor();
  const key = await page.locator('.dlg pre').innerText();
  assert.match(key, /^fl-[a-f0-9]{40}$/);
  assert.equal(JSON.stringify(await record(page)).includes(key), false);
  await page.locator('.dlg [data-act=close]').last().click();
  await page.reload(); await page.locator('#fx .sb').waitFor();
  const state = (await record(page)).state;
  assert.equal(state.profile.name, 'Test Name'); assert.equal(state.theme, 'dark');
  assert.equal(state.prefs.agent, 'claude'); assert.equal(state.prefs.send, 1); assert.equal(state.notifs[0], false);
  await page.locator('[data-act=revoke]').click(); await idle(page);
  assert.equal((await record(page)).state.keys.length, 0);
  await go(page, 'chat/' + chatId);
  await page.locator('[data-act=del-chat]').click(); await idle(page);
  assert.equal((await record(page)).state.chats.length, 0);
  await go(page, 'schedules'); await page.locator('[data-act=sched-del]').click(); await idle(page);
  assert.equal((await record(page)).state.schedules.length, 0);
  assert.deepEqual(errors, []);
});

test('environment values never persist, even on unrelated saves; refresh discards them', async t => {
  const { page } = await setup(t);
  await enter(page); await workspace(page); await environment(page);
  await go(page, 'settings/1'); await page.locator('[data-act=theme][data-v=dark]').click(); await idle(page);
  assert.equal(JSON.stringify(await record(page)).includes('TEST-SECRET'), false);
  assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), []);
  assert.deepEqual(await page.evaluate(() => Object.keys(sessionStorage)), []);
  await go(page, 'ws-settings/1'); assert.equal(await page.locator('[data-act=env-del]').count(), 1);
  await page.reload(); await page.locator('[data-form=env]').waitFor();
  assert.equal(await page.locator('[data-act=env-del]').count(), 0);
});

test('logout clears storage, resets other tabs, and direct/back navigation cannot recover it', async t => {
  const { context, page } = await setup(t);
  await enter(page); await workspace(page); await environment(page);
  const second = await context.newPage();
  await second.goto(base + '/app/'); await second.locator('#fx .sb').waitFor();
  await logout(page);
  await second.waitForURL(/\/app\/start\/?$/);
  assert.equal(await record(page), null);
  await page.goto(base + '/app/'); await page.waitForURL(/\/app\/start\/?$/);
  await page.goBack();
  await page.waitForURL(/\/app\/start\/?$/);
  assert.equal(await page.locator('#fx-input').count(), 0);
});

test('starting with a different email resets the previous preview and revokes its tabs', async t => {
  const { context, page } = await setup(t);
  await enter(page); await workspace(page);
  const next = await context.newPage();
  await enter(next, '', 'other@example.invalid');
  await page.waitForURL(/\/app\/start\/?$/);
  const saved = await record(next);
  assert.equal(saved.state.email, 'other@example.invalid');
  assert.deepEqual(saved.state.workspaces, []);
});

test('old plaintext storage is purged and never rendered or migrated', async t => {
  const { page } = await setup(t);
  await page.goto(base + '/app/start/');
  await page.evaluate(() => {
    localStorage.setItem('fells.app.v1', JSON.stringify({ env: { w: [['OLD_TOKEN', 'OLD_SECRET']] }, email: 'old@example.invalid' }));
    localStorage.setItem('fells.email', 'old@example.invalid');
  });
  await page.goto(base + '/app/'); await page.waitForURL(/\/app\/start\/?$/);
  assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), []);
  assert.equal((await page.locator('body').innerText()).includes('OLD_SECRET'), false);
});

test('stale tabs cannot resurrect a deleted workspace even with all sync notifications disabled', async t => {
  const { context, page } = await setup(t);
  await context.addInitScript(() => {
    window.BroadcastChannel = undefined;
    const add = window.addEventListener.bind(window);
    window.addEventListener = (type, ...args) => { if (type !== 'focus') add(type, ...args); };
  });
  await enter(page); await workspace(page);
  const second = await context.newPage(); await second.goto(base + '/app/#/settings/1');
  await second.locator('[data-act=theme][data-v=dark]').waitFor();
  await go(page, 'ws-settings/4');
  await page.locator('[data-form=del-ws] [name=name]').fill('Test workspace');
  await page.locator('[data-form=del-ws] button').click(); await idle(page);
  assert.equal((await record(page)).state.workspaces.length, 0);
  await second.locator('[data-act=theme][data-v=dark]').click(); await idle(second);
  assert.match(await second.locator('.toast').innerText(), /Another tab/);
  assert.equal((await record(page)).state.workspaces.length, 0);
  await second.locator('[data-act=theme][data-v=dark]').click(); await idle(second);
  assert.equal((await record(page)).state.theme, 'dark');
  assert.equal((await record(page)).state.workspaces.length, 0);
});

test('failed writes/transaction aborts retain input, show no success, and permit retry/deletion', async t => {
  const { page } = await setup(t);
  await enter(page); await workspace(page); await environment(page);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (window.failWrite === 'quota') throw new DOMException('Synthetic quota', 'QuotaExceededError');
      const req = put.apply(this, args);
      if (window.failWrite === 'abort') queueMicrotask(() => this.transaction.abort());
      return req;
    };
    window.failWrite = 'quota';
  });
  await go(page, 'new'); await send(page, 'Retain my draft');
  assert.equal(await page.locator('#fx-input').inputValue(), 'Retain my draft');
  assert.match(await page.locator('.toast').innerText(), /Not saved/);
  assert.equal((await record(page)).state.chats.length, 0);
  // Deleting a memory-only secret must not depend on a failed database write.
  await go(page, 'ws-settings/1'); await page.locator('[data-act=env-del]').click();
  assert.equal(await page.locator('[data-act=env-del]').count(), 0);
  await go(page, 'new');
  await page.evaluate(() => { window.failWrite = 'abort'; });
  await send(page, 'Transaction must complete');
  assert.equal((await record(page)).state.chats.length, 0);
  assert.match(await page.locator('.toast').innerText(), /Not saved/);
  await page.evaluate(() => { window.failWrite = null; });
  await send(page, 'Retried');
  assert.equal((await record(page)).state.chats[0].messages[0][1], 'Retried');
  await page.evaluate(() => { window.failWrite = 'quota'; });
  await logout(page); assert.equal(await record(page), null);
});

test('oversize input is rejected without poisoning later saves', async t => {
  const { page } = await setup(t);
  await enter(page); await workspace(page);
  await page.locator('#fx-input').evaluate(el => { el.value = 'x'.repeat(32769); });
  await page.locator('[data-form=send] .send').click();
  assert.match(await page.locator('.toast').innerText(), /limit/);
  assert.equal((await record(page)).state.chats.length, 0);
  await send(page, 'Small message');
  assert.equal((await record(page)).state.chats.length, 1);
});

test('malformed stored IDs cannot execute markup, and a new preview recovers safely', async t => {
  const { page } = await setup(t);
  await enter(page); await workspace(page); await send(page, 'Safe');
  const saved = await record(page);
  saved.state.chats[0].id = 'x"><img src=x onerror="window.__injected=1">';
  await overwrite(page, saved); await page.reload();
  await page.locator('#fx a').waitFor();
  assert.match(await page.locator('#fx').innerText(), /unavailable or invalid/);
  assert.equal(await page.evaluate(() => window.__injected), undefined);
  assert.equal(await page.locator('#fx img').count(), 0);
  await enter(page); assert.equal((await record(page)).state.chats.length, 0);
});

test('no-script forms are disabled and native submission never puts fields in a URL', async t => {
  const { page } = await setup(t, { javaScriptEnabled: false });
  for (const [path, selector] of [['/app/start/', '[data-auth-form]'], ['/checkout/?mode=redeem', '[data-checkout]'], ['/', '[data-waitlist]']]) {
    await page.goto(base + path);
    const form = page.locator(selector);
    assert.equal(await form.getAttribute('method'), 'post');
    assert.equal(await form.locator('input:not([disabled])').count(), 0);
    assert.equal(await form.locator('button[type=submit]:not([disabled])').count(), 0);
    assert.equal(await form.locator('input[name=password],input[name=cdk]').count(), 0);
  }
});

test('checkout survives missing IntersectionObserver; CDK uses POST and clears only on success', async t => {
  const { page, errors } = await setup(t);
  await page.addInitScript(() => { window.IntersectionObserver = undefined; });
  const requests = [];
  await page.route('**/__redeem-test', route => {
    requests.push({ method: route.request().method(), url: route.request().url(), body: route.request().postDataJSON() });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto(base + '/checkout/?mode=redeem');
  await page.locator('[data-checkout]').evaluate(el => { el.dataset.redeem = '/__redeem-test'; });
  await page.locator('[name=email]').fill('cdk@example.invalid');
  await page.locator('[data-field=cdk]').fill('DUMMY-CDK-1234');
  await page.locator('[name=agree]').check();
  await page.locator('[data-submit]').click();
  await page.waitForFunction(() => document.querySelector('[data-field=cdk]').value === '');
  assert.equal(requests.length, 1); assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].body.cdk, 'DUMMY-CDK-1234'); assert.equal(requests[0].url.includes('DUMMY'), false);
  assert.equal(page.url().includes('DUMMY'), false); assert.deepEqual(errors, []);
});

test('checkout modes, email waitlist and failed redemption keep their original behavior', async t => {
  const { page } = await setup(t);
  const payloads = [];
  await page.route('**/__wait-test', route => { payloads.push(route.request().postDataJSON()); return route.fulfill({ status: 200, body: '{}' }); });
  await page.route('**/__redeem-fail', route => route.fulfill({ status: 500, body: '{}' }));
  await page.goto(base + '/checkout/?plan=3500');
  assert.equal(await page.locator('[name=plan]:checked').inputValue(), '3500');
  await page.locator('[data-checkout]').evaluate(el => { el.dataset.wait = '/__wait-test'; });
  await page.locator('[data-mode=group]').click();
  await page.locator('[name=email]').fill('order@example.invalid'); await page.locator('[name=agree]').check();
  await page.locator('[data-submit]').click();
  await page.locator('[data-msg]').filter({ hasText: /order@example.invalid/ }).waitFor();
  assert.equal(payloads[0].channel, 'alipay'); assert.ok(payloads[0].order);
  await page.locator('[data-mode=redeem]').click();
  await page.locator('[data-checkout]').evaluate(el => { el.dataset.redeem = '/__redeem-fail'; });
  await page.locator('[data-field=cdk]').fill('DUMMY-CDK-1234');
  await page.locator('[data-submit]').click(); await page.locator('[data-msg].err').waitFor();
  assert.equal(await page.locator('[data-field=cdk]').inputValue(), 'DUMMY-CDK-1234');
  await page.goto(base + '/');
  await page.locator('[data-waitlist]').evaluate(el => { el.dataset.action = '/__wait-test'; });
  await page.locator('[data-waitlist] [name=email]').fill('wait@example.invalid');
  await page.locator('[data-waitlist] [type=submit]').click();
  await page.waitForFunction(() => document.querySelector('[data-waitlist] [name=email]').value === '');
  assert.equal(payloads.at(-1).email, 'wait@example.invalid');
});

test('Synara external Ask links and copied prompt omit query parameters and fragments', async t => {
  const { page } = await setup(t);
  await page.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.copiedPrompt = text; } } }); });
  await page.goto(base + '/themes/synara/?token=TEST-SECRET&email=test@example.invalid#demo');
  const links = await page.locator('[data-ask]').evaluateAll(els => els.map(el => el.href));
  for (const link of links) {
    const decoded = decodeURIComponent(link);
    assert.ok(decoded.includes(base + '/themes/synara/'));
    assert.equal(/TEST-SECRET|example.invalid|#demo/.test(decoded), false);
  }
  await page.locator('[data-copy]').click();
  assert.equal(/TEST-SECRET|example.invalid|#demo/.test(await page.evaluate(() => window.copiedPrompt)), false);
});

test('framing headers are emitted and app/entry fail closed even if a host omits them', async t => {
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

test('native submit bypass still uses POST and cannot serialize the unnamed CDK', async t => {
  const { page } = await setup(t);
  await page.goto(base + '/checkout/?mode=redeem');
  await page.locator('[name=email]').fill('native@example.invalid');
  await page.locator('[data-field=cdk]').fill('DUMMY-NATIVE-SECRET');
  const request = page.waitForRequest(r => r.isNavigationRequest() && r.method() === 'POST');
  await page.locator('[data-checkout]').evaluate(form => HTMLFormElement.prototype.submit.call(form));
  const actual = await request;
  assert.equal(actual.url().includes('native@example.invalid'), false);
  assert.equal(actual.url().includes('DUMMY-NATIVE'), false);
  assert.equal(actual.postData().includes('DUMMY-NATIVE'), false);
});

test('initialization failure leaves checkout fields disabled and native submission safe', async t => {
  const { page } = await setup(t);
  // Deterministically fail before checkout initialization can finish.
  await page.addInitScript(() => { CSS.escape = () => { throw new Error('Synthetic initialization failure'); }; });
  await page.goto(base + '/checkout/?plan=trial&mode=redeem');
  assert.equal(await page.locator('[data-checkout] input:not([disabled])').count(), 0);
  assert.equal(await page.locator('[data-submit]').isDisabled(), true);
  assert.equal(await page.locator('[data-checkout]').getAttribute('method'), 'post');
});

test('unavailable browser storage does not enter a falsely successful preview', async t => {
  const { page } = await setup(t);
  await page.addInitScript(() => { indexedDB.open = () => { throw new DOMException('Blocked', 'SecurityError'); }; });
  await page.goto(base + '/app/start/');
  await page.locator('#auth-email').fill('blocked@example.invalid');
  await page.locator('[data-auth-form] [type=submit]').click();
  await page.locator('[data-msg]').filter({ hasText: /unavailable or invalid/ }).waitFor();
  assert.match(page.url(), /\/app\/start/);
  assert.equal(await page.locator('[type=submit]').isDisabled(), false);
});

test('mobile workspace operations, rename/switch/export, nested file deletion and model selection', async t => {
  const { page, errors } = await setup(t, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  page.on('dialog', d => d.accept());
  await enter(page); await workspace(page, 'Mobile workspace');
  await page.locator('[data-act=agent][data-id=claude]').click();
  await page.locator('[data-act=model]').click();
  const modelName = await page.locator('[data-act=pick-model]').first().getAttribute('data-name');
  await page.locator('[data-act=pick-model]').first().click();
  await send(page, 'Mobile message');
  assert.equal((await record(page)).state.chats[0].model, modelName);
  await go(page, 'ws-settings/0');
  await page.locator('[data-form=rename] [name=name]').fill('Renamed');
  await page.locator('[data-form=rename] button').click(); await idle(page);
  assert.equal((await record(page)).state.workspaces[0].name, 'Renamed');
  await go(page, 'files');
  await page.locator('[data-act=new-folder]').click();
  await page.locator('[data-form=prompt] [name=v]').fill('Parent');
  await page.locator('[data-form=prompt] .btn.pri').click();
  await page.locator('.scrim').waitFor({ state: 'detached' });
  const parent = (await record(page)).state.files[0].id;
  await page.locator(`[data-act=folder][data-id="${parent}"]`).click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('[data-act=upload]').first().click();
  await (await chooser).setFiles({ name: 'child.txt', mimeType: 'text/plain', buffer: Buffer.from('sample') });
  await idle(page); assert.equal((await record(page)).state.files[1].parent, parent);
  await page.locator('[data-act=folder][data-id=""]').click();
  await page.locator('[data-act=fview][data-v=list]').click();
  await page.locator(`[data-act=del-file][data-id="${parent}"]`).click(); await idle(page);
  assert.equal((await record(page)).state.files.length, 0);
  await go(page, 'ws-settings/4');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('[data-act=export]').click();
  const download = await downloadPromise;
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.equal(exported.workspace.name, 'Renamed'); assert.equal(exported.chats.length, 1);
  assert.equal('env' in exported, false);
  await page.locator('[data-act=sb]').click();
  await page.locator('[data-act=switcher]').click();
  await page.locator('.pop [data-act=new-ws]').click();
  await page.locator('[data-form=new-ws] [name=name]').fill('Second');
  await page.locator('[data-form=new-ws] .btn.pri').click();
  await page.locator('.scrim').waitFor({ state: 'detached' });
  const saved = await record(page);
  assert.equal(saved.state.workspaces.length, 2);
  assert.notEqual(saved.state.current, saved.state.workspaces[0].id);
  await page.locator('[data-act=sb]').click();
  await page.locator('[data-act=switcher]').click();
  await page.locator(`[data-act=switch][data-id="${saved.state.workspaces[0].id}"]`).click(); await idle(page);
  assert.equal((await record(page)).state.current, saved.state.workspaces[0].id);
  assert.deepEqual(errors, []);
});
