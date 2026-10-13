import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';
import { trackCoverage } from '../helpers/browser.mjs';

// Contract fixtures exercise the built UI, including ambiguous network results.
// FELLS_BROWSER_BASE optionally points at the current local Astro development build.
let browser, server, base = process.env.FELLS_BROWSER_BASE;
const dist = resolve(process.env.TEST_DIST_DIR || 'dist');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
before(async () => {
  if (!base) {
    server = createServer(async (req, res) => {
      try {
        let path = resolve(dist, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
        if (path !== dist && !path.startsWith(dist + '/')) { res.writeHead(403).end(); return; }
        if ((await stat(path)).isDirectory()) path += '/index.html';
        res.writeHead(200, { 'content-type': mime[extname(path)] ?? 'application/octet-stream' }); res.end(await readFile(path));
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

const sessionId = 'b'.repeat(64);
const bootstrap = {
  schema_version: 1, session_id: sessionId,
  user: { id: 42, username: 'contract-user', email: 'real-account@example.test', name: 'Contract user', joined_at: 1700000000, self_keys: true },
  wallet: { currency: 'CNY', cash_micro: 100000000, grant_micro: 200000000, grant_expires_at: 1900000000 },
  api_allowance: { currency: 'USD', balance: { user_id: 42, micro: 9000000, expires_at: 1900000000 }, term_months: 12, price_cny: 2 },
  agreement: { accepted: true, version: 'server-v1' }, capabilities: { token_plan: false, product_cdk: false },
};
const agreement = { version: 'server-v1', h1: 'Terms supplied by server', lede: 'Read the current terms.', clauses: [{ heading: 'Service', paras: ['No automatic plan activation after top-up.'] }], ui: {} };

async function setup(t, handler) {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  await trackCoverage(context);
  t.after(() => context.close());
  const calls = [], errors = [];
  await context.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
  await context.route('**/api/app/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname, method = req.method();
    const body = req.postData() ? JSON.parse(req.postData()) : undefined;
    const call = { path, method, body, headers: req.headers(), url: req.url() }; calls.push(call);
    if (await handler?.({ route, call, calls })) return;
    const data = {
      '/api/app/bootstrap': bootstrap,
      '/api/app/wallet': { cash_micro: 100000000, grant_micro: 200000000, pay_info: 'Local contract payment instructions', pay_qr: '' },
      '/api/app/allowance': { allowance: bootstrap.api_allowance.balance, price_cny: 2, on_sale: true, term_months: 12, cash_micro: 100000000, quote_usd_micro: 50000000 },
      '/api/app/subscriptions': { cash_micro: 100000000, grant_micro: 200000000, plans: [{ pool_id: 7, tier: 4, name: 'Actual 4-person tier', price_micro: 10000000, blurb: 'Shared window quota', free: 2 }] },
      '/api/app/topups': { requests: [] }, '/api/app/agreement': agreement,
      '/api/app/auth/config': { signup_enabled: true, channels: ['email'], min_password_length: 8, turnstile_site_key: '' },
    };
    if (path === '/api/app/session' && method === 'GET') { await route.fulfill({ status: 401, json: { error: 'unauthorized' } }); return; }
    await route.fulfill({ status: 200, json: data[path] ?? { ok: true } });
  });

  await context.route('**/api/support/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === '/api/support/events') { await route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': connected\n\n' }); return; }
    const customer = { id: '42', name: 'Contract user', email: 'real-account@example.test', joinedAt: '2023-11-14T00:00:00Z', preferredLocale: 'en', workspaceCount: 0, credits: 9, creditsCurrency: 'USD', creditsKind: 'api_allowance' };
    const conversation = { id: '21', customer, status: 'open', lastMessage: null, unreadCount: 0, updatedAt: '2026-10-13T00:00:00Z', userRead: { lastReadMessageId: null, updatedAt: null }, agentRead: { lastReadMessageId: null, updatedAt: null } };
    let data = path.endsWith('/messages') ? { items: [], nextCursor: null } : path.endsWith('/orders') ? { items: [], hasMore: false } : path === '/api/support/availability' ? { online: false } : path.endsWith('/typing') ? { user: false, agent: false } : conversation;
    await route.fulfill({ status: 200, json: { ok: true, data, requestId: 'checkout-contract' } });
  });
  const page = await context.newPage(); page.setDefaultTimeout(8000); page.on('pageerror', e => errors.push(e.message));
  return { context, page, calls, errors };
}
async function checkout(page, suffix = '') {
  await page.goto(`${base}/checkout${suffix}`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-open-customer-support]').waitFor({ state: 'visible' });
}

test('login uses a password and server session before entering checkout', async t => {
  const { page, calls, errors } = await setup(t);
  await page.goto(`${base}/app/start?next=%2Fcheckout%3Fmode%3Dallowance`, { waitUntil: 'domcontentloaded' });
  await page.locator('#auth-email').fill('actual-login-name');
  await page.locator('#auth-password').fill('actual-password');
  await page.locator('[data-auth-form] [type=submit]').click();
  await page.waitForURL(url => url.pathname.replace(/\/$/, '') === '/checkout');
  const login = calls.find(c => c.path === '/api/app/session' && c.method === 'POST');
  assert.deepEqual(login.body, { username: 'actual-login-name', password: 'actual-password', turnstile_token: '' });
  assert.equal(login.headers['x-fells-expected-user'], undefined);
  assert.equal(await page.evaluate(async () => (await indexedDB.databases()).some(db => db.name === 'fells.preview.v2')), false);
  assert.deepEqual(errors, []);
});

test('registration sends an independent username, email OTP, current agreement and real password', async t => {
  const { page, calls, errors } = await setup(t);
  await page.goto(`${base}/app/start?mode=create&next=%2Fcheckout`, { waitUntil: 'domcontentloaded' });
  await page.locator('#auth-username').fill('new_user-1');
  assert.equal(await page.locator('#auth-username').getAttribute('autocomplete'), 'username');
  assert.equal(await page.locator('#auth-username').getAttribute('minlength'), '3');
  assert.equal(await page.locator('#auth-username').getAttribute('maxlength'), '32');
  assert.equal(await page.locator('#auth-email').getAttribute('autocomplete'), 'email');
  await page.locator('#auth-email').fill('new@example.test');
  await page.locator('[data-send-code]').click();
  await page.locator('#auth-code').fill('123456');
  await page.locator('#auth-password').fill('actual-password');
  await page.locator('#auth-confirm').fill('actual-password');
  await page.locator('[name=agree]').check();
  await page.locator('[data-auth-form] [type=submit]').click();
  await page.waitForURL(url => url.pathname.replace(/\/$/, '') === '/checkout');
  const code = calls.find(c => c.path === '/api/app/auth/code');
  assert.deepEqual(code.body, { channel: 'email', dest: 'new@example.test', purpose: 'signup', turnstile_token: '' });
  const signup = calls.find(c => c.path === '/api/app/auth/signup');
  assert.equal(signup.body.agreement_version, agreement.version);
  assert.equal(signup.body.username, 'new_user-1');
  assert.equal(signup.body.dest, 'new@example.test');
  assert.equal(Object.hasOwn(signup.body, 'display_name'), false);
  assert.equal(signup.body.password, 'actual-password');
  assert.equal(signup.body.code, '123456');
  assert.deepEqual(errors, []);
});

test('referral signup links open registration and pass the referral code to the server', async t => {
  const { page, calls, errors } = await setup(t);
  await page.goto(`${base}/app/start?ref=campaign-42#signup`, { waitUntil: 'domcontentloaded' });
  await page.locator('#auth-username:not([disabled])').waitFor();
  await page.locator('#auth-username').fill('referred_user');
  await page.locator('#auth-email').fill('referred@example.test');
  await page.locator('#auth-code').fill('123456');
  await page.locator('#auth-password').fill('actual-password');
  await page.locator('#auth-confirm').fill('actual-password');
  await page.locator('[name=agree]').check();
  await page.locator('[data-auth-form] [type=submit]').click();
  await page.waitForURL(url => url.pathname.replace(/\/$/, '') === '/app');
  assert.equal(calls.find(c => c.path === '/api/app/auth/signup').body.referral_code, 'campaign-42');
  assert.deepEqual(errors, []);
});

test('registration rejects invalid usernames without sending signup or normalizing another account', async t => {
  const { page, calls, errors } = await setup(t);
  await page.goto(`${base}/app/start?mode=create`, { waitUntil: 'domcontentloaded' });
  await page.locator('#auth-email').fill('new@example.test');
  await page.locator('#auth-code').fill('123456');
  await page.locator('#auth-password').fill('actual-password');
  await page.locator('#auth-confirm').fill('actual-password');
  await page.locator('[name=agree]').check();
  for (const invalid of ['ab', 'Uppercase', ' user', 'user ', 'user.name']) {
    await page.locator('#auth-username').fill(invalid);
    await page.locator('[data-auth-form] [type=submit]').click();
    assert.equal(calls.some(c => c.path === '/api/app/auth/signup'), false, invalid);
    assert.equal(await page.locator('#auth-username').inputValue(), invalid);
  }
  assert.deepEqual(errors, []);
});

test('desktop account modes leave the left artwork fixed and terms open a focus-contained dialog', async t => {
  const { page, errors } = await setup(t, async ({ route, call }) => {
    if (call.path !== '/api/app/agreement') return false;
    await route.fulfill({ status: 200, json: { ...agreement, clauses: [{ title: 'Server terms', paragraphs: Array(80).fill('Long server-provided service terms.') }] } }); return true;
  });
  await page.setViewportSize({ width: 1440, height: 760 });
  await page.goto(`${base}/app/start`, { waitUntil: 'domcontentloaded' });
  await page.locator('#auth-email:not([disabled])').waitFor();
  const left = await page.locator('.art .pitch').boundingBox();
  for (const mode of ['create', 'reset', 'login', 'create']) {
    await page.locator(`[data-auth-mode=${mode}]`).click();
    const after = await page.locator('.art .pitch').boundingBox();
    for (const coordinate of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(after[coordinate] - left[coordinate]) < 0.5, `${mode}: left ${coordinate} stays fixed`);
  }
  assert.equal(await page.locator('.panel').evaluate(el => el.scrollHeight > el.clientHeight), true, 'long registration form scrolls within the right panel');
  assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), true, 'desktop mode does not grow the whole page');
  assert.equal(await page.locator('[data-auth-create] details').count(), 0);
  const trigger = page.locator('[data-open-terms]'), dialog = page.locator('[data-terms-dialog]'), close = page.locator('[data-close-terms]');
  await trigger.click();
  assert.equal(await dialog.evaluate(el => el.open), true);
  assert.match(await dialog.innerText(), /Terms supplied by server/);
  assert.match(await dialog.innerText(), /Long server-provided service terms/);
  assert.equal(await close.evaluate(el => document.activeElement === el), true);
  await page.keyboard.press('Tab');
  assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true);
  await page.keyboard.press('Tab');
  assert.equal(await close.evaluate(el => document.activeElement === el), true);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true);
  await page.locator('#auth-email').evaluate(el => el.focus());
  assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true, 'native modal makes the background inert');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('[data-terms-dialog]').open);
  assert.equal(await trigger.evaluate(el => document.activeElement === el), true);
  assert.equal(await page.locator('[name=agree]').isChecked(), false, 'reading terms does not accept them');
  await trigger.click(); await close.click();
  assert.equal(await trigger.evaluate(el => document.activeElement === el), true);
  const afterDialog = await page.locator('.art .pitch').boundingBox();
  assert.equal(afterDialog.y, left.y);
  assert.deepEqual(errors, []);
});

test('registration username and terms controls fit all localized 320px account pages', async t => {
  const { page, errors } = await setup(t);
  await page.setViewportSize({ width: 320, height: 640 });
  for (const [prefix, label] of [['', 'Username'], ['/zh', '账号'], ['/zh-hant', '帳號'], ['/ja', 'ユーザー名'], ['/ko', '사용자 이름'], ['/es', 'Nombre de usuario']]) {
    await page.goto(`${base}${prefix}/app/start?mode=create`, { waitUntil: 'domcontentloaded' });
    await page.locator('#auth-username:not([disabled])').waitFor();
    assert.equal(await page.locator('label[for=auth-username]').innerText(), label);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, prefix || 'en');
    await page.locator('[data-open-terms]').click();
    const box = await page.locator('[data-terms-dialog]').boundingBox();
    assert.ok(box.x >= 0 && box.y >= 0 && box.width <= 320 && box.height <= 640, prefix || 'en');
    assert.ok((await page.locator('[data-close-terms]').boundingBox()).height >= 44);
    await page.locator('[data-close-terms]').click();
    assert.equal(await page.locator('[data-open-terms]').evaluate(el => document.activeElement === el), true);
  }
  assert.deepEqual(errors, []);
});

test('account terms request the UI language and display safe text without raw tags or executable DTO markup', async t => {
  const attack = '<script>window.__agreementAttack++</script><img src="/agreement-probe" onerror="window.__agreementAttack++"><svg onload="window.__agreementAttack++"></svg>';
  const { context, page, calls, errors } = await setup(t, async ({ route, call }) => {
    if (call.path !== '/api/app/agreement') return false;
    const chinese = new URL(call.url).searchParams.get('lang') === 'zh-CN';
    await route.fulfill({ status: 200, json: { ...agreement,
      h1: `<b>${chinese ? '服务端中文条款' : 'Server English terms'}</b>${attack}`,
      lede: `<b>${chinese ? '请阅读账户规则' : 'Read the account rules'}</b> &amp; ${attack}`,
      clauses: [{ heading: chinese ? '账户使用' : 'Account use', paras: [`<b>${chinese ? '必须遵守服务规则' : 'Follow the service rules'}</b>${attack} &lt;img src="/agreement-probe" onerror="window.__agreementAttack++"&gt;`] }],
    } }); return true;
  });
  await page.addInitScript(() => { window.__agreementAttack = 0; });
  const resourceRequests = [];
  context.on('request', request => { if (new URL(request.url()).pathname === '/agreement-probe') resourceRequests.push(request.url()); });
  for (const [prefix, language] of [['/zh', 'zh-CN'], ['/zh-hant', 'zh-CN'], ['', 'en'], ['/ja', 'en'], ['/ko', 'en'], ['/es', 'en']]) {
    await page.goto(`${base}${prefix}/app/start?mode=create`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-open-terms]:not([disabled])').waitFor();
    assert.equal(new URL(calls.filter(call => call.path === '/api/app/agreement').at(-1).url).searchParams.get('lang'), language, prefix || 'en');
    await page.locator('[data-open-terms]').click();
    const dialog = page.locator('[data-terms-dialog]'), text = await dialog.innerText();
    assert.match(text, language === 'zh-CN' ? /服务端中文条款[\s\S]*请阅读账户规则[\s\S]*必须遵守服务规则/ : /Server English terms[\s\S]*Read the account rules[\s\S]*Follow the service rules/);
    assert.doesNotMatch(text, /<\/?b\b|<script|<img|<svg|&amp;/i);
    assert.equal(await dialog.locator('script,img,svg,iframe,object,embed').count(), 0);
    assert.equal(await page.evaluate(() => window.__agreementAttack), 0);
    await page.locator('[data-close-terms]').click();
  }
  assert.deepEqual(resourceRequests, [], 'parsing agreement DTOs does not construct resource-loading elements');
  assert.deepEqual(errors, []);
});

test('unconfigured email disables signup and reset while password login remains available', async t => {
  const { page, calls, errors } = await setup(t, async ({ route, call }) => {
    if (call.path !== '/api/app/auth/config') return false;
    await route.fulfill({ status: 200, json: { signup_enabled: true, email_enabled: false, channels: ['email'], min_password_length: 8, turnstile_site_key: '' } }); return true;
  });
  await page.goto(`${base}/app/start?next=%2Fcheckout`, { waitUntil: 'domcontentloaded' });
  await page.locator('#auth-email:not([disabled])').waitFor();
  for (const mode of ['create', 'reset']) {
    await page.locator(`[data-auth-mode=${mode}]`).click();
    assert.match(await page.locator('[data-msg]').innerText(), /Email service is not configured/);
    assert.equal(await page.locator('[data-send-code]').isDisabled(), true);
    assert.equal(await page.locator('[data-auth-form] [type=submit]').isDisabled(), true);
  }
  assert.equal(calls.some(c => c.path === '/api/app/auth/code' || c.path === '/api/app/auth/signup' || c.path === '/api/app/auth/reset'), false);
  await page.locator('[data-auth-mode=login]').click();
  await page.locator('#auth-email').fill('existing-user');
  await page.locator('#auth-password').fill('actual-password');
  assert.equal(await page.locator('[data-auth-form] [type=submit]').isDisabled(), false);
  await page.locator('[data-auth-form] [type=submit]').click();
  await page.waitForURL(url => url.pathname.replace(/\/$/, '') === '/checkout');
  assert.equal(calls.find(c => c.path === '/api/app/session' && c.method === 'POST').body.username, 'existing-user');
  assert.deepEqual(errors, []);
});

test('closed signup with configured email still allows password reset', async t => {
  const { page, errors } = await setup(t, async ({ route, call }) => {
    if (call.path !== '/api/app/auth/config') return false;
    await route.fulfill({ status: 200, json: { signup_enabled: false, email_enabled: true, channels: ['email'], min_password_length: 8, turnstile_site_key: '' } }); return true;
  });
  await page.goto(`${base}/app/start?mode=create`, { waitUntil: 'domcontentloaded' });
  await page.locator('#auth-username:not([disabled])').waitFor();
  assert.match(await page.locator('[data-msg]').innerText(), /sign-up is currently closed/);
  assert.equal(await page.locator('[data-auth-form] [type=submit]').isDisabled(), true);
  await page.locator('[data-auth-mode=reset]').click();
  assert.equal(await page.locator('[data-send-code]').isDisabled(), false);
  assert.equal(await page.locator('[data-auth-form] [type=submit]').isDisabled(), false);
  assert.deepEqual(errors, []);
});

test('legacy checkout URLs open customer support without submitting payments', async t => {
  const { page, calls, errors } = await setup(t, async ({ route, call }) => {
    if (call.path === '/api/app/bootstrap' && call.method === 'GET') { await route.fulfill({ status: 401, json: { error: 'unauthorized' } }); return true; }
    return false;
  });
  await checkout(page, '?mode=wallet&plan=1500&amount=125');
  const requestedUrl = new URL(page.url());
  await page.locator('[data-open-customer-support]').click();
  await page.locator('#support-panel').waitFor({ state: 'visible' });
  assert.equal(new URL(page.url()).pathname, requestedUrl.pathname);
  assert.equal(new URL(page.url()).search, requestedUrl.search);
  assert.equal(await page.locator('#support-panel').isVisible(), true);
  assert.equal(calls.some(call => call.method !== 'GET'), false);
  assert.deepEqual(errors, []);
});

test('homepage and public catalog purchase actions open customer support directly', async t => {
  for (const path of ['/', '/market/']) {
    const { page, calls, errors } = await setup(t, async ({ route, call }) => {
      if (call.path === '/api/app/bootstrap' && call.method === 'GET') { await route.fulfill({ status: 401, json: { error: 'unauthorized' } }); return true; }
      return false;
    });
    await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' });
    const action = page.locator('[data-open-customer-support]').first();
    await action.waitFor({ state: 'visible' });
    const requestedUrl = new URL(page.url());
    await action.click();
    await page.locator('#support-panel').waitFor({ state: 'visible' });
    assert.equal(new URL(page.url()).pathname, requestedUrl.pathname);
    assert.equal(calls.some(call => call.method !== 'GET'), false);
    assert.deepEqual(errors, []);
  }
});

test('reset uses a reset-purpose OTP and rejects Unicode-short passwords before submission', async t => {
  const { page, calls, errors } = await setup(t);
  await page.goto(`${base}/app/start?mode=reset&next=%2Fcheckout`, { waitUntil: 'domcontentloaded' });
  await page.locator('#auth-email').fill('existing@example.test');
  await page.locator('[data-send-code]').click();
  await page.locator('#auth-code').fill('123456');
  await page.locator('#auth-password').fill('😀😀😀😀');
  await page.locator('#auth-confirm').fill('😀😀😀😀');
  await page.locator('[data-auth-form] [type=submit]').click();
  assert.equal(calls.some(c => c.path === '/api/app/auth/reset'), false);
  assert.match(await page.locator('[data-msg]').innerText(), /at least 8/);
  await page.locator('#auth-password').fill('replacement-password');
  await page.locator('#auth-confirm').fill('replacement-password');
  await page.locator('[data-auth-form] [type=submit]').click();
  await page.waitForURL(url => url.pathname.replace(/\/$/, '') === '/checkout');
  assert.equal(calls.find(c => c.path === '/api/app/auth/code').body.purpose, 'reset');
  assert.deepEqual(calls.find(c => c.path === '/api/app/auth/reset').body, { dest: 'existing@example.test', code: '123456', password: 'replacement-password' });
  assert.deepEqual(errors, []);
});

for (const suffix of ['', '?mode=wallet&amount=125', '?mode=subscription&pool=7&tier=4', '?plan=1500', '?mode=redeem&cdk=unavailable']) {
 test('customer purchase consultation opens support without charging: ' + suffix, async t => {
  const { page, calls, errors } = await setup(t);
  await checkout(page, suffix);
  assert.match(await page.locator('h1').innerText(), /Purchase through online support/);
  await page.locator('[data-open-customer-support]').click();
  await page.locator('#support-panel').waitFor({ state: 'visible' });
  assert.equal(await page.locator('[data-checkout]').count(), 0);
  assert.equal(calls.some(call => call.method === 'POST'), false, 'purchase URL parameters never create money transactions');
  assert.deepEqual(errors, []);
 });
}

test('all localized purchase pages show the current product rules and usable support entry', async t => {
 const { page, calls, errors } = await setup(t);
 for (const prefix of ['', '/zh', '/zh-hant', '/ja', '/ko', '/es']) {
  await page.goto(base + prefix + '/checkout', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-open-customer-support]').waitFor();
  assert.match(await page.locator('body').innerText(), /12/);
  assert.equal(await page.locator('[data-checkout]').count(), 0);
 }
 assert.equal(calls.some(call => call.method === 'POST'), false);
 assert.deepEqual(errors, []);
});
