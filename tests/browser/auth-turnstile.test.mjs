import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { chromium, webkit } from 'playwright';

let browser, server, base = process.env.FELLS_BROWSER_BASE;
const dist = resolve(process.env.TEST_DIST_DIR || 'dist');
const mobileWebKit = process.env.FELLS_AUTH_MOBILE_WEBKIT === '1';
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
  browser = mobileWebKit
    ? await webkit.launch({ headless: true })
    : await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
});
after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); });

async function setup(t, handlePost, { scriptUnavailable = false } = {}) {
  const context = await browser.newContext(mobileWebKit ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {});
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
        options: null, resets: 0, removes: 0, history: [],
        solve(token) { this.options.callback(token); },
        expire() { this.options['expired-callback'](); },
        fail() { this.options['error-callback'](); }
      };
      window.turnstile = {
        render(element, options) { const mock = window.__turnstileTest; mock.options = options; mock.history.push(options); element.textContent = 'Turnstile test widget'; return 'test-widget-' + mock.history.length; },
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
async function waitForWidget(page) {
  await page.waitForFunction(() => Boolean(window.__turnstileTest?.options));
}
async function solveCaptcha(page, token) {
  await waitForWidget(page);
  await page.evaluate(token => window.__turnstileTest.solve(token), token);
}
async function expectCaptchaError(page, message = /security verification/i) {
  await page.locator('[data-captcha-retry]').waitFor({ state: 'visible' });
  assert.match(await page.locator('[data-captcha-status]').innerText(), message);
  assert.equal(await page.locator('[data-error-dialog]').isVisible(), false, 'background verification never interrupts typing with a modal');
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
  await waitForWidget(page);
  assert.equal(await page.locator('[data-turnstile]').innerText(), 'Turnstile test widget');
  await page.locator('#auth-email').fill('existing-user');
  await page.locator('#auth-password').fill('actual-password');
  const resetsBeforeLogin = await page.evaluate(() => window.__turnstileTest.resets);
  await page.locator('[data-auth-form] [type=submit]').click();
  assert.deepEqual(calls, [], 'no login request is sent without a solved challenge');
  await dismissAuthError(page, /security verification/);

  await solveCaptcha(page, 'first-token');
  await page.locator('[data-auth-form] [type=submit]').click();
  await page.waitForFunction(previous => window.__turnstileTest.resets > previous, resetsBeforeLogin);
  assert.deepEqual(calls.map(call => call.body.turnstile_token), ['first-token']);
  await dismissAuthError(page, /captcha rejected/);
  await page.locator('[data-auth-form] [type=submit]').click();
  assert.equal(calls.length, 1, 'the rejected token cannot be reused by the form');
  await dismissAuthError(page, /security verification/);

  await solveCaptcha(page, 'fresh-token');
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
    await waitForWidget(page);
    const resetsBeforeSend = await page.evaluate(() => window.__turnstileTest.resets);

    assert.equal(await page.locator('[data-captcha-hint]').isVisible(), true);
    assert.match(await page.locator('[data-captcha-hint]').innerText(), /Cloudflare/);
    assert.equal(await send.isDisabled(), true, 'requesting a code is disabled until the challenge succeeds');
    assert.deepEqual(calls, [], 'no email-code request is sent before the challenge');
    await solveCaptcha(page, 'expired-token');
    assert.equal(await send.isDisabled(), false, 'a solved challenge enables the code request');
    await page.evaluate(() => window.__turnstileTest.expire());
    assert.equal(await send.isDisabled(), true, 'expiration disables code requests again');
    assert.deepEqual(calls, [], 'expired challenge cannot authorize a code');
    await solveCaptcha(page, 'error-token');
    assert.equal(await send.isDisabled(), false);
    await page.evaluate(() => window.__turnstileTest.fail());
    assert.equal(await send.isDisabled(), true, 'a widget error disables code requests');
    assert.deepEqual(calls, [], 'widget error clears the token');
    await expectCaptchaError(page);
    const renders = await page.evaluate(() => window.__turnstileTest.history.length);
    await page.locator('[data-captcha-retry]').click();
    await page.waitForFunction(previous => window.__turnstileTest.history.length > previous, renders);

    await solveCaptcha(page, 'valid-token');
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
  await solveCaptcha(page, 'first-proof');
  await page.locator('[data-send-code]').click();
  await page.locator('#auth-code:not([disabled])').fill('123456');
  await page.locator('#auth-email').fill('second@example.test');
  assert.equal(await page.locator('#auth-code').inputValue(), '');
  assert.equal(await page.locator('[data-send-code]').isDisabled(), true);
  await solveCaptcha(page, 'second-proof');
  await page.locator('[data-send-code]').click();
  await page.locator('#auth-code:not([disabled])').fill('654321');
  await page.locator('[data-auth-mode=create]').click();
  assert.equal(await page.locator('#auth-code').inputValue(), '');
  assert.equal(await page.locator('[data-send-code]').isDisabled(), true);
  await solveCaptcha(page, 'signup-proof');
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
  await solveCaptcha(page, 'initial-proof');
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
  await solveCaptcha(page, 'initial-proof');
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
  await solveCaptcha(page, 'retired-proof');
  await page.locator('[data-send-code]').click();
  await dismissAuthError(page, /Complete the security verification and try again\./);
  assert.equal(await page.locator('[data-send-code]').isDisabled(), true);
  await solveCaptcha(page, 'fresh-proof');
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
  await solveCaptcha(page, 'initial-proof');
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
  await solveCaptcha(page, 'initial-proof');
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
  await solveCaptcha(page, 'rejected-proof');
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
  await solveCaptcha(page, 'initial-proof');
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
  await expectCaptchaError(page);
  await page.locator('#auth-email').fill('existing-user');
  await page.locator('#auth-password').fill('existing-password');
  await page.locator('[data-auth-form] [type=submit]').click();
  await dismissAuthError(page, /security verification/);
  assert.deepEqual(calls, [], 'unavailable widget cannot silently fall back to unprotected login');
  assert.deepEqual(errors, []);
});

for (const enabled of [true, false]) test(`GitHub sign-in is ${enabled ? 'offered with referral context' : 'hidden without server support'}`, async t => {
  const { page, errors } = await setup(t);
  await page.route('**/api/app/auth/config', route => route.fulfill({ json: { signup_enabled: true, email_enabled: true, github_enabled: enabled, channels: ['email'], min_password_length: 8, turnstile_site_key: '' } }));
  await page.goto(`${base}/app/start/?ref=friend-code`);
  await page.locator('[data-auth-form] [type=submit]:not([disabled])').waitFor();
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
  const { page, calls, errors } = await setup(t, undefined, { scriptUnavailable: true });
  await page.route('**/api/app/auth/config', route => route.fulfill({ json: { signup_enabled: true, email_enabled: true, github_enabled: true, channels: ['email'], min_password_length: 8, turnstile_site_key: 'test-site-key' } }));
  await page.goto(`${base}/app/start/`);
  await expectCaptchaError(page);
  assert.equal(await page.locator('[data-github]').isVisible(), true);
  await page.locator('#auth-email').fill('existing-user');
  await page.locator('#auth-password').fill('existing-password');
  await page.locator('[data-auth-form] [type=submit]').click();
  await dismissAuthError(page, /security verification/);
  assert.deepEqual(calls, [], 'password login remains closed without its required challenge');
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
    assert.equal(await page.locator('#auth-email').isDisabled(), false);
    await page.locator('#auth-email').fill('existing-user');
    await page.locator('#auth-password').fill('existing-password');
    assert.equal(await page.locator('[data-auth-form] [type=submit]').isDisabled(), true);
    const retry = page.locator('[data-auth-retry]');
    assert.equal(await retry.isVisible(), true);
    await page.evaluate(() => { window.__authDocumentMarker = 'same initialization document'; });
    // Duplicate activation is coalesced while the initialization GETs are pending.
    await retry.evaluate(button => { button.click(); button.click(); });
    await page.locator('[data-auth-form] [type=submit]:not([disabled])').waitFor();
    assert.equal(await retry.isVisible(), false);
    assert.equal(await page.locator('#auth-email').inputValue(), 'existing-user');
    assert.equal(await page.locator('#auth-password').inputValue(), 'existing-password');
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
  await page.locator('[data-auth-form] [type=submit]:not([disabled])').waitFor();
  assert.equal(sessions, 0, 'a newly live cookie does not silently replace the account being shown');
  assert.equal(new URL(page.url()).searchParams.get('session'), 'changed');
  assert.deepEqual(calls, []);
  assert.deepEqual(errors, []);
});

for (const path of ['/api/app/session', '/api/app/auth/config', '/api/app/agreement']) {
  test(`typing and mode selection do not wait for ${path}`, async t => {
    const { page, calls, errors } = await setup(t);
    let release, requested;
    const gate = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { requested = resolve; });
    t.after(() => release());
    await page.route(url => url.pathname === path, async route => {
      requested(); await gate; await route.fallback();
    });
    await page.goto(`${base}/app/start/`, { waitUntil: 'domcontentloaded' });
    await started;
    await page.locator('#auth-email:not([disabled])').fill('existing-user');
    await page.locator('[data-auth-mode=reset]').click();
    await page.locator('#auth-email').fill('owner@example.test');
    await page.locator('#auth-code').fill('123456');
    await page.locator('#auth-password').fill('replacement-password');
    await page.locator('#auth-confirm').fill('replacement-password');
    assert.equal(await page.locator('[data-auth-form] [type=submit]').isDisabled(), true, 'editing never authorizes submission before session and configuration checks');
    assert.equal(await page.locator('[data-send-code]').isDisabled(), true);
    assert.equal(await page.locator('[data-error-dialog]').isVisible(), false);
    assert.deepEqual(calls, []);
    release();
    await waitForWidget(page);
    assert.equal(await page.locator('[data-auth]').getAttribute('data-mode'), 'reset', 'late initialization does not restore the original mode');
    assert.equal(await page.locator('#auth-email').inputValue(), 'owner@example.test');
    assert.equal(await page.locator('#auth-code').inputValue(), '123456');
    assert.equal(await page.locator('#auth-password').inputValue(), 'replacement-password');
    assert.equal(await page.locator('#auth-confirm').inputValue(), 'replacement-password');
    assert.deepEqual(calls, [], 'neither completing initialization nor typing posts credentials');
    assert.deepEqual(errors, []);
  });
}

test('a hanging script leaves the form editable and retries only verification without losing inputs', async t => {
  const { page, calls, errors } = await setup(t);
  await page.clock.install();
  let release, finished;
  const gate = new Promise(resolve => { release = resolve; });
  const oldRequestFinished = new Promise(resolve => { finished = resolve; });
  t.after(() => release());
  const reads = [];
  await page.route('**/api/app/**', route => {
    if (route.request().method() === 'GET') reads.push(new URL(route.request().url()).pathname);
    return route.fallback();
  });
  let loads = 0;
  await page.route(url => url.hostname === 'challenges.cloudflare.com' && url.pathname === '/turnstile/v0/api.js', async route => {
    loads++;
    if (loads > 2) return route.fallback();
    if (loads === 2) return route.abort('failed');
    await gate;
    try { await route.abort('failed'); } finally { finished(); }
  });
  await page.goto(`${base}/app/start/?mode=reset`, { waitUntil: 'domcontentloaded' });
  await page.locator('script[data-auth-turnstile=pending]').waitFor({ state: 'attached' });
  await page.locator('#auth-email').fill('owner@example.test');
  await page.locator('#auth-code').fill('123456');
  await page.locator('#auth-password').fill('replacement-password');
  await page.locator('#auth-confirm').fill('replacement-password');
  await page.locator('#auth-password').focus();
  assert.equal(await page.locator('[data-send-code]').isDisabled(), true);
  const initializationReads = [...reads];
  await page.clock.fastForward(20_001);
  await expectCaptchaError(page, /Security verification took too long/);
  assert.equal(await page.locator('script[data-auth-turnstile]').count(), 0, 'timed-out script and load handlers are retired');
  assert.equal(await page.locator('#auth-password').evaluate(el => el === document.activeElement), true, 'a background timeout does not steal focus');
  assert.equal(await page.locator('#auth-email').isDisabled(), false);
  assert.equal(await page.locator('[data-auth-retry]').isVisible(), false, 'only verification failed');
  assert.deepEqual(calls, []);
  release(); await oldRequestFinished;
  await page.locator('[data-captcha-retry]').evaluate(button => { button.click(); button.click(); });
  await expectCaptchaError(page);
  assert.equal(loads, 2, 'duplicate retry activation creates one replacement load');
  await page.locator('[data-captcha-retry]').evaluate(button => { button.click(); button.click(); });
  await waitForWidget(page);
  assert.equal(loads, 3, 'a failed retry can itself be retried');
  assert.equal(await page.locator('script[src*="challenges.cloudflare.com/turnstile"]').count(), 1);
  assert.deepEqual(reads, initializationReads, 'verification retry does not refetch session, configuration or terms');
  assert.equal(await page.locator('[data-auth]').getAttribute('data-mode'), 'reset');
  assert.equal(await page.locator('#auth-email').inputValue(), 'owner@example.test');
  assert.equal(await page.locator('#auth-code').inputValue(), '123456');
  assert.equal(await page.locator('#auth-password').inputValue(), 'replacement-password');
  assert.equal(await page.locator('#auth-confirm').inputValue(), 'replacement-password');
  assert.equal(await page.locator('[data-send-code]').isDisabled(), true, 'reloading the widget does not satisfy verification');
  assert.deepEqual(calls, [], 'retry never sends mail or submits credentials automatically');
  await solveCaptcha(page, 'fresh-token');
  assert.equal(await page.locator('[data-send-code]').isDisabled(), false);
  assert.deepEqual(calls, [], 'solving verification also waits for explicit submission');
  assert.deepEqual(errors, []);
});

test('a stalled challenge can be retried and retired widget callbacks cannot authorize or disrupt a new attempt', async t => {
  const { page, calls, errors } = await setup(t);
  await page.clock.install();
  await page.goto(`${base}/app/start/?mode=reset`);
  await waitForWidget(page);
  await page.locator('#auth-email').fill('owner@example.test');
  await page.locator('#auth-code').fill('123456');
  await page.locator('#auth-password').fill('replacement-password');
  await page.evaluate(() => { window.__retiredCaptcha = window.__turnstileTest.options; });
  await page.clock.fastForward(30_001);
  await expectCaptchaError(page, /Security verification took too long/);
  assert.equal(await page.evaluate(() => window.__turnstileTest.removes), 1);
  assert.equal(await page.locator('#auth-code').inputValue(), '123456');
  assert.equal(await page.locator('#auth-password').inputValue(), 'replacement-password');
  await page.locator('[data-captcha-retry]').evaluate(button => { button.click(); button.click(); });
  await page.waitForFunction(() => window.__turnstileTest.history.length === 2);
  await page.evaluate(() => window.__retiredCaptcha.callback('retired-token'));
  assert.equal(await page.locator('[data-send-code]').isDisabled(), true, 'a late callback cannot authorize a retired attempt');
  await solveCaptcha(page, 'current-token');
  await page.evaluate(() => {
    window.__retiredCaptcha['expired-callback']();
    window.__retiredCaptcha['error-callback']();
    window.__retiredCaptcha.callback('retired-token-again');
  });
  assert.equal(await page.locator('[data-send-code]').isDisabled(), false, 'retired error and expiry callbacks cannot clear the current token');
  assert.equal(await page.locator('[data-captcha-retry]').isVisible(), false);
  assert.deepEqual(calls, []);
  await page.locator('[data-send-code]').click();
  await page.waitForFunction(() => document.querySelector('[data-msg]').textContent.includes('latest verification email'));
  assert.deepEqual(calls.filter(call => call.path === '/api/app/auth/human').map(call => call.body.turnstile_token), ['current-token']);
  assert.deepEqual(errors, []);
});

test('an interactive challenge gives the user time to answer and resumes its deadline afterwards', async t => {
  const { page, calls, errors } = await setup(t);
  await page.clock.install();
  await page.goto(`${base}/app/start/`);
  await waitForWidget(page);
  await page.evaluate(() => window.__turnstileTest.options['before-interactive-callback']());
  await page.clock.fastForward(60_001);
  assert.equal(await page.locator('[data-captcha-retry]').isVisible(), false, 'the watchdog does not remove a challenge the user is answering');
  assert.equal(await page.evaluate(() => window.__turnstileTest.removes), 0);
  await page.evaluate(() => window.__turnstileTest.options['after-interactive-callback']());
  await page.clock.fastForward(30_001);
  await expectCaptchaError(page, /Security verification took too long/);
  assert.deepEqual(calls, []);
  assert.deepEqual(errors, []);
});

for (const mode of ['create', 'reset']) test(`maintenance recovery honors the requested ${mode} form without submitting`, async t => {
  const { page, calls, errors } = await setup(t);
  let maintenanceMode = 'maintenance', revision = 1;
  await page.route('**/__maintenance/status', route => route.fulfill({
    status: 200, headers: { 'Cache-Control': 'no-store' }, json: {
      version: 1, revision, mode: maintenanceMode, incident_id: 'synthetic-maintenance', title: '', message: 'Synthetic planned maintenance',
      starts_at: '2026-11-06T20:00:00Z', expected_end_at: null, next_update_at: null, updated_at: '2026-11-06T20:05:00Z', retry_after_seconds: 60, status_url: '',
    },
  }));
  await page.goto(`${base}/app/start/?mode=${mode}`);
  await page.locator('[data-maintenance-notice]:not([hidden])').waitFor();
  await page.waitForLoadState('networkidle');
  // Status can arrive between the session read and the configuration read.
  // In that case the transport also reports the maintenance interruption.
  if (await page.locator('[data-error-dialog]').isVisible()) await dismissAuthError(page, /Synthetic planned maintenance/);
  assert.equal(await page.locator('#auth-email').isDisabled(), true);
  assert.equal(await page.locator('[data-auth-form] [type=submit]').isDisabled(), true);
  maintenanceMode = 'normal'; revision++;
  await page.locator('[data-maintenance-check]').click();
  await page.locator('[data-maintenance-notice]').waitFor({ state: 'hidden' });
  await waitForWidget(page);
  assert.equal(await page.locator('[data-auth]').getAttribute('data-mode'), mode);
  assert.equal(await page.locator('#auth-email').getAttribute('type'), 'email');
  assert.equal(await page.locator('#auth-password').getAttribute('autocomplete'), 'new-password');
  assert.equal(await page.locator('#auth-confirm').isVisible(), true);
  assert.deepEqual(calls, []);
  assert.deepEqual(errors, []);
});

test('maintenance recovery refreshes newly enabled signup and email capabilities without clearing the form or a same-key token', async t => {
  const { page, calls, errors } = await setup(t);
  let maintenanceMode = 'normal', revision = 0, enabled = false, configurationReads = 0, release;
  const refreshGate = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  await page.route('**/__maintenance/status', route => route.fulfill({
    status: 200, headers: { 'Cache-Control': 'no-store' }, json: {
      version: 1, revision, mode: maintenanceMode, incident_id: 'synthetic-capability-change', title: '', message: 'Synthetic planned maintenance',
      starts_at: '2026-11-06T20:00:00Z', expected_end_at: null, next_update_at: null, updated_at: '2026-11-06T20:05:00Z', retry_after_seconds: 60, status_url: '',
    },
  }));
  await page.route('**/api/app/auth/config', async route => {
    configurationReads++;
    if (configurationReads > 1) await refreshGate;
    await route.fulfill({ json: { signup_enabled: enabled, email_enabled: enabled, channels: ['email'], min_password_length: 8, turnstile_site_key: 'test-site-key' } });
  });
  await page.goto(`${base}/app/start/?mode=create`);
  await dismissAuthError(page, /Email service is not configured/);
  await page.locator('#auth-username').fill('new-user');
  await page.locator('#auth-email').fill('new@example.test');
  await page.locator('#auth-code').fill('123456');
  await page.locator('#auth-password').fill('new-password');
  await page.locator('#auth-confirm').fill('new-password');
  await solveCaptcha(page, 'same-key-token');
  assert.equal(await page.locator('[data-send-code]').isDisabled(), true);
  assert.equal(await page.locator('[data-auth-form] [type=submit]').isDisabled(), true);
  const renders = await page.evaluate(() => window.__turnstileTest.history.length);
  maintenanceMode = 'maintenance'; revision++;
  await page.evaluate(() => dispatchEvent(new Event('focus')));
  await page.locator('[data-maintenance-notice]:not([hidden])').waitFor();
  assert.equal(await page.locator('#auth-email').isDisabled(), true);
  enabled = true; maintenanceMode = 'normal'; revision++;
  const refreshedConfig = page.waitForRequest('**/api/app/auth/config');
  await page.locator('[data-maintenance-check]').click();
  await refreshedConfig;
  await page.locator('#auth-email:not([disabled])').waitFor();
  assert.equal(await page.locator('[data-auth-form] [type=submit]').isDisabled(), true, 'submission waits for the refreshed capabilities');
  await page.locator('#auth-password').fill('updated-password');
  await page.locator('#auth-confirm').fill('updated-password');
  release();
  await page.locator('[data-auth-form] [type=submit]:not([disabled])').waitFor();
  assert.equal(configurationReads, 2, 'restoring service re-reads its configuration');
  assert.equal(await page.locator('[data-send-code]').isDisabled(), false, 'newly enabled email uses the still-valid same-key token');
  assert.equal(await page.evaluate(() => window.__turnstileTest.history.length), renders, 'same-key recovery does not recreate the widget');
  assert.equal(await page.locator('[data-auth]').getAttribute('data-mode'), 'create');
  assert.equal(await page.locator('#auth-username').inputValue(), 'new-user');
  assert.equal(await page.locator('#auth-email').inputValue(), 'new@example.test');
  assert.equal(await page.locator('#auth-code').inputValue(), '123456');
  assert.equal(await page.locator('#auth-password').inputValue(), 'updated-password');
  assert.equal(await page.locator('#auth-confirm').inputValue(), 'updated-password');
  assert.deepEqual(calls, [], 'restoring capabilities never submits signup or sends mail automatically');
  assert.deepEqual(errors, []);
});

test('a site-key refresh interrupted by renewed maintenance cannot leave the old widget or human proof active after recovery', async t => {
  const { page, calls, errors } = await setup(t);
  await page.clock.install();
  let maintenanceMode = 'normal', revision = 0, configurationReads = 0, release;
  const interruptedRefresh = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  await page.route('**/__maintenance/status', route => route.fulfill({
    status: 200, headers: { 'Cache-Control': 'no-store' }, json: {
      version: 1, revision, mode: maintenanceMode, incident_id: 'synthetic-key-rotation', title: '', message: 'Synthetic planned maintenance',
      starts_at: '2026-11-06T20:00:00Z', expected_end_at: null, next_update_at: null, updated_at: '2026-11-06T20:05:00Z', retry_after_seconds: 60, status_url: '',
    },
  }));
  await page.route('**/api/app/auth/config', async route => {
    const read = ++configurationReads;
    if (read === 2) await interruptedRefresh;
    await route.fulfill({ json: { signup_enabled: true, email_enabled: true, channels: ['email'], min_password_length: 8, turnstile_site_key: read === 1 ? 'old-site-key' : 'new-site-key' } });
  });
  await page.goto(`${base}/app/start/?mode=reset`);
  await page.locator('#auth-email').fill('owner@example.test');
  await solveCaptcha(page, 'old-key-proof');
  await page.evaluate(() => { window.__retiredCaptcha = window.__turnstileTest.options; });
  await page.locator('[data-send-code]').click();
  await page.waitForFunction(() => document.querySelector('[data-msg]').textContent.includes('latest verification email'));
  await page.locator('#auth-code').fill('123456');
  await page.clock.fastForward(1001);
  assert.equal(await page.locator('[data-send-code]').isDisabled(), false, 'the original same-scope human proof authorizes a resend');
  const initialPosts = calls.length;

  maintenanceMode = 'maintenance'; revision++;
  await page.evaluate(() => dispatchEvent(new Event('focus')));
  await page.locator('[data-maintenance-notice]:not([hidden])').waitFor();
  maintenanceMode = 'normal'; revision++;
  const refreshRequest = page.waitForRequest('**/api/app/auth/config');
  await page.locator('[data-maintenance-check]').click();
  await refreshRequest;
  await page.locator('[data-maintenance-notice]').waitFor({ state: 'hidden' });

  // A second interruption wins while the new configuration is still in flight.
  maintenanceMode = 'maintenance'; revision++;
  await page.evaluate(() => dispatchEvent(new Event('focus')));
  await page.locator('[data-maintenance-notice]:not([hidden])').waitFor();
  const refreshResponse = page.waitForResponse('**/api/app/auth/config');
  release();
  await (await refreshResponse).finished();
  await page.waitForLoadState('networkidle');
  assert.equal(await page.locator('[data-auth-form] [type=submit]').isDisabled(), true);
  assert.equal(await page.evaluate(() => window.__turnstileTest.history.length), 1, 'no replacement widget runs during maintenance');
  assert.equal(calls.length, initialPosts, 'the interrupted refresh never replays a request');

  maintenanceMode = 'normal'; revision++;
  await page.locator('[data-maintenance-check]').click();
  await page.locator('[data-maintenance-notice]').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => window.__turnstileTest.history.length === 2);
  assert.equal(configurationReads, 3);
  assert.equal(await page.evaluate(() => window.__turnstileTest.options.sitekey), 'new-site-key');
  assert.equal(await page.evaluate(() => window.__turnstileTest.removes), 1, 'the old widget is retired when the new key is applied');
  assert.equal(await page.locator('#auth-code').inputValue(), '123456');
  assert.equal(await page.locator('[data-send-code]').isDisabled(), true, 'the previous server proof is also retired by the key change');
  await page.evaluate(() => window.__retiredCaptcha.callback('late-old-key-token'));
  assert.equal(await page.locator('[data-send-code]').isDisabled(), true, 'a late old-key callback cannot authorize submission');
  await solveCaptcha(page, 'new-key-proof');
  await page.locator('[data-send-code]').click();
  await page.waitForFunction(() => document.querySelector('[data-msg]').textContent.includes('latest verification email') && !document.querySelector('#auth-email').disabled);
  assert.deepEqual(calls.filter(call => call.path === '/api/app/auth/human').map(call => call.body.turnstile_token), ['old-key-proof', 'new-key-proof']);
  assert.deepEqual(errors, []);
});
