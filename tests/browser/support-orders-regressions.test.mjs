import test from 'node:test';
import assert from 'node:assert/strict';
import { supportBrowser, supportFixture, refresh } from './helpers/support-http-fixture.mjs';
let environment;
test.before(async () => { environment = await supportBrowser(); });
test.after(async () => { await environment?.close(); });
const orderId = '00000000-0000-4000-8000-000000000099';
function order() {
  return { id: orderId, conversationId: '21', userId: '42', title: 'Existing purchase', product: 'allowance', amountMicro: 20000000, currency: 'CNY', serviceDays: 0, status: 'completed', assigneeId: '85', assigneeName: 'Former operator', note: 'Existing note', dueAt: '2026-12-10T12:34:56Z', paymentTopupId: 101, subscriptionId: null, subscriptionRef: '', allowanceRef: 'allow-original', version: 3, createdAt: '2026-10-13T00:00:00Z', updatedAt: '2026-10-13T00:00:00Z', accepted: true, acceptedAt: '2026-10-13T00:00:00Z', fulfilled: true, fulfilledAt: '2026-10-13T00:00:00Z', enableApiKeys: false, poolId: null, tier: 0, months: 0, allowanceUsdMicro: 10000000, history: [] };
}
async function addSecondConversation(f) {
  const detail = id => ({ id, customer: { id: id === '21' ? '42' : '43', name: 'Customer ' + id, email: id + '@example.test', joinedAt: '2026-10-13T00:00:00Z', preferredLocale: 'en', workspaceCount: 0, credits: 9, creditsCurrency: 'USD', creditsKind: 'api_allowance' }, status: 'open', lastMessage: null, unreadCount: 0, updatedAt: '2026-10-13T00:00:00Z', userRead: { lastReadMessageId: null, updatedAt: null }, agentRead: { lastReadMessageId: null, updatedAt: null } });
  await f.context.route('**/api/support/conversations**', async route => {
    const path = new URL(route.request().url()).pathname;
    let data;
    if (path === '/api/support/conversations') data = { items: [detail('21'), detail('22')], nextCursor: null };
    else if (path === '/api/support/conversations/22') data = detail('22');
    else if (/^\/api\/support\/conversations\/22\/(messages|orders|cases)$/.test(path)) data = { items: [], nextCursor: null };
    else { await route.fallback(); return; }
    await route.fulfill({ json: { ok: true, data, requestId: 'regression' } });
  });
}
for (const product of ['allowance', 'subscription', 'token_plan']) test(`uncertain ${product} quote keeps original intent through editor and conversation switches`, async t => {
  const f = await supportFixture(t, environment, { viewport: { width: 1600, height: 1050 } }); f.state.orders = [order()]; await addSecondConversation(f);
  let initial;
  await f.context.route('**/api/support/conversations/21/orders', async route => {
    if (route.request().method() === 'POST' && !initial) {
      initial = route.request().postDataJSON();
      await route.fulfill({ status: 503, json: { ok: false, error: { code: 'internal_error', message: 'Uncertain quote result' }, requestId: 'regression' } });
    } else await route.fallback();
  });
  const page = await f.operatorPage(''); if (await page.locator('[data-support-details]').isVisible()) await page.locator('[data-support-details]').click(); await page.locator('[data-order-new]').click();
  const form = page.locator('[data-order-form]');
  await form.locator('[name=title]').fill('Original quote'); await form.locator('[name=product]').selectOption(product);
  if (product === 'allowance') await form.locator('[name=amount]').fill('20');
  if (product === 'subscription') await form.locator('[name=months]').fill('2');
  if (product === 'token_plan') await form.locator('[name=planCode]').selectOption('token-standard');
  await form.locator('[name=note]').fill('Original public note');
  const originalAmount = await form.locator('[name=amount]').inputValue();
  await form.locator('[type=submit]').click(); await page.locator('[data-order-error]').filter({ hasText: 'Uncertain quote result' }).waitFor();
  await form.locator('[name=product]:disabled').waitFor();
  const assertIntent = async () => {
    assert.equal(await form.locator('[name=product]').inputValue(), product);
    assert.equal(await form.locator('[name=product]').isDisabled(), true);
    assert.equal(await form.locator('[name=amount]').getAttribute('readonly'), '');
    assert.equal(await form.locator('[name=amount]').inputValue(), originalAmount);
    assert.equal(await form.locator('[name=title]').inputValue(), 'Original quote');
    assert.equal(await form.locator('[name=note]').inputValue(), 'Original public note');
    await form.locator('[data-order-create-hint]').filter({ hasText: 'result is uncertain' }).waitFor();
  };
  await page.locator('[data-order-new]').click(); await assertIntent();
  await page.locator(`[data-order-edit="${orderId}"]`).click(); await page.locator('[data-order-new]').click(); await assertIntent();
  await page.locator('[data-support-conversation="22"]').click(); await page.locator('[data-order-new]').click();
  assert.equal(await form.locator('[name=product]').isDisabled(), false);
  await page.locator('[data-support-conversation="21"]').click(); await page.locator('[data-order-new]').click(); await assertIntent();
  await refresh(page); await assertIntent();
  const saved = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/21/orders'));
  await form.locator('[type=submit]').click(); assert.equal((await saved).status(), 200);
  assert.deepEqual(f.calls.filter(c => c.method === 'POST' && c.path.endsWith('/21/orders')).at(-1).body, initial);
  assert.equal(f.state.orders.filter(item => item.clientOrderId === initial.clientOrderId).length, 1);
  await page.locator('[data-order-new]').click(); assert.equal(await form.locator('[name=product]').isDisabled(), false);
  assert.deepEqual(f.errors, []);
});
test('historical order assignee remains visible and unrelated edits only send changed fields', async t => {
  const f = await supportFixture(t, environment, { viewport: { width: 1600, height: 1050 } }); f.state.orders = [order()];
  const page = await f.operatorPage(''); if (await page.locator('[data-support-details]').isVisible()) await page.locator('[data-support-details]').click(); await page.locator(`[data-order-edit="${orderId}"]`).click();
  const form = page.locator('[data-order-form]');
  assert.equal(await form.locator('[name=assigneeId]').inputValue(), '85');
  assert.equal(await form.locator('[name=assigneeId] option[value="85"]').getAttribute("disabled"), "");
  await form.locator('[name=note]').fill('Reviewed only the note');
  await page.locator('[data-order-new]').click(); await page.locator(`[data-order-edit="${orderId}"]`).click();
  assert.equal(await form.locator('[name=assigneeId]').inputValue(), '85');
  const saved = page.waitForResponse(r => r.request().method() === 'PATCH' && new URL(r.url()).pathname.endsWith('/orders/' + orderId));
  await form.locator('[type=submit]').click(); assert.equal((await saved).status(), 200);
  assert.deepEqual(f.calls.filter(c => c.method === 'PATCH').at(-1).body, { version: 3, note: 'Reviewed only the note' });
  assert.equal(f.state.orders[0].assigneeId, '85'); assert.equal(f.state.orders[0].dueAt, '2026-12-10T12:34:56Z');
  await form.locator('[name=assigneeId]').selectOption('84');
  const assigned = page.waitForResponse(r => r.request().method() === 'PATCH' && new URL(r.url()).pathname.endsWith('/orders/' + orderId));
  await form.locator('[type=submit]').click(); assert.equal((await assigned).status(), 200);
  assert.deepEqual(f.calls.filter(c => c.method === 'PATCH').at(-1).body, { version: 4, assigneeId: '84' });
  assert.deepEqual(f.errors, []);
});

for (const returnBeforeReply of [true, false]) test(`late successful create retains its retry identity when ${returnBeforeReply ? 'back in the original' : 'still in another'} conversation`, async t => {
  const f = await supportFixture(t, environment, { viewport: { width: 1600, height: 1050 } });
  f.state.orders = [order()]; await addSecondConversation(f);
  let release; f.state.orderReplyGate = new Promise(resolve => { release = resolve; }); t.after(() => release());
  const page = await f.operatorPage(''); await page.locator('[data-order-new]').click(); const form = page.locator('[data-order-form]');
  await form.locator('[name=title]').fill('Delayed successful quote'); await form.locator('[name=product]').selectOption('allowance'); await form.locator('[name=amount]').fill('20');
  const initialPost = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/21/orders'));
  const lateReply = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/21/orders'));
  await form.locator('[type=submit]').click(); const original = (await initialPost).postDataJSON();
  await page.locator('[data-support-conversation="22"]').click();
  if (returnBeforeReply) {
    await page.locator('[data-support-conversation="21"]').click(); await page.locator('[data-order-new]').click();
    await form.locator('[name=product]:disabled').waitFor();
  }
  release(); assert.equal((await lateReply).status(), 200);
  if (!returnBeforeReply) { await page.locator('[data-support-conversation="21"]').click(); await page.locator('[data-order-new]').click(); }
  await form.locator('[data-order-create-hint]').waitFor();
  assert.equal(await form.locator('[name=amount]').getAttribute('readonly'), '');
  assert.equal(await form.locator('[name=title]').inputValue(), original.title);
  const replay = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/21/orders'));
  await form.locator('[type=submit]').click(); assert.equal((await replay).status(), 200);
  const requests = f.calls.filter(call => call.method === 'POST' && call.path.endsWith('/21/orders')).map(call => call.body);
  assert.equal(requests.length, 2); assert.deepEqual(requests[1], original);
  assert.equal(f.state.orders.filter(item => item.title === original.title).length, 1);
  await page.locator('[data-order-new]').click(); assert.equal(await form.locator('[name=product]').isDisabled(), false);
  assert.deepEqual(f.errors, []);
});
