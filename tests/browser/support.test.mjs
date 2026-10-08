import { trackCoverage, requireSupportPortal } from '../helpers/browser.mjs';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, extname, relative } from 'node:path';
import { chromium } from 'playwright';

const dist = resolve(process.env.TEST_DIST_DIR || 'dist');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGM4k+kBAAOCAX62ByEmAAAAAElFTkSuQmCC', 'base64');
const prefixes = ['', '/zh', '/zh-hant', '/ja', '/ko', '/es'];
let server, browser, base, portalToken;
const portalPath = (prefix = '/zh', desk = false) => `${prefix}/${portalToken}${desk ? '/desk' : ''}`;
function requirePortal(t) { return requireSupportPortal(t, portalToken); }
async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(entry => entry.isDirectory() ? filesIn(resolve(directory, entry.name)) : [resolve(directory, entry.name)]));
  return files.flat();
}
before(async () => {
  const entries = await readdir(dist, { withFileTypes: true });
  const directories = entries.filter(entry => entry.isDirectory());
  assert.equal(directories.some(entry => /^[a-f0-9]{48}$/.test(entry.name)), false, 'retired random hexadecimal portal directories are absent');
  const candidates = (await Promise.all(directories.map(async entry => {
    try {
      const html = await readFile(resolve(dist, entry.name, 'index.html'), 'utf8');
      return html.includes('data-support-login') ? entry : null;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }))).filter(Boolean);
  assert.ok(candidates.length <= 1, 'production output has at most one configured private portal');
  if (candidates.length) {
    portalToken = candidates[0].name;
  }
  server = createServer(async (req, res) => {
    try {
      let path = resolve(dist, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
      if (path !== dist && !path.startsWith(dist + '/')) { res.writeHead(403).end(); return; }
      if ((await stat(path)).isDirectory()) path += '/index.html';
      res.writeHead(200, { 'content-type': mime[extname(path)] || 'application/octet-stream' });
      res.end(await readFile(path));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
});
after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); });
async function setup(t, options = {}) {
  const context = await browser.newContext({ reducedMotion: 'reduce', ...options });
  await trackCoverage(context, options);
  t.after(() => context.close());
  const errors = [];
  context.on('page', page => { page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(8000); });
  await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  return { context, errors };
}
async function user(context, prefix = '/zh') {
  const page = await context.newPage();
  await page.goto(base + prefix + '/app/start/');
  await page.locator('#auth-email').fill('customer@example.invalid');
  await page.locator('[data-auth-form] [type=submit]').click();
  await page.locator('[data-act=ob-skip]').click();
  await page.locator('.scrim').waitFor({ state: 'detached' });
  await page.locator('[data-support-open]').waitFor({ state: 'visible' });
  return page;
}
async function operator(context, prefix = '/zh', name = 'Support tester') {
  const page = await context.newPage();
  await page.goto(base + portalPath(prefix) + '/');
  await page.locator('#support-name').fill(name);
  await page.locator('#support-email').fill('support@example.invalid');
  await page.locator('[data-support-login-form] [type=submit]').click();
  await page.waitForURL(url => url.pathname.replace(/\/$/, '') === portalPath(prefix, true));
  await page.locator('[data-support-search]').waitFor({ state: 'visible' });
  return page;
}
async function customerSend(page, text) {
  await page.locator('#support-widget [data-support-text]').fill(text);
  await page.locator('#support-widget [data-support-send]').click();
  await page.locator('#support-widget [data-support-message]').filter({ hasText: text }).waitFor();
}

test('availability launcher keeps the original workspace composer clickable on mobile and desktop', async t => {
  for (const [width, height, locale] of [[320, 568, '/es'], [390, 844, '/zh'], [768, 384, '/ja'], [1280, 720, ''], [1440, 900, '/ko']]) {
    const { context, errors } = await setup(t, { viewport: { width, height } });
    const page = await user(context, locale);
    await page.locator('[data-act=new-ws]').first().click();
    await page.locator('[data-form=new-ws] [name=name]').fill('Composer regression');
    await page.locator('[data-form=new-ws] .btn.pri').click();
    await page.locator('.scrim').waitFor({ state: 'detached' });
    const originalSend = page.locator('[data-form=send] .send');
    await page.locator('#fx-input').fill('Original workspace message');
    assert.equal(await originalSend.evaluate(button => {
      const r = button.getBoundingClientRect();
      return button.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    }), true, `${width}px original send is not covered by the support launcher`);
    await originalSend.click();
    await page.waitForFunction(() => document.querySelector('#fx')?.getAttribute('aria-busy') !== 'true');
    assert.equal(await page.locator('#fx-input').inputValue(), '');
    await page.locator('[data-support-open]').click();
    await page.locator('#support-panel').waitFor({ state: 'visible' });
    assert.deepEqual(errors, []);
    await context.close();
  }
});

// Observe both execution and attempted requests: blocking third-party traffic in
// setup() alone must not make an injected network request look like a pass.
async function chatAttackProbe(context) {
  const requests = [], dialogs = [];
  context.on('request', request => {
    const url = new URL(request.url());
    if (url.hostname.endsWith('example.invalid') || url.pathname === '/chat-probe') requests.push(request.url());
  });
  context.on('page', page => page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); }));
  await context.addInitScript(() => { window.__chatAttack = 0; });
  return { requests, dialogs };
}
async function assertInertChat(page, selector, probe) {
  assert.equal(await page.evaluate(() => window.__chatAttack), 0, 'chat data never executes a payload');
  const roots = page.locator(selector);
  assert.equal(await roots.locator('script, iframe, object, embed, svg, [onerror], [onload], a[href]').count(), 0, 'chat data does not create executable HTML or clickable links');
  assert.deepEqual(probe.requests, [], 'no attacker-domain or injected local image request is attempted');
  assert.deepEqual(probe.dialogs, [], 'chat data does not open a script dialog');
}

test('message receipts advance only after the other side reads the visible conversation', async t => {
  if (!requirePortal(t)) return;
  const { context, errors } = await setup(t);
  const customer = await user(context);
  await customer.locator('[data-support-open]').click();
  await customerSend(customer, '用户回执测试');
  const customerReceipt = customer.locator('[data-support-message]').filter({ hasText: '用户回执测试' }).locator('[data-support-receipt]');
  await customerReceipt.locator('xpath=self::*[@data-read="false"]').waitFor();
  const desk = await operator(context);
  await desk.locator('[data-support-conversation]').filter({ hasText: 'customer@example.invalid' }).click();
  await customerReceipt.locator('xpath=self::*[@data-read="true"]').waitFor();
  await customer.bringToFront();
  await customer.locator('[data-support-close]').click();
  await desk.bringToFront();
  await desk.locator('[data-support-text]').fill('客服回执测试');
  await desk.locator('[data-support-send]').click();
  const agentReceipt = desk.locator('[data-support-message]').filter({ hasText: '客服回执测试' }).locator('[data-support-receipt]');
  await agentReceipt.locator('xpath=self::*[@data-read="false"]').waitFor();
  await customer.bringToFront();
  await customer.locator('[data-support-open]').click();
  await agentReceipt.locator('xpath=self::*[@data-read="true"]').waitFor();
  await customer.locator('[data-support-close]').click();
  await desk.bringToFront();
  await desk.locator('[data-support-file]').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: png });
  await desk.locator('[data-support-send]').click();
  const imageReceipt = desk.locator('[data-support-message]').filter({ has: desk.locator('[data-support-image]') }).locator('[data-support-receipt]');
  await imageReceipt.locator('xpath=self::*[@data-read="false"]').waitFor();
  await customer.bringToFront();
  await customer.locator('[data-support-open]').click();
  await imageReceipt.locator('xpath=self::*[@data-read="true"]').waitFor();
  await customer.reload();
  await customer.locator('[data-support-open]').click();
  await customerReceipt.locator('xpath=self::*[@data-read="true"]').waitFor();
  assert.equal(await customer.locator('.support-message--agent [data-support-receipt]').count(), 0, 'receipts belong only to outgoing messages');
  assert.deepEqual(errors, []);
});

test('typing hints work in both directions, expire on pause and close, and keep the layout stable', async t => {
  if (!requirePortal(t)) return;
  const { context, errors } = await setup(t);
  const customer = await user(context);
  await customer.locator('[data-support-open]').click();
  await customerSend(customer, '输入提示测试');
  const desk = await operator(context);
  await desk.locator('[data-support-conversation]').filter({ hasText: 'customer@example.invalid' }).click();
  const composerY = (await desk.locator('.support-composer').boundingBox()).y;
  await customer.bringToFront();
  await customer.locator('[data-support-text]').fill('仍在编辑的用户草稿');
  await desk.locator('[data-support-typing]').waitFor({ state: 'visible' });
  assert.equal((await desk.locator('.support-composer').boundingBox()).y, composerY, 'the typing row reserves its height');
  assert.equal(await desk.locator('.support-typing-dots i').first().evaluate(dot => getComputedStyle(dot).animationName), 'none');
  await desk.locator('[data-support-typing]').waitFor({ state: 'hidden' });
  assert.equal(await customer.locator('[data-support-text]').inputValue(), '仍在编辑的用户草稿');
  await customer.locator('[data-support-text]').fill('重新输入');
  await desk.locator('[data-support-typing]').waitFor({ state: 'visible' });
  await customer.locator('[data-support-close]').click();
  await desk.locator('[data-support-typing]').waitFor({ state: 'hidden' });
  await customer.locator('[data-support-open]').click();
  await desk.bringToFront();
  await desk.locator('[data-support-text]').fill('仍在编辑的客服草稿');
  await customer.locator('[data-support-typing]').waitFor({ state: 'visible' });
  await desk.locator('[data-support-text]').fill('');
  await customer.locator('[data-support-typing]').waitFor({ state: 'hidden' });
  await desk.locator('[data-support-seed]').click();
  await desk.locator('[data-support-conversation]').filter({ hasText: 'alex@example.invalid' }).click();
  await desk.locator('[data-support-text]').fill('其他会话的草稿');
  assert.equal(await customer.locator('[data-support-typing]').isHidden(), true);
  assert.equal(await desk.locator('[data-support-messages]').innerText().then(text => text.includes('其他会话的草稿')), false);
  assert.deepEqual(errors, []);
});

test('customer availability reflects live desks, multiple tabs, corrupt state and logout without blocking messages', async t => {
  if (!requirePortal(t)) return;
  const { context, errors } = await setup(t);
  const customer = await user(context);
  await customer.locator('[data-support-open]').click();
  const status = state => customer.locator(`#support-panel [data-support-availability-dot][data-state="${state}"]`);
  await status('offline').waitFor();
  await customerSend(customer, '客服离线时仍可留言');
  let desk = await operator(context);
  await status('online').waitFor();
  const second = await context.newPage();
  await second.goto(base + portalPath('/zh', true));
  await second.locator('[data-support-agent-availability-dot][data-state="online"]').waitFor();
  await desk.close();
  await customer.bringToFront();
  await status('online').waitFor();
  await customer.locator('[data-support-text]').fill('在线状态异常时保留草稿');
  await customer.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('fells.preview.v2', 1);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try { await new Promise((resolve, reject) => {
      const tx = db.transaction('preview', 'readwrite'); tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
      tx.objectStore('preview').put({ session: 'bad', sources: [] }, 'support.availability.agent');
    }); } finally { db.close(); }
  });
  await status('unknown').waitFor();
  assert.equal(await customer.locator('[data-support-text]').inputValue(), '在线状态异常时保留草稿');
  await customer.evaluate(async () => {
    const db = await new Promise(resolve => { const request = indexedDB.open('fells.preview.v2', 1); request.onsuccess = () => resolve(request.result); });
    try { await new Promise((resolve, reject) => { const tx = db.transaction('preview', 'readwrite'); tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); tx.objectStore('preview').delete('support.availability.agent'); }); }
    finally { db.close(); }
  });
  await second.reload();
  await status('online').waitFor();
  desk = second;
  await desk.locator('[data-support-logout]').click();
  await desk.waitForURL(url => url.pathname.replace(/\/$/, '') === portalPath('/zh'));
  await status('offline').waitFor();
  assert.equal(await customer.locator('[data-support-text]').inputValue(), '在线状态异常时保留草稿');
  assert.deepEqual(errors, []);
});

test('predictable operator paths are absent for every locale and do not redirect', async () => {
  for (const prefix of prefixes) {
    for (const suffix of ['/support/', '/support/login/']) {
      const response = await fetch(base + prefix + suffix, { redirect: 'manual' });
      assert.equal(response.status, 404, `retired path returns 404: ${prefix}${suffix}`);
      assert.equal(response.headers.has('location'), false);
    }
  }
});

test('private portal address never enters public output or client bundles', async t => {
  if (!requirePortal(t)) return;
  const token = Buffer.from(portalToken);
  for (const file of await filesIn(dist)) {
    const segments = relative(dist, file).split('/');
    const privatePage = segments[0] === portalToken || (prefixes.includes('/' + segments[0]) && segments[1] === portalToken);
    if (privatePage) continue;
    // Scan every public output file, including all _astro assets and source maps.
    assert.equal((await readFile(file)).includes(token), false, `private address absent from public output: ${relative(dist, file).replaceAll(portalToken, '[private]')}`);
  }
});

test('customer widget stays functional without publishing an operator entry', async t => {
  const { context, errors } = await setup(t);
  const customer = await user(context);
  const html = await customer.content();
  assert.equal(await customer.locator('[data-support-operator], a[href*="/support"]').count(), 0);
  if (portalToken) assert.equal(html.includes(portalToken), false, 'customer page omits the private portal address');
  await customer.locator('[data-support-open]').click();
  await customerSend(customer, '客服入口保密，但用户仍然可以发送消息');
  await customer.reload();
  await customer.locator('[data-support-open]').click();
  await customer.locator('[data-support-message]').filter({ hasText: '客服入口保密，但用户仍然可以发送消息' }).waitFor();
  assert.deepEqual(errors, []);
});

test('private pages prohibit indexing and omit URL metadata and third-party fonts', async t => {
  if (!requirePortal(t)) return;
  const { context, errors } = await setup(t, { javaScriptEnabled: false });
  const page = await context.newPage();
  for (const prefix of prefixes) {
    for (const desk of [false, true]) {
      const response = await page.goto(base + portalPath(prefix, desk) + '/');
      assert.equal(response.status(), 200, 'configured private page is generated');
      const robots = (await page.locator('meta[name=robots]').getAttribute('content')).split(/\s*,\s*/);
      for (const value of ['noindex', 'nofollow', 'noarchive']) assert.ok(robots.includes(value), `private page robots contains ${value}`);
      assert.equal(await page.locator('link[rel=canonical], link[hreflang], meta[property="og:url"]').count(), 0);
      assert.equal(/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(await page.content()), false, 'private pages omit third-party font requests');
    }
  }
  assert.deepEqual(errors, []);
});

test('private desk entry redirects without a demo session and has locale-aware routes', async t => {
  if (!requirePortal(t)) return;
  const { context, errors } = await setup(t);
  const page = await context.newPage();
  for (const prefix of prefixes) {
    await page.goto(base + portalPath(prefix, true) + '/');
    await page.waitForURL(url => url.pathname.replace(/\/$/, '') === portalPath(prefix));
    assert.equal(await page.locator('input[type=password]').count(), 0);
    assert.equal(await page.locator('#support-name').isEnabled(), true);
    assert.ok((await page.locator('.support-login-intro').innerText()).length > 20);
  }
  assert.deepEqual(errors, []);
});

test('operator-only entry and ordinary customer entry keep their sessions separate', async t => {
  if (!requirePortal(t)) return;
  const operatorSession = await setup(t);
  const desk = await operator(operatorSession.context);
  assert.equal(await desk.locator('[data-support-open], a[href*="/app/"]').count(), 0, 'operator desk has no customer widget or customer-entry link');
  await desk.goto(base + '/zh/app/');
  await desk.waitForURL(url => url.pathname.replace(/\/$/, '') === '/zh/app/start');
  await desk.locator('[data-auth-form]').waitFor({ state: 'visible' });
  assert.equal(await desk.locator('[data-support-open]').count(), 0, 'operator preview does not authorize a customer app session');

  const customerSession = await setup(t);
  const customer = await user(customerSession.context);
  assert.equal(new URL(customer.url()).pathname.replace(/\/$/, ''), '/zh/app', 'ordinary customer enters the app through its existing start page');
  assert.equal(await customer.locator('[data-support-open]').isVisible(), true);
  const privateEntry = await customerSession.context.newPage();
  await privateEntry.goto(base + portalPath('/zh', true) + '/');
  await privateEntry.waitForURL(url => url.pathname.replace(/\/$/, '') === portalPath('/zh'));
  await privateEntry.locator('[data-support-login-form]').waitFor({ state: 'visible' });
  assert.equal(await privateEntry.locator('[data-support-search], [data-support-open], a[href*="/app/"]').count(), 0, 'customer session cannot enter the operator desk or access a customer entry from the private portal');
  assert.deepEqual(operatorSession.errors, []);
  assert.deepEqual(customerSession.errors, []);
});

test('customer and operator exchange safe text/images, unread state, customer details and resolved status', async t => {
  if (!requirePortal(t)) return;
  const { context, errors } = await setup(t);
  const customer = await user(context);
  await customer.locator('[data-support-open]').click();
  const literal = '<img src=x onerror="window.__supportInjected=1"> 请帮我检查';
  await customerSend(customer, literal);
  assert.equal(await customer.evaluate(() => window.__supportInjected), undefined);
  await customer.locator('#support-widget [data-support-file]').setInputFiles({ name: 'question.png', mimeType: 'image/png', buffer: png });
  await customer.locator('#support-widget [data-support-preview]').waitFor({ state: 'visible' });
  await customer.locator('#support-widget [data-support-send]').click();
  await customer.locator('#support-widget [data-support-message] img').waitFor();
  const desk = await operator(context);
  await desk.locator('[data-support-conversation]').filter({ hasText: 'customer@example.invalid' }).click();
  assert.ok((await desk.locator('[data-support-messages]').innerText()).includes(literal));
  assert.equal(await desk.locator('[data-support-messages] img').count(), 1);
  await desk.locator('[data-support-image]').first().click();
  await desk.locator('.support-image-viewer').waitFor({ state: 'visible' });
  assert.equal(await desk.locator('.support-image-viewer img').evaluate(image => image.naturalWidth), 1);
  await desk.keyboard.press('Escape');
  await desk.locator('.support-image-viewer').waitFor({ state: 'hidden' });
  assert.equal(await desk.locator('[data-support-detail-email]').innerText(), 'customer@example.invalid');
  assert.equal(await desk.evaluate(() => window.__supportInjected), undefined);
  await customer.locator('[data-support-close]').click();
  await desk.locator('[data-support-text]').fill('收到，我来帮你检查。');
  await desk.locator('[data-support-send]').click();
  await customer.locator('[data-support-unread]').waitFor({ state: 'visible' });
  await customer.locator('[data-support-open]').click();
  await customer.locator('#support-widget [data-support-message][data-sender=agent]').waitFor();
  await customer.locator('[data-support-unread]').waitFor({ state: 'hidden' });
  await desk.locator('[data-support-file]').setInputFiles({ name: 'answer.png', mimeType: 'image/png', buffer: png });
  await desk.locator('[data-support-attachment]').waitFor({ state: 'visible' });
  await desk.locator('[data-support-send]').click();
  await customer.locator('#support-widget [data-support-message][data-sender=agent] img').waitFor();
  await desk.locator('[data-support-status]').click();
  await desk.locator('[data-support-resolved-notice]').waitFor({ state: 'visible' });
  await customerSend(customer, '再问一个问题');
  await desk.locator('[data-support-resolved-notice]').waitFor({ state: 'hidden' });
  await customer.reload();
  await customer.locator('[data-support-open]').click();
  assert.equal(await customer.locator('#support-widget [data-support-message] img').count(), 2);
  assert.deepEqual(errors, []);
});

test('sample inbox search/filter and mobile conversation/detail navigation', async t => {
  if (!requirePortal(t)) return;
  const { context, errors } = await setup(t, { viewport: { width: 390, height: 844 } });
  const desk = await operator(context);
  await desk.locator('[data-support-seed]').first().click();
  await desk.locator('[data-support-conversation]').first().waitFor();
  const count = await desk.locator('[data-support-conversation]').count();
  assert.ok(count >= 2);
  await desk.locator('[data-support-filter=resolved]').click();
  assert.ok(await desk.locator('[data-support-conversation]').count() < count);
  await desk.locator('[data-support-search]').fill('no-such-customer');
  await desk.locator('[data-support-conversation]').waitFor({ state: 'detached' });
  await desk.locator('[data-support-reset-search]').click();
  assert.equal(await desk.locator('[data-support-search]').inputValue(), '');
  assert.equal(await desk.locator('[data-support-filter=all]').getAttribute('aria-pressed'), 'true');
  assert.equal(await desk.locator('[data-support-filter=resolved]').getAttribute('aria-pressed'), 'false');
  assert.equal(await desk.locator('[data-support-conversation]').count(), count, 'reset restores all conversations as well as clearing the query');
  assert.equal(await desk.locator('[data-support-search]').evaluate(element => document.activeElement === element), true, 'reset returns focus to the search input');
  await desk.locator('[data-support-conversation]').first().click();
  await desk.locator('[data-support-chat]').waitFor({ state: 'visible' });
  await desk.locator('[data-support-details]').click();
  await desk.locator('[data-support-detail-panel]').waitFor({ state: 'visible' });
  assert.ok((await desk.locator('[data-support-detail-email]').innerText()).includes('@'));
  await desk.locator('[data-support-details-close]').click();
  await desk.locator('[data-support-back]').click();
  await desk.locator('[data-support-search]').waitFor({ state: 'visible' });
  await desk.locator('[data-support-filter=resolved]').click();
  assert.ok(await desk.locator('[data-support-conversation]').count() < count);
  assert.equal(await desk.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const customer = await user(context);
  await customer.locator('[data-support-open]').click();
  const bounds = await customer.locator('#support-panel').boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
  assert.deepEqual(errors, []);
});

test('covered conversations keep new messages unread until details or image viewers close', async t => {
  if (!requirePortal(t)) return;
  const { context, errors } = await setup(t, { viewport: { width: 390, height: 844 } });
  const customer = await user(context);
  await customer.locator('[data-support-open]').click();
  await customerSend(customer, '先发送一条消息');
  await customer.locator('#support-widget [data-support-file]').setInputFiles({ name: 'question.png', mimeType: 'image/png', buffer: png });
  await customer.locator('#support-widget [data-support-preview]').waitFor({ state: 'visible' });
  await customer.locator('#support-widget [data-support-send]').click();
  await customer.locator('#support-widget [data-support-message] img').waitFor();
  const desk = await operator(context);
  await desk.locator('[data-support-conversation]').filter({ hasText: 'customer@example.invalid' }).click();
  await desk.locator('[data-support-details]').click();
  await desk.locator('[data-support-detail-panel]').waitFor({ state: 'visible' });
  await customerSend(customer, '查看资料期间收到的消息');
  await desk.bringToFront();
  await desk.locator('[data-support-message]').filter({ hasText: '查看资料期间收到的消息' }).waitFor({ state: 'attached' });
  assert.equal(await desk.locator('[data-support-count=unread]').textContent(), '1', 'customer details cover the chat, so the new message stays unread');
  await desk.locator('[data-support-details-close]').click();
  await desk.waitForFunction(() => document.querySelector('[data-support-count=unread]').textContent === '0');

  await desk.locator('[data-support-image]').first().click();
  await desk.locator('.support-image-viewer').waitFor({ state: 'visible' });
  await customerSend(customer, '客服查看图片期间收到的消息');
  await desk.bringToFront();
  await desk.locator('[data-support-message]').filter({ hasText: '客服查看图片期间收到的消息' }).waitFor({ state: 'attached' });
  assert.equal(await desk.locator('[data-support-count=unread]').textContent(), '1', 'the operator image viewer does not consume new messages');
  await desk.keyboard.press('Escape');
  await desk.waitForFunction(() => document.querySelector('[data-support-count=unread]').textContent === '0');

  await customer.locator('#support-widget [data-support-image]').first().click();
  await customer.locator('.support-image-viewer').waitFor({ state: 'visible' });
  await desk.locator('[data-support-text]').fill('用户查看图片期间收到的回复');
  await desk.locator('[data-support-send]').click();
  await customer.bringToFront();
  await customer.locator('#support-widget [data-support-message]').filter({ hasText: '用户查看图片期间收到的回复' }).waitFor({ state: 'attached' });
  assert.equal(await customer.locator('[data-support-unread]').evaluate(badge => badge.hidden), false, 'the customer image viewer does not consume a new reply');
  assert.equal(await customer.locator('[data-support-unread]').textContent(), '1');
  await customer.keyboard.press('Escape');
  await customer.waitForFunction(() => document.querySelector('[data-support-unread]').hidden);
  assert.deepEqual(errors, []);
});

test('customer preserves history and unread replies until activating the latest-message control', async t => {
  if (!requirePortal(t)) return;
  const { context, errors } = await setup(t, { viewport: { width: 390, height: 844 } });
  const customer = await user(context);
  await customer.locator('[data-support-open]').click();
  await customerSend(customer, '请给我一些消息以查看历史');
  const desk = await operator(context);
  await desk.locator('[data-support-conversation]').filter({ hasText: 'customer@example.invalid' }).click();
  for (let index = 0; index < 6; index++) {
    const body = `历史回复 ${index}：${'用于验证阅读历史时不会被新回复拉到底部。'.repeat(25)}`;
    await desk.locator('[data-support-text]').fill(body);
    await desk.locator('[data-support-send]').click();
    await desk.locator('[data-support-message]').filter({ hasText: body }).waitFor();
  }
  await customer.bringToFront();
  await customer.locator('#support-widget [data-support-message][data-sender=agent]').nth(5).waitFor();
  const history = customer.locator('#support-widget [data-support-messages]');
  await customer.waitForFunction(() => document.querySelector('[data-support-unread]').hidden);
  assert.equal(await history.getAttribute('tabindex'), '0', 'history supports keyboard scrolling');
  await history.press('Home');
  await customer.waitForFunction(() => {
    const history = document.querySelector('#support-widget [data-support-messages]');
    return history.scrollTop <= 1 && history.scrollHeight - history.scrollTop - history.clientHeight > 100;
  });
  const before = await history.evaluate(element => ({ top: element.scrollTop, remaining: element.scrollHeight - element.scrollTop - element.clientHeight }));
  assert.ok(before.remaining > 100, 'customer is reading earlier messages');
  await desk.locator('[data-support-text]').fill('到达的新回复应保留历史阅读位置');
  await desk.locator('[data-support-send]').click();
  await customer.bringToFront();
  await customer.locator('#support-widget [data-support-message]').filter({ hasText: '到达的新回复应保留历史阅读位置' }).waitFor();
  assert.ok(Math.abs(await history.evaluate(element => element.scrollTop) - before.top) <= 1, 'incoming reply leaves the current reading position intact');
  assert.equal(await customer.locator('[data-support-unread]').textContent(), '1', 'a reply outside the visible history stays unread');
  assert.equal(await customer.locator('[data-support-unread]').evaluate(element => element.hidden), false);
  const latest = customer.locator('[data-support-latest]');
  await latest.waitFor({ state: 'visible' });
  assert.ok((await latest.textContent()).includes('1'));
  await latest.press('Enter');
  await customer.waitForFunction(() => document.querySelector('[data-support-unread]').hidden);
  await latest.waitFor({ state: 'hidden' });
  assert.equal(await history.evaluate(element => document.activeElement === element), true, 'keyboard activation keeps focus in the history after the control disappears');
  assert.ok(await history.evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight <= 1));
  await history.press('Home');
  await customerSend(customer, '我自己发送消息时应回到底部');
  const remaining = await history.evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight);
  assert.ok(remaining <= 1, 'sending a customer message still scrolls to the newest message');
  assert.deepEqual(errors, []);
});

test('operator preserves history and unread customer messages until returning to the latest message', async t => {
  if (!requirePortal(t)) return;
  const { context, errors } = await setup(t, { viewport: { width: 1000, height: 760 } });
  const customer = await user(context);
  await customer.locator('[data-support-open]').click();
  for (let index = 0; index < 6; index++) {
    await customerSend(customer, `历史提问 ${index}：${'阅读历史消息时应该保留当前位置。'.repeat(30)}`);
  }
  const desk = await operator(context);
  await desk.locator('[data-support-conversation]').filter({ hasText: 'customer@example.invalid' }).click();
  await desk.waitForFunction(() => document.querySelector('[data-support-count=unread]').textContent === '0');
  const history = desk.locator('[data-support-messages]');
  assert.equal(await history.getAttribute('tabindex'), '0');
  await history.press('Home');
  await desk.waitForFunction(() => {
    const history = document.querySelector('[data-support-messages]');
    return history.scrollTop <= 1 && history.scrollHeight - history.scrollTop - history.clientHeight > 100;
  });
  const before = await history.evaluate(element => element.scrollTop);
  await customerSend(customer, '客服查看历史时到达的新问题');
  await desk.bringToFront();
  await desk.locator('[data-support-message]').filter({ hasText: '客服查看历史时到达的新问题' }).waitFor({ state: 'attached' });
  assert.ok(Math.abs(await history.evaluate(element => element.scrollTop) - before) <= 1);
  assert.equal(await desk.locator('[data-support-count=unread]').textContent(), '1');
  const latest = desk.locator('[data-support-latest]');
  await latest.waitFor({ state: 'visible' });
  assert.ok((await latest.textContent()).includes('1'));
  await latest.press('Enter');
  await desk.waitForFunction(() => document.querySelector('[data-support-count=unread]').textContent === '0');
  await latest.waitFor({ state: 'hidden' });
  assert.equal(await history.evaluate(element => document.activeElement === element), true);
  assert.ok(await history.evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight <= 1));
  assert.deepEqual(errors, []);
});

test('composers prevent empty sends, respect IME and keyboard shortcuts, and show the text limit only when useful', async t => {
  if (!requirePortal(t)) return;
  const { context, errors } = await setup(t);
  const customer = await user(context);
  await customer.locator('[data-support-open]').click();
  const customerText = customer.locator('#support-widget [data-support-text]');
  const customerSendButton = customer.locator('#support-widget [data-support-send]');
  const customerCount = customer.locator('#support-widget [data-support-character-count]');
  assert.equal(await customerSendButton.isDisabled(), true);
  await customerText.fill(' \n\t ');
  assert.equal(await customerSendButton.isDisabled(), true, 'whitespace alone is not a message');
  await customerText.fill('中文输入法正在组词');
  await customerText.evaluate(element => element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })));
  assert.equal(await customer.locator('[data-support-message]').count(), 0, 'confirming an IME composition does not submit a customer message');
  assert.equal(await customerText.inputValue(), '中文输入法正在组词');
  await customerText.fill('第一行');
  await customerText.press('Shift+Enter');
  await customerText.pressSequentially('第二行');
  assert.equal(await customerText.inputValue(), '第一行\n第二行');
  await customerText.press('Enter');
  await customer.locator('[data-support-message]').filter({ hasText: '第一行\n第二行' }).waitFor();
  assert.equal(await customerText.inputValue(), '');
  assert.equal(await customerSendButton.isDisabled(), true);
  await customerText.fill('界'.repeat(3600));
  await customerCount.waitFor({ state: 'visible' });
  assert.ok((await customerCount.textContent()).includes('3,600'));
  assert.ok((await customerCount.textContent()).includes('4,000'));
  await customerText.fill('短草稿');
  await customerCount.waitFor({ state: 'hidden' });
  await customerText.fill('');
  await customer.locator('#support-widget [data-support-file]').setInputFiles({ name: 'standalone.png', mimeType: 'image/png', buffer: png });
  await customer.locator('#support-widget [data-support-preview]').waitFor({ state: 'visible' });
  assert.equal(await customerSendButton.isEnabled(), true, 'an attachment is sufficient without text');
  await customerSendButton.click();
  await customer.locator('[data-support-message] img').waitFor();
  assert.equal(await customerSendButton.isDisabled(), true);

  const desk = await operator(context);
  await desk.locator('[data-support-conversation]').filter({ hasText: 'customer@example.invalid' }).click();
  const deskText = desk.locator('[data-support-text]');
  const deskSend = desk.locator('[data-support-send]');
  const deskCount = desk.locator('[data-support-character-count]');
  assert.equal(await deskSend.isDisabled(), true);
  await deskText.fill(' \n\t ');
  assert.equal(await deskSend.isDisabled(), true);
  await deskText.fill('界'.repeat(3600));
  await deskCount.waitFor({ state: 'visible' });
  assert.ok((await deskCount.textContent()).includes('3,600'));
  await deskText.fill('客服输入法正在组词');
  await deskCount.waitFor({ state: 'hidden' });
  await deskText.evaluate(element => element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, isComposing: true, bubbles: true, cancelable: true })));
  assert.equal(await desk.locator('[data-support-message][data-sender=agent]').count(), 0, 'IME composition also protects the operator shortcut');
  assert.equal(await deskText.inputValue(), '客服输入法正在组词');
  await deskText.fill('客服第一行');
  await deskText.press('Enter');
  await deskText.pressSequentially('客服第二行');
  assert.equal(await deskText.inputValue(), '客服第一行\n客服第二行');
  assert.equal(await desk.locator('[data-support-message][data-sender=agent]').count(), 0, 'plain Enter adds an operator reply line');
  await deskText.press('Control+Enter');
  await desk.locator('[data-support-message][data-sender=agent]').filter({ hasText: '客服第一行\n客服第二行' }).waitFor();
  assert.equal(await deskText.inputValue(), '');
  assert.equal(await deskSend.isDisabled(), true);
  assert.deepEqual(errors, []);
});

test('320px touch layouts keep translated composers, long attachment names and counters inside the viewport', async t => {
  if (!requirePortal(t)) return;
  for (const prefix of ['', '/es']) {
    const { context, errors } = await setup(t, { viewport: { width: 320, height: 740 }, isMobile: true, hasTouch: true });
    const customer = await user(context, prefix);
    await customer.locator('[data-support-open]').click();
    const history = customer.locator('#support-widget [data-support-messages]');
    assert.equal(await history.evaluate(element => document.activeElement === element), true, 'opening the touch widget focuses history instead of raising the keyboard');
    assert.equal(await history.getAttribute('tabindex'), '0');
    const filename = 'attachment_with_a_long_descriptive_filename_'.repeat(5) + '.png';
    await customer.locator('#support-widget [data-support-file]').setInputFiles({ name: filename, mimeType: 'image/png', buffer: png });
    await customer.locator('#support-widget [data-support-preview]').waitFor({ state: 'visible' });
    await customer.locator('#support-widget [data-support-text]').fill('a'.repeat(3600));
    await customer.locator('#support-widget [data-support-character-count]').waitFor({ state: 'visible' });
    assert.equal(await customer.locator('#support-panel').evaluate(element => {
      const bounds = element.getBoundingClientRect();
      return bounds.left >= 0 && bounds.right <= innerWidth + 1 && element.scrollWidth <= element.clientWidth + 1;
    }), true, `${prefix || 'English'} customer panel has no horizontal overflow`);
    assert.equal(await customer.locator('#support-widget [data-support-preview]').evaluate(element => element.scrollWidth <= element.clientWidth + 1), true);
    await customer.locator('#support-widget [data-support-text]').fill('');
    await customer.locator('#support-widget [data-support-send]').click();
    await customer.locator('#support-widget [data-support-message] img').waitFor();
    assert.equal(await history.evaluate(element => document.activeElement === element), true, 'sending an image-only message does not open the touch keyboard');

    const desk = await operator(context, prefix);
    assert.equal(await desk.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${prefix || 'English'} inbox stays within 320px`);
    await desk.locator('[data-support-conversation]').filter({ hasText: 'customer@example.invalid' }).click();
    await desk.locator('[data-support-chat]').waitFor({ state: 'visible' });
    await desk.locator('[data-support-file]').setInputFiles({ name: filename, mimeType: 'image/png', buffer: png });
    await desk.locator('[data-support-attachment]').waitFor({ state: 'visible' });
    await desk.locator('[data-support-text]').fill('a'.repeat(3600));
    await desk.locator('[data-support-character-count]').waitFor({ state: 'visible' });
    assert.equal(await desk.locator('[data-support-messages]').getAttribute('tabindex'), '0');
    assert.equal(await desk.locator('[data-support-composer]').evaluate(element => {
      const bounds = element.getBoundingClientRect();
      return bounds.left >= 0 && bounds.right <= innerWidth + 1 && element.scrollWidth <= element.clientWidth + 1;
    }), true, `${prefix || 'English'} operator composer has no horizontal overflow`);
    assert.equal(await desk.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    assert.deepEqual(errors, []);
  }
});

test('invalid image and quota errors keep draft; logout purges user conversation and revokes other desk tabs', async t => {
  if (!requirePortal(t)) return;
  const { context, errors } = await setup(t);
  const customer = await user(context);
  await customer.locator('[data-support-open]').click();
  await customer.locator('#support-widget [data-support-file]').setInputFiles({ name: 'bad.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg onload="alert(1)"></svg>') });
  await customer.locator('[data-support-error]').filter({ hasText: 'PNG' }).waitFor();
  await customer.locator('#support-widget [data-support-text]').fill('保留这条草稿');
  await customer.evaluate(() => { window.__originalSupportPut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = () => { throw new DOMException('Test quota', 'QuotaExceededError'); }; });
  await customer.locator('#support-widget [data-support-send]').click();
  await customer.waitForFunction(() => document.querySelector('#support-widget [data-support-send]').disabled === false);
  assert.equal(await customer.locator('#support-widget [data-support-text]').inputValue(), '保留这条草稿');
  assert.equal(await customer.locator('#support-widget [data-support-message]').count(), 0);
  await customer.evaluate(() => { IDBObjectStore.prototype.put = window.__originalSupportPut; });
  await customerSend(customer, '保留这条草稿');
  const desk = await operator(context);
  await desk.locator('[data-support-conversation]').first().waitFor();
  await customer.locator('[data-act=account]').click();
  await customer.locator('[data-act=logout]').click();
  await customer.waitForURL(/\/app\/start\/?$/);
  await desk.locator('[data-support-conversation]').waitFor({ state: 'detached' });
  assert.equal(await desk.locator('[data-support-messages]').innerText(), '');
  assert.equal(await desk.locator('[data-support-detail-email]').innerText(), '');
  const oldDesk = await context.newPage();
  await oldDesk.goto(base + portalPath('/zh', true) + '/');
  await oldDesk.locator('[data-support-search]').waitFor();
  await desk.locator('[data-support-logout]').click();
  await oldDesk.waitForURL(url => url.pathname.replace(/\/$/, '') === portalPath('/zh'));
  assert.deepEqual(errors, []);
});

test('operator drafts stay with their customer, send failures preserve attachment, and history restoration reloads', async t => {
  if (!requirePortal(t)) return;
  const { context, errors } = await setup(t);
  const desk = await operator(context);
  await desk.locator('[data-support-seed]').first().click();
  await desk.locator('[data-support-conversation=demo-alex]').click();
  await desk.locator('[data-support-text]').fill('Only for Alex');
  await desk.locator('[data-support-file]').setInputFiles({ name: 'alex.png', mimeType: 'image/png', buffer: png });
  await desk.locator('[data-support-attachment]').waitFor({ state: 'visible' });
  await desk.locator('[data-support-conversation=demo-lin]').click();
  assert.equal(await desk.locator('[data-support-text]').inputValue(), '');
  assert.equal(await desk.locator('[data-support-attachment]').isHidden(), true);
  await desk.locator('[data-support-conversation=demo-alex]').click();
  assert.equal(await desk.locator('[data-support-text]').inputValue(), 'Only for Alex');
  await desk.locator('[data-support-attachment]').waitFor({ state: 'visible' });
  await desk.evaluate(() => { window.__originalSupportPut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = () => { throw new DOMException('Test quota', 'QuotaExceededError'); }; });
  await desk.locator('[data-support-send]').click();
  await desk.locator('[data-support-error]').filter({ hasText: '存储' }).waitFor();
  assert.equal(await desk.locator('[data-support-text]').inputValue(), 'Only for Alex');
  assert.equal(await desk.locator('[data-support-attachment]').isVisible(), true);
  await desk.evaluate(() => { IDBObjectStore.prototype.put = window.__originalSupportPut; });
  await desk.locator('[data-support-send]').click();
  await desk.locator('[data-support-message]').filter({ hasText: 'Only for Alex' }).waitFor();
  await desk.evaluate(() => { window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })); });
  assert.equal(await desk.locator('[data-support-console]').innerText(), '');
  await desk.evaluate(() => { window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
  await desk.locator('[data-support-search]').waitFor({ state: 'visible' });
  await desk.locator('[data-support-conversation=demo-alex]').click();
  await desk.locator('[data-support-message]').filter({ hasText: 'Only for Alex' }).waitFor();
  assert.deepEqual(errors, []);
});

test('chat attack payloads and hostile names remain literal in both UIs after reopening and reloading', async t => {
  if (!requirePortal(t)) return;
  const { context, errors } = await setup(t);
  const probe = await chatAttackProbe(context);
  const customer = await user(context);
  const customerName = '<svg onload=window.__chatAttack++>';
  await customer.evaluate(() => { location.hash = '#/settings/0'; });
  await customer.locator('[data-form=profile] [name=name]').fill(customerName);
  await customer.locator('[data-form=profile] .btn.pri').click();
  await customer.waitForFunction(() => document.querySelector('#fx')?.getAttribute('aria-busy') !== 'true');
  await customer.locator('[data-support-open]').click();
  const payloads = [
    '<script>window.__chatAttack++;fetch("https://attack.example.invalid/script")</script>',
    '<img src="/chat-probe" onerror="window.__chatAttack++">',
    `<svg onload="window.__chatAttack++;fetch('https://attack.example.invalid/svg')"></svg>`,
    '</p><iframe src="https://attack.example.invalid/frame"></iframe><p>',
    'javascript:window.__chatAttack++',
    '[打开附件](javascript:window.__chatAttack++) [查看订单](https://attack.example.invalid/markdown)',
  ];
  for (const payload of payloads) await customerSend(customer, payload);
  const agentName = '<img src=x onerror=window.__chatAttack++>';
  const desk = await operator(context, '/zh', agentName);
  const selectCustomer = () => desk.locator('[data-support-conversation]').filter({ hasText: 'customer@example.invalid' }).click();
  await selectCustomer();
  const customerScope = '#support-widget [data-support-messages]';
  const deskScope = '[data-support-messages], .support-conversation-content, [data-support-agent-name], [data-support-customer-name], [data-support-detail-name]';
  await desk.waitForFunction(name => document.querySelector('[data-support-customer-name]')?.textContent === name, customerName);
  assert.equal(await desk.locator('[data-support-agent-name]').textContent(), agentName);
  assert.equal(await desk.locator('[data-support-detail-name]').textContent(), customerName);
  assert.equal(await desk.locator('[data-support-conversation] .support-conversation-name strong').textContent(), customerName);
  assert.deepEqual(await desk.locator('[data-support-message][data-sender=user] .support-message-body p').allTextContents(), payloads);
  for (const payload of payloads) {
    await desk.locator('[data-support-text]').fill(payload);
    await desk.locator('[data-support-send]').click();
    await desk.locator('[data-support-message][data-sender=agent]').filter({ hasText: payload }).waitFor();
  }
  await customer.locator('[data-support-message][data-sender=agent]').nth(payloads.length - 1).waitFor();
  assert.deepEqual(await customer.locator('[data-support-message][data-sender=agent] .support-message-body p').allTextContents(), payloads);
  await assertInertChat(customer, customerScope, probe);
  await assertInertChat(desk, deskScope, probe);
  await customer.locator('[data-support-close]').click();
  await customer.locator('[data-support-open]').click();
  await customer.reload();
  await customer.locator('[data-support-open]').click();
  await desk.reload();
  await selectCustomer();
  for (const page of [customer, desk]) {
    for (const sender of ['user', 'agent']) {
      assert.deepEqual(await page.locator(`[data-support-message][data-sender=${sender}] .support-message-body p`).allTextContents(), payloads, 'persisted payloads stay literal when read again');
    }
  }
  assert.equal(await desk.locator('[data-support-agent-name]').textContent(), agentName);
  assert.equal(await desk.locator('[data-support-detail-name]').textContent(), customerName);
  await assertInertChat(customer, customerScope, probe);
  await assertInertChat(desk, deskScope, probe);
  assert.deepEqual(errors, []);
});

test('hostile image filenames stay literal in attachment previews, both chats and reopened image viewers', async t => {
  if (!requirePortal(t)) return;
  const { context, errors } = await setup(t);
  const probe = await chatAttackProbe(context);
  const customer = await user(context);
  await customer.locator('[data-support-open]').click();
  const filename = `<img src=x onerror="window.__chatAttack++">&'quoted'.png`;
  await customer.locator('[data-support-file]').setInputFiles({ name: filename, mimeType: 'image/png', buffer: png });
  await customer.locator('[data-support-preview]').waitFor({ state: 'visible' });
  assert.equal(await customer.locator('[data-support-preview] img').getAttribute('alt'), filename);
  assert.equal(await customer.locator('[data-support-preview] span').textContent(), filename);
  await assertInertChat(customer, '[data-support-preview], [data-support-messages]', probe);
  await customer.locator('[data-support-send]').click();
  await customer.locator('[data-support-message] img').waitFor();
  const desk = await operator(context);
  const selectCustomer = () => desk.locator('[data-support-conversation]').filter({ hasText: 'customer@example.invalid' }).click();
  await selectCustomer();
  await desk.locator('[data-support-file]').setInputFiles({ name: filename, mimeType: 'image/png', buffer: png });
  await desk.locator('[data-support-attachment]').waitFor({ state: 'visible' });
  assert.equal(await desk.locator('[data-support-attachment-name]').textContent(), filename);
  await assertInertChat(desk, '[data-support-attachment], [data-support-messages]', probe);
  await desk.locator('[data-support-send]').click();
  await customer.locator('[data-support-message][data-sender=agent] img').waitFor();
  await assertInertChat(customer, '[data-support-preview], [data-support-messages]', probe);
  await assertInertChat(desk, '[data-support-attachment], [data-support-messages]', probe);
  for (const page of [customer, desk]) {
    await page.reload();
    if (page === customer) await page.locator('[data-support-open]').click(); else await selectCustomer();
    await page.locator('[data-support-message] img').nth(1).waitFor();
    const scope = '[data-support-messages], [data-support-preview], [data-support-attachment], .support-image-viewer';
    assert.deepEqual(await page.locator('[data-support-image] span').allTextContents(), [filename, filename]);
    for (let index = 0; index < 2; index++) {
      const image = page.locator('[data-support-image] img').nth(index);
      assert.equal(await image.getAttribute('alt'), filename);
      await page.locator('[data-support-image]').nth(index).click();
      await page.locator('.support-image-viewer').waitFor({ state: 'visible' });
      assert.equal(await page.locator('.support-image-viewer img').getAttribute('alt'), filename);
      assert.equal(await page.locator('.support-image-viewer img').evaluate(image => image.naturalWidth), 1);
      await assertInertChat(page, scope, probe);
      await page.keyboard.press('Escape');
      await page.locator('.support-image-viewer').waitFor({ state: 'hidden' });
    }
    await assertInertChat(page, scope, probe);
  }
  assert.deepEqual(errors, []);
});

test('SVG, HTML, corrupt bytes and oversized headers disguised as supported images are rejected without losing either composer draft', async t => {
  if (!requirePortal(t)) return;
  const { context, errors } = await setup(t);
  const probe = await chatAttackProbe(context);
  const customer = await user(context);
  await customer.locator('[data-support-open]').click();
  await customerSend(customer, '已有记录必须保留');
  const desk = await operator(context);
  await desk.locator('[data-support-conversation]').filter({ hasText: 'customer@example.invalid' }).click();
  const maliciousBytes = [
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="window.__chatAttack++"><image href="https://attack.example.invalid/svg-upload"/></svg>'),
    Buffer.from('<html><script>window.__chatAttack++;fetch("https://attack.example.invalid/html-upload")</script></html>'),
    png.subarray(0, 20),
    // A tiny PNG with a valid IHDR CRC claiming 5001 × 5001 pixels. Reject
    // the header without needing to create or decode a large image fixture.
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAE4kAABOJCAIAAAD2ZKgHAAAADElEQVR4nGM4k+kBAAOCAX62ByEmAAAAAElFTkSuQmCC', 'base64'),
  ];
  for (const page of [customer, desk]) {
    const prefix = page === customer ? '#support-widget ' : '';
    const attachment = page.locator(prefix + (page === customer ? '[data-support-preview]' : '[data-support-attachment]'));
    const draft = page === customer ? '用户的有效草稿' : '客服的有效草稿';
    await page.locator(prefix + '[data-support-text]').fill(draft);
    await page.locator(prefix + '[data-support-file]').setInputFiles({ name: 'retained.png', mimeType: 'image/png', buffer: png });
    await attachment.waitFor({ state: 'visible' });
    const originalImage = await attachment.locator('img').getAttribute('src');
    const messageCount = await page.locator('[data-support-message]').count();
    // Install the spy after the legitimate image has finished preparing. Invalid
    // replacements must fail their metadata check before entering image decode.
    await page.evaluate(() => {
      window.__originalChatImageDecode = HTMLImageElement.prototype.decode;
      window.__chatImageDecodeCalls = 0;
      HTMLImageElement.prototype.decode = function (...args) {
        window.__chatImageDecodeCalls++;
        return window.__originalChatImageDecode.apply(this, args);
      };
    });
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
      for (const [index, buffer] of maliciousBytes.entries()) {
        await page.locator(prefix + '[data-support-file]').setInputFiles({ name: `disguised-${index}.${type.split('/')[1]}`, mimeType: type, buffer });
        await page.locator(prefix + '[data-support-error]').filter({ hasText: 'PNG' }).waitFor();
        await page.waitForFunction(prefix => !document.querySelector(prefix + '[data-support-send]').disabled, prefix);
        assert.equal(await page.locator(prefix + '[data-support-text]').inputValue(), draft);
        assert.equal(await attachment.isVisible(), true, 'previous valid attachment survives the rejected replacement');
        assert.equal(await attachment.locator('img').getAttribute('src'), originalImage);
        assert.equal(await page.locator('[data-support-message]').count(), messageCount, 'rejected upload does not add or remove messages');
        assert.equal(await page.evaluate(() => window.__chatImageDecodeCalls), 0, 'invalid or oversized image metadata is rejected before Image.decode is called');
        await assertInertChat(page, prefix + '[data-support-messages], ' + prefix + '[data-support-preview], ' + prefix + '[data-support-attachment]', probe);
      }
    }
    await page.evaluate(() => { HTMLImageElement.prototype.decode = window.__originalChatImageDecode; });
    await page.locator(prefix + '[data-support-send]').click();
    await page.locator('[data-support-message]').filter({ hasText: draft }).waitFor();
    const sent = page.locator('[data-support-message]').filter({ hasText: draft });
    assert.equal(await sent.locator('img').getAttribute('alt'), 'retained.png');
    assert.equal(await sent.locator('img').getAttribute('src'), originalImage);
    await customer.locator('[data-support-message]').filter({ hasText: draft }).waitFor();
  }
  await customer.reload();
  await customer.locator('[data-support-open]').click();
  assert.equal(await customer.locator('[data-support-message]').count(), 3, 'only the original message and two valid retained drafts are persisted');
  assert.equal(await customer.locator('[data-support-message] img').count(), 2);
  assert.deepEqual(errors, []);
});
