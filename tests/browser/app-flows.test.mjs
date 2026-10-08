import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserFixture, enterPreview, createWorkspace } from '../helpers/browser.mjs';

const fixture = createBrowserFixture();
before(() => fixture.start());
after(() => fixture.stop());
const locales = ['', '/zh', '/zh-hant', '/ja', '/ko', '/es'];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGM4k+kBAAOCAX62ByEmAAAAAElFTkSuQmCC', 'base64');

async function idle(page) {
  await page.waitForFunction(() => document.querySelector('#fx')?.getAttribute('aria-busy') !== 'true');
}
async function go(page, path) {
  await idle(page);
  await page.evaluate(path => { location.hash = '#/' + path; }, path);
  await page.waitForFunction(path => document.querySelector('#fx')?.dataset.route === '#/' + path, path);
}
async function record(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('fells.preview.v2', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('preview');
      const read = tx.objectStore('preview').get('active');
      read.onsuccess = () => resolve(read.result);
      tx.oncomplete = () => db.close();
    };
  }));
}
async function waitlist(page) {
  const requests = [];
  await page.route('**/__order-waitlist', route => {
    requests.push({ method: route.request().method(), body: route.request().postDataJSON() });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.locator('[data-checkout]').evaluate(form => {
    form.dataset.wait = '/__order-waitlist';
    // Preview credit products must not be routed into a configured CNY payment template.
    form.dataset.pay = '/__unexpected-payment?sku={sku}&amount={amount}';
  });
  return requests;
}
async function submitOrder(page, email = 'orders@example.invalid') {
  await page.locator('[name=email]').fill(email);
  await page.locator('[name=agree]').check();
  await page.locator('[data-submit]').click();
  await page.locator('[data-msg]').filter({ hasText: email }).waitFor();
}

for (const locale of locales) {
  test(`credit top-up preserves USD amount, method and reward in ${locale || 'English'}`, async t => {
    const { page, base, errors } = await fixture.setup(t);
    await enterPreview(page, base, locale);
    await go(page, 'billing/credits');
    await page.locator('[data-act=topup]').first().click();
    await page.locator('[data-act=topup-amt][data-v="100"]').click();
    await page.locator('[data-act=topup-method][data-v=card]').click();
    await page.locator('[data-form=topup] [name=code]').fill('abcd-efgh');
    await page.locator('[data-form=topup] [data-pay]').click();
    await page.waitForURL(url => url.pathname === locale + '/checkout');
    await page.locator('[data-mode=credits][aria-selected=true]').waitFor();
    const query = new URL(page.url()).searchParams;
    assert.equal(query.get('mode'), 'credits');
    assert.equal(query.get('amount'), '100');
    assert.equal(query.get('method'), 'card');
    assert.equal(query.has('code'), false, 'reward is retained in the field instead of the URL');
    assert.equal(await page.locator('[name=amount]').inputValue(), '100');
    assert.equal(await page.locator('[name=channel]:checked').inputValue(), 'card');
    assert.equal(await page.locator('[name=code]').inputValue(), 'abcd-efgh');
    assert.equal(await page.locator('[data-total]').innerText(), '$100');
    assert.equal(await page.locator('[data-comparison]:visible').count(), 0);
    const requests = await waitlist(page);
    await submitOrder(page);
    assert.deepEqual(requests, [{ method: 'POST', body: {
      email: 'orders@example.invalid', order: 'credits-topup', amount: 100, currency: 'USD', channel: 'card', code: 'ABCD-EFGH',
    } }]);
    assert.equal((await record(page)).state.credits.never, 0, 'a preview order never claims a paid balance');
    assert.deepEqual(errors, []);
  });
}

test('market purchases and old product links select the intended dedicated USD tier', async t => {
  const { page, base, errors } = await fixture.setup(t);
  await enterPreview(page, base);
  for (const product of ['claude', 'codex']) {
    await go(page, 'billing/market');
    await page.locator(`a[href*="product=${product}"]`).click();
    await page.locator('[data-mode=subscription][aria-selected=true]').waitFor();
    assert.equal(await page.locator('[name=subscription]:checked').inputValue(), product + '-1x');
    assert.equal(await page.locator('[data-total]').innerText(), '$10/mo');
    await page.locator(`label.opt:has([name=subscription][value="${product}-5x"])`).click();
    assert.equal(await page.locator('[data-total]').innerText(), '$50/mo');
    const requests = await waitlist(page);
    await submitOrder(page);
    assert.equal(requests[0].body.order, 'dedicated-' + product + '-5x');
    assert.equal(requests[0].body.amount, 50);
    assert.equal(requests[0].body.currency, 'USD');
    await page.goto(base + '/app/#/billing/market');
    await page.locator('a[href*="product=claude"]').waitFor();
  }
  await page.goto(base + '/checkout?product=codex&period=monthly');
  await page.locator('[data-mode=subscription][aria-selected=true]').waitFor();
  assert.equal(await page.locator('[name=subscription]:checked').inputValue(), 'codex-1x');
  assert.equal(new URL(page.url()).searchParams.get('mode'), 'subscription');
  assert.deepEqual(errors, []);
});

test('unsupported products and invalid top-up amounts cannot silently buy the trial', async t => {
  const { page, base, errors } = await fixture.setup(t);
  const invalidQueries = [
    'product=missing', 'product=codex&tier=unknown', 'product=codex&period=annual', 'mode=unknown',
    'mode=credits&amount=0', 'mode=credits&amount=11', 'mode=credits&amount=5005', 'mode=credits&amount=100&method=unknown',
    'plan=missing', 'plan=', 'mode=group&seat=missing', 'mode=group&seat=',
    'mode=token&product=codex', 'plan=3500&product=codex', 'plan=3500&seat=g10',
    'mode=credits&amount=100&plan=trial', 'mode=redeem&plan=trial', 'amount=100',
    'plan=trial&plan=3500', 'mode=group&seat=g2&seat=g10', 'mode=credits&mode=token&amount=100',
    'mode=credits&amount=100&amount=200', 'product=claude&product=codex',
    'product=codex&tier=1x&tier=5x', 'product=codex&period=monthly&period=annual',
    'mode=credits&amount=100&method=alipay&method=card', 'plan=trial&code=ABCD-EFGH&code=IJKL-MNOP',
    'mode=token&method=card',
  ];
  for (const query of invalidQueries) {
    await page.goto(base + '/checkout?' + query);
    await page.locator('[data-msg].err').waitFor();
    assert.equal(await page.locator('[data-submit]').isDisabled(), true, query);
    assert.equal(await page.locator('[data-total]').innerText(), '—', query);
    const expected = new URLSearchParams(query);
    expected.delete('code');
    assert.equal(new URL(page.url()).search, '?' + expected.toString(), 'invalid intent is not rewritten: ' + query);
    const alternative = await page.locator('[name=channel]:enabled:not(:checked)').first().inputValue();
    await page.locator(`label.opt:has([name=channel][value="${alternative}"])`).click();
    assert.equal(await page.locator('[data-submit]').isDisabled(), true, 'payment-channel changes cannot clear an invalid product');
    await page.locator('[data-mode=token]').click();
    assert.equal(await page.locator('[data-submit]').isDisabled(), false, 'an explicit product choice recovers');
    assert.equal(await page.locator('[data-total]').innerText(), expected.get('plan') === '3500' ? '¥3,788/mo' : '¥99');
  }
  await page.goto(base + '/checkout?mode=credits&amount=11');
  await page.locator('[name=amount]').fill('75');
  assert.equal(await page.locator('[data-total]').innerText(), '$75');
  assert.equal(await page.locator('[data-submit]').isDisabled(), false);
  assert.deepEqual(errors, []);
});

test('empty checkout and valid bare-seat links retain their explicit default or group order', async t => {
  const { page, base, errors } = await fixture.setup(t);
  await page.goto(base + '/checkout');
  await page.locator('[data-submit]:enabled').waitFor();
  assert.equal(await page.locator('[name=plan]:checked').inputValue(), 'trial');
  assert.equal(await page.locator('[data-total]').innerText(), '¥99');
  await page.goto(base + '/checkout?seat=g10');
  await page.locator('[data-mode=group][aria-selected=true]').waitFor();
  assert.equal(await page.locator('[name=seat]:checked').inputValue(), 'g10');
  assert.equal(await page.locator('[data-total]').innerText(), '¥788/mo');
  assert.equal(new URL(page.url()).searchParams.get('mode'), 'group');
  assert.deepEqual(errors, []);
});

test('CNY payment and live shop handoffs preserve the existing order contract', async t => {
  const { page, base, errors } = await fixture.setup(t);
  await page.goto(base + '/checkout?plan=3500');
  await page.locator('[data-checkout]').evaluate(form => {
    form.dataset.pay = '/__payment?sku={sku}&period={period}&amount={amount}&email={email}&method={method}&code={code}';
  });
  await page.locator('[name=email]').fill('cn-orders@example.invalid');
  await page.locator('[name=agree]').check();
  await page.locator('[data-reward] summary').click();
  await page.locator('[name=code]').fill('ABCD-EFGH');
  const navigation = page.waitForRequest(request => new URL(request.url()).pathname === '/__payment');
  await page.locator('[data-submit]').click();
  const query = new URL((await navigation).url()).searchParams;
  assert.equal(query.get('sku'), 'token-3500');
  assert.equal(query.get('amount'), '3788');
  assert.equal(query.get('period'), 'monthly');
  assert.equal(query.get('code'), 'ABCD-EFGH');
  // Shops are captured at initialization; supply a configured shop before that script starts.
  await page.route('**/checkout*', async route => {
    if (!route.request().isNavigationRequest()) return route.continue();
    const response = await route.fetch();
    const body = (await response.text()).replace('data-shops=', 'data-unused-shops=').replace('data-checkout ', 'data-checkout data-shops=\'{"taobao":{"name":"Taobao","url":"https://shop.example.invalid/order"},"xianyu":{"name":"Xianyu","url":""}}\' ');
    await route.fulfill({ response, body });
  });
  await page.addInitScript(() => { window.open = (...args) => { window.openedShop = args; return null; }; });
  await page.goto(base + '/checkout?mode=group&seat=g10');
  await page.locator('label.opt:has([name=channel][value=taobao])').click();
  assert.equal(await page.locator('[data-account]').isVisible(), false);
  await page.locator('[data-submit]').click();
  assert.deepEqual(await page.evaluate(() => window.openedShop), ['https://shop.example.invalid/order', '_blank', 'noopener']);
  assert.deepEqual(errors, []);
});

test('onboarding single and multiple choices survive back navigation and recommend the saved agent', async t => {
  const { page, base, errors } = await fixture.setup(t);
  await page.goto(base + '/app/start/');
  await page.locator('#auth-email').fill('onboarding@example.invalid');
  await page.locator('[data-auth-form] [type=submit]').click();
  assert.equal(await page.locator('[data-act=ob-next]').isDisabled(), true);
  await page.locator('[data-act=ob-opt][data-i="0"]').click();
  await page.locator('[data-act=ob-opt][data-i="1"]').click();
  await page.locator('[data-act=ob-next]').click();
  await page.locator('[data-act=ob-back]').click();
  assert.equal(await page.locator('[data-act=ob-opt][aria-checked=true]').count(), 2);
  await page.locator('[data-act=ob-next]').click();
  await page.locator('[data-act=ob-opt][data-i="1"]').click();
  await page.locator('[data-act=ob-opt][data-i="4"]').click();
  await page.locator('[data-act=ob-next]').click();
  await page.locator('[data-act=ob-opt][data-i="0"]').click();
  await page.locator('[data-act=ob-opt][data-i="1"]').click();
  assert.equal(await page.locator('[data-act=ob-opt][aria-checked=true]').count(), 1);
  await page.locator('[data-act=ob-next]').click();
  await page.locator('[data-act=ob-opt][data-i="2"]').click();
  await page.locator('[data-act=ob-next]').click();
  await page.locator('.scrim').waitFor({ state: 'detached' });
  assert.deepEqual((await record(page)).state.answers, [[0, 1], [1, 4], [1], [2]]);
  await createWorkspace(page);
  assert.equal(await page.locator('[data-act=agent][data-id=claude]').getAttribute('aria-selected'), 'true');
  await page.reload();
  await page.locator('[data-act=agent][data-id=claude][aria-selected=true]').waitFor();
  assert.equal(await page.locator('[data-act=ob-next]').count(), 0);
  assert.deepEqual(errors, []);
});

test('plugin install, category/search filtering and removal persist after reload', async t => {
  const { page, base, errors } = await fixture.setup(t);
  await enterPreview(page, base); await createWorkspace(page);
  await go(page, 'plugins');
  await page.locator('[data-act=pcat][data-i="3"]').click();
  await page.locator('[data-input=pluginQ]').fill('GitHub');
  assert.equal(await page.locator('[data-plist] .plug').count(), 1);
  await page.locator('[data-plist] [data-act=plugin][data-id=github]').click(); await idle(page);
  assert.deepEqual((await record(page)).state.installed, ['github']);
  await page.reload();
  await page.locator('[data-act=plugin][data-id=github]').first().waitFor();
  assert.deepEqual((await record(page)).state.installed, ['github']);
  await page.locator('[data-input=pluginQ]').fill('no matching plugin');
  assert.equal(await page.locator('[data-plist] [data-act=plugin]').count(), 0);
  await page.locator('[data-input=pluginQ]').fill('GitHub');
  await page.locator('[data-plist] [data-act=plugin][data-id=github]').click(); await idle(page);
  await page.reload();
  await page.locator('[data-plist]').waitFor();
  assert.deepEqual((await record(page)).state.installed, []);
  assert.deepEqual(errors, []);
});

test('budget settings and both default-channel controls persist as one preference', async t => {
  const { page, base, errors } = await fixture.setup(t);
  await enterPreview(page, base);
  await go(page, 'billing/credits');
  await page.locator('[data-form=budget] [name=limit]').fill('150');
  await page.locator('[data-form=budget] [name=alert]').selectOption('90');
  await page.locator('[data-act=budget-pause]').click();
  await page.locator('[data-form=budget] .btn').click(); await idle(page);
  assert.deepEqual((await record(page)).state.budget, { limit: 150, alert: 90, pause: true });
  await page.locator('[data-input=defaultChannel]').selectOption('glm'); await idle(page);
  await go(page, 'billing/market');
  assert.equal(await page.locator('[data-act=default-chan][data-id=glm]').count(), 0);
  await page.locator('[data-act=default-chan][data-id=fireworks]').click(); await idle(page);
  await go(page, 'billing/credits');
  assert.equal(await page.locator('[data-input=defaultChannel]').inputValue(), 'fireworks');
  await page.reload();
  await page.locator('[data-form=budget]').waitFor();
  assert.equal(await page.locator('[name=limit]').inputValue(), '150');
  assert.equal(await page.locator('[data-act=budget-pause]').getAttribute('aria-checked'), 'true');
  assert.equal((await record(page)).state.defaultChannel, 'fireworks');
  assert.deepEqual(errors, []);
});

test('avatar selection, shuffle, raster upload and removal survive reload', async t => {
  const { page, base, errors } = await fixture.setup(t);
  await enterPreview(page, base);
  await go(page, 'settings/0');
  await page.locator('[data-act=avatar][data-i="2"]').click(); await idle(page);
  assert.equal((await record(page)).state.profile.avatar, 2);
  await page.locator('[data-act=avatar-shuffle]').click(); await idle(page);
  assert.notEqual((await record(page)).state.profile.avatar, 2);
  const chooser = page.waitForEvent('filechooser');
  await page.locator('[data-act=avatar-upload]').click();
  await (await chooser).setFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: png });
  await page.locator('[data-act=avatar-remove]').waitFor();
  const uploaded = (await record(page)).state.profile.avatar;
  assert.match(uploaded, /^data:image\/jpeg;base64,/);
  await page.reload(); await page.locator('[data-act=avatar-remove]').waitFor();
  assert.equal((await record(page)).state.profile.avatar, uploaded);
  await page.locator('[data-act=avatar-remove]').click(); await idle(page);
  assert.equal((await record(page)).state.profile.avatar, 0);
  assert.deepEqual(errors, []);
});

test('command palette filters, keyboard-selects routes and handles empty results', async t => {
  const { page, base, errors } = await fixture.setup(t);
  await enterPreview(page, base); await createWorkspace(page);
  await page.keyboard.press('Control+k');
  await page.locator('[data-input=pal]').fill('Plugin');
  assert.equal(await page.locator('[data-act=pal-run]').count(), 1);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#fx').dataset.route === '#/plugins');
  await page.keyboard.press('Control+k');
  await page.locator('[data-input=pal]').fill('missing palette command');
  assert.equal(await page.locator('[data-act=pal-run]').count(), 0);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await page.locator('.scrim').waitFor({ state: 'detached' });
  await page.keyboard.press('Control+Shift+o');
  await page.locator('#fx-input').waitFor();
  assert.equal(await page.locator('#fx').getAttribute('data-route'), '#/new');
  assert.deepEqual(errors, []);
});

test('main chat honors IME, newlines and both Enter sending preferences', async t => {
  const { page, base, errors } = await fixture.setup(t);
  await enterPreview(page, base); await createWorkspace(page);
  let input = page.locator('#fx-input');
  await input.press('Enter');
  assert.equal((await record(page)).state.chats.length, 0);
  await input.fill('中文输入');
  await input.evaluate(input => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: true })));
  assert.equal((await record(page)).state.chats.length, 0);
  assert.equal(await input.inputValue(), '中文输入');
  await input.press('Shift+Enter');
  assert.equal(await input.inputValue(), '中文输入\n');
  assert.equal((await record(page)).state.chats.length, 0);
  await input.press('Enter'); await idle(page);
  await page.locator('[data-form=send][data-chat]').waitFor();
  assert.equal((await record(page)).state.chats[0].messages[0][1], '中文输入');
  await go(page, 'settings/1');
  await page.locator('[data-act=send-key][data-i="1"]').click(); await idle(page);
  await go(page, 'new');
  input = page.locator('#fx-input');
  await input.fill('Modifier sends');
  await input.press('Enter');
  assert.equal(await input.inputValue(), 'Modifier sends\n');
  assert.equal((await record(page)).state.chats.length, 1);
  await input.press('Control+Enter'); await idle(page);
  await page.locator('[data-form=send][data-chat]').waitFor();
  assert.equal((await record(page)).state.chats.length, 2);
  assert.equal((await record(page)).state.chats[1].messages[0][1], 'Modifier sends');
  assert.deepEqual(errors, []);
});
