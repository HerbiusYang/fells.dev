import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const accountSource = await readFile(new URL('../src/lib/account-api.ts', import.meta.url), 'utf8');
const transpile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const dataURL = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
// Keep the HTTP module's real file location so Node can resolve its TypeScript
// dependency graph. Only account-api's extensionless browser import needs rewriting.
const httpURL = new URL('../src/lib/app-http.ts', import.meta.url).href;
const { accountApi, setExpectedUser, githubErrorCode, passwordIsValid, usernameIsValid, authNextPath, announceSessionChange, usageTokens, compactTokenCount } = await import(dataURL(transpile(accountSource).replace('"./app-http"', JSON.stringify(httpURL))));
const identity = { userId: 42, sessionId: 'a'.repeat(64) };

test('token display uses K/M/B while promoting values that round to the next unit', () => {
  for (const [value, expected] of [[0,'0'],[999,'999'],[1000,'1.00K'],[999994,'999.99K'],[999995,'1.00M'],[1000000,'1.00M'],[1703039,'1.70M'],[999995000,'1.00B'],[1000000000,'1.00B'],[1250000000,'1.25B']]) {
    assert.equal(compactTokenCount(value), expected, String(value));
  }
});

test('missing or invalid token counts cannot display NaN, negative usage or fake zero', () => {
  for (const value of [undefined,null,NaN,Infinity,-Infinity,-1,1.5,'1000','',{},Number.MAX_SAFE_INTEGER+1]) assert.equal(compactTokenCount(value), '—');
});

test('private account calls require a bound real user and session', async t => {
  const calls = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (...args) => { calls.push(args); return Response.json({ keys: [], self_keys: true }); };
  t.after(() => { globalThis.fetch = previous; setExpectedUser(null); });
  setExpectedUser(null);
  assert.throws(() => accountApi.keys(), /not bound/);
  assert.throws(() => setExpectedUser({ userId: 42, sessionId: 'untrusted' }), /identity/);
  assert.equal(calls.length, 0);
  setExpectedUser(identity);
  await accountApi.keys();
  const [path, options] = calls[0];
  assert.equal(path, '/api/app/keys');
  assert.equal(options.headers.get('X-Fells-Expected-User'), '42');
  assert.equal(options.headers.get('X-Fells-Expected-Session'), identity.sessionId);
  assert.equal(options.credentials, 'same-origin');
  assert.equal(options.cache, 'no-store');
  assert.equal(options.redirect, 'error');
});

test('bootstrap and real authentication do not carry stale account expectations', async t => {
  const calls = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (path, options) => { calls.push({ path, options }); return Response.json({ ok: true, resend_after: 60 }); };
  t.after(() => { globalThis.fetch = previous; setExpectedUser(null); });
  setExpectedUser(identity);
  await accountApi.bootstrap();
  await accountApi.session();
  await accountApi.login('demo', 'actual password', 'captcha-proof');
  await accountApi.sendCode('new@example.com', 'signup', 'captcha-proof');
  await accountApi.signup({ username: 'new_user-1', dest: 'new@example.com', code: '123456', password: 'actual password', agreement_version: 'server-version' });
  await accountApi.reset('new@example.com', '123456', 'replacement password');
  for (const { options } of calls) {
    assert.equal(options.headers.has('X-Fells-Expected-User'), false);
    assert.equal(options.headers.has('X-Fells-Expected-Session'), false);
  }
  assert.deepEqual(JSON.parse(calls[2].options.body), { username: 'demo', password: 'actual password', turnstile_token: 'captcha-proof' });
  assert.deepEqual(JSON.parse(calls[3].options.body), { channel: 'email', dest: 'new@example.com', purpose: 'signup', turnstile_token: 'captcha-proof' });
  assert.equal(JSON.parse(calls[4].options.body).agreement_version, 'server-version');
  assert.equal(JSON.parse(calls[4].options.body).channel, 'email');
  assert.equal(JSON.parse(calls[4].options.body).username, 'new_user-1');
  assert.equal(Object.hasOwn(JSON.parse(calls[4].options.body), 'display_name'), false);
  assert.deepEqual(JSON.parse(calls[5].options.body), { dest: 'new@example.com', code: '123456', password: 'replacement password' });
});

test('public authentication config preserves the optional email capability', async t => {
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; setExpectedUser(null); });
  for (const email_enabled of [false, true, undefined]) {
    globalThis.fetch = async (_path, options) => {
      assert.equal(options.headers.has('X-Fells-Expected-User'), false);
      return Response.json({ signup_enabled: true, email_enabled, channels: ['email'], min_password_length: 8, turnstile_site_key: '' });
    };
    setExpectedUser(identity);
    const result = await accountApi.authConfig();
    assert.equal(result.email_enabled, email_enabled);
  }
});

test('human verification exchanges one widget token independently of email-code requests', async t => {
  const calls = [], previous = globalThis.fetch;
  globalThis.fetch = async (path, options) => { calls.push({ path, options }); return Response.json({ ok: true, expires_in: 600, resend_after: 60 }); };
  t.after(() => { globalThis.fetch = previous; setExpectedUser(null); });
  setExpectedUser(identity);
  await accountApi.verifyHuman('owner@example.test', 'reset', 'one-time-widget-token');
  await accountApi.sendCode('owner@example.test', 'reset');
  assert.equal(calls[0].path, '/api/app/auth/human');
  assert.deepEqual(JSON.parse(calls[0].options.body), { channel: 'email', dest: 'owner@example.test', purpose: 'reset', turnstile_token: 'one-time-widget-token' });
  assert.deepEqual(JSON.parse(calls[1].options.body), { channel: 'email', dest: 'owner@example.test', purpose: 'reset', turnstile_token: '' });
  for (const { options } of calls) {
    assert.equal(options.headers.has('X-Fells-Expected-User'), false);
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.cache, 'no-store');
  }
});

test('model conversation catalog uses the chosen existing key and current account headers', async t => {
  const previous = globalThis.fetch, calls = [];
  globalThis.fetch = async (path, options) => { calls.push({ path, options }); return Response.json({ capability: 'model_chat', key_id: 17, models: [] }); };
  t.after(() => { globalThis.fetch = previous; setExpectedUser(null); });
  setExpectedUser(null); assert.throws(() => accountApi.chatModels(17), /not bound/);
  setExpectedUser(identity); await accountApi.chatModels(17);
  await accountApi.catalog(17);
  assert.equal(calls[0].path, '/api/app/chat-models?key_id=17');
  assert.equal(calls[1].path, '/api/app/catalog?key_id=17');
  assert.equal(calls[0].options.headers.get('X-Fells-Expected-User'), '42');
  assert.equal(calls[0].options.headers.get('X-Fells-Expected-Session'), identity.sessionId);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[1].options.headers.get('X-Fells-Expected-User'), '42');
  assert.equal(calls[1].options.headers.get('X-Fells-Expected-Session'), identity.sessionId);
});

test('agreement language follows the UI while the first abort-signal argument stays compatible', async t => {
  const calls = [], previous = globalThis.fetch;
  const signal = new AbortController().signal;
  globalThis.fetch = async (path, options) => { calls.push({ path, options }); return Response.json({ version: 'server-version', clauses: [] }); };
  t.after(() => { globalThis.fetch = previous; setExpectedUser(null); });
  setExpectedUser(identity);
  for (const [language, expected] of [[undefined, ''], ['zh', '?lang=zh-CN'], ['zh-CN', '?lang=zh-CN'], ['zh-TW', '?lang=zh-CN'], ['zh-hant', '?lang=zh-CN'], ['en', '?lang=en'], ['ja', '?lang=en'], ['ko', '?lang=en'], ['es', '?lang=en']]) {
    await accountApi.agreement(signal, language);
    const { path, options } = calls.at(-1);
    assert.equal(path, `/api/app/agreement${expected}`);
    assert.strictEqual(options.signal, signal);
    assert.equal(options.headers.has('X-Fells-Expected-User'), false);
    assert.equal(options.headers.has('X-Fells-Expected-Session'), false);
  }
});

test('all financial adapters keep supplied intent keys and exact server DTOs', async t => {
  const calls = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (path, options) => { calls.push({ path, options }); return Response.json({ allowance: { micro: 9000000 }, request: { id: 17, status: 'pending' } }); };
  t.after(() => { globalThis.fetch = previous; setExpectedUser(null); });
  setExpectedUser(identity);
  const key = 'stable-operation-key';
  await accountApi.buyAllowance(1000000, '00000000-0000-4000-8000-000000000001', key);
  await accountApi.buyAllowance(1000000, '00000000-0000-4000-8000-000000000001', key);
  await accountApi.buySubscription({ pool_id: 12, tier: 4, months: 1, max_charge_micro: 10000000 }, key);
  await accountApi.createTopup({ draft: true, amount_micro: 100000000, pay_method: 'alipay' }, key);
  await accountApi.markTopupPaid('00017', 'transfer-evidence', key);
  await accountApi.claimCoupon('server-campaign', key);
  await accountApi.upgradeQuote({ from_pool: 11, pool_id: 12, tier: 8, months: 1 });
  await accountApi.upgradeSubscription({ from_pool: 11, pool_id: 12, tier: 8, months: 1, expect_charge_micro: 8000000 }, key);
  await accountApi.invoices();
  await accountApi.creditRebate({ amount_micro: 1000000 }, key);
  for (const [index, { options }] of calls.entries()) {
    if (index === 6 || index === 8) continue;
    assert.equal(options.headers.get('Idempotency-Key'), key);
    assert.equal(options.headers.get('X-Fells-Expected-User'), '42');
    assert.equal(options.headers.get('X-Fells-Expected-Session'), identity.sessionId);
    assert.equal(options.method, 'POST');
  }
  assert.equal(calls[0].options.body, calls[1].options.body);
  assert.deepEqual(JSON.parse(calls[0].options.body), { cash_micro: 1000000, quote_id: '00000000-0000-4000-8000-000000000001' });
  assert.deepEqual(JSON.parse(calls[2].options.body), { pool_id: 12, tier: 4, months: 1, max_charge_micro: 10000000 });
  assert.equal(calls[4].path, '/api/app/topups/17/paid');
  assert.deepEqual(JSON.parse(calls[4].options.body), { note: 'transfer-evidence' });
  assert.equal(calls[6].path, '/api/app/subscriptions/upgrade-quote');
  assert.deepEqual(JSON.parse(calls[6].options.body), { from_pool: 11, pool_id: 12, tier: 8, months: 1 });
  assert.equal(calls[7].path, '/api/app/subscriptions/upgrade');
  assert.equal(calls[8].path, '/api/app/invoices');
  assert.equal(calls[8].options.method, 'GET');
  assert.equal(calls[8].options.headers.get('X-Fells-Expected-Session'), identity.sessionId);
  await accountApi.buyTokenPlan({plan:'1000',max_charge_micro:2000000,terms_hash:'a'.repeat(64)},key);
  assert.equal(calls.at(-1).path,'/api/app/plans/buy');
  assert.equal(calls.at(-1).options.headers.get('Idempotency-Key'),key);
  assert.deepEqual(JSON.parse(calls.at(-1).options.body),{plan:'1000',max_charge_micro:2000000,terms_hash:'a'.repeat(64)});
  assert.throws(() => accountApi.buyAllowance(1000000, '00000000-0000-4000-8000-000000000001', ''), /stable transaction key/);
});

test('logout carries the loaded session and session change invalidates subsequent private calls', async t => {
  const previousFetch = globalThis.fetch, previousChannel = globalThis.BroadcastChannel;
  const messages = [];
  let request;
  globalThis.fetch = async (path, options) => { request = { path, options }; return Response.json({ ok: true }); };
  globalThis.BroadcastChannel = class { constructor(name) { assert.equal(name, 'fells.session.changed'); } postMessage(message) { messages.push(message); } close() {} };
  t.after(() => { globalThis.fetch = previousFetch; globalThis.BroadcastChannel = previousChannel; setExpectedUser(null); });
  setExpectedUser(identity);
  await accountApi.logout();
  assert.equal(request.options.method, 'DELETE');
  assert.equal(request.options.headers.get('X-Fells-Expected-Session'), identity.sessionId);
  announceSessionChange();
  assert.deepEqual(messages, [{ audience: 'customer' }]);
  assert.throws(() => accountApi.wallet(), /not bound/);
});

test('password length follows Unicode character minimum and bcrypt UTF-8 byte maximum', () => {
  assert.equal(passwordIsValid('😀'.repeat(4)), false);
  assert.equal(passwordIsValid('😀'.repeat(8)), true);
  assert.equal(passwordIsValid('a'.repeat(72)), true);
  assert.equal(passwordIsValid('a'.repeat(73)), false);
  assert.equal(passwordIsValid('汉'.repeat(24)), true);
  assert.equal(passwordIsValid('汉'.repeat(25)), false);
});

test('self-selected username follows the server ASCII format without normalization', () => {
  for (const name of ['abc', 'user_123', 'new-user', 'a'.repeat(32)]) assert.equal(usernameIsValid(name), true, name);
  for (const name of ['', 'ab', 'a'.repeat(33), 'Uppercase', ' abc', 'abc ', 'user.name', 'user@example.test', '用户账号', 'abc\n']) assert.equal(usernameIsValid(name), false, JSON.stringify(name));
});

test('authentication redirects stay on app or checkout paths', () => {
  const fallback = '/app';
  for (const path of ['/app', '/app/settings', '/es/app', '/checkout?mode=wallet', '/zh-hant/checkout']) assert.equal(authNextPath(path, fallback), path);
  for (const path of [null, 'https://example.com', '//example.com', '/portal', '/admin', '/app/../admin', '/app\\\\example.com', ' /checkout']) assert.equal(authNextPath(path, fallback), fallback);
});

test('public checkout enters the customer market without charging while account purchase requires explicit confirmation', async () => {
  const auth = await readFile(new URL('../src/components/pages/AuthPage.astro', import.meta.url), 'utf8');
  const checkout = await readFile(new URL('../src/components/pages/CheckoutPage.astro', import.meta.url), 'utf8');
  const app = await readFile(new URL('../src/scripts/app.ts', import.meta.url), 'utf8');
  const appPage = await readFile(new URL('../src/components/pages/AppPage.astro', import.meta.url), 'utf8');
  const landing = await readFile(new URL('../src/components/Landing.astro', import.meta.url), 'utf8');
  const pageShell = await readFile(new URL('../src/components/PageShell.astro', import.meta.url), 'utf8');
  const support = await readFile(new URL('../src/scripts/support-widget.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(auth, /beginPreview|signupBonus|data-bonus/);
  assert.match(auth, /accountApi\.session\(\)/);
  assert.match(auth, /accountApi\.signup/);
  assert.match(checkout, /<SupportWidget t=\{t\}/);
  assert.match(checkout, /data-purchase-market/);
  assert.doesNotMatch(checkout, /accountApi|\/api\/app\/.*(?:buy|topups)/);
  assert.match(app, /data-act="contact-purchase"/);
  assert.match(app, /fells:support-open/);
  assert.match(app, /case "plan-confirm": await confirmPlan\(\)/);
  assert.match(app, /storeMoneyIntent\(planStorageKey,p\)/);
  assert.doesNotMatch(app, /accountApi\.(?:createTopup|markTopupPaid)/);
  assert.match(appPage, /<SupportWidget t=\{t\} \/>/);
  assert.match(landing, /<SupportWidget t=\{t\} \/>/);
  assert.match(pageShell, /<SupportWidget t=\{t\} \/>/);
  assert.match(support, /data-open-customer-support/);
  assert.match(support, /fells:support-open/);
  assert.match(checkout, /^---\r?\n/);
  assert.doesNotMatch(checkout, /transactionIntent|data-checkout/);
});

test('token totals match the backend cache accounting for mixed protocols', () => {
  const row = { tokens_in: 100, tokens_out: 20, tokens_cache_r: 30, tokens_cache_w: 10, tokens_cache_w1h: 5 };
  assert.equal(usageTokens({ ...row, protocol: 'openai' }), 130);
  assert.equal(usageTokens({ ...row, protocol: 'gemini' }), 130);
  assert.equal(usageTokens({ ...row, protocol: 'anthropic' }), 160);
  assert.equal(usageTokens({}), 0);
  assert.equal(['anthropic','openai','gemini'].reduce((total, protocol) => total + usageTokens({ ...row, protocol }), 0), 420);
  for (const protocol of ['openai', 'gemini']) {
    assert.equal(usageTokens({ ...row, protocol, tokens_cache_w: 0 }), 120, 'existing rows without cache writes keep their total');
    assert.equal(usageTokens({ protocol, tokens_cache_w: 25, tokens_cache_r: 30 }), 25, 'cache writes are added once and cache reads are already in input');
  }
});

test('a blocked cross-tab channel cannot stop a session change announcement', t => {
  const previous = globalThis.BroadcastChannel;
  globalThis.BroadcastChannel = class { constructor() { throw new Error('blocked by policy'); } };
  t.after(() => { globalThis.BroadcastChannel = previous; setExpectedUser(null); });
  setExpectedUser(identity);
  assert.doesNotThrow(() => announceSessionChange());
  assert.throws(() => accountApi.keys(), /not bound/);
});


test('GitHub return errors are allowlisted before display', () => {
  assert.equal(githubErrorCode(null), null);
  assert.equal(githubErrorCode(''), null);
  assert.equal(githubErrorCode('unverified'), 'unverified');
  assert.equal(githubErrorCode('<img src=x onerror=alert(1)>'), 'server');
});


test('API retry metadata preserves transaction rejection and server details', async t => {
  const { api, APIError } = await import(httpURL);
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => Response.json({ ok: false, error: { code: 'rate_limited', message: 'Slow down' }, transaction_rejected: true, current_price_micro: 123 }, { status: 429, headers: { 'Retry-After': '120' } });
  await assert.rejects(api('/api/app/password', { body: {} }), error => {
    assert.ok(error instanceof APIError);
    assert.equal(error.retryAfter, 120);
    assert.equal(error.transactionRejected, true);
    assert.equal(error.details.current_price_micro, 123);
    return true;
  });
});
