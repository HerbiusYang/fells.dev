import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserFixture } from '../helpers/browser.mjs';
import { createAppBackend } from '../helpers/app-backend.mjs';
import { acceptSiteConfirm } from '../helpers/site-confirm.mjs';

const fixture = createBrowserFixture();
before(() => fixture.start());
after(() => fixture.stop());

async function open(t, options = {}, role = 'owner') {
  const { context, page, base, errors } = await fixture.setup(t, options);
  const backend = createAppBackend({
    preferences: { theme: 'system', prefs: { agent: '', send: 0 }, notifs: [true, true, true, false],
      onboarded: true, answers: [[0], [0], [0], [0]], promoClosed: true, sbHidden: false },
    workspaces: [{ id: 'quick-delete-workspace', name: 'Quick delete workspace', region: 'auto', tz: 'UTC', created: 1700000000000, role }],
    chats: [
      { id: 'chat-current', ws: 'quick-delete-workspace', title: 'Current conversation', agent: 'codex', model: 'GPT-6.1 Sol', created: 1700000000001, messages: [['you', 'Current conversation content']] },
      { id: 'chat-other', ws: 'quick-delete-workspace', title: 'Other conversation', agent: 'codex', model: 'GPT-6.1 Sol', created: 1700000000000, messages: [['you', 'Other conversation content']] },
    ],
  });
  await backend.install(context);
  await page.goto(base + '/app/#/chat/chat-current');
  await page.locator('.main .msg-body').filter({ hasText: 'Current conversation content' }).waitFor();
  // The first conversation render precedes the parallel account/member loads.
  // Wait for their rendered result before manipulating a control they replace.
  await page.locator('.sb [data-go=members] .end').filter({ hasText: /^1\/32$/ }).waitFor();
  if (options.isMobile) await page.locator('[data-act=sb]').click();
  return { context, page, backend, errors };
}

const quickDelete = (page, id) => page.locator(`.sb .chat-delete[data-id="${id}"]`);
const chatLink = (page, id) => page.locator(`.sb .chat-i[data-go="chat/${id}"]`);
const deleted = backend => backend.state.writes.filter(write => write.method === 'DELETE' && write.path.startsWith('/api/app/chats/'));
async function idle(page) { await page.waitForFunction(() => document.querySelector('#fx')?.getAttribute('aria-busy') !== 'true'); }

test('quick deletion of another conversation keeps the current conversation open', async t => {
  const { page, backend, errors } = await open(t);
  const draft = 'Draft to keep while removing another conversation';
  await page.locator('#fx-input').fill(draft);
  await page.locator('#fx-input').evaluate(element => element.setSelectionRange(6, 13));
  await quickDelete(page, 'chat-other').click();
  await acceptSiteConfirm(page);
  await quickDelete(page, 'chat-other').waitFor({ state: 'detached' });
  await idle(page);
  assert.equal(new URL(page.url()).hash, '#/chat/chat-current');
  assert.equal(await page.locator('.main .msg-body').innerText(), 'Current conversation content');
  assert.equal(await page.locator('#fx-input').inputValue(), draft, 'deleting another conversation preserves the unsent draft');
  assert.deepEqual(await page.locator('#fx-input').evaluate(element => [element.selectionStart, element.selectionEnd]), [6, 13]);
  assert.deepEqual(backend.state.chats.map(chat => chat.id), ['chat-current']);
  assert.deepEqual(backend.state.chats[0].messages, [['you', 'Current conversation content']], 'the preserved draft is not submitted');
  assert.equal(backend.state.writes.some(write => write.method === 'POST' && /\/api\/app\/chats(?:\/|$)/.test(write.path)), false);
  assert.deepEqual(deleted(backend).map(write => write.path), ['/api/app/chats/chat-other']);
  assert.deepEqual(errors, []);
});

test('quick deletion of the current conversation opens a new conversation', async t => {
  const { page, backend, errors } = await open(t);
  await quickDelete(page, 'chat-current').click();
  await acceptSiteConfirm(page);
  await page.waitForFunction(() => document.querySelector('#fx')?.dataset.route === '#/new');
  await idle(page);
  assert.equal(await quickDelete(page, 'chat-current').count(), 0);
  assert.equal(await quickDelete(page, 'chat-other').count(), 1);
  assert.deepEqual(backend.state.chats.map(chat => chat.id), ['chat-other']);
  assert.deepEqual(deleted(backend).map(write => write.path), ['/api/app/chats/chat-current']);
  assert.deepEqual(errors, []);
});

test('a focus refresh preserves the current conversation draft and selection', async t => {
  const { page, backend, errors } = await open(t);
  const draft = 'An unsent draft survives a server refresh';
  await page.locator('#fx-input').fill(draft);
  await page.locator('#fx-input').evaluate(element => element.setSelectionRange(3, 15));
  backend.state.profile.name = 'Refreshed profile name';
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  // A changed server value makes completion observable without a timer.
  await page.locator('.me-btn b').filter({ hasText: 'Refreshed profile name' }).waitFor();
  assert.equal(await page.locator('#fx-input').inputValue(), draft);
  assert.deepEqual(await page.locator('#fx-input').evaluate(element => [element.selectionStart, element.selectionEnd]), [3, 15]);
  assert.equal(await page.locator('#fx-input').evaluate(element => element === document.activeElement), true);
  assert.equal(new URL(page.url()).hash, '#/chat/chat-current');
  assert.deepEqual(backend.state.writes, []);
  assert.deepEqual(backend.state.chats[0].messages, [['you', 'Current conversation content']]);
  assert.deepEqual(errors, []);
});

test('keyboard users can reach quick delete and cancelling confirmation performs no write', async t => {
  const { page, backend, errors } = await open(t);
  await chatLink(page, 'chat-other').focus();
  await page.keyboard.press('Tab');
  const button = quickDelete(page, 'chat-other');
  assert.equal(await button.evaluate(element => element === document.activeElement), true);
  assert.match(await button.getAttribute('aria-label'), /Other conversation/);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.chat-delete[data-id="chat-other"]')).opacity === '1');
  const writesBefore = backend.state.writes.length;
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('alertdialog');
  await dialog.waitFor();
  assert.equal(await dialog.locator('[data-confirm-cancel]').evaluate(button => document.activeElement === button), true);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await button.evaluate(element => document.activeElement === element), true);
  assert.equal(backend.state.writes.length, writesBefore);
  assert.equal(await page.locator('.sb .chat-delete').count(), 2);
  assert.equal(new URL(page.url()).hash, '#/chat/chat-current');
  assert.deepEqual(errors, []);
});

test('a rejected quick deletion restores the conversation and allows a real retry', async t => {
  const { context, page, backend, errors } = await open(t);
  let attempts = 0;
  const rejectDelete = async route => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    attempts++;
    return route.fulfill({ status: 503, json: { error: 'Injected delete failure' } });
  };
  await context.route('**/api/app/chats/chat-current', rejectDelete);
  await quickDelete(page, 'chat-current').click();
  await acceptSiteConfirm(page);
  await page.locator('.toast').filter({ hasText: 'Injected delete failure' }).waitFor();
  await idle(page);
  assert.equal(attempts, 1);
  assert.equal(await page.locator('.sb .chat-delete').count(), 2);
  assert.equal(new URL(page.url()).hash, '#/chat/chat-current');
  assert.equal(await page.locator('.main .msg-body').innerText(), 'Current conversation content');
  assert.equal(backend.state.chats.length, 2);
  assert.deepEqual(deleted(backend), []);
  await context.unroute('**/api/app/chats/chat-current', rejectDelete);
  await quickDelete(page, 'chat-current').click();
  await acceptSiteConfirm(page);
  await page.waitForFunction(() => document.querySelector('#fx')?.dataset.route === '#/new');
  await idle(page);
  assert.deepEqual(backend.state.chats.map(chat => chat.id), ['chat-other']);
  assert.equal(deleted(backend).length, 1);
  assert.deepEqual(errors, []);
});

test('read-only example conversations expose no deletion action', async t => {
  const { page, backend, errors } = await open(t);
  await page.locator('[data-act=switcher]').click();
  await page.locator('.pop [data-act=switch][data-id=example]').click();
  await page.locator('.pop').waitFor({ state: 'detached' });
  await page.locator('.sb .chat-i[data-go="chat/ex0"]').waitFor();
  await idle(page);
  assert.ok(await page.locator('.sb .chat-i').count() > 0);
  assert.equal(await page.locator('.sb .chat-delete').count(), 0);
  await page.locator('.sb .chat-i').first().click();
  await page.locator('.main [data-thread]').waitFor();
  assert.equal(await page.locator('[data-act=del-chat]').count(), 0);
  assert.deepEqual(deleted(backend), []);
  assert.deepEqual(errors, []);
});

test('workspace viewers can read conversations without any deletion controls', async t => {
  const { page, backend, errors } = await open(t, {}, 'viewer');
  assert.equal(await page.locator('.sb .chat-i').count(), 2);
  assert.equal(await page.locator('.sb .chat-delete').count(), 0);
  assert.equal(await page.locator('.main [data-act=del-chat]').count(), 0);
  await chatLink(page, 'chat-other').click();
  await page.locator('.main .msg-body').filter({ hasText: 'Other conversation content' }).waitFor();
  assert.equal(await page.locator('[data-act=del-chat]').count(), 0);
  assert.deepEqual(deleted(backend), []);
  assert.deepEqual(errors, []);
});

test('mobile quick-delete controls are visible without hover and receive taps', async t => {
  const { page, backend, errors } = await open(t, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const button = quickDelete(page, 'chat-other');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.chat-delete[data-id="chat-other"]')).opacity === '1');
  const target = await button.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return { width: rect.width, height: rect.height, reachable: top === element || element.contains(top) };
  });
  assert.ok(target.width >= 40 && target.height >= 40 && target.reachable, JSON.stringify(target));
  await button.tap();
  await acceptSiteConfirm(page);
  await button.waitFor({ state: 'detached' });
  await idle(page);
  assert.equal(new URL(page.url()).hash, '#/chat/chat-current');
  assert.deepEqual(backend.state.chats.map(chat => chat.id), ['chat-current']);
  assert.deepEqual(errors, []);
});
