import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserFixture } from '../helpers/browser.mjs';
import { createAppBackend } from '../helpers/app-backend.mjs';
import { acceptSiteConfirm } from '../helpers/site-confirm.mjs';

const fixture = createBrowserFixture();
before(() => fixture.start());
after(() => fixture.stop());

async function open(t, options = {}, role = 'owner', data = {}) {
  const { context, page, base, errors } = await fixture.setup(t, options);
  const backend = createAppBackend({
    preferences: { theme: 'system', prefs: { agent: '', send: 0 }, notifs: [true, true, true, false],
      onboarded: true, answers: [[0], [0], [0], [0]], promoClosed: true, sbHidden: false },
    workspaces: [{ id: 'quick-delete-workspace', name: 'Quick delete workspace', region: 'auto', tz: 'UTC', created: 1700000000000, role }],
    chats: [
      { id: 'chat-current', ws: 'quick-delete-workspace', title: 'Current conversation', agent: 'codex', model: 'GPT-6.1 Sol', created: 1700000000001, messages: [['you', 'Current conversation content']] },
      { id: 'chat-other', ws: 'quick-delete-workspace', title: 'Other conversation', agent: 'codex', model: 'GPT-6.1 Sol', created: 1700000000000, messages: [['you', 'Other conversation content']] },
    ],
    ...data,
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

test('pending deletion is local and keeps live edits and focus made while the DELETE is waiting', async t => {
  const { context, page, backend, errors } = await open(t);
  let release, entered, attempts = 0;
  const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  t.after(() => release());
  await context.route('**/api/app/chats/chat-other', async route => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    attempts++; entered(); await gate; return route.fallback();
  });
  await quickDelete(page, 'chat-other').click(); await acceptSiteConfirm(page); await started;
  assert.equal(await quickDelete(page, 'chat-other').isDisabled(), true);
  assert.equal(await quickDelete(page, 'chat-other').getAttribute('aria-busy'), 'true');
  assert.match(await chatLink(page, 'chat-other').innerText(), /Deleting/);
  assert.equal(await quickDelete(page, 'chat-current').isEnabled(), true);
  assert.notEqual(await page.locator('#fx').getAttribute('aria-busy'), 'true', 'unrelated actions are not globally blocked');
  const input = page.locator('#fx-input');
  await input.fill('The live draft was edited after deletion began');
  await input.evaluate(element => { window.__retainedDeleteInput = element; element.setSelectionRange(4, 12); });
  release();
  await quickDelete(page, 'chat-other').waitFor({ state: 'detached' });
  assert.equal(await input.inputValue(), 'The live draft was edited after deletion began');
  assert.deepEqual(await input.evaluate(element => [element === window.__retainedDeleteInput, element === document.activeElement, element.selectionStart, element.selectionEnd]), [true, true, 4, 12]);
  assert.equal(attempts, 1); assert.equal(deleted(backend).length, 1);
  assert.equal(backend.state.writes.some(write => write.method === 'POST'), false);
  assert.deepEqual(errors, []);
});

test('queued deletion shows its local pending state while the original full read still owns the serial boundary', async t => {
  const { context, page, backend, errors } = await open(t);
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  t.after(() => release());
  await context.route('**/api/app/profile', async route => { entered(); await gate; return route.fallback(); });
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await started;
  await quickDelete(page, 'chat-other').click(); await acceptSiteConfirm(page);
  await page.locator('.sb [data-delete-pending][data-id="chat-other"]').waitFor();
  assert.equal(deleted(backend).length, 0, 'the already active full read has not been bypassed');
  assert.notEqual(await page.locator('#fx').getAttribute('aria-busy'), 'true');
  release();
  await quickDelete(page, 'chat-other').waitFor({ state: 'detached' });
  assert.equal(deleted(backend).length, 1); assert.deepEqual(errors, []);
});

test('finishing deletion does not navigate away from another conversation opened while it was pending', async t => {
  const { context, page, backend, errors } = await open(t);
  let release;
  const gate = new Promise(resolve => { release = resolve; }); t.after(() => release());
  await context.route('**/api/app/chats/chat-current', async route => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    await gate; return route.fallback();
  });
  await quickDelete(page, 'chat-current').click(); await acceptSiteConfirm(page);
  await page.locator('.sb [data-delete-pending][data-id="chat-current"]').waitFor();
  await chatLink(page, 'chat-other').click();
  await page.locator('.main .msg-body').filter({ hasText: 'Other conversation content' }).waitFor();
  await page.locator('#fx-input').fill('Draft in the conversation I opened');
  release(); await quickDelete(page, 'chat-current').waitFor({ state: 'detached' });
  assert.equal(new URL(page.url()).hash, '#/chat/chat-other');
  assert.equal(await page.locator('#fx-input').inputValue(), 'Draft in the conversation I opened');
  assert.equal(await page.locator('#fx-input').evaluate(element => element === document.activeElement), true);
  assert.equal(deleted(backend).length, 1); assert.deepEqual(errors, []);
});

test('a workspace switch waiting for deletion preserves its selected workspace without recreating the deleted conversation', async t => {
  const nextWorkspace = 'quick-delete-second-workspace';
  const { context, page, backend, errors } = await open(t, {}, 'owner', { workspaces: [
    { id: 'quick-delete-workspace', name: 'Quick delete workspace', region: 'auto', tz: 'UTC', created: 1700000000000, role: 'owner' },
    { id: nextWorkspace, name: 'Second workspace', region: 'auto', tz: 'UTC', created: 1700000000000, role: 'owner' },
  ] });
  let release;
  const gate = new Promise(resolve => { release = resolve; }); t.after(() => release());
  await context.route('**/api/app/chats/chat-other', async route => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    await gate; return route.fallback();
  });
  await quickDelete(page, 'chat-other').click(); await acceptSiteConfirm(page);
  await page.locator('.sb [data-delete-pending][data-id="chat-other"]').waitFor();
  await page.locator('[data-act=switcher]').click();
  await page.locator(`.pop [data-act=switch][data-id="${nextWorkspace}"]`).click();
  await page.waitForFunction(id => document.querySelector('#fx')?.dataset.workspace === id, nextWorkspace);
  assert.deepEqual(backend.state.writes, [], 'the waiting workspace save has sent no write before the DELETE ACK');
  release(); await idle(page);
  assert.equal(await page.locator('#fx').getAttribute('data-workspace'), nextWorkspace);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('fells.app.current.42')), nextWorkspace);
  assert.deepEqual(backend.state.chats.map(chat => chat.id), ['chat-current']);
  assert.deepEqual(backend.state.writes.map(write => [write.method, write.path]), [['DELETE', '/api/app/chats/chat-other']]);
  assert.deepEqual(errors, []);
});

for (const externalChange of [false, true]) test(`a profile save waiting for deletion ${externalChange ? 'refuses an external profile change' : 'retains its original intent and form'}`, async t => {
  const { context, page, backend, errors } = await open(t);
  let release;
  const gate = new Promise(resolve => { release = resolve; }); t.after(() => release());
  await context.route('**/api/app/chats/chat-other', async route => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    await gate; return route.fallback();
  });
  await quickDelete(page, 'chat-other').click(); await acceptSiteConfirm(page);
  await page.locator('.sb [data-delete-pending][data-id="chat-other"]').waitFor();
  await page.evaluate(() => { location.hash = '#/settings/0'; });
  const form = page.locator('[data-form=profile]'), name = form.locator('[name=name]'); await form.waitFor();
  await name.fill('Profile intent while deleting');
  await name.evaluate(element => { window.__deleteWaitingName = element; });
  await form.locator('button[type=submit], button:not([type])').click();
  assert.equal(await name.evaluate(element => element === window.__deleteWaitingName), true);
  assert.equal(await name.inputValue(), 'Profile intent while deleting');
  assert.deepEqual(backend.state.writes, [], 'no profile POST precedes the DELETE ACK');
  if (externalChange) backend.state.profile.name = 'Profile changed elsewhere';
  const profileResponse = externalChange ? null : page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/app/profile');
  release(); if (profileResponse) assert.equal((await profileResponse).status(), 200);
  await idle(page);
  assert.equal(backend.state.profile.name, externalChange ? 'Profile changed elsewhere' : 'Profile intent while deleting');
  assert.equal(await name.inputValue(), backend.state.profile.name);
  assert.deepEqual(backend.state.chats.map(chat => chat.id), ['chat-current']);
  assert.deepEqual(backend.state.writes.map(write => [write.method, write.path]), [
    ['DELETE', '/api/app/chats/chat-other'], ...(externalChange ? [] : [['POST', '/api/app/profile']]),
  ]);
  assert.deepEqual(errors, []);
});

test('an explicit server rejection is shown as a failed deletion rather than an unconfirmed result', async t => {
  const { context, page, backend, errors } = await open(t); let attempts = 0;
  await context.route('**/api/app/chats/chat-other', route => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    attempts++; return route.fulfill({ status: 403, json: { error: 'Synthetic authority rejection' } });
  });
  await quickDelete(page, 'chat-other').click(); await acceptSiteConfirm(page);
  const toast = page.locator('.toast').filter({ hasText: 'The conversation could not be deleted' }); await toast.waitFor();
  assert.doesNotMatch(await toast.innerText(), /unconfirmed/);
  assert.equal(attempts, 1); assert.equal(backend.state.chats.length, 2); assert.deepEqual(deleted(backend), []);
  assert.deepEqual(errors, []);
});

for (const interference of ['blocked', 'failed']) test(`DELETE ACK is visible without ${interference} unrelated reads or a self-broadcast reload`, async t => {
  const { context, page, backend, errors } = await open(t);
  let release, interfering = true;
  const gate = new Promise(resolve => { release = resolve; }), unrelated = [];
  t.after(() => release());
  await context.route('**/api/app/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (interfering && request.method() === 'GET' && /^\/api\/app\/(?:profile|preferences|keys|workspaces(?:\/[^/]+\/chats)?)$/.test(path)) {
      unrelated.push(path);
      if (interference === 'failed') return route.fulfill({ status: 503, json: { error: 'Synthetic unrelated read failure' } });
      await gate;
    }
    return route.fallback();
  });
  await page.evaluate(() => {
    window.__deleteNotifications = [];
    window.__deleteSubscriber = new BroadcastChannel('fells.app.changed.v1');
    window.__deleteSubscriber.onmessage = event => window.__deleteNotifications.push(event.data);
  });
  const ack = page.waitForResponse(response => response.request().method() === 'DELETE' && new URL(response.url()).pathname === '/api/app/chats/chat-other');
  await quickDelete(page, 'chat-other').click(); await acceptSiteConfirm(page);
  assert.equal((await ack).status(), 204);
  await quickDelete(page, 'chat-other').waitFor({ state: 'detached' });
  await page.waitForFunction(() => window.__deleteNotifications.length === 1);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.deepEqual(unrelated, [], 'neither pre/post full reads nor the local notification are on the ACK path');
  assert.equal(deleted(backend).length, 1);
  assert.equal(await chatLink(page, 'chat-current').count(), 1);

  // A different same-origin page still invalidates this page. The local
  // subscriber above also received the module's own change, without a snapshot.
  assert.deepEqual(await page.evaluate(() => Object.keys(window.__deleteNotifications[0])), ['source']);
  interfering = false; release();
  await context.route('**/synthetic-change-peer', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Synthetic change peer</title>' }));
  const peer = await context.newPage();
  await peer.goto(new URL('/synthetic-change-peer', page.url()).href);
  backend.state.chats[0].title = 'Conversation updated in another page';
  const reread = page.waitForRequest(request => request.method() === 'GET' && new URL(request.url()).pathname === '/api/app/workspaces/quick-delete-workspace/chats');
  await peer.evaluate(() => { const channel = new BroadcastChannel('fells.app.changed.v1'); channel.postMessage('changed'); channel.close(); });
  await page.waitForFunction(() => window.__deleteNotifications.includes('changed'));
  await reread;
  await chatLink(page, 'chat-current').filter({ hasText: 'Conversation updated in another page' }).waitFor();
  await peer.close();
  assert.equal(deleted(backend).length, 1); assert.deepEqual(errors, []);
});

test('a target changed after confirmation was opened is not deleted', async t => {
  const { page, backend, errors } = await open(t);
  await quickDelete(page, 'chat-other').click();
  backend.state.chats.find(chat => chat.id === 'chat-other').title = 'Changed while confirming';
  await acceptSiteConfirm(page);
  await chatLink(page, 'chat-other').filter({ hasText: 'Changed while confirming' }).waitFor();
  assert.equal(deleted(backend).length, 0);
  assert.equal(backend.state.chats.length, 2);
  assert.equal(new URL(page.url()).hash, '#/chat/chat-current');
  assert.deepEqual(errors, []);
});

test('a lost deletion response leaves an unconfirmed row and does not automatically resend', async t => {
  const { context, page, backend, errors } = await open(t);
  let attempts = 0;
  await context.route('**/api/app/chats/chat-other', route => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    attempts++; return route.abort('failed');
  });
  await quickDelete(page, 'chat-other').click(); await acceptSiteConfirm(page);
  await page.locator('.toast').filter({ hasText: 'Deletion is unconfirmed' }).waitFor();
  assert.equal(await quickDelete(page, 'chat-other').isEnabled(), true);
  const reread = page.waitForResponse(response => response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/app/workspaces/quick-delete-workspace/chats');
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await reread;
  assert.equal(attempts, 1); assert.equal(backend.state.chats.length, 2);
  assert.deepEqual(deleted(backend), []); assert.deepEqual(errors, []);
});

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
