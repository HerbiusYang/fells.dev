import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prepareSupportOperator } from './support-live-session.mjs';

// Every action below uses the production UI and real loopback Go/PG handlers.
// Callers provide only synthetic identities; this helper never seeds a sale.
export function manualSaleLive(browser, { publicBase, consoleBase, errors, selfServiceRequests, pages }) {
  const publicURL = new URL(publicBase), consoleURL = new URL(consoleBase);
  for (const url of [publicURL, consoleURL]) {
    assert.equal(url.protocol, 'http:'); assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.username + url.password + url.search + url.hash, '');
  }
  const origins = [publicURL.origin, consoleURL.origin];
  async function context(width) {
    const ctx = await browser.newContext({ viewport: { width, height: 950 }, reducedMotion: 'reduce' });
    await ctx.route('**/*', route => origins.includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
    ctx.on('page', page => {
      page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => {
        if (request.method() === 'POST' && /^\/api\/app\/(?:allowance\/buy|plans\/buy|subscriptions\/(?:buy|upgrade))$/.test(new URL(request.url()).pathname)) selfServiceRequests.push({ path: new URL(request.url()).pathname });
      });
    });
    return ctx;
  }
  async function json(actor, path, options = {}, expected = 200) {
    const origin = actor.operator ? consoleURL : publicURL;
    const response = await actor.ctx.request.fetch(new URL(path, origin).href, { ...options, headers: { Origin: origin.origin, ...actor.headers, ...options.headers } });
    assert.equal(response.status(), expected, `${options.method ?? 'GET'} ${path}: ${await response.text()}`);
    return response.json();
  }
  async function response(page, path, method, action, expected = 200) {
    const pending = page.waitForResponse(reply => new URL(reply.url()).pathname === path && reply.request().method() === method);
    await action(); const reply = await pending;
    assert.equal(reply.status(), expected, `${method} ${path}: ${await reply.text()}`);
    return { result: await reply.json(), body: reply.request().postDataJSON() };
  }
  async function idle(page) { await page.waitForFunction(() => document.querySelector('#fx')?.getAttribute('aria-busy') !== 'true'); }
  async function customer(username, password, width = 320, name = username) {
    const ctx = await context(width), page = await ctx.newPage(); pages.push([name, page]);
    await page.goto(new URL('/zh/app/start/', publicURL).href);
    await page.locator('#auth-email').fill(username); await page.locator('#auth-password').fill(password);
    await page.locator('[data-auth-form] [type=submit]').click();
    await page.waitForURL(url => /^\/zh\/app\/?$/.test(url.pathname)); await idle(page);
    const actor = { ctx, page, operator: false };
    actor.bootstrap = await json(actor, '/api/app/bootstrap');
    if (!actor.bootstrap.agreement.accepted) {
      // Synthetic customers exercise the same current-terms gate as a real
      // customer. Dismissing its modal would leave protected actions blocked.
      const agreement = page.locator('[data-form=agreement]');
      await agreement.locator('[name=consent]').check();
      const accepted = await response(page, '/api/app/agreement/accept', 'POST', () => agreement.locator('button').click());
      assert.equal(accepted.result.ok, true);
      await agreement.waitFor({ state: 'detached' });
      actor.bootstrap = await json(actor, '/api/app/bootstrap');
      assert.equal(actor.bootstrap.agreement.accepted, true);
    }
    actor.headers = { 'X-Fells-Support-Audience': 'customer', 'X-Fells-Expected-User': String(actor.bootstrap.user.id), 'X-Fells-Expected-Session': actor.bootstrap.session_id };
    await openCustomerOrders(actor);
    actor.conversation = (await json(actor, '/api/support/conversations/current')).data;
    return actor;
  }
  async function operator(width = 1280, name = 'staff') {
    const ctx = await context(width);
    const identity = await ctx.request.post(new URL('/__support_access_fixture/identity', consoleURL).href, { data: { identity: 'ops' } });
    assert.equal(identity.status(), 204);
    const session = await prepareSupportOperator(ctx, { base: consoleURL });
    const page = await ctx.newPage(); pages.push([name, page]);
    return { ctx, page, operator: true, headers: { 'X-Fells-Support-Audience': 'operator', 'X-Fells-Expected-Operator': session.operator.id, 'X-Fells-Expected-Operator-Session': session.sessionId } };
  }
  async function desk(actor, customerActor, orderId) {
    await actor.page.goto(new URL('/zh/support/desk/', consoleURL).href);
    await actor.page.locator('[data-support-search]:enabled').waitFor();
    await actor.page.locator(`[data-support-conversation="${customerActor.conversation.id}"]`).click();
    await actor.page.locator('[data-support-details]').click();
    if (orderId) await actor.page.locator(`[data-order-edit="${orderId}"]`).click();
  }
  async function openCustomerOrders(actor, reload = false) {
    if (reload) { await actor.page.reload(); await idle(actor.page); }
    if (!await actor.page.locator('#support-widget [data-customer-orders]').isVisible()) await actor.page.locator('[data-open-customer-support]:visible,[data-support-open]:visible').first().click();
    const details = actor.page.locator('[data-customer-orders]'); await details.waitFor();
    if (!await details.evaluate(element => element.open)) await details.locator('[data-customer-orders-open]').click();
  }
  async function inquire(owner, selector, expected) {
    await owner.page.locator('#support-widget [data-support-close]').click();
    await owner.page.goto(new URL('/zh/app/#/billing/market', publicURL).href); await idle(owner.page);
    await owner.page.locator(selector).first().click();
    const text = owner.page.locator('#support-widget [data-support-text]'); await text.waitFor();
    const draft = await text.inputValue(); assert.ok(draft.includes(expected));
    assert.equal(await owner.page.locator('#support-widget [data-support-message]').filter({ hasText: draft }).count(), 0, 'Consultation stays a draft until the customer sends');
    const pending = owner.page.waitForResponse(reply => new URL(reply.url()).pathname === `/api/support/conversations/${owner.conversation.id}/messages` && reply.request().method() === 'POST');
    await owner.page.locator('#support-widget [data-support-send]').click();
    assert.equal((await pending).status(), 200);
    await owner.page.locator('#support-widget [data-support-message]').filter({ hasText: draft }).waitFor();
  }
  async function quote(staff, owner, { product = 'subscription', offer, planCode = '', amountMicro, serviceDays = 0, title = `Synthetic manual ${product}` }) {
    await desk(staff, owner); await staff.page.locator('[data-order-new]').click();
    const form = staff.page.locator('[data-order-form]');
    await form.locator('[name=title]').fill(title); await form.locator('[name=product]').selectOption(product);
    if (product === 'subscription') {
      await form.locator('[name=months]').fill('1'); await form.locator('[name=plan]').selectOption(`${offer.poolId}:${offer.tier}`);
    } else if (product === 'token_plan') await form.locator('[name=planCode]').selectOption(planCode);
    else { await form.locator('[name=amount]').fill(String(amountMicro / 1e6)); await form.locator('[name=serviceDays]').fill(String(serviceDays)); }
    await form.locator('[name=note]').fill('SYNTHETIC isolated staff quotation; no external payment');
    const reply = await response(staff.page, `/api/support/conversations/${owner.conversation.id}/orders`, 'POST', () => form.locator('[type=submit]').click());
    const order = reply.result.data;
    assert.equal(order.purchaseConfirmation.state, 'required'); assert.equal(order.fulfilled, false); assert.equal(order.accepted, false);
    // A quotation first enters awaiting_payment. Linking collection directly
    // from quoted is an invalid state transition in the production contract.
    await form.locator('[name=status]').selectOption('awaiting_payment');
    const awaiting = await response(staff.page, `/api/support/orders/${order.id}`, 'PATCH', () => form.locator('[type=submit]').click());
    assert.equal(awaiting.result.data.status, 'awaiting_payment');
    assert.equal(awaiting.result.data.purchaseConfirmation.state, 'required');
    assert.equal(awaiting.result.data.fulfilled, false);
    return { order: awaiting.result.data, createBody: reply.body };
  }
  async function confirm(owner, order, expected = 200) {
    await openCustomerOrders(owner, true);
    const card = owner.page.locator(`[data-customer-order="${order.id}"]`); await card.waitFor();
    const text = await card.innerText(); assert.ok(text.includes(String(order.amountMicro / 1e6)));
    if (order.product === 'subscription') { assert.ok(text.includes(`1/${order.tier}`)); assert.ok(text.includes(String(order.serviceDays))); }
    if (order.product === 'token_plan') { assert.ok(text.includes(String(order.serviceDays))); assert.ok(text.includes(String(order.quoteSnapshot.tokenPlan.name))); }
    const reply = await response(owner.page, `/api/support/orders/${order.id}/confirm-purchase`, 'POST', () => card.locator('[data-order-confirm-purchase]').click(), expected);
    if (expected === 200) {
      assert.equal(reply.result.data.purchaseConfirmation.state, 'confirmed'); assert.equal(reply.result.data.fulfilled, false); assert.equal(reply.result.data.accepted, false);
    }
    assert.equal(reply.body.quoteHash, order.purchaseConfirmation.quoteHash); assert.equal(reply.body.maxChargeMicro, order.amountMicro);
    return reply;
  }
  async function collect(staff, owner, amountMicro, receiptRef = `SYNTHETIC-bank-${randomUUID()}`) {
    await desk(staff, owner);
    const form = staff.page.locator('[data-cash-topup]');
    await form.locator('[name=amount]').fill(String(amountMicro / 1e6)); await form.locator('[name=receipt]').fill(receiptRef);
    await form.locator('[name=memo]').fill('SYNTHETIC original CNY bank receipt verified in isolated fixture');
    await form.locator('[type=submit]').click();
    const reply = await response(staff.page, `/api/support/conversations/${owner.conversation.id}/topups`, 'POST', () => staff.page.locator('[data-cash-confirm]').click());
    return { payment: reply.result.data, body: reply.body };
  }
  async function link(staff, owner, order, payment, expected = 200) {
    await desk(staff, owner, order.id);
    const form = staff.page.locator('[data-order-form]');
    await form.locator('[name=status]').selectOption('awaiting_fulfillment');
    await form.locator('[name=paymentTopupId]').fill(String(payment.topupId));
    return response(staff.page, `/api/support/orders/${order.id}`, 'PATCH', () => form.locator('[type=submit]').click(), expected);
  }
  async function activation(staff, owner, order, enableKeys = true) {
    await desk(staff, owner, order.id); await staff.page.locator('[data-case-new]').click();
    const form = staff.page.locator('[data-case-form]');
    await form.locator('[name=caseType]').selectOption('activation');
    await form.locator('[name=reason]').fill('Deliver customer-confirmed original quotation');
    await form.locator('[name=evidenceNote]').fill('SYNTHETIC original bank receipt verified and linked to this exact order');
    await form.locator('[name=enableApiKeys]').setChecked(enableKeys);
    const reply = await response(staff.page, `/api/support/orders/${order.id}/cases`, 'POST', () => form.locator('[type=submit]').click());
    return reply.result.data;
  }
  async function execute(staff, item, expected = 200) {
    return response(staff.page, `/api/support/cases/${item.id}/execute`, 'POST', () => staff.page.locator(`[data-case-execute="${item.id}"]`).click(), expected);
  }
  async function accept(owner, item) {
    await openCustomerOrders(owner, true);
    const reply = await response(owner.page, `/api/support/cases/${item.id}/accept`, 'POST', () => owner.page.locator(`[data-case-accept="${item.id}"]`).click());
    assert.equal(reply.result.data.status, 'closed');
    const order = (await json(owner, `/api/support/orders/${item.orderId}`)).data;
    assert.equal(order.fulfilled, true); assert.equal(order.accepted, true);
    return order;
  }
  return { json, response, customer, operator, desk, openCustomerOrders, inquire, quote, confirm, collect, link, activation, execute, accept, idle };
}
