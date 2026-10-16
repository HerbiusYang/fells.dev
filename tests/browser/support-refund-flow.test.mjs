import test from 'node:test';
import assert from 'node:assert/strict';
import { supportBrowser, supportFixture, refresh } from './helpers/support-http-fixture.mjs';

let environment;
test.before(async () => { environment = await supportBrowser(); });
test.after(async () => { await environment?.close(); });
const at = '2026-10-15T00:00:00Z';
const orderId = '00000000-0000-4000-8000-000000000090';
const refundId = '20000000-0000-4000-8000-000000000091';
const subscriptionOrderId = '00000000-0000-4000-8000-000000000092';
const activationId = '20000000-0000-4000-8000-000000000093';

function seed(f) {
  const order = { id: orderId, conversationId: '21', userId: '42', title: 'Original paid allowance', product: 'allowance', amountMicro: 20000000, currency: 'CNY', serviceDays: 0, status: 'completed', assigneeId: '84', assigneeName: 'Support operator', note: 'Original verified payment', dueAt: null, paymentTopupId: 101, subscriptionId: null, subscriptionRef: '', allowanceRef: 'original-paid-allowance', version: 3, createdAt: at, updatedAt: at, accepted: true, acceptedAt: at, fulfilled: true, fulfilledAt: at, enableApiKeys: false, poolId: null, tier: 0, months: 0, allowanceUsdMicro: 10000000, history: [], waitingOn: 'none', acceptanceKind: 'customer' };
  f.state.orders = [order, { ...order, id: subscriptionOrderId, title: 'Original new subscription with confirmation gift', product: 'subscription', amountMicro: 120000000, serviceDays: 30, paymentTopupId: 102, subscriptionId: 501, subscriptionRef: 'original-new-subscription', allowanceRef: '', allowanceUsdMicro: 0, poolId: 11, tier: 1, months: 1, rewardStatus: 'awarded', rewardAllowanceMicro: 1230000 }];
  f.state.messages = [{ id: '31', conversationId: '21', clientMessageId: crypto.randomUUID(), sender: 'user', text: 'Please correct this original delivery and review the unused gift', attachments: [], createdAt: at }, { id: '32', conversationId: '21', clientMessageId: crypto.randomUUID(), sender: 'agent', text: 'Original channel independently confirmed that transfer failed', attachments: [], createdAt: at }];
  const base = { orderId, conversationId: '21', userId: '42', caseType: 'refund', status: 'open', reason: 'Partial original purchase refund', evidenceMessageId: '31', evidenceAttachmentId: null, evidenceNote: 'Original conversation and payment evidence', requestedAllowanceMicro: 0, requestedHours: 0, requestedPlanPeriods: 0, refundMicro: 1000000, enableApiKeys: false, assigneeId: '84', assigneeName: 'Support operator', dueAt: null, note: '', refundProof: '', refundProofMessageId: null, refundProofAttachmentId: null, receipt: null, version: 1, createdAt: at, updatedAt: at, executedAt: null, closedAt: null, history: [], waitingOn: 'team', acceptanceKind: '', acceptanceDeadline: null };
  const snapshot = { balanceMicro: 12000000, grantMicro: 0, allowanceMicro: 0, allowanceGrantMicro: 0, selfKeys: true, rideMode: 'monthly', allowanceExpiresAt: 1900000000, subscriptionExpiresAt: 1900000000 };
  f.state.cases = [{ ...base, id: refundId }, { ...base, id: activationId, orderId: subscriptionOrderId, caseType: 'activation', status: 'closed', reason: 'Correct the original new subscription', refundMicro: 0, executedAt: at, closedAt: at, waitingOn: 'none', acceptanceKind: 'customer', rewardStatus: 'awarded', rewardAllowanceMicro: 1230000, receipt: { actionRef: 'support-case:' + activationId, ledgerRef: 'original-new-subscription', allowanceMicro: 0, subscriptionHours: 0, subscriptionId: 501, cashRefundMicro: 0, before: snapshot, after: snapshot } }];
}
async function openCase(desk, order, item) {
  await desk.locator(`[data-order-edit="${order}"]`).click();
  await desk.locator(`[data-case-edit="${item}"]`).click();
  await desk.locator('[data-case-form]').waitFor();
}
async function submit(desk, form, suffix, button = '[type=submit]') {
  const reply = desk.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith(suffix));
  await form.locator(button).click();
  const response = await reply;
  return { status: response.status(), body: await response.json() };
}
function lastPost(f, suffix) { return f.calls.filter(call => call.method === 'POST' && call.path.endsWith(suffix)).at(-1); }

test('refund UI preserves independent approval, failed-channel correction and explicit reward-loss authority', async t => {
  const f = await supportFixture(t, environment); seed(f);
  const desk = await f.operatorPage();
  await desk.locator('[data-support-details]').click();
  await openCase(desk, orderId, refundId);
  let plan = desk.locator('[data-refund-action=plan]');
  await plan.locator('[name=mode]').selectOption('remaining');
  await plan.locator('[name=reason]').fill('Recover only original unused rights and disclose consumed service');
  let result = await submit(desk, plan, '/refund-plan', '[value=propose]');
  assert.equal(result.status, 200);
  assert.deepEqual(lastPost(f, '/refund-plan').body, { version: 1, action: 'propose', mode: 'remaining', reason: 'Recover only original unused rights and disclose consumed service' });
  assert.equal(await desk.locator('[data-refund-action=plan] [value=approve]').isDisabled(), true, 'a proposer cannot approve their own plan');
  assert.equal(await desk.locator('[data-case-execute]').isDisabled(), true, 'delivered rights cannot execute without approval');

  // The fixture has one logged-in operator identity. Model a separate
  // operator's refreshed proposal, then verify this identity still needs Owner.
  f.state.cases[0].refund.plan.proposedBy = '82'; f.state.cases[0].version++;
  await refresh(desk);
  await desk.locator('[data-refund-action=plan] [value=approve]:enabled').waitFor();
  result = await submit(desk, desk.locator('[data-refund-action=plan]'), '/refund-plan', '[value=approve]');
  assert.equal(result.status, 403);
  assert.equal(f.state.cases[0].refund.plan.approvedAt, null);
  f.state.operatorRole = 'owner';
  result = await submit(desk, desk.locator('[data-refund-action=plan]'), '/refund-plan', '[value=approve]');
  assert.equal(result.status, 200);
  assert.equal(lastPost(f, '/refund-plan').body.action, 'approve');
  const executed = desk.waitForResponse(response => new URL(response.url()).pathname.endsWith('/execute'));
  await desk.locator(`[data-case-execute="${refundId}"]:enabled`).click();
  assert.equal((await executed).status(), 200);

  let channel = desk.locator('[data-refund-action=channel]');
  await channel.locator('..').locator('summary').click();
  await channel.locator('[name=stage]').selectOption('unknown');
  await channel.locator('[name=provider]').fill('Original bank');
  await channel.locator('[name=account]').fill('Original customer recipient');
  await channel.locator('[name=refundId]').fill('ORIGINAL-TRANSFER-91');
  await channel.locator('[name=refundChannelMessageId]').selectOption('31');
  await channel.locator('[name=note]').fill('Channel outcome is unknown; do not pretend payment succeeded');
  const unknownVersion = f.state.cases[0].version;
  result = await submit(desk, channel, '/refund-channel'); assert.equal(result.status, 200);
  let posted = lastPost(f, '/refund-channel');
  assert.equal(posted.body.version, unknownVersion); assert.equal(posted.body.amountMicro, 1000000); assert.equal(posted.body.currency, 'CNY'); assert.equal(posted.body.proofMessageId, '31'); assert.equal(posted.body.proofAttachmentId, null); assert.equal(posted.body.stage, 'unknown');
  assert.equal(await desk.locator('[data-refund-action=review] [type=submit]').isDisabled(), true, 'executor/recorder cannot review their own payout claim');
  assert.equal(await desk.locator('[data-refund-action=reverse] [type=submit]').isDisabled(), true, 'unknown outcome cannot authorize a reversal');

  channel = desk.locator('[data-refund-action=channel]');
  await channel.locator('..').locator('summary').click();
  for (const name of ['provider', 'account', 'refundId']) assert.equal(await channel.locator(`[name=${name}]`).getAttribute('readonly'), '', 'channel identity remains frozen');
  await channel.locator('[name=stage]').selectOption('failed');
  await channel.locator('[name=refundChannelMessageId]').selectOption('32');
  await channel.locator('[name=note]').fill('Original channel has now definitively confirmed no money was paid');
  result = await submit(desk, channel, '/refund-channel'); assert.equal(result.status, 200);
  posted = lastPost(f, '/refund-channel'); assert.equal(posted.body.stage, 'failed'); assert.equal(posted.body.refundId, 'ORIGINAL-TRANSFER-91'); assert.equal(posted.body.proofMessageId, '32');
  assert.equal(f.state.cases[0].refund.stage, 'pending', 'a failed claim alone is still unreviewed');
  assert.equal(f.state.cases[0].status, 'executed');

  // A separate executor/recorder's evidence lets this operator independently
  // review the confirmed failure. The server then reverses it automatically.
  Object.assign(f.state.cases[0].refund, { executedBy: '82', recordedBy: '83' });
  await refresh(desk);
  const review = desk.locator('[data-refund-action=review]');
  await review.locator('[type=submit]:enabled').waitFor();
  await review.locator('[name=note]').fill('Independent original recipient, exact amount and failed channel reconciled');
  result = await submit(desk, review, '/refund-review'); assert.equal(result.status, 200);
  await desk.locator('[data-case-form] [name=status]').waitFor();
  assert.equal(f.state.cases[0].status, 'reversed');
  assert.ok(f.state.cases[0].reversalRef);
  await desk.locator('[data-reversal-link]').waitFor();
  assert.equal(await desk.locator('[data-refund-action],[data-case-execute]').count(), 0);
  assert.equal(await desk.locator('[data-case-form] [type=submit]').isDisabled(), true);

  // A new-package correction is the separate explicit reverse operation. A
  // spent confirmation gift can only be acknowledged through its own checkbox.
  await openCase(desk, subscriptionOrderId, activationId);
  let reverse = desk.locator('[data-refund-action=reverse]');
  await reverse.locator('..').locator('summary').click();
  await reverse.locator('[name=reason]').fill('Correct original delivery; unused gift is recovered and used gift is an explicit loss');
  await reverse.locator('[name=reverseMessageId]').selectOption('31');
  f.state.operatorRole = 'ops';
  result = await submit(desk, reverse, '/reverse'); assert.equal(result.status, 403);
  assert.equal(lastPost(f, '/reverse').body.acceptRewardLoss, false);
  assert.equal(f.state.cases[1].status, 'closed', 'an unauthorized inverse cannot alter the receipt');
  f.state.operatorRole = 'owner';
  reverse = desk.locator('[data-refund-action=reverse]');
  await reverse.locator('[name=acceptRewardLoss]').check();
  result = await submit(desk, reverse, '/reverse'); assert.equal(result.status, 200);
  const approved = lastPost(f, '/reverse');
  assert.equal(approved.body.acceptRewardLoss, true); assert.equal(approved.body.evidenceMessageId, '31'); assert.equal(approved.body.evidenceAttachmentId, null);
  assert.equal(approved.headers['x-fells-support-audience'], 'operator'); assert.equal(approved.headers['x-fells-expected-operator'], '84');
  assert.equal(f.state.cases[1].status, 'reversed'); assert.equal(f.state.cases[1].rewardAllowanceMicro, 1230000, 'reversal retains gross historical gift facts');
  await desk.locator('[data-reversal-link]').waitFor(); assert.equal(await desk.locator('[data-refund-action],[data-case-execute]').count(), 0);
  const customer = await f.customerPage(); await customer.locator('[data-customer-orders-open]').click();
  for (const id of [refundId, activationId]) { const card = customer.locator(`[data-case-id="${id}"]`); await card.locator('[data-reversal-link]').waitFor(); assert.equal(await card.locator('[data-case-accept],[data-case-dispute]').count(), 0); }
  assert.equal(f.calls.some(call => /\/send-money|\/transfer$/.test(call.path)), false);
  assert.deepEqual(f.errors, []);
});
