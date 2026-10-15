// Regression coverage for the 2026-10-15 case review. Run only on the dedicated test VPS.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { supportBrowser, supportFixture, refresh } from './helpers/support-http-fixture.mjs';
let environment;
test.before(async () => { environment = await supportBrowser(); });
test.after(async () => { await environment?.close(); });
const orderId = '00000000-0000-4000-8000-000000000090';
const caseId = '20000000-0000-4000-8000-000000000091';
const at = '2026-10-13T00:00:00Z';
function seed(f) {
  f.state.orders = [{ id: orderId, conversationId: '21', userId: '42', title: 'Original completed purchase', product: 'allowance', amountMicro: 20000000, currency: 'CNY', serviceDays: 0, status: 'completed', assigneeId: '84', assigneeName: 'Support operator', note: 'Original verified purchase', dueAt: null, paymentTopupId: 101, subscriptionId: null, subscriptionRef: '', allowanceRef: 'allow-original', version: 3, createdAt: at, updatedAt: at, accepted: true, acceptedAt: at, fulfilled: true, fulfilledAt: at, enableApiKeys: false, poolId: null, tier: 0, months: 0, allowanceUsdMicro: 10000000, history: [] }];
  f.state.messages = [{ id: '31', conversationId: '21', clientMessageId: crypto.randomUUID(), sender: 'user', text: 'Reported service interruption', attachments: [], createdAt: at }];
  f.state.cases = [{ id: caseId, orderId, conversationId: '21', userId: '42', caseType: 'compensation', status: 'open', reason: 'Unresolved compensation', evidenceMessageId: '31', evidenceAttachmentId: null, evidenceNote: 'Actual conversation report', requestedAllowanceMicro: 1000000, requestedHours: 0, requestedPlanPeriods: 0, refundMicro: 0, enableApiKeys: false, assigneeId: '84', assigneeName: 'Support operator', dueAt: null, note: '', refundProof: '', refundProofMessageId: null, refundProofAttachmentId: null, receipt: null, version: 1, createdAt: at, updatedAt: at, executedAt: null, closedAt: null, history: [] }];
}
async function openCase(desk) {
  await desk.locator('[data-support-details]').click();
  await desk.locator(`[data-order-edit="${orderId}"]`).click();
  await desk.locator(`[data-case-edit="${caseId}"]`).click();
  await desk.locator('[data-case-form]').waitFor();
}
async function captureEvidence(page, name, selector) {
  const directory = process.env.CASE_FIXES_EVIDENCE_DIR;
  if (directory) await mkdir(directory, { recursive: true }); const viewport = page.viewportSize();
  for (const [surface, size] of [['desktop', {width: 1440, height: 1000}], ['mobile', {width: 390, height: 844}]]) {
    await page.setViewportSize(size); await page.locator(selector).scrollIntoViewIfNeeded();
    if (surface === 'mobile') {
      const overflow = await page.evaluate(() => {
        const panel = document.querySelector('[data-support-detail-panel]'), section = panel.querySelector('.support-orders');
        const panelRect = panel.getBoundingClientRect(), panelStyle = getComputedStyle(panel), sectionRect = section.getBoundingClientRect(), sectionStyle = getComputedStyle(section);
        const left = Math.max(panelRect.left + parseFloat(panelStyle.borderLeftWidth) + parseFloat(panelStyle.paddingLeft), sectionRect.left + parseFloat(sectionStyle.borderLeftWidth) + parseFloat(sectionStyle.paddingLeft));
        const right = Math.min(panelRect.right - parseFloat(panelStyle.borderRightWidth) - parseFloat(panelStyle.paddingRight), sectionRect.right - parseFloat(sectionStyle.borderRightWidth) - parseFloat(sectionStyle.paddingRight));
        return [...section.querySelectorAll('[data-case-form] input,[data-case-form] select,[data-case-form] textarea')].filter(control => control.getClientRects().length).flatMap(control => {
          const rect = control.getBoundingClientRect();
          return rect.left < left - 1 || rect.right > right + 1 ? [{name: control.name, left: rect.left, right: rect.right, contentLeft: left, contentRight: right}] : [];
        });
      });
      assert.deepEqual(overflow, [], `${name}: mobile case controls preserve the detail panel's horizontal padding`);
    }
    if (directory) await page.screenshot({ path: resolve(directory, `case-${name}-${surface}.png`) });
  }
  if (viewport) await page.setViewportSize(viewport);
}
test('dirty drafts retain their opening version and send only edited fields after concurrent refresh', async t => {
  const f = await supportFixture(t, environment); seed(f);
  const desk = await f.operatorPage(''); await openCase(desk);
  const form = desk.locator('[data-case-form]');
  await form.locator('[name=note]').fill('Only updating my note');
  Object.assign(f.state.cases[0], { version: 2, status: 'needs_review', note: 'Another operator escalated this case', assigneeId: '85', dueAt: '2026-12-10T12:34:56Z' });
  await refresh(desk);
  await desk.locator(`[data-case-id="${caseId}"] strong`).filter({ hasText: 'Needs review' }).waitFor();
  await desk.locator('[data-case-conflict]').filter({ hasText: 'changed while you were editing' }).waitFor();
  await captureEvidence(desk, 'draft-conflict', '[data-case-conflict]');
  const saved = desk.waitForResponse(r => r.request().method() === 'PATCH' && new URL(r.url()).pathname.endsWith('/cases/' + caseId));
  await form.locator('[type=submit]').click(); assert.equal((await saved).status(), 409);
  const call = f.calls.filter(c => c.method === 'PATCH' && c.path.endsWith('/cases/' + caseId)).at(-1);
  assert.deepEqual(call.body, { version: 1, note: 'Only updating my note' });
  assert.equal(f.state.cases[0].status, 'needs_review'); assert.equal(f.state.cases[0].note, 'Another operator escalated this case');
  assert.equal(await form.locator('[name=note]').inputValue(), 'Only updating my note');
  await desk.locator('[data-case-reload]').click();
  await desk.waitForFunction(() => document.querySelector('[data-case-form] [name=status]')?.value === 'needs_review');
  assert.equal(await form.locator('[name=note]').inputValue(), 'Another operator escalated this case');
  assert.deepEqual(f.errors, []);
});
test('note-only edits preserve historical assignee and due timestamp precision', async t => {
  const f = await supportFixture(t, environment); seed(f);
  Object.assign(f.state.cases[0], { assigneeId: '85', assigneeName: 'Former operator', dueAt: '2026-12-10T12:34:56Z' });
  const desk = await f.operatorPage(''); await openCase(desk);
  const form = desk.locator('[data-case-form]'); assert.equal(await form.locator('[name=assigneeId]').inputValue(), '85');
  await form.locator('[name=note]').fill('Reviewed the existing record');
  const saved = desk.waitForResponse(r => r.request().method() === 'PATCH' && new URL(r.url()).pathname.endsWith('/cases/' + caseId));
  await form.locator('[type=submit]').click(); assert.equal((await saved).status(), 200);
  assert.deepEqual(f.calls.filter(c => c.method === 'PATCH' && c.path.endsWith('/cases/' + caseId)).at(-1).body, { version: 1, note: 'Reviewed the existing record' });
  assert.equal(f.state.cases[0].dueAt, '2026-12-10T12:34:56Z'); assert.equal(f.state.cases[0].assigneeId, '85'); assert.deepEqual(f.errors, []);
});
test('execution of a dirty stale draft cannot use the latest case version', async t => {
  const f = await supportFixture(t, environment); seed(f); f.state.operatorRole = 'owner';
  const desk = await f.operatorPage(''); await openCase(desk);
  await desk.locator('[data-case-form] [name=note]').fill('Unsaved original draft');
  Object.assign(f.state.cases[0], { version: 2, status: 'needs_review' }); await refresh(desk);
  await desk.locator('[data-case-conflict]').filter({ hasText: 'changed while you were editing' }).waitFor();
  const executed = desk.waitForResponse(r => new URL(r.url()).pathname.endsWith('/cases/' + caseId + '/execute'));
  await desk.locator(`[data-case-execute="${caseId}"]`).click(); assert.equal((await executed).status(), 409);
  assert.equal(f.calls.filter(c => c.path.endsWith('/execute')).at(-1).body.version, 1); assert.equal(f.state.cases[0].receipt, null); assert.deepEqual(f.errors, []);
});
test('active queue opens the original order and case by ID beyond both first history pages', async t => {
  const f = await supportFixture(t, environment); seed(f);
  const original = f.state.orders[0], originalCase = f.state.cases[0];
  f.state.orders.unshift(...Array.from({ length: 100 }, (_, i) => ({ ...original, id: '00000000-0000-4000-8000-' + String(1000 + i).padStart(12, '0'), title: 'Newer completed purchase ' + i })));
  f.state.cases.unshift(...Array.from({ length: 100 }, (_, i) => ({ ...originalCase, id: '20000000-0000-4000-8000-' + String(1000 + i).padStart(12, '0'), createdAt: '2026-10-14T00:00:00Z' })));
  const desk = await f.operatorPage(''); await desk.locator('[data-orders-queue]').click(); await desk.locator('[data-work-cases]').click();
  await desk.locator('[data-work-case-more]').click(); await desk.locator(`[data-queue-case="${caseId}"]`).click();
  await desk.locator('[data-order-editor] h4').filter({ hasText: orderId }).waitFor();
  await desk.locator('[data-case-form] h4').filter({ hasText: caseId }).waitFor();
  assert.equal(await desk.locator('[data-support-cases=operator]').isVisible(), true);
  assert.ok(f.calls.some(c => c.method === 'GET' && c.path === '/api/support/orders/' + orderId));
  assert.ok(f.calls.some(c => c.method === 'GET' && c.path === '/api/support/cases/' + caseId)); assert.deepEqual(f.errors, []);
});
test('operator and customer can load the 101st active case and retain it through refresh and acceptance', async t => {
  const f = await supportFixture(t, environment); seed(f); f.state.operatorRole = 'owner';
  const original = f.state.cases[0];
  f.state.cases.unshift(...Array.from({ length: 100 }, (_, i) => ({ ...original, id: '20000000-0000-4000-8000-' + String(1000 + i).padStart(12, '0'), createdAt: '2026-10-14T00:00:00Z', reason: 'Newer active case ' + i })));
  const desk = await f.operatorPage(''); await desk.locator('[data-support-details]').click(); await desk.locator(`[data-order-edit="${orderId}"]`).click();
  await desk.locator('[data-case-more]').waitFor(); await captureEvidence(desk, 'load-more', '[data-case-more]'); assert.equal(await desk.locator(`[data-case-id="${caseId}"]`).count(), 0);
  await desk.locator('[data-case-more]').click(); await desk.locator(`[data-case-edit="${caseId}"]`).click();
  await desk.locator(`[data-case-execute="${caseId}"]`).click(); await desk.locator('.support-case-table').waitFor();
  assert.equal(await desk.locator('[data-case-id]').count(), 101);
  const user = await f.customerPage(''); await user.locator('[data-customer-orders] > summary').click();
  await user.locator('[data-case-more]').click(); await user.locator(`[data-case-accept="${caseId}"]`).click();
  await user.locator(`[data-case-id="${caseId}"] strong`).filter({ hasText: 'Closed' }).waitFor();
  assert.equal(await user.locator('[data-case-id]').count(), 101); assert.equal(f.state.cases.find(item => item.id === caseId).status, 'closed');
  assert.ok(f.calls.some(c => c.query?.cursor)); assert.deepEqual(f.errors, []);
});
test('reopening an uncertain creation restores and locks the exact intent before retrying it', async t => {
  const f = await supportFixture(t, environment); seed(f); f.state.cases = [];
  let initialPayload;
  await f.context.route('**/api/support/orders/*/cases', async route => {
    if (route.request().method() === 'POST' && !initialPayload) {
      initialPayload = route.request().postDataJSON();
      await route.fulfill({ status: 503, json: { ok: false, error: { code: 'internal_error', message: 'Uncertain create response' }, requestId: 'regression' } });
    } else await route.fallback();
  });
  const desk = await f.operatorPage(''); await desk.locator('[data-support-details]').click(); await desk.locator(`[data-order-edit="${orderId}"]`).click(); await desk.locator('[data-case-new]').click();
  const form = desk.locator('[data-case-form]'); await form.locator('[name=caseType]').selectOption('compensation'); await form.locator('[name=reason]').fill('First attempted compensation'); await form.locator('[name=evidenceNote]').fill('Verified interruption'); await form.locator('[name=evidenceMessageId]').selectOption('31'); await form.locator('[name=requestedAllowance]').fill('1');
  await form.locator('[type=submit]').click(); await desk.locator('[data-case-error]').filter({ hasText: 'Uncertain create response' }).waitFor(); await form.locator('[name=caseType]:disabled').waitFor();
  await desk.locator('[data-case-new]').click(); assert.equal(await form.locator('[name=caseType]').isDisabled(), true); assert.equal(await form.locator('[name=requestedAllowance]').getAttribute('readonly'), '');
  assert.equal(await form.locator('[name=requestedAllowance]').inputValue(), '1'); assert.equal(await form.locator('[name=reason]').inputValue(), 'First attempted compensation');
  await form.locator('[data-case-hint]').filter({ hasText: 'result is uncertain' }).waitFor();
  await captureEvidence(desk, 'retry-locked', '[data-case-hint]');
  const saved = desk.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/cases'));
  await form.locator('[type=submit]').click(); assert.equal((await saved).status(), 200);
  assert.deepEqual(f.calls.filter(c => c.method === 'POST' && c.path.endsWith('/cases')).at(-1).body, initialPayload); assert.equal(f.state.cases.length, 1); assert.deepEqual(f.errors, []);
});
