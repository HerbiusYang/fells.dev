import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createBrowserFixture } from '../helpers/browser.mjs';
import { supportBrowser, supportFixture } from './helpers/support-http-fixture.mjs';

const auth = createBrowserFixture();
let support;
test.before(async () => { await auth.start(); support = await supportBrowser(); });
test.after(async () => { await support?.close(); await auth.stop(); });

async function probe(context) {
  await context.addInitScript(() => {
    window.__fieldValidationProbe = { invalid: [], fieldFocus: [], reports: 0 };
    document.addEventListener('invalid', event => {
      queueMicrotask(() => window.__fieldValidationProbe.invalid.push({ prevented: event.defaultPrevented, id: event.target.id, name: event.target.name }));
    }, true);
    document.addEventListener('focusin', event => {
      if (event.target instanceof Element && event.target.matches('input,select,textarea')) window.__fieldValidationProbe.fieldFocus.push({ id: event.target.id, name: event.target.name });
    }, true);
    for (const prototype of [HTMLFormElement.prototype, HTMLInputElement.prototype, HTMLSelectElement.prototype, HTMLTextAreaElement.prototype]) {
      prototype.reportValidity = function () {
        window.__fieldValidationProbe.reports++;
        throw new Error('A form attempted to open the native validation UI');
      };
    }
  });
}

async function resetFocusProbe(page) {
  await page.evaluate(() => { window.__fieldValidationProbe.invalid = []; window.__fieldValidationProbe.fieldFocus = []; });
}

async function assertFirstErrorFocus(page, selector) {
  try {
    await page.waitForFunction(selector => document.activeElement === document.querySelector(selector), selector);
    // The first error must retain focus after the whole validation pass paints.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.locator(selector).evaluate(element => document.activeElement === element), true);
  } catch (failure) {
    const details = await page.evaluate(() => ({ active: { id: document.activeElement?.id, name: document.activeElement?.getAttribute('name') }, ...window.__fieldValidationProbe }));
    throw new Error(`Expected first invalid field ${selector}; validation/focus order: ${JSON.stringify(details)}`, { cause: failure });
  }
}

async function showStaffDetails(page) {
  const toggle = page.locator('[data-support-details]');
  if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await page.locator('[data-support-detail-panel]').waitFor({ state: 'visible' });
}

async function assertCustomValidation(page) {
  const seen = await page.evaluate(() => window.__fieldValidationProbe);
  assert.ok(seen.invalid.length > 0, 'the browser still evaluated its actual constraints');
  assert.ok(seen.invalid.every(event => event.prevented), 'every invalid event suppresses the native bubble');
  assert.equal(seen.reports, 0, 'no reportValidity popup path was called');
}

async function feedback(page, control) {
  const ids = (await control.getAttribute('aria-describedby') || '').split(/\s+/);
  for (const id of ids) {
    if (id && await page.locator(`#${id}[data-field-error]`).count()) return page.locator(`#${id}`);
  }
  assert.fail('invalid field must describe its custom error');
}

async function openAuth(t, prefix = '', width = 390) {
  const f = await auth.setup(t, { viewport: { width, height: 900 } });
  await probe(f.context);
  const calls = [];
  await f.context.route('**/api/app/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    calls.push({ path, method: request.method() });
    if (path === '/api/app/session' && request.method() === 'GET') return route.fulfill({ status: 401, json: { code: 'unauthorized' } });
    if (path === '/api/app/auth/config') return route.fulfill({ json: { signup_enabled: true, email_enabled: true, github_enabled: true, channels: ['email'], min_password_length: 12, turnstile_site_key: '' } });
    if (path === '/api/app/agreement') return route.fulfill({ json: { version: 'synthetic-v1', h1: 'Synthetic terms', lede: 'Synthetic terms.', clauses: [{ title: 'Terms', body: 'Synthetic terms only.' }], ui: {} } });
    if (request.method() === 'POST') return route.fulfill({ status: 400, json: { code: 'invalid_credentials', error: 'Synthetic server rejection' } });
    return route.fulfill({ status: 404, json: { error: 'Unexpected synthetic endpoint' } });
  });
  await f.page.goto(f.base + prefix + '/app/start/');
  await f.page.locator('[data-auth-form] [type=submit]:enabled').waitFor();
  return { ...f, calls };
}

for (const [lang, prefix, required] of [
  ['en', '', 'Fill in this field.'], ['zh', '/zh', '请填写此项。'], ['zh-hant', '/zh-hant', '請填寫此項。'],
  ['ja', '/ja', 'この項目を入力してください。'], ['ko', '/ko', '이 항목을 입력해 주세요.'], ['es', '/es', 'Completa este campo.'],
]) test(`default Auth submit uses localized field errors and preserves its request gate: ${lang}`, async t => {
  const { page, calls, errors } = await openAuth(t, prefix, lang === 'zh' ? 320 : 390);
  const form = page.locator('[data-auth-form]'), email = page.locator('#auth-email'), password = page.locator('#auth-password');
  assert.equal(await form.evaluate(element => element.noValidate), false, 'native constraints stay enabled');
  await resetFocusProbe(page); await form.locator('[type=submit]').click();
  await page.locator('[data-field-error]').first().waitFor();
  assert.equal(await (await feedback(page, email)).innerText(), required);
  await assertFirstErrorFocus(page, '#auth-email');
  assert.equal(await email.evaluate(element => element.validity.valueMissing), true);
  assert.equal(calls.some(call => call.method === 'POST'), false);
  if (lang === 'zh') { await mkdir('test-results/package-audit', { recursive: true }); await page.screenshot({ path: 'test-results/package-audit/field-validation-zh-mobile-320.png', fullPage: true }); }
  await email.fill('synthetic@example.invalid');
  assert.equal(await email.getAttribute('data-field-invalid'), null);
  assert.equal(await email.getAttribute('aria-invalid'), null);
  await password.fill('synthetic-password');
  assert.equal(await form.locator('[data-field-error]').count(), 0);
  const sent = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/app/session');
  await form.locator('[type=submit]').click();
  assert.equal((await sent).status(), 400, 'a corrected form reaches the existing server-authentication path');
  await page.locator('[data-error-dialog][open]').waitFor();
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
  await assertCustomValidation(page);
  assert.deepEqual(errors, []);
});

test('signup preserves pattern/email/code constraints and existing descriptive hints', async t => {
  const { page, calls, errors } = await openAuth(t);
  await page.locator('[data-auth-mode=create]').click();
  const username = page.locator('#auth-username'), email = page.locator('#auth-email'), code = page.locator('#auth-code');
  await username.fill('UPPER'); await email.fill('not-an-email'); await code.fill('123');
  await page.locator('#auth-password').fill('synthetic-password'); await page.locator('#auth-confirm').fill('synthetic-password'); await page.locator('[name=agree]').check();
  await resetFocusProbe(page); await page.locator('[data-auth-form] [type=submit]').click();
  await page.locator('[data-field-error]').first().waitFor();
  await assertFirstErrorFocus(page, '#auth-username');
  assert.equal(await username.evaluate(element => element.validity.patternMismatch), true);
  assert.equal(await email.evaluate(element => element.validity.typeMismatch), true);
  assert.equal(await code.evaluate(element => element.validity.patternMismatch), true);
  assert.ok((await username.getAttribute('aria-describedby')).split(/\s+/).includes('auth-username-hint'));
  assert.equal(calls.some(call => call.method === 'POST'), false);
  await username.fill('synthetic_user'); await email.fill('synthetic@example.invalid'); await code.fill('123456');
  assert.equal(await username.getAttribute('aria-describedby'), 'auth-username-hint');
  assert.equal(await page.locator('[data-auth-form] [data-field-error]').count(), 0);
  const sent = page.waitForResponse(response => response.request().method() === 'POST');
  await page.locator('[data-auth-form] [type=submit]').click(); await sent;
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
  await assertCustomValidation(page); assert.deepEqual(errors, []);
});

test('staff quotation blocks required and increment errors before the actual create request', async t => {
  const f = await supportFixture(t, support, { viewport: { width: 1600, height: 1000 } }); await probe(f.context);
  const page = await f.operatorPage(''); await showStaffDetails(page); await page.locator('[data-order-new]').click();
  const form = page.locator('[data-order-form]'), title = form.locator('[name=title]'), amount = form.locator('[name=amount]');
  await form.locator('[name=product]').selectOption('other');
  await amount.fill('1.0000001');
  await resetFocusProbe(page); await form.locator('[type=submit]').click(); await form.locator('[data-field-error]').first().waitFor();
  await assertFirstErrorFocus(page, '[data-order-form] [name=title]');
  assert.equal(await title.evaluate(element => element.validity.valueMissing), true);
  assert.equal(await amount.evaluate(element => element.validity.stepMismatch), true);
  assert.equal(f.calls.filter(call => call.method === 'POST' && call.path.endsWith('/orders')).length, 0);
  await mkdir('test-results/package-audit', { recursive: true }); await page.screenshot({ path: 'test-results/package-audit/field-validation-en-desktop-1600.png', fullPage: true });
  await title.fill('Synthetic quotation'); await amount.fill('20'); await form.locator('[name=serviceDays]').fill('0');
  const sent = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/orders'));
  await form.locator('[type=submit]').click(); assert.equal((await sent).status(), 200);
  assert.equal(f.calls.filter(call => call.method === 'POST' && call.path.endsWith('/orders')).length, 1);
  await assertCustomValidation(page); assert.deepEqual(f.errors, []);
});

test('staff receipt form keeps decimal precision validation and its explicit confirmation boundary', async t => {
  const f = await supportFixture(t, support, { viewport: { width: 1600, height: 1000 } }); await probe(f.context);
  const paid = [];
  await f.context.route('**/api/support/conversations/21/topups', async route => {
    paid.push(route.request().postDataJSON());
    await route.fulfill({ json: { ok: true, data: { topupId: '101', ledgerId: '202', creditedCashMicro: 1250000, cashBalanceMicro: 13250000, currency: 'CNY', duplicate: false } } });
  });
  const page = await f.operatorPage(''); await showStaffDetails(page);
  const form = page.locator('[data-cash-topup]'), amount = form.locator('[name=amount]');
  await amount.fill('1.1234567'); await form.locator('[name=receipt]').fill('SYNTHETIC-RECEIPT'); await form.locator('[name=memo]').fill('Synthetic receipt verification');
  await resetFocusProbe(page); await form.locator('[type=submit]').click(); await form.locator('[data-field-error]').first().waitFor();
  await assertFirstErrorFocus(page, '[data-cash-topup] [name=amount]');
  assert.equal(await amount.evaluate(element => element.validity.patternMismatch), true); assert.equal(paid.length, 0);
  await amount.fill('1.25'); await form.locator('[type=submit]').click();
  await page.locator('[data-cash-confirm]').waitFor(); assert.equal(paid.length, 0, 'valid input still only opens the existing confirmation');
  const sent = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/topups'));
  await page.locator('[data-cash-confirm]').click(); assert.equal((await sent).status(), 200);
  assert.equal(paid.length, 1); assert.equal(paid[0].amountMicro, 1250000);
  await assertCustomValidation(page); assert.deepEqual(f.errors, []);
});

test('staff case form retains required evidence and amount bounds before creating a case', async t => {
  const f = await supportFixture(t, support, { viewport: { width: 1600, height: 1000 } }); await probe(f.context);
  const id = '00000000-0000-4000-8000-000000000090', at = '2026-10-13T00:00:00Z';
  f.state.orders = [{ id, conversationId: '21', userId: '42', title: 'Original synthetic allowance', product: 'allowance', amountMicro: 20000000, currency: 'CNY', serviceDays: 0, status: 'completed', assigneeId: '84', assigneeName: 'Support operator', note: '', dueAt: null, paymentTopupId: 101, subscriptionId: null, subscriptionRef: '', allowanceRef: 'synthetic-allowance', version: 3, createdAt: at, updatedAt: at, accepted: true, acceptedAt: at, fulfilled: true, fulfilledAt: at, enableApiKeys: false, poolId: null, tier: 0, months: 0, allowanceUsdMicro: 10000000, history: [] }];
  f.state.messages = [{ id: '31', conversationId: '21', clientMessageId: crypto.randomUUID(), sender: 'user', text: 'Synthetic service report', attachments: [], createdAt: at }];
  const page = await f.operatorPage(''); await showStaffDetails(page); await page.locator(`[data-order-edit="${id}"]`).click(); await page.locator('[data-case-new]').click();
  const form = page.locator('[data-case-form]'), reason = form.locator('[name=reason]'), amount = form.locator('[name=requestedAllowance]');
  await form.locator('[name=caseType]').selectOption('compensation'); await amount.fill('101');
  await resetFocusProbe(page); await form.locator('[type=submit]').click(); await form.locator('[data-field-error]').first().waitFor();
  await assertFirstErrorFocus(page, '[data-case-form] [name=reason]');
  assert.equal(await reason.evaluate(element => element.validity.valueMissing), true); assert.equal(await amount.evaluate(element => element.validity.rangeOverflow), true);
  assert.equal(f.calls.filter(call => call.method === 'POST' && call.path.endsWith('/cases')).length, 0);
  await reason.fill('Synthetic verified follow-up'); await form.locator('[name=evidenceNote]').fill('Synthetic report in this conversation'); await form.locator('[name=evidenceMessageId]').selectOption('31'); await amount.fill('1');
  const sent = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/cases'));
  await form.locator('[type=submit]').click(); assert.equal((await sent).status(), 200);
  assert.equal(f.calls.filter(call => call.method === 'POST' && call.path.endsWith('/cases')).length, 1);
  await assertCustomValidation(page); assert.deepEqual(f.errors, []);
});
