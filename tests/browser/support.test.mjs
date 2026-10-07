import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, extname, relative } from 'node:path';
import { chromium } from 'playwright';

const dist = resolve('dist');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGM4k+kBAAOCAX62ByEmAAAAAElFTkSuQmCC', 'base64');
const prefixes = ['', '/zh', '/zh-hant', '/ja', '/ko', '/es'];
let server, browser, base, portalToken;
const portalPath = (prefix = '/zh', desk = false) => `${prefix}/${portalToken}${desk ? '/desk' : ''}`;
function requirePortal(t) {
  if (portalToken) return true;
  t.skip('SUPPORT_PORTAL_PATH is unconfigured; private operator pages are intentionally omitted');
  return false;
}
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
async function operator(context, prefix = '/zh') {
  const page = await context.newPage();
  await page.goto(base + portalPath(prefix) + '/');
  await page.locator('#support-name').fill('Support tester');
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
  await desk.locator('[data-support-search]').fill('no-such-customer');
  await desk.locator('[data-support-conversation]').waitFor({ state: 'detached' });
  await desk.locator('[data-support-search]').fill('');
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
