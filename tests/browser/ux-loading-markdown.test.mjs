import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createBrowserFixture } from '../helpers/browser.mjs';
import { createAppBackend } from '../helpers/app-backend.mjs';

const fixture = createBrowserFixture(); before(() => fixture.start()); after(() => fixture.stop());
const preferences = { theme: 'system', prefs: { agent: '', send: 0 }, notifs: [true,true,true,false], onboarded: true, answers: [[],[],[],[]], promoClosed: true, sbHidden: false };
const workspace = { id: 'ux-audit-space', name: 'UX audit', region: 'auto', tz: 'UTC', created: 1700000000000, role: 'owner' };

test('a stalled invoice read cannot hide already loaded models or purchasable plans', async t => {
  const { context, page, base, errors } = await fixture.setup(t);
  const backend = createAppBackend({ preferences: structuredClone(preferences), tokenPlans: { plans: [{ code: 'audit-plan', name: 'Audit Ready Plan', enabled: true, new_user_only: false, price_micro: 1000000, quota_usd_micro: 5000000, burst_usd_micro: 5000000, period_days: 30, period: 'month', terms_hash: 'a'.repeat(64) }], current: null, burst_allowed: false } });
  await backend.install(context);
  let release, invoiceStarted, invoiceFinished, started = false;
  const gate = new Promise(resolve => { release = resolve; }), began = new Promise(resolve => { invoiceStarted = resolve; }), finished = new Promise(resolve => { invoiceFinished = resolve; });
  await context.route('**/api/app/invoices', async route => { started = true; invoiceStarted(); try { await gate; await route.fulfill({ json: { invoices: [] } }); } finally { invoiceFinished(); } });
  await context.route('**/api/app/catalog', route => route.fulfill({ json: { models: [{ model: 'audit-model', display_name: 'Audit Ready Model', protocols: ['anthropic'], list_priced: true, usd_in: 1000000, usd_out: 2000000 }] } }));
  try {
    await page.goto(base + '/zh/app/#/billing/market'); await began;
    await page.locator('.market-plan').filter({ hasText: 'Audit Ready Plan' }).waitFor();
    await page.locator('.market-model-table tbody tr').filter({ hasText: 'Audit Ready Model' }).waitFor();
    assert.equal(backend.state.writes.length, 0, 'independent reads cannot make a purchase');
    assert.deepEqual(errors, []);
  } finally { release(); if (started) await finished; }
});

for (const width of [320, 390, 1280]) test(`${width}px: assistant tables scroll inside the reply and retain semantic cells`, async t => {
  const { context, page, base, errors } = await fixture.setup(t, { viewport: { width, height: 800 } });
  const row = ['Model A', '**Available**', '`USD 1`', 'Long explanatory text', '[Docs](https://example.test/docs)', '<img src=x onerror=evil>'];
  const markdown = '| Model | State | Cost | Description | Source | Untrusted text |\n| :--- | :---: | ---: | --- | --- | --- |\n| ' + row.join(' | ') + ' |\n\n~~Old option~~';
  const backend = createAppBackend({ preferences: structuredClone(preferences), modelChat: true, workspaces: [{ ...workspace }], chats: [{ id: 'ux-table-chat', ws: workspace.id, title: 'Table reply', agent: 'lite', model: 'server/text-model-v2', created: 1700000000000, messages: [['you', 'Compare these options'], ['assistant', markdown]] }] });
  await backend.install(context);
  await page.goto(base + '/app/#/chat/ux-table-chat');
  const table = page.locator('.chat-markdown table'); await table.waitFor();
  assert.equal(await table.locator('th[scope=col]').count(), 6);
  assert.equal(await table.locator('tbody td').count(), 6);
  assert.equal(await table.locator('tbody strong').innerText(), 'Available');
  assert.equal(await page.locator('.chat-markdown del').innerText(), 'Old option');
  assert.equal(await table.locator('img,script,input,iframe').count(), 0);
  assert.match(await table.locator('tbody td').last().innerText(), /<img src=x/);
  assert.ok(await page.locator('#fx').evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'the reply cannot widen the application');
  const scroll = page.locator('.chat-table-scroll');
  if (width < 600) {
    assert.ok(await scroll.evaluate(element => element.scrollWidth > element.clientWidth));
    await scroll.focus(); assert.equal(await scroll.evaluate(element => document.activeElement === element), true);
    await scroll.evaluate(element => { element.scrollLeft = element.scrollWidth; });
    assert.ok(await scroll.evaluate(element => element.scrollLeft > 0));
  }
  if (width === 390) { await mkdir('test-results/claude-onboarding', { recursive: true }); await page.screenshot({ path: 'test-results/claude-onboarding/ux-table-mobile.png', animations: 'disabled' }); }
  assert.deepEqual(errors, []);
});
