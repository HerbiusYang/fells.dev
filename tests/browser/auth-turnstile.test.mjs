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
      await route.fulfill({ status: 200, json: { ok: true, resend_after: 1, expires_in: 600 } }); return;
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
        options: null, resets: 0, removes: 0,
        solve(token) { this.options.callback(token); },
        expire() { this.options['expired-callback'](); },
        fail() { this.options['error-callback'](); }
      };
      window.turnstile = {
        render(element, options) { window.__turnstileTest.options = options; element.textContent = 'Turnstile test widget'; return 'test-widget'; },
        reset() { window.__turnstileTest.resets++; },
        remove() { window.__turnstileTest.removes++; }
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
    await page.waitForFunction(() => document.querySelector('[data-msg]').textContent.includes('latest verification email'));
    assert.deepEqual(calls, [
      { path: '/api/app/auth/human', body: { channel: 'email', dest: `${purpose}@example.test`, purpose, turnstile_token: 'valid-token' } },
      { path: '/api/app/auth/code', body: { channel: 'email', dest: `${purpose}@example.test`, purpose, turnstile_token: '' } },
    ]);
    assert.equal(await page.evaluate(() => window.__turnstileTest.resets), resetsBeforeSend, 'the server proof does not restart the widget after a successful send');
    assert.match(await page.locator('[data-msg]').innerText(), /valid for 10 minutes/);
    assert.equal(await page.locator('#auth-code').evaluate(el => el === document.activeElement), true);
    await page.locator('#auth-code').fill('111111');
    await page.evaluate(() => { window.__turnstileTest.expire(); window.__turnstileTest.fail(); });
    assert.equal(await page.locator('[data-error-dialog]').isVisible(), false, 'retiring the original widget token does not invalidate an issued server proof');
    await page.waitForFunction(() => !document.querySelector('[data-send-code]').disabled);
    await send.click();
    await page.locator('#auth-code:not([disabled])').waitFor();
    assert.equal(calls.filter(call => call.path === '/api/app/auth/human').length, 1, 'same-scope resend reuses the short server proof');
    assert.equal(calls.filter(call => call.path === '/api/app/auth/code').length, 2);
    assert.equal(await page.locator('#auth-code').inputValue(), '', 'a successfully resent code clears the superseded input');
    assert.deepEqual(errors, []);
  });
}

test('changing the email or purpose clears its OTP and requires a new human proof', async t => {
  const { page, calls, errors } = await setup(t);
  await page.goto(`${base}/app/start?mode=reset`);
  await page.locator('#auth-email:not([disabled])').fill('first@example.test');
  await page.evaluate(() => window.__turnstileTest.solve('first-proof'));
  await page.locator('[data-send-code]').click();
  await page.locator('#auth-code:not([disabled])').fill('123456');
  await page.locator('#auth-email').fill('second@example.test');
  assert.equal(await page.locator('#auth-code').inputValue(), '');
  assert.equal(await page.locator('[data-send-code]').isDisabled(), true);
  await page.evaluate(() => window.__turnstileTest.solve('second-proof'));
  await page.locator('[data-send-code]').click();
  await page.locator('#auth-code:not([disabled])').fill('654321');
  await page.locator('[data-auth-mode=create]').click();
  assert.equal(await page.locator('#auth-code').inputValue(), '');
  assert.equal(await page.locator('[data-send-code]').isDisabled(), true);
  await page.evaluate(() => window.__turnstileTest.solve('signup-proof'));
  await page.locator('[data-send-code]').click();
  await page.locator('#auth-code:not([disabled])').waitFor();
  assert.deepEqual(calls.filter(call => call.path === '/api/app/auth/human').map(call => [call.body.dest, call.body.purpose, call.body.turnstile_token]), [
    ['first@example.test', 'reset', 'first-proof'], ['second@example.test', 'reset', 'second-proof'], ['second@example.test', 'signup', 'signup-proof'],
  ]);
  assert.deepEqual(errors, []);
});

test('an incorrect reset code preserves both input and the independent human proof', async t => {
  const { page, calls, errors } = await setup(t, async (route, call) => {
    if (call.path !== '/api/app/auth/reset') return false;
    await route.fulfill({ status: 400, json: { error: 'That code is wrong or has expired — request a new one.' } }); return true;
  });
  await page.goto(`${base}/app/start?mode=reset`);
  await page.locator('#auth-email:not([disabled])').fill('owner@example.test');
  await page.evaluate(() => window.__turnstileTest.solve('initial-proof'));
  await page.locator('[data-send-code]').click();
  await page.locator('#auth-code:not([disabled])').fill('123456');
  await page.locator('#auth-password').fill('replacement-password');
  await page.locator('#auth-confirm').fill('replacement-password');
  const resets = await page.evaluate(() => window.__turnstileTest.resets);
  await page.locator('[data-auth-form] [type=submit]').click();
  await dismissAuthError(page, /wrong or has expired/);
  assert.equal(await page.locator('#auth-code').inputValue(), '123456');
  assert.equal(await page.locator('#auth-password').inputValue(), 'replacement-password');
  assert.equal(await page.evaluate(() => window.__turnstileTest.resets), resets);
  await page.waitForFunction(() => !document.querySelector('[data-send-code]').disabled);
  await page.locator('[data-send-code]').click();
  await page.locator('#auth-code:not([disabled])').waitFor();
  assert.equal(calls.filter(call => call.path === '/api/app/auth/human').length, 1);
  assert.deepEqual(errors, []);
});

for (const limited of ['code', 'reset']) test(`${limited} 429 respects Retry-After without clearing the OTP or human proof`, async t => {
  const { page, calls, errors } = await setup(t, async (route, call) => {
    if (call.path !== `/api/app/auth/${limited}`) return false;
    await route.fulfill({ status: 429, headers: { 'Retry-After': '180' }, json: { code: 'otp_verify_rate_limited', error: 'Too many attempts. Try again later.' } }); return true;
  });
  await page.goto(`${base}/app/start?mode=reset`);
  await page.locator('#auth-email:not([disabled])').fill('limited@example.test');
  await page.evaluate(() => window.__turnstileTest.solve('initial-proof'));
  if (limited === 'code') await page.locator('#auth-code').fill('123456');
  await page.locator('[data-send-code]').click();
  if (limited === 'reset') {
    await page.locator('#auth-code:not([disabled])').fill('123456');
    await page.locator('#auth-password').fill('replacement-password');
    await page.locator('#auth-confirm').fill('replacement-password');
    await page.locator('[data-auth-form] [type=submit]').click();
  }
  await dismissAuthError(page, /Too many attempts/);
  assert.equal(await page.locator('#auth-code').inputValue(), '123456');
  assert.equal(await page.locator('[data-send-code]').isDisabled(), true);
  assert.match(await page.locator('[data-send-code]').innerText(), /min/);
  assert.equal(await page.locator('[data-turnstile]').isVisible(), false);
  if (limited === 'reset') assert.equal(await page.locator('[data-auth-form] [type=submit]').isDisabled(), true);
  const posts = calls.length;
  await page.locator('[data-send-code]').evaluate(button => button.click());
  assert.equal(calls.length, posts, 'there is no automatic or disabled-button resend');
  await page.locator('#auth-email').fill('another@example.test');
  assert.equal(await page.locator('#auth-code').inputValue(), '');
  assert.equal(await page.locator('[data-auth-form] [type=submit]').isDisabled(), false, 'another email does not inherit the previous scope cooldown');
  assert.deepEqual(errors, []);
});

test('a rejected or expired server proof asks for a fresh widget token before another send', async t => {
  let sends = 0;
  const { page, calls, errors } = await setup(t, async (route, call) => {
    if (call.path !== '/api/app/auth/code' || ++sends !== 1) return false;
    await route.fulfill({ status: 403, json: { code: 'captcha_required', error: 'Complete security verification again.' } }); return true;
  });
  await page.goto(`${base}/app/start?mode=reset`);
  await page.locator('#auth-email:not([disabled])').fill('owner@example.test');
  await page.evaluate(() => window.__turnstileTest.solve('retired-proof'));
  await page.locator('[data-send-code]').click();
  await dismissAuthError(page, /Complete the security verification and try again\./);
  assert.equal(await page.locator('[data-send-code]').isDisabled(), true);
  await page.evaluate(() => window.__turnstileTest.solve('fresh-proof'));
  await page.locator('[data-send-code]').click();
  await page.locator('#auth-code:not([disabled])').waitFor();
  assert.deepEqual(calls.filter(call => call.path === '/api/app/auth/human').map(call => call.body.turnstile_token), ['retired-proof', 'fresh-proof']);
  assert.deepEqual(errors, []);
});

test('legacy email-code responses without expiry never show an invalid countdown', async t => {
  const { page, errors } = await setup(t, async (route, call) => {
    if (call.path !== '/api/app/auth/code') return false;
    await route.fulfill({ status: 200, json: { ok: true } }); return true;
  });
  await page.goto(`${base}/app/start?mode=reset`);
  await page.locator('#auth-email:not([disabled])').fill('owner@example.test');
  await page.evaluate(() => window.__turnstileTest.solve('initial-proof'));
  await page.locator('[data-send-code]').click();
  await page.waitForFunction(() => document.querySelector('[data-msg]').textContent.includes('owner@example.test'));
  assert.doesNotMatch(await page.locator('[data-msg]').innerText(), /NaN|expired|valid for/);
  assert.doesNotMatch(await page.locator('[data-send-code]').innerText(), /NaN/);
  assert.equal(await page.locator('[data-send-code]').isDisabled(), true);
  assert.deepEqual(errors, []);
});

for (const outcome of ['mail failure', 'network failure', 'invalid response']) test(`${outcome} clears a potentially retired OTP and starts a cautious resend cooldown`, async t => {
  const { page, calls, errors } = await setup(t, async (route, call) => {
    if (call.path !== '/api/app/auth/code') return false;
    if (outcome === 'mail failure') await route.fulfill({ status: 502, json: { error: 'Mail delivery failed.' } });
    else if (outcome === 'network failure') await route.abort('failed');
    else await route.fulfill({ status: 200, contentType: 'text/plain', body: 'invalid response' });
    return true;
  });
  await page.goto(`${base}/app/start?mode=reset`);
  await page.locator('#auth-email:not([disabled])').fill('owner@example.test');
  await page.locator('#auth-code').fill('123456');
  await page.evaluate(() => window.__turnstileTest.solve('initial-proof'));
  await page.locator('[data-send-code]').click();
  await dismissAuthError(page, /Do not use the previous code/);
  assert.equal(await page.locator('#auth-code').inputValue(), '', 'the former code may already have been retired by issuance');
  assert.equal(await page.locator('[data-send-code]').isDisabled(), true);
  assert.equal(await page.locator('[data-turnstile]').isVisible(), false, 'delivery errors do not consume the server human proof');
  assert.equal(calls.filter(call => call.path === '/api/app/auth/code').length, 1, 'there is no automatic mail retry');
  assert.deepEqual(errors, []);
});

test('a failed human exchange preserves the unsubmitted email-code input', async t => {
  const { page, calls, errors } = await setup(t, async (route, call) => {
    if (call.path !== '/api/app/auth/human') return false;
    await route.fulfill({ status: 403, json: { code: 'captcha_required', error: 'Verify again.' } }); return true;
  });
  await page.goto(`${base}/app/start?mode=reset`);
  await page.locator('#auth-email:not([disabled])').fill('owner@example.test');
  await page.locator('#auth-code').fill('123456');
  await page.evaluate(() => window.__turnstileTest.solve('rejected-proof'));
  await page.locator('[data-send-code]').click();
  await dismissAuthError(page, /Complete the security verification and try again\./);
  assert.equal(await page.locator('#auth-code').inputValue(), '123456');
  assert.equal(calls.filter(call => call.path === '/api/app/auth/code').length, 0);
  assert.deepEqual(errors, []);
});

test('BFCache restoration refreshes absolute proof expiry without destroying the widget or resending mail', async t => {
  const { page, calls, errors } = await setup(t);
  await page.goto(`${base}/app/start?mode=reset`);
  await page.locator('#auth-email:not([disabled])').fill('owner@example.test');
  await page.evaluate(() => window.__turnstileTest.solve('initial-proof'));
  await page.locator('[data-send-code]').click();
  await page.locator('#auth-code:not([disabled])').fill('123456');
  const posts = calls.length;
  await page.evaluate(() => {
    const now = Date.now();
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    Date.now = () => now + 600_001;
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  assert.equal(await page.evaluate(() => window.__turnstileTest.removes), 0);
  assert.equal(await page.locator('[data-turnstile]').isVisible(), true);
  assert.equal(await page.locator('[data-send-code]').isDisabled(), true, 'an expired human proof needs a fresh challenge');
  assert.equal(await page.locator('#auth-code').inputValue(), '123456', 'returning to the form does not discard the email code');
  assert.equal(await page.locator('[data-auth-form] [type=submit]').isDisabled(), false, 'OTP submission is separate from human-proof expiry');
  assert.equal(calls.length, posts);
  assert.deepEqual(errors, []);
});

for (const outcome of ['server failure', 'network failure', 'invalid response']) test(`unknown reset ${outcome} keeps input and directs the user to confirm with the new password`, async t => {
  const { page, calls, errors } = await setup(t, async (route, call) => {
    if (call.path !== '/api/app/auth/reset') return false;
    if (outcome === 'server failure') await route.fulfill({ status: 500, json: { error: 'Server error' } });
    else if (outcome === 'network failure') await route.abort('failed');
    else await route.fulfill({ status: 200, contentType: 'text/plain', body: 'invalid response' });
    return true;
  });
  await page.goto(`${base}/app/start?mode=reset`);
  await page.locator('#auth-email:not([disabled])').fill('owner@example.test');
  await page.locator('#auth-code').fill('123456');
  await page.locator('#auth-password').fill('replacement-password');
  await page.locator('#auth-confirm').fill('replacement-password');
  await page.locator('[data-auth-form] [type=submit]').click();
  await dismissAuthError(page, /reset result is unconfirmed.*signing in with your new password/);
  assert.equal(await page.locator('#auth-code').inputValue(), '123456');
  assert.equal(await page.locator('#auth-password').inputValue(), 'replacement-password');
  assert.equal(await page.locator('#auth-confirm').inputValue(), 'replacement-password');
  assert.equal(calls.filter(call => call.path === '/api/app/auth/reset').length, 1);
  assert.equal(calls.some(call => call.path === '/api/app/auth/code' || call.path === '/api/app/session'), false, 'an uncertain reset does not retry, send mail, or try a password automatically');
  assert.match(page.url(), /app\/start/);
  assert.deepEqual(errors, []);
});

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
  const { page, errors } = await setup(t, undefined, { scriptUnavailable: true });
  await page.route('**/api/app/auth/config', route => route.fulfill({ json: { signup_enabled: true, email_enabled: true, github_enabled: true, channels: ['email'], min_password_length: 8, turnstile_site_key: 'test-site-key' } }));
  await page.goto(`${base}/app/start/`);
  await dismissAuthError(page, /security verification/);
  assert.equal(await page.locator('[data-github]').isVisible(), true);
  assert.equal(await page.locator('[data-auth-form] [type=submit]').isDisabled(), true, 'password login remains closed without its required challenge');
  assert.deepEqual(errors, []);
});

for (const path of ['/api/app/session', '/api/app/auth/config', '/api/app/agreement']) {
  test(`a temporary initialization failure at ${path} can be retried without reloading or posting credentials`, async t => {
    const { page, calls, errors } = await setup(t);
    let reads = 0;
    await page.route(url => url.pathname === path, async route => {
      if (route.request().method() !== 'GET') return route.fallback();
      reads++;
      if (reads === 1) return route.fulfill({ status: 503, json: { error: 'Synthetic initialization outage' } });
      return route.fallback();
    });
    await page.goto(`${base}/app/start/?next=%2Fcheckout%2F`);
    await dismissAuthError(page, /Synthetic initialization outage/);
    assert.equal(await page.locator('#auth-email').isDisabled(), true);
    const retry = page.locator('[data-auth-retry]');
    assert.equal(await retry.isVisible(), true);
    await page.evaluate(() => { window.__authDocumentMarker = 'same initialization document'; });
    // Duplicate activation is coalesced while the initialization GETs are pending.
    await retry.evaluate(button => { button.click(); button.click(); });
    await page.locator('#auth-email:not([disabled])').waitFor();
    assert.equal(await retry.isVisible(), false);
    assert.equal(await page.evaluate(() => window.__authDocumentMarker), 'same initialization document');
    assert.equal(new URL(page.url()).searchParams.get('next'), '/checkout/');
    assert.equal(reads, 2);
    assert.deepEqual(calls, [], 'retry only re-reads session/configuration/terms');
    assert.deepEqual(errors, []);
  });
}

for (const [prefix, label, message] of [
  ['', 'Retry loading sign-in', /Synthetic localized outage/], ['/zh', '重新加载登录表单', /Synthetic localized outage/], ['/zh-hant', '重新載入登入表單', /操作未完成.*客服/],
  ['/ja', 'ログインフォームを再読み込み', /操作を完了.*サポート/], ['/ko', '로그인 양식 다시 불러오기', /작업을 완료.*고객 지원/], ['/es', 'Volver a cargar el acceso', /No se pudo completar.*soporte/],
]) test(`${prefix || 'en'} exposes a localized initialization recovery action`, async t => {
  const { page, calls, errors } = await setup(t);
  await page.route('**/api/app/auth/config', route => route.fulfill({ status: 503, json: { error: 'Synthetic localized outage' } }));
  await page.goto(`${base}${prefix}/app/start/`);
  await dismissAuthError(page, message);
  assert.equal(await page.locator('[data-auth-retry]').innerText(), label);
  assert.deepEqual(calls, []);
  assert.deepEqual(errors, []);
});

test('initialization retry rechecks the real cookie and honors the validated next destination', async t => {
  const { page, calls, errors } = await setup(t);
  let sessions = 0;
  await page.route('**/api/app/session', route => {
    assert.equal(route.request().method(), 'GET');
    sessions++;
    return sessions === 1
      ? route.fulfill({ status: 503, json: { error: 'Synthetic session outage' } })
      : route.fulfill({ json: { username: 'already-signed-in', display_name: 'Synthetic account', self_keys: true, created_at: 1700000000, agreement: { version: 'v1', accepted: true } } });
  });
  await page.goto(`${base}/app/start/?next=%2Fcheckout%2F`);
  await dismissAuthError(page, /Synthetic session outage/);
  await page.locator('[data-auth-retry]').click();
  await page.waitForURL(url => url.pathname === '/checkout/');
  assert.ok(sessions >= 2);
  assert.deepEqual(calls, [], 'an existing cookie never requires an automatic credential POST');
  assert.deepEqual(errors, []);
});

test('retry after an explicit session change keeps the fresh sign-in requirement', async t => {
  const { page, calls, errors } = await setup(t);
  let sessions = 0, configurations = 0;
  await page.route('**/api/app/session', route => { sessions++; return route.fallback(); });
  await page.route('**/api/app/auth/config', route => ++configurations === 1
    ? route.fulfill({ status: 503, json: { error: 'Synthetic replaced-session outage' } })
    : route.fallback());
  await page.goto(`${base}/app/start/?session=changed`);
  await dismissAuthError(page, /Synthetic replaced-session outage/);
  await page.locator('[data-auth-retry]').click();
  await page.locator('#auth-email:not([disabled])').waitFor();
  assert.equal(sessions, 0, 'a newly live cookie does not silently replace the account being shown');
  assert.equal(new URL(page.url()).searchParams.get('session'), 'changed');
  assert.deepEqual(calls, []);
  assert.deepEqual(errors, []);
});

test('a hanging Turnstile script times out, cleans up and supports one safe initialization retry', async t => {
  const { page, calls, errors } = await setup(t);
  await page.clock.install();
  let release, finished;
  const gate = new Promise(resolve => { release = resolve; });
  const oldRequestFinished = new Promise(resolve => { finished = resolve; });
  t.after(() => release());
  let loads = 0;
  await page.route(url => url.hostname === 'challenges.cloudflare.com' && url.pathname === '/turnstile/v0/api.js', async route => {
    loads++;
    if (loads > 1) return route.fallback();
    await gate;
    try { await route.abort('failed'); } finally { finished(); }
  });
  await page.goto(`${base}/app/start/`, { waitUntil: 'domcontentloaded' });
  await page.locator('script[data-auth-turnstile=pending]').waitFor({ state: 'attached' });
  await page.clock.fastForward(20_001);
  await dismissAuthError(page, /Security verification took too long/);
  assert.equal(await page.locator('script[data-auth-turnstile]').count(), 0, 'timed-out script and load handlers have been retired');
  assert.equal(await page.locator('#auth-email').isDisabled(), true);
  assert.deepEqual(calls, []);
  release(); await oldRequestFinished;
  await page.locator('[data-auth-retry]').click();
  await page.locator('#auth-email:not([disabled])').waitFor();
  assert.equal(loads, 2, 'retry starts one replacement load');
  assert.equal(await page.locator('[data-turnstile]').innerText(), 'Turnstile test widget');
  assert.equal(await page.locator('script[src*="challenges.cloudflare.com/turnstile"]').count(), 1);
  await page.locator('#auth-email').fill('existing-user');
  await page.locator('#auth-password').fill('existing-password');
  await page.locator('[data-auth-form] [type=submit]').click();
  await dismissAuthError(page, /security verification/);
  assert.deepEqual(calls, [], 'the reloaded widget still requires a real challenge token before login');
  assert.deepEqual(errors, []);
});
