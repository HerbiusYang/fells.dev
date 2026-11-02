import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';

// Test-only orchestration. Sales and receipts use production HTTP handlers;
// historical purchases are explicitly identified Store/ledger fixtures.
export async function readBusinessFixture() {
  const path = process.env.FELLS_BUSINESS_FIXTURE_FILE ?? process.env.FELLS_LIFECYCLE_FIXTURE;
  assert.ok(path, 'An explicit isolated business fixture manifest is required');
  const fixture = JSON.parse(await readFile(path, 'utf8'));
  const provider = fixture.businessProvider;
  assert.equal(provider?.schemaVersion, 1);
  assert.equal(provider.synthetic, true);
  assert.equal(provider.realProviderCallsAllowed, false);
  const { inputTokens, outputTokens } = provider.usage;
  const { inputMicroPerMillion, outputMicroPerMillion } = provider.price;
  for (const value of [inputTokens, outputTokens, inputMicroPerMillion, outputMicroPerMillion]) assert.ok(Number.isSafeInteger(value) && value >= 0);
  const charge = Math.ceil((inputTokens * inputMicroPerMillion + outputTokens * outputMicroPerMillion) / 1_000_000);
  assert.equal(charge, 2, 'These business cases require the independently seeded two-micro workload');
  assert.equal(provider.expectedChargeMicroPerCall, charge);
  return fixture;
}

export async function acceptBusinessAgreement(page, bootstrap) {
  const before = await bootstrap();
  if (before.agreement.accepted) return;
  const form = page.locator('[data-form=agreement]');
  await form.waitFor({ state: 'visible' });
  await form.locator('[name=consent]').check();
  const pending = page.waitForResponse(response => new URL(response.url()).pathname === '/api/app/agreement/accept' && response.request().method() === 'POST');
  await form.locator('button').click();
  const response = await pending; assert.equal(response.status(), 200);
  assert.equal((await response.json()).ok, true);
  await form.waitFor({ state: 'detached' });
  assert.equal((await bootstrap()).agreement.accepted, true);
}

export function supportBusinessLive({ customer, operator, bootstrap, conversationId, foreign, trace = [] }) {
  const pathFor = id => `/api/support/orders/${id}`;
  const funds = snapshot => ({ cash: snapshot.wallet.cash_micro, allowance: snapshot.api_allowance.balance.micro });
  const unchanged = async (before, reason) => assert.deepEqual(funds(await bootstrap()), funds(before), reason);

  async function collect(amountMicro) {
    assert.ok(Number.isSafeInteger(amountMicro) && amountMicro > 0);
    const path = `/api/support/conversations/${conversationId}/topups`;
    const body = { operationId: randomUUID(), amountMicro, receiptRef: `SYNTHETIC-business-bank-${randomUUID()}`, memo: 'SYNTHETIC original bank collection verified in the disposable fixture; no external payment' };
    const before = await bootstrap();
    const payment = await operator(path, 'POST', body);
    assert.match(String(payment.topupId), /^[1-9]\d*$/);
    const after = await bootstrap();
    assert.equal(after.wallet.cash_micro, before.wallet.cash_micro + amountMicro);
    assert.equal(after.api_allowance.balance.micro, before.api_allowance.balance.micro);
    assert.equal(after.user.self_keys, before.user.self_keys, 'Collection alone does not grant key permissions');
    const replay = await operator(path, 'POST', body);
    assert.equal(replay.topupId, payment.topupId);
    await unchanged(after, 'Exact collection UUID replay cannot credit cash twice');
    await customer(path, 'POST', { ...body, operationId: randomUUID() }, 403);
    trace.push({ kind: 'verified-collection', topupId: payment.topupId, amountMicro, before: funds(before), after: funds(after), exactReplay: true });
    return { payment, body, before, after };
  }

  async function sale({ product, amountMicro, poolId = null, tier = 0, months = 0, evidenceMessageId, title = `SYNTHETIC manual ${product}` }) {
    if (product === 'subscription') assert.ok(Number.isSafeInteger(months) && months >= 1 && months <= 12);
    // The request must pass the initial order guard before the server freezes
    // its catalog quote. Subscription terms use thirty days per month.
    const serviceDays = product === 'subscription' ? 30 * months : 0;
    const create = { clientOrderId: randomUUID(), title, product, amountMicro, serviceDays, note: 'SYNTHETIC current staff sale; customer consent precedes verified collection and activation', dueAt: null, poolId, tier, months, planCode: '' };
    let order = await operator(`/api/support/conversations/${conversationId}/orders`, 'POST', create);
    assert.equal(order.source, 'support');
    assert.equal(order.product, product);
    assert.equal(order.amountMicro, amountMicro, 'The server freezes the real catalog CNY price');
    assert.equal(order.purchaseConfirmation?.state, 'required');
    assert.equal(order.fulfilled, false); assert.equal(order.accepted, false);
    order = await operator(pathFor(order.id), 'PATCH', { version: order.version, status: 'awaiting_payment' });
    const consent = { version: order.version, operationId: randomUUID(), quoteHash: order.purchaseConfirmation.quoteHash, maxChargeMicro: order.amountMicro };
    const beforeConsent = await bootstrap();
    if (foreign) await foreign(`${pathFor(order.id)}/confirm-purchase`, 'POST', { ...consent, operationId: randomUUID() }, 404);
    await operator(`${pathFor(order.id)}/confirm-purchase`, 'POST', consent, 403);
    order = await customer(`${pathFor(order.id)}/confirm-purchase`, 'POST', consent);
    assert.equal(order.purchaseConfirmation?.state, 'confirmed');
    assert.equal(order.fulfilled, false); assert.equal(order.accepted, false);
    await unchanged(beforeConsent, 'Quote consent must not debit cash, convert USD or deliver an entitlement');
    await customer(`${pathFor(order.id)}/confirm-purchase`, 'POST', consent);
    await unchanged(beforeConsent, 'Exact consent UUID replay cannot spend money');
    const funding = await collect(order.amountMicro);
    order = await operator(pathFor(order.id), 'PATCH', { version: order.version, status: 'awaiting_fulfillment', paymentTopupId: Number(funding.payment.topupId) });
    await operator(`${pathFor(order.id)}/fulfill`, 'POST', { version: order.version, operationId: randomUUID(), enableApiKeys: true }, 400);
    let activation = await operator(`${pathFor(order.id)}/cases`, 'POST', { clientCaseId: randomUUID(), caseType: 'activation', reason: 'Deliver the exact customer-confirmed quotation', evidenceNote: 'Original synthetic verified collection and customer evidence are linked', evidenceMessageId, requestedAllowanceMicro: 0, requestedHours: 0, requestedPlanPeriods: 0, refundMicro: 0, enableApiKeys: true, assigneeId: '', dueAt: null });
    const executeBody = { version: activation.version };
    await customer(`/api/support/cases/${activation.id}/execute`, 'POST', executeBody, 403);
    const beforeExecution = await bootstrap();
    activation = await operator(`/api/support/cases/${activation.id}/execute`, 'POST', executeBody);
    assert.equal(activation.status, 'executed'); assert.ok(activation.receipt?.actionRef);
    const afterExecution = await bootstrap();
    assert.equal(afterExecution.wallet.cash_micro, beforeExecution.wallet.cash_micro - order.amountMicro, 'Only real activation spends the frozen CNY amount');
    const allowanceMicro = product === 'allowance' ? order.allowanceUsdMicro : 0;
    assert.ok(Number.isSafeInteger(allowanceMicro) && allowanceMicro >= 0);
    assert.equal(afterExecution.api_allowance.balance.micro, beforeExecution.api_allowance.balance.micro + allowanceMicro, 'Subscription activation adds zero independent USD allowance');
    assert.equal(activation.receipt.before.balanceMicro - activation.receipt.after.balanceMicro, order.amountMicro);
    const replay = await operator(`/api/support/cases/${activation.id}/execute`, 'POST', executeBody);
    assert.deepEqual(replay.receipt, activation.receipt); assert.equal(replay.version, activation.version); assert.equal(replay.history.length, activation.history.length);
    await unchanged(afterExecution, 'Activation UUID/version replay cannot debit CNY or deliver USD twice');
    order = await customer(pathFor(order.id));
    assert.equal(order.fulfilled, true); assert.equal(order.accepted, false);
    trace.push({ kind: 'current-support-sale', orderId: order.id, activationId: activation.id, amountMicro: order.amountMicro, allowanceMicro, beforeConsent: funds(beforeConsent), beforeExecution: funds(beforeExecution), afterExecution: funds(afterExecution), consentMovedMoney: false, exactReplay: true });
    return { order, activation, consent, executeBody, funding, beforeConsent, beforeExecution, afterExecution };
  }

  async function historical(fixture, replayRequest) {
    assert.equal(fixture.history?.schemaVersion, 1); assert.equal(fixture.history.fixtureOnly, true);
    assert.equal(fixture.history.source, 'pre-cutover-self-service');
    const purchase = fixture.history.allowance;
    assert.equal(purchase.fixtureOnly, true); assert.equal(purchase.source, 'pre-cutover-self-service');
    assert.equal(purchase.httpResponseCaptured, false);
    assert.equal(purchase.receiptKind, 'store-reconciled-committed-ledger');
    assert.equal(purchase.route, '/api/app/allowance/buy');
    assert.match(purchase.quote.id, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
    assert.equal(purchase.quote.source, 'ECB'); assert.equal(purchase.quote.fee_bp, 10);
    assert.equal(purchase.request.quote_id, purchase.quote.id); assert.equal(purchase.request.cash_micro, purchase.quote.cash_micro);
    assert.deepEqual(JSON.parse(purchase.requestCanonical), purchase.request);
    assert.equal(createHash('sha256').update(purchase.requestCanonical).digest('hex'), purchase.requestSha256);
    assert.equal(purchase.storeResult.exchange.id, purchase.quote.id); assert.equal(purchase.storeResult.exchange.usd_micro, purchase.quote.usd_micro);
    assert.equal(purchase.storeResult.self_keys_enabled, true); assert.equal(purchase.after.selfKeys, true);
    assert.equal(purchase.quote.cash_micro, purchase.cashDebitedMicro);
    assert.equal(purchase.quote.usd_micro, purchase.allowanceGrantedMicro);
    assert.equal(purchase.before.cashMicro - purchase.after.cashMicro, purchase.cashDebitedMicro);
    assert.equal(purchase.after.allowanceMicro - purchase.before.allowanceMicro, purchase.allowanceGrantedMicro);
    assert.ok(purchase.ledgerRef && Number.isSafeInteger(purchase.ledgerId) && purchase.ledgerId > 0);
    const before = await bootstrap();
    const replay = await replayRequest(purchase);
    assert.equal(replay.status(), 200);
    assert.equal(replay.headers()['idempotency-replayed'], 'true');
    assert.equal(replay.headers()['x-fells-operation-id'], purchase.operationId);
    assert.deepEqual(await replay.json(), purchase.receiptBody, 'Only the immutable reconciled historical receipt is replayed');
    const receiptPath = `/api/app/purchase-operations/${purchase.operationId}`;
    // These endpoints return the customer projection directly, not support.data.
    const receipt = await customer(receiptPath);
    assert.equal(receipt.operation_id, purchase.operationId); assert.equal(receipt.status, 'completed');
    assert.equal(receipt.poll_only, true); assert.equal(receipt.body_available, true); assert.equal(receipt.body_complete, true);
    assert.deepEqual(receipt.body, purchase.request);
    assert.equal(receipt.evidence.cash_micro, purchase.cashDebitedMicro); assert.equal(receipt.evidence.allowance_micro, purchase.allowanceGrantedMicro);
    if (foreign) await foreign(receiptPath, 'GET', undefined, 404);
    const acknowledged = await customer(`${receiptPath}/acknowledge`, 'POST', {});
    assert.equal(acknowledged.acknowledged, true); assert.equal(acknowledged.status, 'completed');
    await unchanged(before, 'Historical HTTP replay/read/ack must not buy again or move funds');
    const order = await customer(pathFor(purchase.orderId));
    assert.equal(order.source, 'self_service'); assert.equal(order.product, 'allowance'); assert.equal(order.fulfilled, true);
    assert.equal(order.status, 'completed');
    assert.equal(order.amountMicro, purchase.cashDebitedMicro); assert.equal(order.allowanceUsdMicro, purchase.allowanceGrantedMicro);
    trace.push({ kind: 'historical-self-service-replay', orderId: order.id, operationId: purchase.operationId, fixtureOnly: true, httpResponseCaptured: false, fundsUnchanged: true });
    return order;
  }

  // Existing UI assertions remain in each suite; this helper never fabricates
  // or intercepts a successful reply.
  return { collect, sale, historical, trace };
}
