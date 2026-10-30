import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createBrowserFixture } from '../helpers/browser.mjs';
const fixture = createBrowserFixture(); before(() => fixture.start()); after(() => fixture.stop());
const locales = [['en', '', 'en'], ['zh', '/zh', 'zh-CN'], ['zh-hant', '/zh-hant', 'zh-TW'], ['ja', '/ja', 'ja'], ['ko', '/ko', 'ko'], ['es', '/es', 'es']];
async function open(t, { prefix = '', next, throttle = false } = {}) {
  const f = await fixture.setup(t, { viewport: { width: 320, height: 900 } });
  const calls = [];
  await f.context.route('**/api/app/**', async route => {
    const request = route.request(), url = new URL(request.url()); calls.push({ path: url.pathname, method: request.method(), headers: request.headers() });
    if (url.pathname === '/api/app/session' && request.method() === 'GET') return route.fulfill({ status: 401, json: { code: 'unauthorized', error: '请重新登录' } });
    if (url.pathname === '/api/app/auth/config') return route.fulfill({ json: { signup_enabled: true, email_enabled: true, github_enabled: true, channels: ['email'], min_password_length: 12, turnstile_site_key: '' } });
    if (url.pathname === '/api/app/agreement') return route.fulfill({ json: { version: 'original-v1', h1: 'Configured original terms', lede: 'Original legal text remains.', clauses: [{ title: 'Original clause', body: 'Original configured legal language.' }], ui: {} } });
    if (url.pathname === '/api/app/session' && request.method() === 'POST') return route.fulfill({ status: throttle ? 429 : 400, headers: throttle ? { 'Retry-After': '2' } : {}, json: { code: throttle ? 'rate_limited' : 'invalid_credentials', error: '服务器中文错误' } });
    return route.fulfill({ status: 404, json: { error: 'Unexpected synthetic endpoint' } });
  });
  const query = next ? '?next=' + encodeURIComponent(next) : '';
  await f.page.goto(f.base + prefix + '/app/start/' + query);
  await f.page.locator('[data-auth-form] [type=submit]:enabled').waitFor();
  return { ...f, calls };
}

for (const [locale, prefix, language] of locales) test(`auth is localized and form-first at 320px while preserving GitHub destination: ${locale}`, async t => {
  const next = prefix + '/app/?support=1#/billing/credits';
  const { page, calls, errors } = await open(t, { prefix, next });
  assert.equal(await page.locator('html').getAttribute('lang'), language);
  assert.equal(await page.locator('[data-password-hint]').isVisible(), false, 'login omits signup password constraints');
  const form = await page.locator('[data-auth-form]').boundingBox(), art = await page.locator('.art').boundingBox();
  assert.ok(form.y < art.y && form.y < 600, 'sign-in appears before the marketing panel');
  const github = new URL(await page.locator('[data-github]').getAttribute('href'), page.url());
  assert.equal(github.searchParams.get('from'), 'app'); assert.equal(github.searchParams.get('next'), next);
  assert.equal(github.searchParams.get('lang'), locale, 'GitHub retains the current sign-in page language in signed state');
  assert.ok(calls.filter(call => call.path !== '/api/app/session').every(call => call.headers['accept-language'] === language));
  await page.locator('[data-auth-mode=create]').click();
  assert.match(await page.locator('[data-password-hint]').innerText(), /12/);
  assert.doesNotMatch(await page.locator('[data-password-hint]').innerText(), /UTF-8|72/);
  await page.locator('[data-open-terms]').click();
  assert.match(await page.locator('[data-agreement-text]').innerText(), /Original configured legal language/);
  assert.ok((await page.locator('[data-agreement-source]').innerText()).length > 0);
  if (locale === 'zh') {
    await page.locator('[data-close-terms]').click();
    await mkdir('test-results/package-audit', { recursive: true });
    await page.screenshot({ path: 'test-results/package-audit/auth-zh-mobile.png', fullPage: true });
  }
  assert.equal(calls.some(call => call.method === 'POST'), false);
  assert.deepEqual(errors, []);
});

test('login Retry-After disables submit until the localized countdown finishes', async t => {
  const { page, calls, errors } = await open(t, { prefix: '/ja', throttle: true });
  await page.locator('#auth-email').fill('synthetic@example.invalid'); await page.locator('#auth-password').fill('synthetic-password');
  await page.locator('[data-auth-form] [type=submit]').click();
  await page.locator('[data-error-dialog][open]').waitFor(); await page.locator('[data-close-error]').click();
  const submit = page.locator('[data-auth-form] [type=submit]');
  assert.equal(await submit.isDisabled(), true); assert.match(await submit.innerText(), /秒/);
  await submit.waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('[data-auth-form] [type=submit]').disabled, undefined, { timeout: 4500 });
  assert.equal(calls.filter(call => call.path === '/api/app/session' && call.method === 'POST').length, 1, 'countdown never retries sign-in automatically');
  assert.deepEqual(errors, []);
});

test('signup mismatched passwords remain an inline field error and never submit', async t => {
  const { page, calls, errors } = await open(t, { prefix: '/es' });
  await page.locator('[data-auth-mode=create]').click();
  await page.locator('#auth-username').fill('synthetic_user'); await page.locator('#auth-email').fill('synthetic@example.invalid');
  await page.locator('#auth-code').fill('123456'); await page.locator('#auth-password').fill('synthetic-password-one'); await page.locator('#auth-confirm').fill('synthetic-password-two');
  await page.locator('[name=agree]').check(); await page.locator('[data-auth-form] [type=submit]').click();
  assert.equal(await page.locator('[data-error-dialog][open]').count(), 0);
  assert.match(await page.locator('[data-msg]').innerText(), /no coinciden/);
  assert.equal(await page.locator('#auth-confirm').getAttribute('aria-invalid'), 'true');
  assert.equal(calls.some(call => call.method === 'POST'), false);
  assert.deepEqual(errors, []);
});

for (const [locale, prefix] of locales) test(`manual auth errors follow password correction and mode changes without losing unrelated errors: ${locale}`, async t => {
  const { page, calls, errors } = await open(t, { prefix });
  await page.locator('[data-auth-mode=create]').click();
  await page.locator('#auth-username').fill('synthetic_user'); await page.locator('#auth-email').fill('synthetic@example.invalid');
  await page.locator('#auth-code').fill('123456'); await page.locator('#auth-password').fill('synthetic-password-one'); await page.locator('#auth-confirm').fill('synthetic-password-two');
  await page.locator('[name=agree]').check(); await page.locator('[data-auth-form] [type=submit]').click();
  const confirm = page.locator('#auth-confirm'), message = page.locator('[data-msg]'), mismatch = await message.innerText();
  assert.ok(mismatch); assert.equal(await confirm.getAttribute('aria-invalid'), 'true');
  await page.locator('#auth-username').fill('synthetic_other');
  assert.equal(await message.innerText(), mismatch); assert.equal(await confirm.getAttribute('aria-invalid'), 'true', 'unrelated input cannot dismiss a real mismatch');
  await page.locator('#auth-email').fill('synthetic-other@example.invalid');
  assert.equal(await message.innerText(), mismatch); assert.equal(await confirm.getAttribute('aria-invalid'), 'true');
  await page.locator('#auth-password').fill('synthetic-password-two');
  assert.equal(await message.innerText(), ''); assert.equal(await confirm.getAttribute('aria-invalid'), null); assert.equal(await confirm.getAttribute('aria-errormessage'), null);
  await page.locator('#auth-code').fill('123456'); await page.locator('#auth-password').fill('synthetic-password-three');
  await page.locator('[data-auth-form] [type=submit]').click(); assert.equal(await confirm.getAttribute('aria-invalid'), 'true');
  await confirm.fill(''); await page.locator('[data-auth-form] [type=submit]').click();
  assert.equal(await confirm.getAttribute('data-field-invalid'), 'true', 'native constraints can coexist with the manual mismatch');
  await page.locator('[data-auth-mode=login]').click();
  assert.equal(await confirm.getAttribute('aria-invalid'), null); assert.equal(await confirm.getAttribute('aria-errormessage'), null); assert.equal(await message.innerText(), '');
  await page.locator('[data-auth-mode=create]').click(); assert.equal(await confirm.getAttribute('aria-invalid'), null); assert.equal(await confirm.inputValue(), '');
  await page.locator('#auth-username').fill('synthetic_user'); await page.locator('#auth-email').fill('synthetic@example.invalid'); await page.locator('#auth-code').fill('123456');
  await page.locator('#auth-password').fill('short'); await confirm.fill('short'); await page.locator('[name=agree]').check();
  await page.locator('[data-auth-form] [type=submit]').click(); assert.equal(await page.locator('#auth-password').getAttribute('aria-invalid'), 'true');
  await page.locator('[data-auth-mode=login]').click(); assert.equal(await page.locator('#auth-password').getAttribute('aria-invalid'), null);
  assert.equal(calls.some(call => call.method === 'POST'), false); assert.deepEqual(errors, []);
});

test('GitHub destination rejects an external origin and preserves only a safe local fallback', async t => {
  const { page, errors } = await open(t, { prefix: '/ko', next: 'https://outside.example/app/' });
  const github = new URL(await page.locator('[data-github]').getAttribute('href'), page.url());
  assert.equal(github.searchParams.get('next'), '/ko/app/');
  assert.equal(github.origin, new URL(page.url()).origin);
  assert.deepEqual(errors, []);
});
