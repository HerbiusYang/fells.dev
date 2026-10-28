import { prepareSupportOperator } from './helpers/support-live-session.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';

// Real API/DB integration only. No successful replies or payment records are
// mocked. Seed disposable customers and APPROVED topups in the isolated DB.
// Customer USD conversion uses a real server quote and buy transaction. Support
// records consultation and after-sales work; the customer buys the package.
// This suite never approves a payment or transfers external cash.
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const synthetic = name => /^(?:business|synthetic|live|test|browser-test|support-browser)[-_.@]/i.test(name) || /@example\.invalid$/i.test(name);
const positive = (name, value) => { assert.match(value ?? '', /^[1-9]\d*$/, `${name} must identify a seeded disposable record`); assert.ok(Number.isSafeInteger(Number(value))); return String(value); };

test('isolated live cases: account activation, compensation and proven refund with replay, authority and isolation', async t => {
  if (process.env.FELLS_LIVE_TEST !== '1') { t.skip('Requires exact FELLS_LIVE_TEST=1 for the disposable loopback backend'); return; }
  const origin = new URL(process.env.FELLS_BROWSER_BASE ?? 'http://127.0.0.1:18087');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname), 'Only a loopback test backend is allowed');
  assert.equal(origin.username + origin.password + origin.search + origin.hash, '');
  assert.ok(origin.pathname === '/' && ['http:', 'https:'].includes(origin.protocol));
  const base = origin.origin, password = process.env.FELLS_LIVE_TEST_PASSWORD;
  assert.ok(password, 'Explicit disposable account password is required');
  const username = process.env.FELLS_TEST_USER ?? '', operator = process.env.FELLS_TEST_OPERATOR ?? '';
  const otherName = process.env.FELLS_TEST_OTHER_USER ?? '';
  for (const name of [username, operator, otherName]) assert.ok(synthetic(name), 'Only explicitly named synthetic accounts are allowed');
  assert.notEqual(username, otherName);
  const customerId = positive('FELLS_LIVE_CUSTOMER_ID', process.env.FELLS_LIVE_CUSTOMER_ID);
  const conversationId = positive('FELLS_LIVE_CONVERSATION_ID', process.env.FELLS_LIVE_CONVERSATION_ID);
  const topupId = positive('FELLS_LIVE_TOPUP_ID', process.env.FELLS_LIVE_TOPUP_ID);
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (!existsSync(chromium.executablePath()) && existsSync(chrome) ? chrome : undefined);
  const browser = await chromium.launch({ headless:true, ...(executablePath ? { executablePath } : {}) });
  t.after(() => browser.close());
  const customers = await browser.newContext({ viewport:{width:1440,height:1050} }), operators = await browser.newContext({ viewport:{width:1440,height:1050} }), others = await browser.newContext();
  const errors = [];
  for (const context of [customers, operators, others]) {
    await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    context.on('page', page => { page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message)); });
  }
  const user = await customers.newPage(), desk = await operators.newPage(), other = await others.newPage();
  async function loginCustomer(page, name) {
    await page.goto(base + '/zh/app/start/');
    await page.locator('#auth-email').fill(name); await page.locator('#auth-password').fill(password);
    await page.locator('[data-auth-form] [type=submit]').click();
    await page.waitForURL(url => /^\/zh\/app\/?$/.test(url.pathname));
    await page.waitForFunction(() => document.querySelector('#fx')?.getAttribute('aria-busy') !== 'true');
    const skip = page.locator('[data-act=ob-skip]'); if (await skip.isVisible()) await skip.click();
  }
  const raw = async (context, path, options = {}) => context.request.fetch(base + path, { ...options, headers:{Origin:base, ...options.headers} });
  const json = async (context, path, options = {}, status = 200) => {
    const response = await raw(context, path, options);
    assert.equal(response.status(), status, `${options.method ?? 'GET'} ${path}: ${await response.text()}`);
    return response.json();
  };
  const customerHeaders = bootstrap => ({ 'X-Fells-Support-Audience':'customer', 'X-Fells-Expected-User':String(bootstrap.user.id), 'X-Fells-Expected-Session':bootstrap.session_id });
  await loginCustomer(user, username);
  const initial = await json(customers, '/api/app/bootstrap');
  assert.equal(String(initial.user.id), customerId, 'UI is bound to the seeded customer');
  const customerIdentity = customerHeaders(initial);
  assert.equal(typeof initial.user.self_keys, 'boolean', 'Use the current seeded API key policy');
  const topups = await json(customers, '/api/app/topups', { headers:customerIdentity });
  const payment = topups.requests.find(item => String(item.id) === topupId);
  assert.ok(payment && payment.status === 'approved', 'Only a seeded real approved payment is linked');
  assert.equal(String(payment.user_id), customerId);
  await user.locator('[data-chat-support]:visible,[data-support-open]:visible').click();
  const ownConversation = await json(customers, '/api/support/conversations/current', { headers:customerIdentity });
  assert.equal(ownConversation.data.id, conversationId);
  await prepareSupportOperator(operators, {base, email:operator, password});
  await desk.goto(`${base}/zh/support/desk/`);
  await desk.locator(`[data-support-conversation="${conversationId}"]`).click();
  const agent = (await json(operators, '/api/support/session', { headers:{'X-Fells-Support-Audience':'operator'} })).data;
  const agentIdentity = { 'X-Fells-Support-Audience':'operator', 'X-Fells-Expected-Operator':agent.operator.id, 'X-Fells-Expected-Operator-Session':agent.sessionId };
  const catalog = (await json(operators, '/api/support/catalog', { headers:agentIdentity })).data;
  const monthlyPlan=catalog.subscriptions.find(plan=>plan.tier===1); assert.ok(monthlyPlan,'Seeded synthetic monthly plan is required');
  const amountMicro = monthlyPlan.monthlyMicro;
  assert.ok(Number.isSafeInteger(amountMicro) && payment.amount_micro - payment.discount_micro >= amountMicro);

  // A non-entitlement consultation order keeps the lost-create contract covered
  // without letting support sell a package or spend the customer's CNY.
  await desk.locator('[data-order-new]').click();
  const form = desk.locator('[data-order-form]'), title = `live-retry-${randomUUID()}`;
  await form.locator('[name=title]').fill(title); await form.locator('[name=product]').selectOption('other');
  await form.locator('[name=amount]').fill('2');
  await form.locator('[name=note]').fill('Disposable consultation: original CNY payment and customer refund question');
  async function saveOrder() {
    const reply = desk.waitForResponse(response => response.request().method() !== 'GET' && new URL(response.url()).pathname.includes('/api/support/') && /\/orders(?:\/[^/]+)?$/.test(new URL(response.url()).pathname));
    await form.locator('[type=submit]').click(); const response = await reply;
    assert.equal(response.status(), 200, `Real order write: ${await response.text()}`);
    const value = await response.json(); assert.equal(value.ok, true);
    await desk.waitForFunction(({id,version}) => { const editor=document.querySelector('[data-order-editor]'); return editor?.querySelector('h4')?.textContent?.includes(id) && editor.textContent.includes(`版本 ${version}`); }, {id:value.data.id,version:value.data.version});
    return value.data;
  }
  let order = await saveOrder(); assert.match(order.id, uuid); assert.equal(order.product, 'other'); assert.equal(order.amountMicro, 2_000_000); assert.equal(order.allowanceUsdMicro, 0);
  await form.locator('[name=status]').selectOption('awaiting_payment'); order = await saveOrder();
  await desk.waitForFunction(() => document.querySelector('[data-order-form] [name=status]')?.value === 'awaiting_payment');
  await form.locator('[name=paymentTopupId]').fill(topupId); await form.locator('[name=status]').selectOption('awaiting_fulfillment'); order = await saveOrder();
  const retryOrder=order;

  // A real customer message is the traceable basis for every after-sales case.
  const evidenceText = `SYNTHETIC support evidence ${randomUUID()}`;
  await user.locator('#support-widget [data-support-text]').fill(evidenceText);
  const evidenceResponse = user.waitForResponse(reply => new URL(reply.url()).pathname === `/api/support/conversations/${conversationId}/messages` && reply.request().method() === 'POST');
  await user.locator('#support-widget [data-support-send]').click();
  const evidenceId = (await (await evidenceResponse).json()).data.id;
  await desk.locator('[data-support-message]').filter({hasText:evidenceText}).waitFor();

  await desk.locator('[data-case-new]').waitFor();
  const caseForm = desk.locator('[data-case-form]');
  const caseRequests = [];
  desk.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === `/api/support/orders/${retryOrder.id}/cases`) caseRequests.push(request.postDataJSON()); });
  let droppedCase, dropCreateOnce=true;
  await desk.route(`**/api/support/orders/${retryOrder.id}/cases`, async route => {
    if (route.request().method() !== 'POST' || !dropCreateOnce) return route.continue();
    dropCreateOnce=false;
    const committed = await route.fetch(); assert.equal(committed.status(), 200);
    droppedCase = (await committed.json()).data;
    await route.fulfill({status:503,json:{ok:false,error:{code:'response_lost',message:'SYNTHETIC committed response lost'},requestId:randomUUID()}});
  });
  await desk.locator('[data-case-new]').click();
  await caseForm.locator('[name=caseType]').selectOption('refund');
  await caseForm.locator('[name=reason]').fill('Synthetic customer asked about the original payment');
  await caseForm.locator('[name=evidenceNote]').fill('Original approved payment; this draft performs no refund or entitlement delivery');
  await caseForm.locator('[name=evidenceMessageId]').selectOption(String(evidenceId));
  await caseForm.locator('[name=refundAmount]').fill('1');
  const lostCreateReply = desk.waitForResponse(reply => new URL(reply.url()).pathname === `/api/support/orders/${retryOrder.id}/cases` && reply.request().method() === 'POST' && reply.status() === 503);
  await caseForm.locator('[type=submit]').click();
  const lostCreate = await lostCreateReply;
  assert.equal((await lostCreate.json()).error.code, 'response_lost');
  await desk.locator('[data-case-error]').filter({hasText:'SYNTHETIC committed response lost'}).waitFor();
  assert.equal(dropCreateOnce, false, 'The first case POST reaches the real server before its committed response is lost');
  assert.equal(caseRequests.length, 1, 'The first create attempt sends exactly one case POST');
  assert.ok(droppedCase && droppedCase.status === 'open');
  assert.equal(droppedCase.evidenceMessageId, String(evidenceId), 'The committed draft is bound to the actual customer message');
  assert.equal((await json(customers, '/api/app/bootstrap')).wallet.cash_micro, initial.wallet.cash_micro, 'Creating a case never moves money');
  const createdReply = desk.waitForResponse(reply => new URL(reply.url()).pathname === `/api/support/orders/${retryOrder.id}/cases` && reply.request().method() === 'POST');
  await caseForm.locator('[type=submit]').click();
  const retriedCase = (await (await createdReply).json()).data;
  assert.equal(retriedCase.id, droppedCase.id, 'Lost create response reuses the original case');
  assert.deepEqual(caseRequests[0], caseRequests[1], 'Lost response retries the same immutable UUID and request');
  assert.equal(retriedCase.userId, customerId); assert.equal(retriedCase.orderId, retryOrder.id);
  const changedCreate = await raw(operators, `/api/support/orders/${retryOrder.id}/cases`, {method:'POST',headers:agentIdentity,data:{...caseRequests[1],reason:'Different account change'}});
  assert.equal(changedCreate.status(), 409, 'An existing case UUID cannot be changed');

  // The authenticated customer confirms the actual catalog price and buys the
  // package. Its automatic activation history is the customer receipt below.
  const beforeMonthlyIds=new Set((await json(customers,`/api/support/conversations/${conversationId}/orders`,{headers:customerIdentity})).data.items.map(item=>item.id));
  const subscriptionKey=`live-customer-monthly-${randomUUID()}`;
  const subscriptionBody={pool_id:monthlyPlan.poolId,tier:monthlyPlan.tier,months:1,max_charge_micro:amountMicro};
  await json(customers,'/api/app/subscriptions/buy',{method:'POST',headers:{...customerIdentity,'Idempotency-Key':subscriptionKey},data:subscriptionBody});
  let after=await json(customers,'/api/app/bootstrap');
  assert.equal(after.wallet.cash_micro,initial.wallet.cash_micro-amountMicro,'Only the customer checkout debits the package CNY price');
  assert.equal(after.api_allowance.balance.micro,initial.api_allowance.balance.micro,'Buying the package does not convert CNY into USD');
  await json(customers,'/api/app/subscriptions/buy',{method:'POST',headers:{...customerIdentity,'Idempotency-Key':subscriptionKey},data:subscriptionBody});
  const replayBalance=await json(customers,'/api/app/bootstrap');assert.deepEqual(replayBalance.wallet,after.wallet);assert.deepEqual(replayBalance.api_allowance.balance,after.api_allowance.balance);
  let currentCase;
  for(let attempt=0;attempt<180;attempt++){
    order=(await json(customers,`/api/support/conversations/${conversationId}/orders`,{headers:customerIdentity})).data.items.find(item=>!beforeMonthlyIds.has(item.id)&&item.source==='self_service'&&item.product==='subscription'&&item.amountMicro===amountMicro);
    if(order?.fulfilled){currentCase=(await json(customers,`/api/support/conversations/${conversationId}/cases`,{headers:customerIdentity})).data.items.find(item=>item.orderId===order.id&&item.caseType==='activation'&&item.status==='executed');if(currentCase)break;}
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  assert.ok(order&&currentCase,'Real customer package purchase must publish its original activation receipt');
  assert.ok(currentCase.receipt.subscriptionId);assert.equal(currentCase.receipt.allowanceMicro,0);assert.ok(currentCase.receipt.after.subscriptionExpiresAt>Math.floor(Date.now()/1000));
  const activationRequest={version:currentCase.version};
  const replay=(await json(operators,`/api/support/cases/${currentCase.id}/execute`,{method:'POST',headers:agentIdentity,data:activationRequest})).data;
  assert.equal(replay.version,currentCase.version);assert.equal(replay.history.length,currentCase.history.length);assert.deepEqual(replay.receipt,currentCase.receipt);
  await loginCustomer(other, otherName); const unrelated = await json(others, '/api/app/bootstrap');
  assert.notEqual(String(unrelated.user.id), customerId);
  const otherIdentity = customerHeaders(unrelated);
  assert.ok([403,404].includes((await raw(others, `/api/support/conversations/${conversationId}/orders`, {headers:otherIdentity})).status()), 'Other customer cannot read work items');
  assert.equal((await raw(others, `/api/support/cases/${currentCase.id}/accept`, {method:'POST',headers:otherIdentity,data:{version:currentCase.version}})).status(), 404, 'Other customer cannot discover or confirm another account case');
  const otherBefore = await json(others, '/api/app/bootstrap');
  await user.bringToFront(); await user.locator('[data-customer-orders] > summary').click();
  await user.locator(`[data-case-accept="${currentCase.id}"]`).waitFor();
  assert.equal(await user.locator(`[data-order-accept="${order.id}"]`).count(), 0, 'Activation case has one customer confirmation');
  const acceptance = user.waitForResponse(reply => new URL(reply.url()).pathname === `/api/support/cases/${currentCase.id}/accept`);
  await user.locator(`[data-case-accept="${currentCase.id}"]`).click();
  const accepted = await acceptance; assert.equal(accepted.status(), 200, `Customer validation: ${await accepted.text()}`);
  currentCase = (await accepted.json()).data; assert.equal(currentCase.status, 'closed');
  order = (await json(customers, `/api/support/conversations/${conversationId}/orders`, {headers:customerIdentity})).data.items.find(item => item.id === order.id);
  assert.equal(order.accepted, true); assert.equal(order.status, 'completed');
  const monthlyOrder=order, monthlyActivation=currentCase;
  after=await json(customers,'/api/app/bootstrap'); // Includes any separately identified acceptance reward.

  // Only the authenticated customer confirms the ECB quote and spends CNY.
  // The service imports its real purchase ledger for support after-sales work.
  const priorOrderIds=new Set((await json(customers,`/api/support/conversations/${conversationId}/orders`,{headers:customerIdentity})).data.items.map(item=>item.id));
  const exchangeCashMicro=10_000_000;
  const quote=(await json(customers,'/api/app/allowance/quote',{method:'POST',headers:customerIdentity,data:{cash_micro:exchangeCashMicro}})).quote;
  assert.match(quote.id,uuid); assert.equal(quote.source,'ECB'); assert.equal(quote.fee_bp,10); assert.equal(quote.cash_micro,exchangeCashMicro); assert.ok(Number.isSafeInteger(quote.usd_micro) && quote.usd_micro>0);
  const exchangeKey=`live-customer-fx-${randomUUID()}`, exchangeBody={cash_micro:exchangeCashMicro,quote_id:quote.id};
  const exchange=await json(customers,'/api/app/allowance/buy',{method:'POST',headers:{...customerIdentity,'Idempotency-Key':exchangeKey},data:exchangeBody});
  assert.equal(exchange.exchange.id,quote.id); assert.equal(exchange.exchange.usd_micro,quote.usd_micro);
  const beforeExchange=after; after=await json(customers,'/api/app/bootstrap');
  assert.equal(after.wallet.cash_micro,beforeExchange.wallet.cash_micro-exchangeCashMicro,'Customer confirmed CNY is debited exactly once');
  assert.equal(after.api_allowance.balance.micro,beforeExchange.api_allowance.balance.micro+quote.usd_micro,'Customer receives the exact server quote in USD');
  await json(customers,'/api/app/allowance/buy',{method:'POST',headers:{...customerIdentity,'Idempotency-Key':exchangeKey},data:exchangeBody});
  const afterExchangeReplay=await json(customers,'/api/app/bootstrap'); assert.deepEqual(afterExchangeReplay.wallet,after.wallet); assert.deepEqual(afterExchangeReplay.api_allowance.balance,after.api_allowance.balance,'Exchange retry cannot grant USD twice');
  assert.equal(after.user.self_keys,true,'First customer exchange enables key creation unless an administrator explicitly closed it');
  await json(customers,'/api/app/keys',{headers:customerIdentity});
  let exchangeOrder;
  for(let attempt=0;attempt<180;attempt++){
    exchangeOrder=(await json(customers,`/api/support/conversations/${conversationId}/orders`,{headers:customerIdentity})).data.items.find(item=>!priorOrderIds.has(item.id)&&item.source==='self_service'&&item.product==='allowance'&&item.amountMicro===exchangeCashMicro);
    if(exchangeOrder)break;
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  assert.ok(exchangeOrder,'Real customer exchange must be imported as a self-service order');
  assert.equal(exchangeOrder.allowanceUsdMicro,quote.usd_micro); assert.equal(exchangeOrder.fulfilled,true); assert.equal(exchangeOrder.status,'completed');
  order=exchangeOrder;

  await desk.locator(`[data-order-edit="${order.id}"]`).click();
  async function newCase(type, reason, amount) {
    await desk.locator('[data-case-new]').click();
    await caseForm.locator('[name=caseType]').selectOption(type);
    await caseForm.locator('[name=reason]').fill(reason);
    await caseForm.locator('[name=evidenceNote]').fill('SYNTHETIC evidence linked to the original customer conversation');
    await caseForm.locator('[name=evidenceMessageId]').selectOption(String(evidenceId));
    if (type === 'compensation') { const hours=caseForm.locator('[name=requestedHours]'); await (await hours.count() ? hours : caseForm.locator('[name=requestedAllowance]')).fill(String(amount)); }
    if (type === 'refund') await caseForm.locator('[name=refundAmount]').fill(String(amount));
    const reply = desk.waitForResponse(response => new URL(response.url()).pathname === `/api/support/orders/${order.id}/cases` && response.request().method() === 'POST');
    await caseForm.locator('[type=submit]').click(); const response = await reply;
    assert.equal(response.status(), 200, `Create ${type}: ${await response.text()}`); return (await response.json()).data;
  }
  let compensation = await newCase('compensation', 'SYNTHETIC compensation for verified service interruption', .25);
  const compDenied = desk.waitForResponse(reply => new URL(reply.url()).pathname === `/api/support/cases/${compensation.id}/execute`);
  await desk.locator(`[data-case-execute="${compensation.id}"]`).click(); assert.equal((await compDenied).status(), 403, 'Ops cannot grant compensation without owner authority');
  const ownerName = process.env.FELLS_TEST_OWNER ?? ''; assert.ok(synthetic(ownerName));
  const ownerContext = await browser.newContext(), ownerPage = await ownerContext.newPage(); t.after(() => ownerContext.close());
  await prepareSupportOperator(ownerContext, {base, email:ownerName, password}); await ownerPage.goto(`${base}/zh/support/desk/`);
  await ownerPage.locator(`[data-support-conversation="${conversationId}"]`).click(); await ownerPage.locator('[data-support-details]').click();
  await ownerPage.locator(`[data-order-edit="${order.id}"]`).click(); await ownerPage.locator(`[data-case-edit="${compensation.id}"]`).click();
  const compExecuted = ownerPage.waitForResponse(reply => new URL(reply.url()).pathname === `/api/support/cases/${compensation.id}/execute`);
  await ownerPage.locator(`[data-case-execute="${compensation.id}"]`).click(); const compResponse = await compExecuted; assert.equal(compResponse.status(), 200);
  compensation = (await compResponse.json()).data;
  assert.equal(compensation.receipt.allowanceMicro, 250_000); assert.equal(compensation.receipt.before.balanceMicro, compensation.receipt.after.balanceMicro);
  assert.equal(compensation.receipt.after.allowanceGrantMicro - compensation.receipt.before.allowanceGrantMicro, 250_000, 'Compensation enters the gift bucket');
  const ownerSession = (await json(ownerContext, '/api/support/session')).data;
  const ownerIdentity = {'X-Fells-Expected-Operator':ownerSession.operator.id,'X-Fells-Expected-Operator-Session':ownerSession.sessionId,'X-Fells-Support-Audience':'operator'};
  const compReplay = (await json(ownerContext, `/api/support/cases/${compensation.id}/execute`, {method:'POST',headers:ownerIdentity,data:{version:1}})).data;
  assert.equal(compReplay.version, compensation.version); assert.equal(compReplay.history.length, compensation.history.length);
  const compAfter = await json(customers, '/api/app/bootstrap'); assert.equal(compAfter.wallet.cash_micro, after.wallet.cash_micro); assert.equal(compAfter.api_allowance.balance.micro, after.api_allowance.balance.micro+250_000);
  const compAccept = user.waitForResponse(reply => new URL(reply.url()).pathname === `/api/support/cases/${compensation.id}/accept`);
  await user.locator(`[data-case-accept="${compensation.id}"]`).click(); assert.equal((await compAccept).status(), 200);

  // A real API call verifies the granted permission and allowance can be used.
  const deliveryKey=await json(customers,'/api/app/keys',{method:'POST',headers:customerIdentity,data:{name:`business-case-delivery-${randomUUID()}`,ttl_days:1}});
  async function verifyGateway(key) {
    const response=await raw(customers,'/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`},data:{model:'business-synthetic-model',messages:[{role:'user',content:'SYNTHETIC verify delivered account access'}]}});
    assert.equal(response.status(),200,`Synthetic gateway access: ${await response.text()}`);
    assert.equal((await response.json()).choices[0].message.content,'Business synthetic gateway verified');
  }
  const beforeApiUsage=await json(customers,'/api/app/bootstrap');
  await verifyGateway(deliveryKey.raw);
  let afterApiUsage;
  for(let i=0;i<50;i++) { afterApiUsage=await json(customers,'/api/app/bootstrap'); if(afterApiUsage.api_allowance.balance.micro!==beforeApiUsage.api_allowance.balance.micro)break; await new Promise(resolve=>setTimeout(resolve,100)); }
  assert.equal(afterApiUsage.api_allowance.balance.micro,beforeApiUsage.api_allowance.balance.micro-2,'Real synthetic usage debits exactly the seeded USD token price');
  assert.equal(afterApiUsage.wallet.cash_micro,beforeApiUsage.wallet.cash_micro,'Service use does not debit the CNY wallet again');

  // Refund an unactivated order from the second approved synthetic payment.
  const refundTopup = positive('FELLS_LIVE_REFUND_TOPUP_ID',process.env.FELLS_LIVE_REFUND_TOPUP_ID);
  await desk.locator('[data-order-new]').click(); await form.locator('[name=title]').fill(`live-refund-${randomUUID()}`); await form.locator('[name=product]').selectOption('other'); await form.locator('[name=amount]').fill('1'); await form.locator('[name=note]').fill('Cancelled before delivery; unconsumed original cash');
  order = await saveOrder(); await form.locator('[name=status]').selectOption('awaiting_payment'); order = await saveOrder(); await form.locator('[name=status]').selectOption('awaiting_fulfillment'); await form.locator('[name=paymentTopupId]').fill(refundTopup); order = await saveOrder();
  let refund = await newCase('refund','SYNTHETIC customer cancellation before delivery',1);
  const beforeRefund = await json(customers,'/api/app/bootstrap');
  const refundResponsePromise = desk.waitForResponse(reply => new URL(reply.url()).pathname === `/api/support/cases/${refund.id}/execute`);
  await desk.locator(`[data-case-execute="${refund.id}"]`).click(); const refundResponse = await refundResponsePromise; assert.equal(refundResponse.status(),200);
  const refundRequest = refundResponse.request().postDataJSON(); refund=(await refundResponse.json()).data;
  assert.equal(refund.receipt.cashRefundMicro,1_000_000); assert.match(refund.receipt.ledgerRef,/^refund:topup-req:/);
  const refundAfter = await json(customers,'/api/app/bootstrap'); assert.equal(refundAfter.wallet.cash_micro,beforeRefund.wallet.cash_micro-1_000_000); assert.equal(refundAfter.api_allowance.balance.micro,beforeRefund.api_allowance.balance.micro);
  await json(operators,`/api/support/cases/${refund.id}/execute`,{method:'POST',headers:agentIdentity,data:refundRequest});
  assert.equal((await json(customers,'/api/app/bootstrap')).wallet.cash_micro,refundAfter.wallet.cash_micro);
  const premature = await raw(customers,`/api/support/cases/${refund.id}/accept`,{method:'POST',headers:customerIdentity,data:{version:refund.version}}); assert.ok([400,409].includes(premature.status()),'Cash deduction alone does not prove external refund completion');
  const channelForm=desk.locator('[data-refund-action=channel]');await channelForm.locator('..').locator('summary').click();
  await channelForm.locator('[name=stage]').selectOption('paid');await channelForm.locator('[name=provider]').fill('synthetic-bank');await channelForm.locator('[name=account]').fill('synthetic-original-account-'+customerId);await channelForm.locator('[name=refundId]').fill('synthetic-transfer-'+refund.id);await channelForm.locator('[name=refundChannelMessageId]').selectOption(String(evidenceId));await channelForm.locator('[name=note]').fill(`SYNTHETIC original-channel refund receipt ${refund.id}`);
  const proofReply=desk.waitForResponse(reply=>new URL(reply.url()).pathname===`/api/support/cases/${refund.id}/refund-channel`);await channelForm.locator('[type=submit]').click();const proofResponse=await proofReply;assert.equal(proofResponse.status(),200,await proofResponse.text());refund=(await proofResponse.json()).data;
  const unreviewed=await raw(customers,`/api/support/cases/${refund.id}/accept`,{method:'POST',headers:customerIdentity,data:{version:refund.version}});assert.ok([400,409].includes(unreviewed.status()),'a transfer claim alone is not independently verified');
  await ownerPage.locator(`[data-order-edit="${order.id}"]`).click();await ownerPage.locator(`[data-case-edit="${refund.id}"]`).click();const reviewForm=ownerPage.locator('[data-refund-action=review]');await reviewForm.locator('[name=note]').fill('SYNTHETIC independent reviewer verified channel, recipient, amount and linked original receipt');const reviewed=ownerPage.waitForResponse(reply=>new URL(reply.url()).pathname===`/api/support/cases/${refund.id}/refund-review`);await reviewForm.locator('[type=submit]').click();const reviewedResponse=await reviewed;assert.equal(reviewedResponse.status(),200,await reviewedResponse.text());refund=(await reviewedResponse.json()).data;assert.equal(refund.refund.stage,'paid');assert.notEqual(refund.refund.reviewedBy,refund.refund.executedBy);assert.notEqual(refund.refund.reviewedBy,refund.refund.recordedBy);
  await user.locator(`[data-case-accept="${refund.id}"]:enabled`).waitFor();
  const refundAccepted = user.waitForResponse(reply=>new URL(reply.url()).pathname===`/api/support/cases/${refund.id}/accept`); await user.locator(`[data-case-accept="${refund.id}"]`).click(); assert.equal((await refundAccepted).status(),200);
  const refundClosed=(await json(customers,`/api/support/conversations/${conversationId}/cases`,{headers:customerIdentity})).data.items.find(item=>item.id===refund.id); assert.equal(refundClosed.status,'closed');
  const proofChanged = await raw(operators,`/api/support/cases/${refund.id}`,{method:'PATCH',headers:agentIdentity,data:{version:refundClosed.version,refundProof:'Different final proof'}}); assert.equal(proofChanged.status(),409,'Accepted proof is immutable');
  const originalRefunded=(await json(customers,`/api/support/conversations/${conversationId}/orders`,{headers:customerIdentity})).data.items.find(item=>item.id===order.id); assert.equal(originalRefunded.status,'refunded');
  const otherAfter=await json(others,'/api/app/bootstrap'); assert.deepEqual(otherAfter.wallet,otherBefore.wallet); assert.deepEqual(otherAfter.api_allowance,otherBefore.api_allowance,'Other account is unchanged');
  assert.equal((await json(customers,'/api/app/bootstrap')).wallet.cash_micro,refundAfter.wallet.cash_micro);
  // The monthly subscription activated above remains usable after an independent
  // customer USD exchange, API usage and an unrelated refund.
  order=monthlyOrder; const monthlyCase=monthlyActivation;
  await desk.locator(`[data-order-edit="${order.id}"]`).click();
  assert.ok(monthlyCase.receipt.subscriptionId); assert.ok(monthlyCase.receipt.after.subscriptionExpiresAt>Math.floor(Date.now()/1000));
  assert.equal(monthlyCase.receipt.before.balanceMicro-monthlyCase.receipt.after.balanceMicro,monthlyPlan.monthlyMicro);
  const beforeMonthlyUsage=await json(customers,'/api/app/bootstrap');
  // Sail/device keys consume the selected monthly subscription. Developer API
  // keys remain independently metered, even when the user selects monthly mode.
  const backend=new URL(process.env.FELLS_BACKEND_ORIGIN ?? '');
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(backend.hostname));
  assert.equal(backend.username+backend.password+backend.search+backend.hash,'');
  const portalJSON=async (path,data) => {
    const response=await customers.request.post(backend.origin+path,{headers:{Origin:backend.origin},data});
    assert.equal(response.status(),200,`Synthetic device flow ${path}: ${await response.text()}`);
    return response.json();
  };
  await portalJSON('/portal/api/login',{username,password});
  const agreementResponse=await customers.request.get(backend.origin+'/portal/api/agreement');
  assert.equal(agreementResponse.status(),200);
  const agreement=await agreementResponse.json();
  await portalJSON('/portal/api/agreement/accept',{version:agreement.version});
  const device=await portalJSON('/portal/api/device/start',{device:`business-monthly-${randomUUID()}`});
  await portalJSON('/portal/api/device/approve',{user_code:device.user_code});
  const deviceKey=await portalJSON('/portal/api/device/poll',{device_code:device.device_code});
  assert.equal(deviceKey.status,'approved'); assert.ok(deviceKey.raw && deviceKey.key?.id);
  await verifyGateway(deviceKey.raw); // Actual service use obtains the monthly assignment.
  const afterMonthlyUsage=await json(customers,'/api/app/bootstrap');
  assert.equal(afterMonthlyUsage.api_allowance.balance.micro,beforeMonthlyUsage.api_allowance.balance.micro,'Monthly mode does not consume the independent API allowance');
  assert.equal(monthlyCase.status,'closed','Customer already confirmed this monthly activation exactly once');
  let hourCase=await newCase('compensation','SYNTHETIC verified two-hour interruption',2);
  await ownerPage.locator(`[data-order-edit="${order.id}"]`).click(); await ownerPage.locator(`[data-case-edit="${hourCase.id}"]`).click();
  const hoursReply=ownerPage.waitForResponse(reply=>new URL(reply.url()).pathname===`/api/support/cases/${hourCase.id}/execute`); await ownerPage.locator(`[data-case-execute="${hourCase.id}"]`).click(); const hoursResponse=await hoursReply; assert.equal(hoursResponse.status(),200); hourCase=(await hoursResponse.json()).data;
  assert.equal(hourCase.receipt.subscriptionHours,2); assert.equal(hourCase.receipt.after.subscriptionExpiresAt-hourCase.receipt.before.subscriptionExpiresAt,7200); assert.equal(hourCase.receipt.before.balanceMicro,hourCase.receipt.after.balanceMicro); assert.equal(hourCase.receipt.before.allowanceMicro,hourCase.receipt.after.allowanceMicro); assert.equal(hourCase.receipt.ledgerRef,'','Free hours do not fabricate a money ledger'); assert.ok(hourCase.receipt.actionRef);
  const hourReplay=(await json(ownerContext,`/api/support/cases/${hourCase.id}/execute`,{method:'POST',headers:ownerIdentity,data:{version:1}})).data; assert.deepEqual(hourReplay.receipt,hourCase.receipt); assert.equal(hourReplay.history.length,hourCase.history.length);
  const hourAccept=user.waitForResponse(reply=>new URL(reply.url()).pathname===`/api/support/cases/${hourCase.id}/accept`); await user.locator(`[data-case-accept="${hourCase.id}"]`).click(); assert.equal((await hourAccept).status(),200);
  const finalOther=await json(others,'/api/app/bootstrap'); assert.deepEqual(finalOther.wallet,otherBefore.wallet); assert.deepEqual(finalOther.api_allowance,otherBefore.api_allowance);
  await json(customers,`/api/app/keys/${deliveryKey.key.id}`,{method:'DELETE',headers:customerIdentity});
  await portalJSON(`/portal/api/cli-keys/${deviceKey.key.id}/revoke`,{});
  await user.screenshot({path:'reports/business-cases-customer-85.png',fullPage:true}); await desk.screenshot({path:'reports/business-cases-operator-85.png',fullPage:true});
  await desk.bringToFront();
  await desk.locator('[data-operations-queue]').click();
  await desk.locator('[data-work-title]').filter({hasText:'交易待核对'}).waitFor();
  const pending = (await json(operators, '/api/support/operations?status=pending&limit=100', {headers:agentIdentity})).data.items;
  const unknown = pending.find(item => item.outcome === 'unknown' && item.userId === customerId);
  if (unknown) {
    await desk.locator(`[data-operation="${unknown.id}"]`).click();
    const review = desk.locator('[data-operation-form]');
    assert.equal(await review.locator('[value=confirm_committed]').isDisabled(), true);
    assert.equal(await review.locator('[value=confirm_not_executed]').isDisabled(), true);
    await review.locator('[name=note]').fill('Synthetic live review: outcome remains unknown; no charge repeated');
    assert.equal(await review.evaluate(form=>form.checkValidity()),true);
    const reviewReply = desk.waitForResponse(reply => new URL(reply.url()).pathname.endsWith(`/${unknown.id}/reconcile`));
    await review.locator('[value=needs_review]').click();
    await desk.waitForTimeout(500);
    assert.equal(await desk.locator('[data-work-error]').textContent(),'','Review must not fail silently before sending the request');
    assert.equal((await reviewReply).status(), 200);
    const reviewed = (await json(operators, `/api/support/operations/${unknown.id}`, {headers:agentIdentity})).data;
    assert.equal(reviewed.status, 'pending'); assert.equal(reviewed.assigneeId, agent.operator.id);
  }
  await desk.locator('[data-work-close]').click();
  assert.deepEqual(errors, []);
  const cases=(await json(customers,`/api/support/conversations/${conversationId}/cases`,{headers:customerIdentity})).data.items;
  const orders=(await json(customers,`/api/support/conversations/${conversationId}/orders`,{headers:customerIdentity})).data.items;
  writeFileSync('reports/business-cases-receipts-85.json',JSON.stringify({environment:'85 isolated synthetic DB',cases,orders,apiUsage:{beforeMicro:beforeApiUsage.api_allowance.balance.micro,afterMicro:afterApiUsage.api_allowance.balance.micro},monthlyUsage:{beforeMicro:beforeMonthlyUsage.api_allowance.balance.micro,afterMicro:afterMonthlyUsage.api_allowance.balance.micro}},null,2)+'\n');
});
