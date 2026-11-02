import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createBrowserFixture } from '../helpers/browser.mjs';
import { createAppBackend } from '../helpers/app-backend.mjs';
import { acceptSiteConfirm } from '../helpers/site-confirm.mjs';

const fixture = createBrowserFixture();
before(() => fixture.start()); after(() => fixture.stop());
const path = '/api/app/workspaces/clear-workspace/chats';
const button = page => page.locator('.sb [data-act=clear-chats]');
const clears = backend => backend.state.writes.filter(write => write.method === 'DELETE' && write.path === path);
const chat = (id, ws = 'clear-workspace') => ({ id, ws, title: `Conversation ${id}`, agent: 'codex', model: 'Server model', created: 1700000000000, messages: [['you', `Content ${id}`]] });
async function open(t, { width = 1280, locale = 'en', role = 'owner', run } = {}) {
  const f = await fixture.setup(t, { viewport: { width, height: 800 }, ...(width < 800 ? { isMobile: true, hasTouch: true } : {}) });
  const backend = createAppBackend({
    preferences: { theme: 'light', prefs: { agent: '', send: 0 }, notifs: [true, true, true, false], onboarded: true, answers: [[], [], [], []], promoClosed: true, sbHidden: false },
    workspaces: [{ id: 'clear-workspace', name: 'Shared project', region: 'auto', tz: 'UTC', created: 1700000000000, role }, { id: 'other-workspace', name: 'Other workspace', region: 'auto', tz: 'UTC', created: 1700000000001, role: 'owner' }],
    chats: [chat('current'), chat('second'), chat('foreign', 'other-workspace')],
  });
  await backend.install(f.context);
  if (run) {
    const value = { chat_id: 'second', request_id: 'a3178ad9-2dea-469a-83ea-b3df125a8958', status: run };
    backend.state.chatRuns[value.request_id] = value;
    await f.context.addInitScript(value => sessionStorage.setItem(`fells.chat-run.v1:42:${'c'.repeat(64)}`, JSON.stringify([value])), value);
  }
  await f.page.goto(f.base + (locale === 'en' ? '/app/' : `/${locale}/app/`) + '#/chat/current');
  await f.page.locator('.main .msg-body').filter({ hasText: 'Content current' }).waitFor();
  await f.page.locator('.sb [data-go=members] .end').filter({ hasText: /^1\/32$/ }).waitFor();
  if (width < 800) await f.page.locator('[data-act=sb]').click();
  return { ...f, backend };
}

for (const [locale, width] of [['en', 1280], ['zh', 320]]) test(`clear-all has an explicit scoped, safely cancellable site confirmation: ${locale}`, async t => {
  const { page, backend, errors } = await open(t, { locale, width });
  await button(page).click();
  const dialog = page.getByRole('alertdialog'); await dialog.waitFor();
  const text = await dialog.innerText();
  assert.match(text, /Shared project/); assert.match(text, /2/);
  assert.match(text, locale === 'en' ? /cannot be undone/ : /无法恢复/);
  assert.match(text, locale === 'en' ? /everyone in this workspace/ : /所有成员/);
  assert.equal(await dialog.locator('[data-confirm-cancel]').evaluate(element => document.activeElement === element), true);
  const box = await dialog.boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= width + 1 && box.y >= 0 && box.y + box.height <= 801);
  await mkdir('test-results/package-audit', { recursive: true });
  await page.screenshot({ path: `test-results/package-audit/clear-all-${locale}-${width}.png`, fullPage: true });
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
  assert.equal(await button(page).evaluate(element => element === document.activeElement), true);
  assert.deepEqual(clears(backend), []); assert.equal(backend.state.chats.length, 3); assert.deepEqual(errors, []);
});

test('clear-all sends one batch, blocks duplicate submits and reaches the empty state without touching another workspace', async t => {
  const { context, page, backend, errors } = await open(t);
  let release, entered, attempts = 0;
  const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; }); t.after(() => release());
  await context.route('**' + path, async route => { if (route.request().method() !== 'DELETE') return route.fallback(); attempts++; entered(); await gate; return route.fallback(); });
  await page.locator('#fx-input').fill('Draft stays visible until deletion succeeds');
  await button(page).click();
  await page.getByRole('alertdialog').locator('[data-confirm-accept]').evaluate(element => { element.click(); element.click(); });
  await started;
  assert.equal(await button(page).isDisabled(), true); assert.equal(await button(page).getAttribute('aria-busy'), 'true');
  assert.equal(await page.locator('.composer .send').isDisabled(), true);
  assert.equal(await page.locator('#fx-input').inputValue(), 'Draft stays visible until deletion succeeds');
  await button(page).evaluate(element => element.click()); assert.equal(attempts, 1);
  release(); await page.waitForFunction(() => document.querySelector('#fx')?.dataset.route === '#/new');
  await page.locator('.sb .empty-note').waitFor();
  assert.equal(await button(page).isDisabled(), true); assert.deepEqual(backend.state.chats.map(c => c.id), ['foreign']);
  assert.deepEqual(clears(backend).map(write => write.body.chat_ids), [['current', 'second']]);
  assert.match(clears(backend)[0].body.request_id, /^[0-9a-f-]{36}$/i); assert.equal(attempts, 1); assert.deepEqual(errors, []);
});

test('a rejected clear-all preserves the current draft and allows a newly confirmed retry', async t => {
  const { context, page, backend, errors } = await open(t);
  const reject = route => route.request().method() === 'DELETE' ? route.fulfill({ status: 409, json: { error: 'A reply is still running' } }) : route.fallback();
  await context.route('**' + path, reject);
  await page.locator('#fx-input').fill('Keep this draft on rejection');
  await button(page).click(); await acceptSiteConfirm(page);
  await page.locator('#chat-clear-status').filter({ hasText: 'Chats could not be cleared' }).waitFor();
  assert.equal(await button(page).isEnabled(), true); assert.equal(await page.locator('#fx-input').inputValue(), 'Keep this draft on rejection');
  assert.equal(backend.state.chats.length, 3); assert.deepEqual(clears(backend), []);
  await context.unroute('**' + path, reject);
  await button(page).click(); await acceptSiteConfirm(page);
  await page.locator('.sb .empty-note').waitFor(); assert.equal(clears(backend).length, 1); assert.deepEqual(errors, []);
});

for (const [code, message] of [['chat_clear_rate_limited', 'Try again later'], ['chat_clear_history_limit', 'Bulk deletion is unavailable']]) test(`clear-all explains ${code} without suggesting a futile refresh`, async t => {
  const { context, page, backend, errors } = await open(t);
  await context.route('**' + path, route => route.request().method() === 'DELETE' ? route.fulfill({ status: 429, json: { code, error: 'Synthetic limit' } }) : route.fallback());
  await button(page).click(); await acceptSiteConfirm(page);
  await page.locator('#chat-clear-status').filter({ hasText: message }).waitFor();
  assert.match(await page.locator('#chat-clear-status').innerText(), /individually/);
  assert.equal(await page.locator('[data-act=clear-chats-refresh]').count(), 0);
  assert.equal(await page.locator('.sb .chat-delete').count(), 2); assert.deepEqual(clears(backend), []); assert.deepEqual(errors, []);
});

test('an uncertain clear-all is never retried automatically and an explicit same-selection retry retains its request identity', async t => {
  const { context, page, backend, errors } = await open(t);
  const bodies = [];
  const lose = route => { if (route.request().method() !== 'DELETE') return route.fallback(); bodies.push(route.request().postDataJSON()); return route.abort('failed'); };
  await context.route('**' + path, lose);
  await button(page).click(); await acceptSiteConfirm(page);
  await page.locator('#chat-clear-status').filter({ hasText: 'Deletion is not yet confirmed' }).waitFor();
  assert.equal(bodies.length, 1); assert.equal(backend.state.chats.length, 3);
  await page.locator('[data-act=clear-chats-refresh]').click();
  await page.locator('#chat-clear-status').waitFor({ state: 'detached' });
  await context.unroute('**' + path, lose);
  await button(page).click(); await acceptSiteConfirm(page);
  await page.locator('.sb .empty-note').waitFor();
  assert.deepEqual(clears(backend)[0].body, bodies[0]); assert.equal(clears(backend).length, 1); assert.deepEqual(errors, []);
});

test('a changed conversation during clear-all confirmation is refreshed without deleting it', async t => {
  const { page, backend, errors } = await open(t);
  await button(page).click(); backend.state.chats[0].messages = [['you', 'Changed during confirmation']];
  await acceptSiteConfirm(page);
  await page.locator('.main .msg-body').filter({ hasText: 'Changed during confirmation' }).waitFor();
  assert.deepEqual(clears(backend), []); assert.equal(backend.state.chats.length, 3); assert.deepEqual(errors, []);
});

test('an external list refresh invalidates an open clear-all confirmation instead of expanding its selection', async t => {
  const { page, backend, errors } = await open(t);
  await button(page).click(); await page.getByRole('alertdialog').waitFor();
  backend.state.chats.push(chat('added-while-confirming'));
  await page.evaluate(() => dispatchEvent(new Event('focus')));
  await page.locator('.sb [data-go="chat/added-while-confirming"]').waitFor();
  await acceptSiteConfirm(page);
  assert.deepEqual(clears(backend), []); assert.equal(backend.state.chats.length, 4); assert.deepEqual(errors, []);
});

test('pending and completed clear-all preserve an unrelated profile input, focus and DOM node', async t => {
  const { context, page, backend, errors } = await open(t);
  await page.evaluate(() => { location.hash = '/settings/0'; });
  const name = page.locator('[data-form=profile] input[name=name]');
  await name.fill('Unsubmitted profile name');
  await name.evaluate(element => { window.retainedClearProfileInput = element; });
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; }); t.after(() => release());
  await context.route('**' + path, async route => { if (route.request().method() !== 'DELETE') return route.fallback(); entered(); await gate; return route.fallback(); });
  await button(page).click(); await acceptSiteConfirm(page); await started;
  assert.equal(await name.inputValue(), 'Unsubmitted profile name');
  await name.fill('Further edits during deletion');
  await name.evaluate(element => element.setSelectionRange(3, 11));
  release(); await page.locator('.sb .empty-note').waitFor();
  assert.equal(await name.inputValue(), 'Further edits during deletion');
  assert.deepEqual(await name.evaluate(element => [element === window.retainedClearProfileInput, element === document.activeElement, element.selectionStart, element.selectionEnd]), [true, true, 3, 11]);
  assert.equal(new URL(page.url()).hash, '#/settings/0');
  assert.equal(backend.state.writes.some(write => write.path === '/api/app/profile'), false); assert.deepEqual(errors, []);
});

test('clear-all preserves a conversation created concurrently after its selection was confirmed', async t => {
  const { context, page, backend, errors } = await open(t);
  await context.route('**' + path, route => { if (route.request().method() === 'DELETE') backend.state.chats.push(chat('new-chat')); return route.fallback(); });
  await button(page).click(); await acceptSiteConfirm(page);
  await page.locator('.sb [data-go="chat/new-chat"]').waitFor();
  await page.locator('.sb [data-go="chat/current"]').waitFor({ state: 'detached' });
  assert.deepEqual(backend.state.chats.map(c => c.id), ['foreign', 'new-chat']);
  assert.deepEqual(clears(backend)[0].body.chat_ids, ['current', 'second']); assert.deepEqual(errors, []);
});

for (const concurrent of [false, true]) test(`switching workspace while clear-all waits preserves that selection and never resurrects deleted conversations${concurrent ? ' with a concurrent new chat' : ''}`, async t => {
  const { context, page, backend, errors } = await open(t);
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; }); t.after(() => release());
  await context.route('**' + path, async route => { if (route.request().method() !== 'DELETE') return route.fallback(); entered(); await gate; return route.fallback(); });
  await button(page).click(); await acceptSiteConfirm(page); await started;
  await page.locator('[data-act=switcher]').click(); await page.locator('[data-act=switch][data-id=other-workspace]').click();
  if (concurrent) backend.state.chats.push(chat('concurrent-new'));
  release();
  await page.waitForFunction(() => document.querySelector('#fx')?.dataset.workspace === 'other-workspace' && document.querySelector('#fx')?.getAttribute('aria-busy') !== 'true');
  await page.locator('.sb [data-go="chat/foreign"]').waitFor();
  assert.deepEqual(backend.state.chats.map(c => c.id), concurrent ? ['foreign', 'concurrent-new'] : ['foreign']); assert.equal(clears(backend).length, 1);
  assert.equal(backend.state.writes.some(write => write.method === 'POST' && write.path === '/api/app/chats'), false); assert.deepEqual(errors, []);
});

for (const role of ['editor', 'viewer']) test(`workspace ${role} has no bulk deletion control`, async t => {
  const { page, backend, errors } = await open(t, { role });
  assert.equal(await button(page).count(), 0); assert.deepEqual(clears(backend), []); assert.deepEqual(errors, []);
});
for (const run of ['pending', 'running', 'unknown']) test(`clear-all respects ${run} generation without coupling deletion to settlement`, async t => {
  const { page, backend, errors } = await open(t, { run });
  if (run === 'unknown') {
    assert.equal(await button(page).isEnabled(), true); await button(page).click(); await acceptSiteConfirm(page);
    await page.locator('.sb .empty-note').waitFor(); assert.equal(clears(backend).length, 1);
  } else {
    assert.equal(await button(page).isDisabled(), true);
    assert.match(await page.locator('#chat-clear-status').innerText(), /replies to finish/); assert.deepEqual(clears(backend), []);
  }
  assert.deepEqual(errors, []);
});

test('refreshing a stale run in an unopened conversation unlocks clear-all using reads only', async t => {
  const { context, page, backend, errors } = await open(t, { run: 'running' });
  const requestID = 'a3178ad9-2dea-469a-83ea-b3df125a8958';
  backend.state.chatRuns[requestID] = { request_id: requestID, status: 'completed' };
  let release, entered, reads = 0;
  const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; }); t.after(() => release());
  await context.route('**/api/app/chats/second/runs/' + requestID, async route => { assert.equal(route.request().method(), 'GET'); reads++; entered(); await gate; return route.fallback(); });
  const refresh = page.locator('[data-act=clear-chats-refresh]');
  await refresh.click(); await started;
  assert.equal(await refresh.isDisabled(), true); assert.equal(await button(page).isDisabled(), true);
  await refresh.evaluate(element => element.click()); assert.equal(reads, 1);
  release();
  await page.waitForFunction(() => document.querySelector('[data-act=clear-chats]')?.disabled === false);
  assert.equal(new URL(page.url()).hash, '#/chat/current');
  assert.equal(reads, 1); assert.deepEqual(backend.state.generations, []); assert.deepEqual(backend.state.writes, []);
  await button(page).click(); await acceptSiteConfirm(page);
  await page.locator('.sb .empty-note').waitFor();
  assert.equal(clears(backend).length, 1); assert.deepEqual(backend.state.generations, []); assert.deepEqual(errors, []);
});

test('ending a session closes clear-all confirmation without dispatching deletion', async t => {
  const { page, backend, errors } = await open(t);
  await button(page).click(); await page.getByRole('alertdialog').waitFor(); backend.state.signedIn = false;
  await page.evaluate(() => { const stale = document.querySelector('[data-confirm-accept]'); dispatchEvent(new CustomEvent('fells.session.changed', { detail: { audience: 'customer' } })); stale.click(); });
  await page.waitForURL(url => /\/app\/start\/?$/.test(url.pathname));
  assert.deepEqual(clears(backend), []); assert.equal(backend.state.chats.length, 3); assert.deepEqual(errors, []);
});
