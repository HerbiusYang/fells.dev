import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserFixture } from '../helpers/browser.mjs';
import { createAppBackend } from '../helpers/app-backend.mjs';

const fixture = createBrowserFixture();
before(() => fixture.start());
after(() => fixture.stop());
const preferences = { theme: 'light', prefs: { agent: '', send: 0 }, notifs: [true, true, true, false], onboarded: true, answers: [[0], [0], [0], [0]], promoClosed: true, sbHidden: false };
const workspace = { id: 'feedback-workspace', name: 'Feedback workspace', region: 'auto', tz: 'UTC', created: 1700000000000, role: 'owner' };
const key = { id: 17, name: 'Existing key', prefix: 'sk-existing…', kind: 'user', expires_at: 0, revoked: false, created_at: 1700000000 };
const selectedMessage = 'Copy failed. Copy the selected text manually.';

async function open(t, { clipboard = 'reject', prefix = '', route = 'api' } = {}) {
  const session = await fixture.setup(t);
  await session.page.addInitScript(mode => {
    window.feedbackCopies = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: mode === 'missing' ? undefined : {
      writeText: async value => { throw new DOMException('Clipboard permission denied', 'NotAllowedError'); },
    } });
  }, clipboard);
  const backend = createAppBackend({ preferences, modelChat: true, workspaces: [{ ...workspace }], keys: [{ ...key }] });
  await backend.install(session.context);
  await session.context.route(/\/api\/app\/catalog(?:\?.*)?$/, route => route.fulfill({ json: {
    key_id: Number(new URL(route.request().url()).searchParams.get('key_id')),
    models: [{ model: 'feedback/model', formats: ['openai-responses'], client_formats: { api: ['openai-responses'], claude_code: ['openai-responses'] }, routable: true }],
  } }));
  await session.page.goto(`${session.base}${prefix}/app/#/${route}`);
  await session.page.locator('#fx .sb').waitFor();
  await session.page.waitForFunction(() => document.querySelector('#fx')?.getAttribute('aria-busy') !== 'true');
  if (route === 'api') await session.page.locator('.codebox[data-catalog-state=ready]').waitFor();
  else await session.page.locator('[data-support-product=allowance]').waitFor();
  return { ...session, backend };
}

async function storedText(page) {
  return page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
}

for (const clipboard of ['reject', 'missing']) test(`one-time key stays visible and manually selectable when clipboard ${clipboard}, then an explicit copy retry succeeds`, async t => {
  const { page, backend, errors } = await open(t, { clipboard });
  await page.locator('.bar [data-act=new-key]').click();
  await page.locator('[data-form=key] [name=name]').fill('One-time feedback key');
  await page.locator('[data-form=key] .btn.pri').click();
  const secretText = page.locator('.dlg .codebox pre');
  await secretText.waitFor();
  const secret = await secretText.innerText();
  assert.match(secret, /^sk-contract-secret-/);
  const copies = page.locator('.dlg .codebox [data-act=copy]');
  const writesBeforeCopy = backend.state.writes.length;
  await copies.click();
  await page.locator('.toast').filter({ hasText: selectedMessage }).waitFor();
  assert.equal(await page.locator('.toast').innerText(), selectedMessage, 'failed copy cannot report success');
  assert.equal(await secretText.innerText(), secret, 'manual recovery keeps the only full secret visible');
  assert.equal(await page.evaluate(() => getSelection()?.toString()), secret, 'selection is limited to this secret codebox');
  assert.equal((await storedText(page)).includes(secret), false, 'copy fallback never persists a credential');
  assert.equal(backend.state.writes.length, writesBeforeCopy, 'copying cannot create another key or mutate the account');

  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: async value => { window.feedbackCopies.push(value); },
  } }));
  await copies.click();
  await page.locator('.toast').filter({ hasText: /^Copied$/ }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.feedbackCopies), [secret]);
  assert.equal((await storedText(page)).includes(secret), false);
  assert.equal(backend.state.writes.length, writesBeforeCopy);
  await page.locator('.dlg [data-act=close]').last().click();
  assert.equal((await page.locator('#fx').innerText()).includes(secret), false, 'closing the one-time view removes its secret');
  assert.equal((await storedText(page)).includes(secret), false);
  assert.deepEqual(errors, []);
});

test('a command copy rejection preserves and selects its visible example without claiming success', async t => {
  const { page, backend, errors } = await open(t);
  const code = page.locator('.api-quick-panel .codebox pre');
  const example = await code.innerText();
  assert.match(example, /^curl /);
  await page.locator('.api-quick-panel .codebox [data-act=copy]').click();
  await page.locator('.toast').filter({ hasText: selectedMessage }).waitFor();
  assert.equal(await page.locator('.toast').innerText(), selectedMessage);
  assert.equal(await code.innerText(), example);
  assert.equal(await page.evaluate(() => getSelection()?.toString()), example);
  assert.deepEqual(await page.evaluate(() => window.feedbackCopies), []);
  assert.equal(backend.state.writes.length, 0);
  assert.deepEqual(errors, []);
});

for (const failure of [
  {network:false,message:'Original operations are temporarily unavailable'},
  {network:true,message:'Could not connect. Check your connection and try again.'},
]) test(`historical operation read failure cannot submit a new financial operation ${failure.network?'network':'service'}`,async t=>{
 const {context,page,backend,errors}=await open(t,{route:'billing/credits'});let reads=0;const writesBefore=backend.state.writes.length;
 await context.route('**/api/app/purchase-operations/unconfirmed*',route=>{reads++;return failure.network?route.abort('failed'):route.fulfill({status:503,json:{error:failure.message}});});
 await page.locator('[data-act=operation-list]').click();await page.locator('.toast').waitFor();
 assert.ok(reads>0);assert.equal(backend.state.writes.length,writesBefore);assert.equal(await page.locator('[data-act=exchange-confirm],[data-act=plan-confirm]').count(),0);assert.equal(await page.locator('#fx .sb').count(),1);assert.deepEqual(errors,[]);
});
