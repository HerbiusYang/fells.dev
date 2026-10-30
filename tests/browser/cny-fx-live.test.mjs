import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { manualSaleLive } from './helpers/manual-sale-live.mjs';

// Product replies and financial effects come from actual Go/PG transactions.
// A lost reply is injected only AFTER the real handler commits successfully.
test('real CNY collection and manual API plan: authority, exact consent, lost replies, staff delivery and receipt isolation', { timeout: 300000 }, async t => {
  if (process.env.FELLS_CNY_FX_LIVE !== '1') { t.skip('Requires isolated signed Access, production Go handlers and disposable PG'); return; }
  assert.equal(process.env.FELLS_ACCESS_BROWSER_TEST, '1');
  const publicBase = new URL(process.env.FELLS_ACCESS_PUBLIC_BASE), consoleBase = new URL(process.env.FELLS_ACCESS_CONSOLE_BASE);
  const evidence = resolve(process.env.FELLS_ACCESS_EVIDENCE_DIR); await mkdir(evidence, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
  const pages = [], errors = [], checks = [], receipts = {}, funding = [], confirmations = [], selfServiceRequests = [];
  t.after(async () => {
    for (const [name, page] of pages) if (!page.isClosed()) await page.screenshot({ path: resolve(evidence, `cny-manual-${name}.png`), fullPage: true, animations: 'disabled', timeout: 10000 }).catch(() => {});
    await writeFile(resolve(evidence, 'cny-fx-real-receipts.json'), JSON.stringify({ scope: 'Synthetic isolated signed Access and real Go/PostgreSQL, no external collection or provider; current sales are manual', checks, receipts, funding, confirmations, selfServiceRequests, errors }, null, 2));
    await browser.close();
  }, { timeout: 50000 });
  const live = manualSaleLive(browser, { publicBase, consoleBase, errors, selfServiceRequests, pages });
  const owner = await live.customer('support-browser-other', 'support-browser-password', 320, 'customer-320');
  const foreign = await live.customer('support-browser-third', 'support-browser-password', 320, 'other-customer-320');
  const staff = await live.operator(320, 'staff-320');
  const bootstrap = () => live.json(owner, '/api/app/bootstrap');
  const initial = await bootstrap(); assert.equal(initial.wallet.cash_micro, 0); assert.equal(initial.api_allowance.balance.micro, 0);
  await live.desk(staff, owner); assert.equal(await staff.page.locator('input[type=password]').count(), 0);
  const topupPath = `/api/support/conversations/${owner.conversation.id}/topups`, receiptRef = `SYNTHETIC-bank-${randomUUID()}`;
  let loseFunding = true;
  await staff.page.route(`**${topupPath}`, async route => {
    if (route.request().method() !== 'POST') return route.continue(); funding.push(route.request().postDataJSON());
    if (!loseFunding) return route.continue(); loseFunding = false;
    const committed = await route.fetch(); assert.equal(committed.status(), 200, await committed.text()); receipts.collection = await committed.json();
    await route.fulfill({ status: 503, json: { ok: false, error: { code: 'synthetic_response_lost', message: 'Committed collection response deliberately lost' } } });
  });
  const form = staff.page.locator('[data-cash-topup]');
  await form.locator('[name=amount]').fill('20'); await form.locator('[name=receipt]').fill(receiptRef); await form.locator('[name=memo]').fill('SYNTHETIC verified original CNY bank receipt'); await form.locator('[type=submit]').click();
  assert.equal(funding.length, 0); assert.equal((await bootstrap()).wallet.cash_micro, 0, 'Review is not collection');
  await staff.page.screenshot({ path: resolve(evidence, 'cny-fx-cny-review-320.png'), fullPage: true, animations: 'disabled' });
  await live.response(staff.page, topupPath, 'POST', () => staff.page.locator('[data-cash-confirm]').click(), 503);
  const funded = await bootstrap(); assert.equal(funded.wallet.cash_micro, 20_000_000); assert.equal(funded.api_allowance.balance.micro, 0); assert.equal(funded.user.self_keys, initial.user.self_keys);
  await live.desk(staff, owner); await staff.page.locator('[data-cash-confirm]').click(); await staff.page.locator('[data-cash-topup]').waitFor();
  assert.equal(funding.length, 2); assert.deepEqual(funding[0], funding[1]); assert.equal((await bootstrap()).wallet.cash_micro, 20_000_000);
  const duplicate = (await live.json(staff, topupPath, { method: 'POST', data: { ...funding[0], operationId: randomUUID() } })).data;
  assert.equal(duplicate.duplicate, true); assert.equal(duplicate.topupId, receipts.collection.data.topupId);
  await live.json(staff, topupPath, { method: 'POST', data: { ...funding[0], operationId: randomUUID(), amountMicro: 1_000_000 } }, 409);
  await live.json(owner, topupPath, { method: 'POST', data: { ...funding[0], operationId: randomUUID() } }, 403);
  await live.json(staff, topupPath, { method: 'POST', headers: { Origin: 'https://untrusted.example.invalid' }, data: { ...funding[0], operationId: randomUUID() } }, 403);
  await live.json(staff, `/api/support/conversations/${foreign.conversation.id}/topups`, { method: 'POST', data: { ...funding[0], operationId: randomUUID() } }, 409);
  assert.equal((await live.json(foreign, '/api/app/bootstrap')).wallet.cash_micro, 0);
  checks.push('Actual CNY collection survives a lost committed reply with one credit; reused, altered, cross-customer, customer and foreign-origin receipts are rejected');
  await live.inquire(owner, '[data-act=contact-purchase][data-support-product=token_plan][data-support-code="1000"]', '1000');
  const quotation = await live.quote(staff, owner, { product: 'token_plan', planCode: '1000', title: 'SYNTHETIC staff API plan quotation' });
  assert.equal(quotation.order.amountMicro, 2_000_000); assert.equal(quotation.order.product, 'token_plan'); assert.ok(quotation.order.serviceDays > 0);
  const confirmationPath = `/api/support/orders/${quotation.order.id}/confirm-purchase`;
  let loseConsent = true;
  await owner.page.route(`**${confirmationPath}`, async route => {
    confirmations.push(route.request().postDataJSON());
    if (!loseConsent) return route.continue(); loseConsent = false;
    const committed = await route.fetch(); assert.equal(committed.status(), 200, await committed.text()); receipts.consent = await committed.json();
    await route.fulfill({ status: 503, json: { ok: false, error: { code: 'synthetic_response_lost', message: 'Committed consent response deliberately lost' } } });
  });
  await live.confirm(owner, quotation.order, 503);
  const consent = (await live.json(owner, `/api/support/orders/${quotation.order.id}`)).data;
  assert.equal(consent.purchaseConfirmation.state, 'confirmed'); assert.equal(consent.accepted, false); assert.equal(consent.fulfilled, false);
  await live.openCustomerOrders(owner, true); assert.equal(await owner.page.locator(`[data-order-confirm-purchase="${consent.id}"]`).count(), 0);
  await live.json(owner, confirmationPath, { method: 'POST', data: confirmations[0] });
  await live.json(foreign, confirmationPath, { method: 'POST', data: { ...confirmations[0], operationId: randomUUID() } }, 404);
  await live.json(staff, confirmationPath, { method: 'POST', data: confirmations[0] }, 403);
  assert.equal((await bootstrap()).wallet.cash_micro, 20_000_000); assert.equal((await live.json(owner, '/api/app/plans')).current, null);
  checks.push('Frozen plan quotation is confirmed only by its customer; lost consent reply recovers without payment or premature delivery');
  await live.link(staff, owner, quotation.order, receipts.collection.data);
  const item = await live.activation(staff, owner, quotation.order);
  const executePath = `/api/support/cases/${item.id}/execute`; let loseActivation = true;
  await staff.page.route(`**${executePath}`, async route => {
    if (!loseActivation) return route.continue(); loseActivation = false;
    const committed = await route.fetch(); assert.equal(committed.status(), 200, await committed.text()); receipts.activation = await committed.json();
    await route.fulfill({ status: 503, json: { ok: false, error: { code: 'synthetic_response_lost', message: 'Committed activation response deliberately lost' } } });
  });
  const executed = await live.execute(staff, item, 503);
  const delivered = (await live.json(owner, `/api/support/cases/${item.id}`)).data;
  assert.equal(delivered.status, 'executed'); assert.ok(delivered.receipt.actionRef); assert.equal(delivered.receipt.before.balanceMicro - delivered.receipt.after.balanceMicro, 2_000_000);
  await live.json(staff, executePath, { method: 'POST', data: executed.body });
  const finalAccount = await bootstrap(), finalPlan = await live.json(owner, '/api/app/plans');
  assert.equal(finalAccount.wallet.cash_micro, 18_000_000); assert.equal(finalAccount.user.self_keys, true);
  assert.equal(finalPlan.current.plan_code, '1000'); assert.equal(finalPlan.current.ref, delivered.receipt.tokenPlanRef); assert.ok(!finalPlan.current.queued);
  receipts.accepted = await live.accept(owner, item);
  await owner.page.goto(new URL('/zh/app/#/billing/market', publicBase).href); await live.idle(owner.page);
  assert.match(await owner.page.locator('main').innerText(), /1000/);
  checks.push('Verified original collection funds a manual staff case; lost activation reply delivers exactly one CNY-priced plan, receipt and customer acceptance');

  // Deliberate direct calls prove old purchase doors do not create fresh sales.
  const deniedRequests = [
    { path: 'allowance/buy', body: { cash_micro: 1_000_000 } },
    { path: 'plans/buy', body: { plan: '1000', max_charge_micro: 2_000_000 } },
    { path: 'subscriptions/buy', body: { pool_id: 1, tier: 1, months: 1, max_charge_micro: 1_000_000 } },
    { path: 'subscriptions/upgrade', body: { pool_id: 1, tier: 1, months: 1, max_charge_micro: 1_000_000 } },
  ];
  for (const { path, body } of deniedRequests) {
    // Each route must receive its own valid DTO so this proves the manual-sale
    // policy rejection, rather than stopping at malformed-field validation.
    const denied = await live.json(owner, `/api/app/${path}`, { method: 'POST', headers: { 'Idempotency-Key': randomUUID() }, data: body }, 403);
    assert.equal(denied.code ?? denied.error?.code, 'contact_support_required'); assert.equal(denied.transaction_rejected, true);
  }
  assert.equal((await bootstrap()).wallet.cash_micro, 18_000_000); assert.equal((await live.json(owner, '/api/app/plans')).current.id, finalPlan.current.id);
  checks.push('Every old customer exchange, plan purchase and monthly purchase/upgrade door rejects a new operation without changing cash or entitlements');
  assert.deepEqual(selfServiceRequests, [], 'Visible UI never submits a self-service purchase');
  for (const actor of [owner, staff]) assert.equal(await actor.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  assert.deepEqual(errors, []); receipts.finalAccount = finalAccount; receipts.finalPlan = finalPlan;
});
