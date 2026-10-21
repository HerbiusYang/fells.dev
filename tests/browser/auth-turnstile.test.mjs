import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';

let browser, server, base = process.env.FELLS_BROWSER_BASE;
const dist = resolve(process.env.TEST_DIST_DIR || 'dist');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const agreement = { version: 'v1', h1: 'Terms', lede: 'Read these terms.', clauses: [{ title: 'Service', body: 'Service terms.' }], ui: {} };

before(async () => {
  if (!base) {
    server = createServer(async (req, res) => {
      try {
        let path = resolve(dist, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
        if (path !== dist && !path.startsWith(dist + '/')) { res.writeHead(403).end(); return; }
        if ((await stat(path)).isDirectory()) path += '/index.html';
        res.writeHead(200, { 'content-type': mime[extname(path)] ?? 'application/octet-stream' });
        res.end(await readFile(path));
      } catch { res.writeHead(404).end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  }
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (!existsSync(chromium.executablePath()) && existsSync(chrome) ? chrome : undefined);
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
});
after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); });

async function setup(t, handlePost, { scriptUnavailable = false } = {}) {
  const context = await browser.newContext();
  t.after(() => context.close());
  const calls = [], errors = [];
  await context.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
  await context.route('**/api/app/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method();
    if (method === 'POST') {
      const call = { path, body: request.postDataJSON() }; calls.push(call);
      if (await handlePost?.(route, call, calls)) return;
      await route.fulfill({ status: 200, json: { ok: true, resend_after: 1 } }); return;
    }
    if (path === '/api/app/session') { await route.fulfill({ status: 401, json: { error: 'unauthorized' } }); return; }
    if (path === '/api/app/auth/config') {
      await route.fulfill({ status: 200, json: { signup_enabled: true, email_enabled: true, channels: ['email'], min_password_length: 8, turnstile_site_key: 'test-site-key' } }); return;
    }
    if (path === '/api/app/agreement') { await route.fulfill({ status: 200, json: agreement }); return; }
    await route.fulfill({ status: 404, json: { error: 'unexpected request' } });
  });
  await context.route(url => url.hostname === 'challenges.cloudflare.com' && url.pathname === '/turnstile/v0/api.js', route => scriptUnavailable ? route.abort() : route.fulfill({
    status: 200, contentType: 'application/javascript', body: `
      window.__turnstileTest = {
        options: null, resets: 0,
        solve(token) { this.options.callback(token); },
        expire() { this.options['expired-callback'](); },
        fail() { this.options['error-callback'](); }
      };
      window.turnstile = {
        render(element, options) { window.__turnstileTest.options = options; element.textContent = 'Turnstile test widget'; return 'test-widget'; },
        reset() { window.__turnstileTest.resets++; },
        remove() {}
      };
    `,
  }));
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', error => errors.push(error.message));
  return { page, calls, errors };
}
async function dismissAuthError(page, message) {
  const dialog = page.locator('[data-error-dialog][open]');
  await dialog.waitFor({ state: 'visible' });
  assert.match(await dialog.locator('[data-error-message]').innerText(), message);
  await dialog.locator('[data-close-error]').click();
  await dialog.waitFor({ state: 'hidden' });
}

test('configured Turnstile blocks login until solved and requires a fresh token after rejection', async t => {
  const { page, calls, errors } = await setup(t, async (route, call, all) => {
    if (call.path !== '/api/app/session') return false;
    await route.fulfill(all.length === 1 ? { status: 403, json: { error: 'captcha rejected' } } : { status: 200, json: { ok: true, username: 'existing-user', display_name: 'Existing user' } });
    return true;
  });
  await page.goto(`${base}/app/start?next=%2Fcheckout`, { waitUntil: 'domcontentloaded' });
  await page.locator('#auth-email:not([disabled])').waitFor();
  assert.equal(await page.locator('[data-turnstile]').innerText(), 'Turnstile test widget');
  await page.locator('#auth-email').fill('existing-user');
  await page.locator('#auth-password').fill('actual-password');
  const resetsBeforeLogin = await page.evaluate(() => window.__turnstileTest.resets);
  await page.locator('[data-auth-form] [type=submit]').click();
  assert.deepEqual(calls, [], 'no login request is sent without a solved challenge');
  await dismissAuthError(page, /security verification/);

  await page.evaluate(() => window.__turnstileTest.solve('first-token'));
  await page.locator('[data-auth-form] [type=submit]').click();
  await page.waitForFunction(previous => window.__turnstileTest.resets > previous, resetsBeforeLogin);
  assert.deepEqual(calls.map(call => call.body.turnstile_token), ['first-token']);
  await dismissAuthError(page, /captcha rejected/);
  await page.locator('[data-auth-form] [type=submit]').click();
  assert.equal(calls.length, 1, 'the rejected token cannot be reused by the form');
  await dismissAuthError(page, /security verification/);

  await page.evaluate(() => window.__turnstileTest.solve('fresh-token'));
  await page.locator('[data-auth-form] [type=submit]').click();
  await page.waitForURL(url => url.pathname.replace(/\/$/, '') === '/checkout');
  assert.deepEqual(calls.map(call => call.body.turnstile_token), ['first-token', 'fresh-token']);
  assert.deepEqual(errors, []);
});

for (const [mode, purpose] of [['create', 'signup'], ['reset', 'reset']]) {
  test(`configured Turnstile protects ${purpose} email-code requests and clears expired/error tokens`, async t => {
    const { page, calls, errors } = await setup(t);
    await page.goto(`${base}/app/start?mode=${mode}`, { waitUntil: 'domcontentloaded' });
    await page.locator('#auth-email:not([disabled])').waitFor();
    await page.locator('#auth-email').fill(`${purpose}@example.test`);
    const send = page.locator('[data-send-code]');
    const resetsBeforeSend = await page.evaluate(() => window.__turnstileTest.resets);

    assert.equal(await page.locator('[data-captcha-hint]').isVisible(), true);
    assert.match(await page.locator('[data-captcha-hint]').innerText(), /Cloudflare/);
    assert.equal(await send.isDisabled(), true, 'requesting a code is disabled until the challenge succeeds');
    assert.deepEqual(calls, [], 'no email-code request is sent before the challenge');
    await page.evaluate(() => window.__turnstileTest.solve('expired-token'));
    assert.equal(await send.isDisabled(), false, 'a solved challenge enables the code request');
    await page.evaluate(() => window.__turnstileTest.expire());
    assert.equal(await send.isDisabled(), true, 'expiration disables code requests again');
    assert.deepEqual(calls, [], 'expired challenge cannot authorize a code');
    await page.evaluate(() => window.__turnstileTest.solve('error-token'));
    assert.equal(await send.isDisabled(), false);
    await page.evaluate(() => window.__turnstileTest.fail());
    assert.equal(await send.isDisabled(), true, 'a widget error disables code requests');
    assert.deepEqual(calls, [], 'widget error clears the token');
    await dismissAuthError(page, /security verification/);

    await page.evaluate(() => window.__turnstileTest.solve('valid-token'));
    assert.equal(await send.isDisabled(), false);
    await send.click();
    await page.waitForFunction(previous => window.__turnstileTest.resets > previous, resetsBeforeSend);
    assert.deepEqual(calls, [{ path: '/api/app/auth/code', body: { channel: 'email', dest: `${purpose}@example.test`, purpose, turnstile_token: 'valid-token' } }]);
    assert.equal(await send.isDisabled(), true, 'a sent code consumes the challenge and starts the resend cooldown');
    assert.deepEqual(errors, []);
  });
}

test('configured Turnstile fails closed if its script cannot load', async t => {
  const { page, calls, errors } = await setup(t, undefined, { scriptUnavailable: true });
  await page.goto(`${base}/app/start`, { waitUntil: 'domcontentloaded' });
  await dismissAuthError(page, /security verification/);
  assert.equal(await page.locator('[data-auth-form] [type=submit]').isDisabled(), true);
  assert.deepEqual(calls, [], 'unavailable widget cannot silently fall back to unprotected login');
  assert.deepEqual(errors, []);
});

for (const enabled of [true, false]) test(`GitHub sign-in is ${enabled ? 'offered with referral context' : 'hidden without server support'}`, async t => {
  const { page, errors } = await setup(t);
  await page.route('**/api/app/auth/config', route => route.fulfill({ json: { signup_enabled: true, email_enabled: true, github_enabled: enabled, channels: ['email'], min_password_length: 8, turnstile_site_key: '' } }));
  await page.goto(`${base}/app/start/?ref=friend-code`);
  await page.locator('#auth-email:not([disabled])').waitFor();
  const button = page.locator('[data-github]');
  assert.equal(await button.isVisible(), enabled);
  if (enabled) {
    const target = new URL(await button.getAttribute('href'), base);
    assert.equal(target.pathname, '/portal/api/auth/github/start');
    assert.equal(target.searchParams.get('from'), 'app');
    assert.equal(target.searchParams.get('ref'), 'friend-code');
  }
  assert.deepEqual(errors, []);
});

test('GitHub errors are localized text and preserve the existing accessible error dialog', async t => {
  const { page, errors } = await setup(t);
  await page.goto(`${base}/app/start/?gh_error=unverified`);
  await dismissAuthError(page, /not verified/);
  assert.deepEqual(errors, []);
});

test('a failed Turnstile download does not hide independently enabled GitHub sign-in', async t => {
  const { page, errors } = await setup(t, undefined, true);
  await page.route('**/api/app/auth/config', route => route.fulfill({ json: { signup_enabled: true, email_enabled: true, github_enabled: true, channels: ['email'], min_password_length: 8, turnstile_site_key: 'test-site-key' } }));
  await page.goto(`${base}/app/start/`);
  await dismissAuthError(page, /security verification/);
  assert.equal(await page.locator('[data-github]').isVisible(), true);
  assert.equal(await page.locator('[data-auth-form] [type=submit]').isDisabled(), true, 'password login remains closed without its required challenge');
  assert.deepEqual(errors, []);
});
