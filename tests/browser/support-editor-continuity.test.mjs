import test from 'node:test';
import assert from 'node:assert/strict';
import { supportBrowser, supportFixture, refresh } from './helpers/support-http-fixture.mjs';

let environment;
test.before(async () => { environment = await supportBrowser(); });
test.after(async () => { await environment?.close(); });
const orderId = '00000000-0000-4000-8000-000000000090';
const caseId = '20000000-0000-4000-8000-000000000091';
const at = '2026-10-13T00:00:00Z';
const record = (extra = {}) => ({ id: caseId, orderId, conversationId: '21', userId: '42', caseType: 'refund', status: 'open', reason: 'Synthetic original refund', evidenceMessageId: '31', evidenceAttachmentId: null, evidenceNote: 'Synthetic verified evidence', requestedAllowanceMicro: 0, requestedHours: 0, requestedPlanPeriods: 0, refundMicro: 1000000, enableApiKeys: false, assigneeId: '84', assigneeName: 'Support operator', dueAt: null, note: '', refundProof: '', refundProofMessageId: null, refundProofAttachmentId: null, receipt: null, version: 1, createdAt: at, updatedAt: at, executedAt: null, closedAt: null, history: [], refund: { plan: { mode: 'waive', reason: 'Synthetic original plan', proposedBy: '84', approvedBy: '', approvedAt: null }, stage: 'pending', claimedStage: '', provider: '', account: '', refundId: '', executedBy: '', recordedBy: '', reviewedBy: '', reversalRef: '', reversedAt: null, recovery: {} }, ...extra });
function seed(f, cases = []) {
  f.state.orders = [{ id: orderId, conversationId: '21', userId: '42', title: 'Synthetic original paid order', product: 'allowance', amountMicro: 20000000, currency: 'CNY', serviceDays: 0, status: 'completed', assigneeId: '84', assigneeName: 'Support operator', note: '', dueAt: null, paymentTopupId: 101, subscriptionId: null, subscriptionRef: '', allowanceRef: 'synthetic-original', version: 3, createdAt: at, updatedAt: at, accepted: true, acceptedAt: at, fulfilled: true, fulfilledAt: at, enableApiKeys: false, poolId: null, tier: 0, months: 0, allowanceUsdMicro: 10000000, history: [] }];
  f.state.messages = [{ id: '31', conversationId: '21', clientMessageId: crypto.randomUUID(), sender: 'user', text: 'Synthetic customer evidence', attachments: [], createdAt: at }];
  f.state.cases = cases; f.state.operatorRole = 'owner';
}
async function editor(f, width = 1280) {
  const page = await f.operatorPage(); await page.setViewportSize({ width, height: 900 });
  const toggle = page.locator('[data-support-details]'); if (await toggle.isVisible()) await toggle.click();
  await page.locator(`[data-order-edit="${orderId}"]`).click(); await page.locator('[data-case-new]').waitFor(); return page;
}
async function refreshWithUnselectedCase(f, page) {
  const other = record({ id: '20000000-0000-4000-8000-000000000092', status: 'closed', closedAt: at });
  f.state.cases.push(other); await refresh(page); await page.locator(`[data-case-id="${other.id}"]`).waitFor();
}

for (const width of [320, 1600]) test(`unchanged case editor retains real focus and inline validation during refresh at ${width}px`, async t => {
  const f = await supportFixture(t, environment); seed(f); const page = await editor(f, width);
  await page.locator('[data-case-new]').click(); const form = page.locator('[data-case-form]'), reason = form.locator('[name=reason]');
  await form.locator('[type=submit]').click(); await reason.locator('..').locator('[data-field-error]').waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute('name') === 'reason');
  const original = await reason.elementHandle(), described = await reason.getAttribute('aria-describedby');
  await refreshWithUnselectedCase(f, page);
  assert.equal(await original.evaluate(el => el.isConnected && document.activeElement === el), true, 'the original constrained field keeps focus');
  assert.equal(await reason.getAttribute('aria-describedby'), described); assert.equal(await reason.getAttribute('aria-invalid'), 'true');
  assert.equal(f.calls.some(call => call.method === 'POST' && call.path.endsWith('/cases')), false); assert.deepEqual(f.errors, []);
});

test('unchanged refund details retain nodes and expansion while a real new case version updates the editor', async t => {
  const f = await supportFixture(t, environment); seed(f, [record()]); const page = await editor(f);
  await page.locator(`[data-case-edit="${caseId}"]`).click(); const note = page.locator('[data-case-form] [name=note]');
  const original = await note.elementHandle(); await note.focus();
  const detail = page.locator('[data-refund-action=plan]').locator('..'); await detail.evaluate(el => { el.open = false; });
  await refreshWithUnselectedCase(f, page);
  assert.equal(await original.evaluate(el => el.isConnected && document.activeElement === el), true); assert.equal(await detail.evaluate(el => el.open), false);
  f.state.cases[0].version = 2; f.state.cases[0].note = 'Synthetic server update'; await refresh(page);
  await page.locator('[data-case-version="2"]').waitFor(); assert.equal(await original.evaluate(el => el.isConnected), false);
  assert.equal(await note.inputValue(), 'Synthetic server update');
  await note.fill('Synthetic discarded draft'); await page.locator('[data-case-reload]').click();
  await page.waitForFunction(() => document.querySelector('[data-case-form] [name=note]')?.value === 'Synthetic server update');
  assert.equal(await page.locator('[data-case-execute]').isDisabled(), true); assert.deepEqual(f.errors, []);
});

test('a real new case version keeps a dirty draft and requires explicit conflict resolution', async t => {
  const f = await supportFixture(t, environment); seed(f, [record()]); const page = await editor(f);
  await page.locator(`[data-case-edit="${caseId}"]`).click(); const note = page.locator('[data-case-form] [name=note]');
  await note.fill('Synthetic unsaved draft'); const original = await note.elementHandle();
  f.state.cases[0].version = 2; f.state.cases[0].note = 'Synthetic other operator update'; await refresh(page);
  await page.waitForFunction(() => !!document.querySelector('[data-case-conflict]')?.textContent);
  assert.equal(await original.evaluate(el => el.isConnected), true); assert.equal(await note.inputValue(), 'Synthetic unsaved draft');
  assert.equal(await page.locator('[data-case-version="1"]').count(), 1); assert.equal(f.calls.some(call => call.method === 'PATCH'), false); assert.deepEqual(f.errors, []);
});

for (const action of ['save', 'plan']) test(`failed refund ${action} preserves original approval guards and allows only an explicit retry`, async t => {
  const f = await supportFixture(t, environment); seed(f, [record()]); const page = await editor(f);
  await page.locator(`[data-case-edit="${caseId}"]`).click();
  const execute = page.locator('[data-case-execute]'), approve = page.locator('[data-refund-action=plan] [value=approve]');
  assert.equal(await execute.isDisabled(), true); assert.equal(await approve.isDisabled(), true);
  const path = `/api/support/cases/${caseId}${action === 'plan' ? '/refund-plan' : ''}`, method = action === 'plan' ? 'POST' : 'PATCH', requests = [];
  let reject = true;
  await page.route(`**${path}`, async route => {
    if (route.request().method() !== method) return route.fallback();
    requests.push(route.request().postDataJSON());
    if (reject) return route.fulfill({ status: 503, json: { ok: false, error: { code: 'internal_error', message: 'Synthetic retryable save failure' } } });
    return route.fallback();
  });
  const form = page.locator(action === 'plan' ? '[data-refund-action=plan]' : '[data-case-form]');
  await form.locator(`[name=${action === 'plan' ? 'reason' : 'note'}]`).fill('Synthetic edited draft');
  const submit = form.locator(action === 'plan' ? '[value=propose]' : '[type=submit]');
  const failed = page.waitForResponse(response => response.request().method() === method && new URL(response.url()).pathname === path);
  await submit.click(); assert.equal((await failed).status(), 503); await page.locator('[data-case-error]').filter({ hasText: 'Synthetic retryable save failure' }).waitFor();
  await submit.waitFor({ state: 'visible' }); await page.waitForFunction(selector => !document.querySelector(selector).disabled, action === 'plan' ? '[data-refund-action=plan] [value=propose]' : '[data-case-form] [type=submit]');
  assert.equal(await execute.isDisabled(), true); assert.equal(await approve.isDisabled(), true); assert.equal(requests.length, 1);
  reject = false; const retried = page.waitForResponse(response => response.request().method() === method && new URL(response.url()).pathname === path);
  await submit.click(); assert.equal((await retried).status(), 200); await page.locator('[data-case-version="2"]').waitFor();
  assert.equal(requests.length, 2); assert.equal(await execute.isDisabled(), true); assert.equal(await approve.isDisabled(), true);
  assert.equal(f.calls.some(call => call.path.endsWith('/execute') || call.path.endsWith('/refund-review') || call.body?.action === 'approve'), false);
  assert.equal(f.state.cases[0].executedAt, null); assert.deepEqual(f.errors, []);
});
