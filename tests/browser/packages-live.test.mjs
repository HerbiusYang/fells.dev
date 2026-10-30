import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

// Opt-in joint-repository integration. Every product reply is the real Go
// handler and PostgreSQL transaction. The only write control advances one
// explicitly synthetic subscription deadline; no wall-clock date is mocked.
test('actual monthly package UI: CNY checkout, immediate fixed assignment, acceptance, replay, renewal, expiry and last-seat race', { timeout: 240000 }, async t => {
  if (process.env.FELLS_PACKAGE_BROWSER_TEST !== '1') { t.skip('Requires the isolated signed-Access Go/PG package fixture'); return; }
  assert.equal(process.env.FELLS_ACCESS_BROWSER_TEST, '1');
  const manifest = JSON.parse(await readFile(process.env.FELLS_PACKAGE_FIXTURE_FILE, 'utf8'));
  const base = new URL(manifest.publicBase), consoleBase = new URL(manifest.consoleBase), fixture = manifest.packages;
  for (const url of [base, consoleBase]) {
    assert.equal(url.protocol, 'http:'); assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.username + url.password + url.search + url.hash, '');
  }
  assert.equal(manifest.disposableDatabase, true); assert.equal(fixture.synthetic, true);
  assert.equal(fixture.realProviderCallsAllowed, false);
  const evidence = resolve(process.env.FELLS_ACCESS_EVIDENCE_DIR); await mkdir(evidence, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
  const pages = [], checks = [], errors = [], receipts = {};
  t.after(async () => {
    for (const [name, page] of pages) if (!page.isClosed()) await page.screenshot({ path: resolve(evidence, `packages-${name}.png`), fullPage: true, animations: 'disabled', timeout: 10000 }).catch(() => {});
    await writeFile(resolve(evidence, 'packages-live-receipts.json'), JSON.stringify({ scope: 'synthetic isolated real Go/PostgreSQL and actual customer UI; no real payment or provider calls', checks, errors, receipts }, null, 2) + '\n');
    await browser.close();
  }, { timeout: 45000 });
  async function customer(alias, width = 1280) {
    const ctx = await browser.newContext({ viewport: { width, height: 950 }, reducedMotion: 'reduce' });
    await ctx.route('**/*', route => [base.origin, consoleBase.origin].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
    ctx.on('page', p => { p.setDefaultTimeout(20000); p.on('pageerror', e => errors.push(e.message)); });
    const page = await ctx.newPage(); pages.push([alias, page]);
    await page.goto(new URL('/zh/app/start/', base).href);
    await page.locator('#auth-email').fill(fixture.customers[alias].username);
    await page.locator('#auth-password').fill(fixture.password);
    await page.locator('[data-auth-form] [type=submit]').click();
    await page.waitForURL(url => /^\/zh\/app\/?$/.test(url.pathname));
    await idle(page);
    return { alias, ctx, page };
  }
  async function idle(page) { await page.waitForFunction(() => document.querySelector('#fx')?.getAttribute('aria-busy') !== 'true'); }
  async function json(actor, path, options = {}, expected = 200) {
    const response = await actor.ctx.request.fetch(new URL(path, base).href, { ...options, headers: { Origin: base.origin, ...options.headers } });
    assert.equal(response.status(), expected, `${options.method ?? 'GET'} ${path}: ${await response.text()}`); return response.json();
  }
  const state = actor => json(actor, `${fixture.probePath}?customer=${encodeURIComponent(actor.alias)}`);
  const offer = tier => { const row = fixture.offers.find(p => p.tier === tier); assert.ok(row); return row; };
  const sub = (snapshot, tier = 1) => snapshot.subscriptions.find(row => row.subscription.tier === tier);
  const identity = b => ({ 'X-Fells-Support-Audience': 'customer', 'X-Fells-Expected-User': String(b.user.id), 'X-Fells-Expected-Session': b.session_id });
  async function review(actor, tier) {
    const p = offer(tier);
    await actor.page.goto(new URL('/zh/app/#/billing/market', base).href);
    const button = actor.page.locator(`[data-act=buy-monthly][data-pool="${p.poolId}"][data-tier="${tier}"]`);
    await button.click(); await actor.page.locator('[data-form=plan-select] [name=months]').fill('1');
    await actor.page.locator('[data-form=plan-select] button').click();
    await actor.page.locator('[data-plan-review]').waitFor(); await idle(actor.page);
    const text = await actor.page.locator('[data-plan-review]').innerText();
    assert.match(text, /30/); assert.ok(text.includes(`CNY ${p.monthlyMicro / 1e6}`));
    assert.match(text, new RegExp(`1/${tier}`));
  }
  async function confirm(actor, expected = 200) {
    const response = actor.page.waitForResponse(r => new URL(r.url()).pathname === '/api/app/subscriptions/buy' && r.request().method() === 'POST');
    await actor.page.locator('[data-act=plan-confirm]').click();
    const result = await response; assert.equal(result.status(), expected, await result.text());
    return { body: result.request().postDataJSON(), key: result.request().headers()['idempotency-key'], receipt: await result.json() };
  }
  async function receiptAndRide(actor, purchase) {
    await actor.page.locator('[data-plan-receipt]').waitFor();
    const actual = purchase.receipt.subscription;
    assert.ok(actual.started_at > 0 && actual.expires_at > actual.started_at);
    const receipt = await actor.page.locator('[data-plan-receipt]').innerText();
    assert.match(receipt, /1\/1|1\/2/); assert.match(receipt, new RegExp(String(new Date(actual.expires_at * 1000).getFullYear())));
    await actor.page.locator('[data-act=plan-view]').click();
    await actor.page.waitForURL(url => url.hash === '#/billing/credits'); await idle(actor.page);
    assert.match(await actor.page.locator('main').innerText(), /已分配/);
    const offerings = await json(actor, '/api/app/subscriptions');
    assert.ok(offerings.rides.some(ride => Number(ride.subscription_id) === Number(actual.id) && ride.seated === true), 'Customer sees the actual purchased allocation');
  }
  const buyer = await customer('monthly', 320), rival = await customer('rival');
  const before = await state(buyer); assert.equal(before.seatDebitCount, 0); assert.deepEqual(before.subscriptions, []);
  // Both customers review the final exclusive place before either confirms.
  await review(rival, 1); await review(buyer, 1);
  assert.equal((await state(buyer)).cashMicro, before.cashMicro, 'Opening and reviewing a package cannot debit cash');
  const initial = await confirm(buyer); receipts.initial = initial;
  assert.ok(initial.key); assert.deepEqual(initial.body, { pool_id: offer(1).poolId, tier: 1, months: 1, max_charge_micro: offer(1).monthlyMicro });
  const purchased = await state(buyer); receipts.purchasedBeforeTraffic = purchased;
  assert.equal(purchased.cashMicro, before.cashMicro - offer(1).monthlyMicro);
  assert.equal(purchased.seatDebitCount, 1); assert.equal(purchased.seatChargedMicro, offer(1).monthlyMicro);
  assert.equal(purchased.requestLogs, 0); assert.equal(purchased.syntheticUpstreamCalls, 0);
  const fixed = sub(purchased); assert.equal(fixed.assignments.length, 1); assert.equal(fixed.assignments[0].upstream, offer(1).upstream);
  assert.ok(fixed.servicePeriod > 0); assert.equal(fixed.subscription.id, initial.receipt.subscription.id);
  await receiptAndRide(buyer, initial);
  checks.push('Actual customer review → exact CNY debit and fixed account in the same committed purchase, before any inference');
  const rivalBefore = await state(rival); receipts.soldOutRejection = await confirm(rival, 409);
  assert.equal((await state(rival)).cashMicro, rivalBefore.cashMicro); assert.equal((await state(rival)).seatDebitCount, 0);
  await rival.page.goto(new URL('/zh/app/#/billing/market', base).href); await idle(rival.page);
  assert.equal(await rival.page.locator(`[data-act=buy-monthly][data-pool="${offer(1).poolId}"]`).isDisabled(), true, 'Sold-out shelf cannot advertise an actionable purchase');
  checks.push('An already reviewed sold-out package is rejected atomically; fresh sold-out UI is disabled');

  const own = identity(await json(buyer, '/api/app/bootstrap'));
  const replay = await json(buyer, '/api/app/subscriptions/buy', { method: 'POST', headers: { ...own, 'Idempotency-Key': initial.key }, data: initial.body });
  assert.equal(replay.subscription.id, initial.receipt.subscription.id);
  const replayState = await state(buyer); assert.equal(replayState.cashMicro, purchased.cashMicro); assert.equal(replayState.seatDebitCount, 1);
  assert.equal(sub(replayState).assignments[0].id, fixed.assignments[0].id); assert.equal(sub(replayState).subscription.expires_at, fixed.subscription.expires_at);
  await json(buyer, '/api/app/subscriptions/buy', { method: 'POST', headers: { ...own, 'Idempotency-Key': initial.key }, data: { ...initial.body, months: 2 } }, 409);
  checks.push('Exact operation replay and changed-body refusal cannot double-charge, extend twice, or reassign');

  await buyer.page.locator('[data-chat-support]:visible,[data-support-open]:visible').click();
  const conversation = (await json(buyer, '/api/support/conversations/current', { headers: own })).data;
  let order, activation;
  for (let attempt = 0; attempt < 100; attempt++) {
    order = (await json(buyer, `/api/support/conversations/${conversation.id}/orders`, { headers: own })).data.items.find(o => o.source === 'self_service' && o.product === 'subscription' && Number(o.subscriptionId) === fixed.subscription.id);
    if (order?.fulfilled) activation = (await json(buyer, `/api/support/conversations/${conversation.id}/cases`, { headers: own })).data.items.find(c => c.orderId === order.id && c.caseType === 'activation' && c.status === 'executed');
    if (activation) break; await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(order && activation, 'Durable wallet outbox publishes this original purchase and verified activation');
  receipts.orderBeforeAcceptance = order; receipts.activation = activation;
  await buyer.page.locator('[data-customer-orders] > summary').click();
  const accept = buyer.page.waitForResponse(r => new URL(r.url()).pathname === `/api/support/cases/${activation.id}/accept` && r.request().method() === 'POST');
  await buyer.page.locator(`[data-case-accept="${activation.id}"]`).click(); assert.equal((await accept).status(), 200);
  const accepted = (await json(buyer, `/api/support/orders/${order.id}`, { headers: own })).data;
  assert.equal(accepted.acceptanceKind, 'customer'); assert.equal(accepted.status, 'completed'); assert.equal(accepted.rewardStatus, 'awarded');
  await json(buyer, `/api/support/cases/${activation.id}/accept`, { method: 'POST', headers: own, data: { version: activation.version } }, 409);
  assert.equal(sub(await state(buyer)).assignments[0].id, fixed.assignments[0].id);
  receipts.accepted = accepted;
  checks.push('Real purchase outbox → self-service order → executed activation receipt → customer UI acceptance; replay does not award twice');

  await review(buyer, 1); const renewal = await confirm(buyer); receipts.renewal = renewal;
  const renewed = await state(buyer), renewedSub = sub(renewed);
  assert.equal(renewed.cashMicro, purchased.cashMicro - offer(1).monthlyMicro); assert.equal(renewed.seatDebitCount, 2);
  assert.equal(renewedSub.servicePeriod, fixed.servicePeriod); assert.equal(renewedSub.assignments[0].id, fixed.assignments[0].id);
  assert.equal(renewedSub.subscription.expires_at, fixed.subscription.expires_at + 30 * 86400);
  await receiptAndRide(buyer, renewal);
  checks.push('Sold-out account owner renews for exactly 30 days, retaining the original account and service period');
  const expiry = await json(buyer, `${fixture.clockPath}?customer=monthly`, { method: 'POST' });
  assert.equal(expiry.syntheticClockAdvanced, true); assert.equal(expiry.expiredRoutingAccount, '');
  const expired = await state(buyer); assert.equal(sub(expired).assignments.length, 0); assert.equal(expired.cashMicro, renewed.cashMicro);
  await review(buyer, 1); const reopened = await confirm(buyer); const reopenedState = await state(buyer); receipts.reopened = { purchase: reopened, state: reopenedState };
  assert.equal(reopenedState.seatDebitCount, 3); assert.equal(reopenedState.cashMicro, renewed.cashMicro - offer(1).monthlyMicro);
  assert.ok(sub(reopenedState).servicePeriod > fixed.servicePeriod); assert.equal(sub(reopenedState).assignments[0].upstream, offer(1).upstream);
  assert.ok(sub(reopenedState).subscription.expires_at - sub(reopenedState).subscription.started_at <= 30 * 86400 + 1, 'Expired time cannot be carried into a fresh paid term');
  await receiptAndRide(buyer, reopened);
  checks.push('Explicit synthetic expiry stops routing/releases the place; fresh UI checkout starts a new paid period');

  const poor = await customer('poor'); await review(poor, 4); receipts.insufficientFunds = await confirm(poor, 402);
  const poorState = await state(poor); assert.equal(poorState.cashMicro, 0); assert.equal(poorState.seatDebitCount, 0); assert.deepEqual(poorState.subscriptions, []);
  checks.push('Insufficient cash cannot create a subscription, assignment, debit, or fulfillment');
  const raceA = await customer('race-a'), raceB = await customer('race-b'); await review(raceA, 2); await review(raceB, 2);
  const raceResponses = [raceA, raceB].map(actor => actor.page.waitForResponse(r => new URL(r.url()).pathname === '/api/app/subscriptions/buy' && r.request().method() === 'POST'));
  await Promise.all([raceA, raceB].map(actor => actor.page.locator('[data-act=plan-confirm]').click()));
  const raceResults = await Promise.all(raceResponses); assert.deepEqual(raceResults.map(r => r.status()).sort(), [200, 409]);
  const raceStates = await Promise.all([raceA, raceB].map(state)); receipts.lastSeatRace = raceStates;
  assert.equal(raceStates.reduce((n, s) => n + s.seatDebitCount, 0), 1);
  assert.equal(raceStates.reduce((n, s) => n + s.seatChargedMicro, 0), offer(2).monthlyMicro);
  assert.equal(raceStates.flatMap(s => s.subscriptions).flatMap(s => s.assignments).length, 1);
  assert.ok(raceStates.every(s => s.requestLogs === 0 && s.syntheticUpstreamCalls === 0));
  checks.push('Two real UI customers confirming the last shared place concurrently produce one sale, one debit and one assignment');
  assert.equal(await buyer.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  assert.deepEqual(errors, []);
});
