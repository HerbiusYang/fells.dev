import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

// Opt-in real API/PostgreSQL coverage. Only the first successful create response
// is replaced with an explicit network-error response; business replies and data
// are always obtained from the real isolated backend.
test('deep fixes against real API and PostgreSQL: signed allowance, key semantics, historical owner, immutable retry', async t => {
  if (process.env.FELLS_DEEP_FIXES_TEST !== '1') { t.skip('Requires FELLS_DEEP_FIXES_TEST=1 and isolated deep seed'); return; }
  const base = new URL(process.env.FELLS_BROWSER_BASE ?? 'http://127.0.0.1:18087');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname));
  assert.equal(base.username + base.password + base.search + base.hash, '');
  const seed = JSON.parse(await readFile(process.env.FELLS_DEEP_FIXTURE_FILE, 'utf8')).deep;
  assert.ok(seed); const password = process.env.FELLS_LIVE_TEST_PASSWORD; assert.ok(password);
  const portal = process.env.FELLS_TEST_SUPPORT_PORTAL; assert.match(portal ?? '', /^[a-z][a-z0-9-]{2,63}$/);
  for (const name of [seed.negativeUser, seed.unlimitedUser, seed.revokedUser, seed.operator]) assert.match(name, /^business[-_.@]/);
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  t.after(() => browser.close());
  const identities = new Map();
  const errors = [], evidence = { cases: [] }, directory = process.env.FELLS_DEEP_EVIDENCE_DIR;
  if (directory) await mkdir(directory, { recursive: true });
  const context = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1050 } });
    await ctx.route('**/*', route => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort());
    ctx.on('page', page => { page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message)); });
    return ctx;
  };
  const api = async (ctx, path, method = 'GET', data, headers = {}) => {
    const response = await ctx.request.fetch(new URL(path, base).href, { method, ...(data === undefined ? {} : { data }), headers: { Origin: base.origin, ...identities.get(ctx), ...headers } });
    assert.equal(response.status(), 200, `${method} ${path}: ${await response.text()}`);
    return response.json();
  };
  let unlimitedContext;
  for (const [scenario, username] of [['negative', seed.negativeUser], ['unlimited', seed.unlimitedUser], ['revoked', seed.revokedUser]]) {
    const ctx = await context(); if (scenario === 'unlimited') unlimitedContext = ctx;
    await api(ctx, '/api/app/session', 'POST', { username, password });
    const bootstrap = await api(ctx, '/api/app/bootstrap');
    identities.set(ctx, { 'X-Fells-Expected-User': String(bootstrap.user.id), 'X-Fells-Expected-Session': bootstrap.session_id });
    const page = await ctx.newPage(); await page.goto(new URL('/app/', base).href);
    await page.locator('[data-act=account]').waitFor();
    const skip = page.locator('[data-act=ob-skip]'); if (await skip.isVisible()) { await skip.click(); await page.locator('.scrim').waitFor({ state: 'detached' }); }
    if (scenario === 'negative') {
      assert.equal(bootstrap.api_allowance.balance.micro, seed.negativeMicro);
      assert.match(await page.locator('[data-act=account]').innerText(), /-0\.10/);
    }
    await page.evaluate(() => { location.hash = '#/api'; }); await page.locator('#fx[data-route="#/api"]').waitFor();
    if (scenario === 'unlimited') {
      const limitRequests = []; page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/limits')) limitRequests.push(request.postDataJSON()); });
      await page.locator(`[data-act=key-limit][data-id="${seed.activeKeyId}"]`).click();
      assert.match(await page.locator('[data-form=key-limit]').innerText(), /Leave blank to keep/);
      assert.equal(await page.locator('[data-form=key-limit] [name=limit]').inputValue(), '');
      await page.locator('[data-form=key-limit] .btn.pri').click(); await page.locator('.scrim').waitFor({ state: 'detached' });
      assert.deepEqual(limitRequests, []);
      const keys = await api(ctx, '/api/app/keys'); assert.equal(keys.keys.find(key => key.id === Number(seed.activeKeyId)).monthly_allow_limit_micro, -1);
    } else if (scenario === 'revoked') assert.equal(await page.locator(`[data-act=key-limit][data-id="${seed.revokedKeyId}"]`).count(), 0);
    if (directory) await page.screenshot({ path: resolve(directory, scenario + '.png') });
    evidence.cases.push({ scenario, userId: bootstrap.user.id, allowanceMicro: bootstrap.api_allowance.balance.micro, appLoaded: true });
  }
  const operators = await context(); await api(operators, '/api/support/session', 'POST', { email: seed.operator, password }, { 'X-Fells-Support-Audience': 'operator' });
  const session = (await api(operators, '/api/support/session', 'GET', undefined, { 'X-Fells-Support-Audience': 'operator' })).data;
  const headers = { 'X-Fells-Support-Audience': 'operator', 'X-Fells-Expected-Operator': session.operator.id, 'X-Fells-Expected-Operator-Session': session.sessionId };
  const inbox = (await api(operators, '/api/support/conversations', 'GET', undefined, headers)).data.items;
  const negativeConversation = inbox.find(item => item.customer.id === String(evidence.cases[0].userId));
  assert.ok(negativeConversation); assert.equal(negativeConversation.customer.credits, seed.negativeMicro / 1e6);
  const desk = await operators.newPage(); await desk.goto(new URL(`/${portal}/desk/`, base).href);
  await desk.locator(`[data-support-conversation="${negativeConversation.id}"]`).click();
  assert.equal(await desk.locator('[data-support-detail-credits]').innerText(), 'USD -0.10');
  assert.equal(await desk.locator('[data-support-conversation]').count(), inbox.length);
  evidence.cases.push({ scenario: 'signed-support-inbox', conversationId: negativeConversation.id, credits: negativeConversation.customer.credits, visibleConversations: inbox.length });
  await desk.locator(`[data-support-conversation="${seed.conversationId}"]`).click();
  if (await desk.locator('[data-support-details]').isVisible() && await desk.locator('[data-support-console]').getAttribute('data-details') !== 'true') await desk.locator('[data-support-details]').click();
  await desk.locator(`[data-order-edit="${seed.historicalOrderId}"]`).click(); const form = desk.locator('[data-order-form]');
  assert.equal(await form.locator('[name=assigneeId]').inputValue(), String(seed.historicalAssigneeId));
  assert.equal(await form.locator(`[name=assigneeId] option[value="${seed.historicalAssigneeId}"]`).getAttribute("disabled"), "");
  const before = (await api(operators, `/api/support/orders/${seed.historicalOrderId}`, 'GET', undefined, headers)).data;
  const note = 'Synthetic note-only edit ' + randomUUID(); await form.locator('[name=note]').fill(note);
  const patchReply = desk.waitForResponse(response => response.request().method() === 'PATCH' && new URL(response.url()).pathname.endsWith('/orders/' + seed.historicalOrderId));
  await form.locator('[type=submit]').click(); const patched = await patchReply; assert.equal(patched.status(), 200, await patched.text());
  assert.deepEqual(patched.request().postDataJSON(), { version: before.version, note });
  const updated = (await patched.json()).data; assert.equal(updated.assigneeId, String(seed.historicalAssigneeId)); assert.equal(updated.note, note); assert.equal(updated.dueAt, before.dueAt);
  evidence.cases.push({ scenario: 'historical-assignee', request: patched.request().postDataJSON(), response: updated });
  // Real committed order, with only its reply lost. Replay must match both the
  // visible locked values and the original request, without a duplicate row.
  await desk.locator('[data-order-new]').click(); const title = 'Synthetic immutable quote ' + randomUUID();
  await form.locator('[name=title]').fill(title); await form.locator('[name=product]').selectOption('allowance'); await form.locator('[name=amount]').fill('20'); await form.locator('[name=note]').fill('Original synthetic public note');
  const path = `/api/support/conversations/${seed.conversationId}/orders`, requests = []; let committed;
  await desk.route('**' + path, async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    requests.push(route.request().postDataJSON());
    if (committed) { await route.continue(); return; }
    const response = await route.fetch(); assert.equal(response.status(), 200, await response.text()); committed = (await response.json()).data;
    await route.fulfill({ status: 503, json: { ok: false, error: { code: 'response_lost', message: 'SYNTHETIC committed reply lost' }, requestId: randomUUID() } });
  });
  await form.locator('[type=submit]').click(); await desk.locator('[data-order-error]').filter({ hasText: 'SYNTHETIC committed reply lost' }).waitFor();
  await desk.locator('[data-order-new]').click(); await form.locator('[name=product]:disabled').waitFor();
  await desk.locator(`[data-support-conversation="${seed.otherConversationId}"]`).click();
  await desk.locator(`[data-support-conversation="${seed.conversationId}"]`).click(); await desk.locator('[data-order-new]').click();
  assert.equal(await form.locator('[name=product]').isDisabled(), true); assert.equal(await form.locator('[name=amount]').inputValue(), '20'); assert.equal(await form.locator('[name=amount]').getAttribute('readonly'), ''); assert.equal(await form.locator('[name=title]').inputValue(), title);
  await form.locator('[data-order-create-hint]').filter({ hasText: 'result is uncertain' }).waitFor();
  if (directory) await form.screenshot({ path: resolve(directory, 'immutable-retry.png') });
  const reply = desk.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === path);
  await form.locator('[type=submit]').click(); const retried = await reply; assert.equal(retried.status(), 200, await retried.text());
  const saved = (await retried.json()).data; assert.equal(saved.id, committed.id); assert.deepEqual(requests[0], requests[1]);
  const orders = (await api(operators, path, 'GET', undefined, headers)).data.items;
  assert.equal(orders.filter(item => item.title === title).length, 1);
  evidence.cases.push({ scenario: 'immutable-retry', requests, committedId: committed.id, retriedId: saved.id, matchingOrderCount: 1 });
  assert.ok(unlimitedContext); assert.deepEqual(errors, []); evidence.errors = errors;
  if (directory) await writeFile(resolve(directory, 'result.json'), JSON.stringify(evidence, null, 2));
});
