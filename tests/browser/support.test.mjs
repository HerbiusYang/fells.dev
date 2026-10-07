import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';

const dist = resolve('dist');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGM4k+kBAAOCAX62ByEmAAAAAElFTkSuQmCC', 'base64');
let server, browser, base;
before(async () => {
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
  await page.goto(base + prefix + '/support/login/');
  await page.locator('#support-name').fill('Support tester');
  await page.locator('#support-email').fill('support@example.invalid');
  await page.locator('[data-support-login-form] [type=submit]').click();
  await page.waitForURL('**/support');
  await page.locator('[data-support-search]').waitFor({ state: 'visible' });
  return page;
}
async function customerSend(page, text) {
  await page.locator('#support-widget [data-support-text]').fill(text);
  await page.locator('#support-widget [data-support-send]').click();
  await page.locator('#support-widget [data-support-message]').filter({ hasText: text }).waitFor();
}

test('support desk entry redirects without a demo session and has locale-aware routes', async t => {
  const { context, errors } = await setup(t);
  const page = await context.newPage();
  for (const prefix of ['', '/zh', '/zh-hant', '/ja', '/ko', '/es']) {
    await page.goto(base + prefix + '/support/');
    await page.waitForURL(`**${prefix}/support/login`);
    assert.equal(await page.locator('input[type=password]').count(), 0);
    assert.equal(await page.locator('#support-name').isEnabled(), true);
    assert.ok((await page.locator('.support-login-intro').innerText()).length > 20);
  }
  assert.deepEqual(errors, []);
});

test('customer and operator exchange safe text/images, unread state, customer details and resolved status', async t => {
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
  await customer.waitForURL('**/app/start');
  await desk.locator('[data-support-conversation]').waitFor({ state: 'detached' });
  assert.equal(await desk.locator('[data-support-messages]').innerText(), '');
  assert.equal(await desk.locator('[data-support-detail-email]').innerText(), '');
  const oldDesk = await context.newPage();
  await oldDesk.goto(base + '/zh/support/');
  await oldDesk.locator('[data-support-search]').waitFor();
  await desk.locator('[data-support-logout]').click();
  await oldDesk.waitForURL('**/support/login');
  assert.deepEqual(errors, []);
});

test('operator drafts stay with their customer, send failures preserve attachment, and history restoration reloads', async t => {
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
