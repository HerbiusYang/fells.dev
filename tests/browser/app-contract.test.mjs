import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserFixture } from '../helpers/browser.mjs';
import { createAppBackend } from '../helpers/app-backend.mjs';
import { png } from '../fixtures/support-images.mjs';

const onboarded = { theme: 'system', prefs: { agent: '', send: 0 }, notifs: [true, true, true, false], onboarded: true, answers: [[0], [0], [0], [0]], promoClosed: false, sbHidden: false };

// The signed-in application against the in-memory same-origin API contract.
const fixture = createBrowserFixture();
before(() => fixture.start());
after(() => fixture.stop());

async function open(t, options = {}, backendOptions = {}) {
  const backend = createAppBackend({ ...backendOptions });
  const { context, page, base, errors } = await fixture.setup(t, options);
  await backend.install(context);
  return { backend, context, page, base, errors };
}
async function idle(page) { await page.waitForFunction(() => document.querySelector('#fx')?.getAttribute('aria-busy') !== 'true'); }
async function go(page, route) {
  await idle(page);
  await page.evaluate(route => { location.hash = '#/' + route; }, route);
  await page.waitForFunction(route => document.querySelector('#fx')?.dataset.route === '#/' + route, route);
}
async function createWorkspace(page, name = 'Contract workspace') {
  await page.locator('[data-act=new-ws]').first().click();
  await page.locator('[data-form=new-ws] [name=name]').fill(name);
  await page.locator('[data-form=new-ws] .btn.pri').click();
  await page.locator('.scrim').waitFor({ state: 'detached' });
  await page.locator('#fx-input').waitFor();
  await idle(page);
}

test('an unauthenticated visitor is returned to the account entry', async t => {
  const { page, base, errors } = await open(t, {}, { signedIn: false });
  await page.goto(base + '/app/');
  await page.waitForURL(/\/app\/start\/?(?:\?.*)?$/);
  assert.deepEqual(errors, []);
});

test('onboarding single and multiple choices survive back navigation and recommend the saved agent', async t => {
  const { backend, page, base, errors } = await open(t);
  await page.goto(base + '/app/');
  assert.equal(await page.locator('[data-act=ob-next]').isDisabled(), true);
  await page.locator('[data-act=ob-opt][data-i="0"]').click();
  await page.locator('[data-act=ob-opt][data-i="1"]').click();
  await page.locator('[data-act=ob-next]').click();
  await page.locator('[data-act=ob-back]').click();
  assert.equal(await page.locator('[data-act=ob-opt][aria-checked=true]').count(), 2);
  await page.locator('[data-act=ob-next]').click();
  await page.locator('[data-act=ob-opt][data-i="1"]').click();
  await page.locator('[data-act=ob-opt][data-i="4"]').click();
  await page.locator('[data-act=ob-next]').click();
  await page.locator('[data-act=ob-opt][data-i="0"]').click();
  await page.locator('[data-act=ob-opt][data-i="1"]').click();
  assert.equal(await page.locator('[data-act=ob-opt][aria-checked=true]').count(), 1);
  await page.locator('[data-act=ob-next]').click();
  await page.locator('[data-act=ob-opt][data-i="2"]').click();
  await page.locator('[data-act=ob-next]').click();
  await page.locator('.scrim').waitFor({ state: 'detached' });
  await idle(page);
  assert.deepEqual(backend.state.preferences.answers, [[0, 1], [1, 4], [1], [2]]);
  assert.equal(backend.state.preferences.onboarded, true);
  await createWorkspace(page);
  assert.equal(await page.locator('[data-act=agent][data-id=claude]').getAttribute('aria-selected'), 'true');
  await page.reload();
  await page.locator('[data-act=agent][data-id=claude][aria-selected=true]').waitFor();
  assert.equal(await page.locator('[data-act=ob-next]').count(), 0);
  assert.deepEqual(errors, []);
});

test('workspace, conversation, profile, preference and API-key writes persist through the server contract without XSS', async t => {
  const { backend, page, base, errors } = await open(t, {}, { preferences: { ...onboarded } });
  page.on('dialog', dialog => dialog.accept());
  await page.goto(base + '/app/');
  await page.locator('#fx .sb').waitFor();
  await createWorkspace(page);
  assert.equal(backend.state.workspaces[0].name, 'Contract workspace');
  const body = '<img src=x onerror="window.__injected=1"> literal text';
  const send = async text => { await page.locator('#fx-input').fill(text); await page.locator('[data-form=send] .send').click(); await idle(page); };
  await send(body);
  assert.equal(await page.locator('.msg-body').innerText(), body);
  assert.equal(await page.evaluate(() => window.__injected), undefined);
  assert.match(await page.locator('#fx-main').innerText(), /not configured/);
  await send('Second instruction');
  assert.deepEqual(backend.state.chats[0].messages, [['you', body], ['you', 'Second instruction']]);

  const name = '<svg onload=window.__injected=2>';
  await go(page, 'settings/0');
  await page.locator('[data-form=profile] [name=name]').fill(name);
  await page.locator('[data-form=profile] .btn.pri').click(); await idle(page);
  assert.equal(backend.state.profile.name, name);
  const chooser = page.waitForEvent('filechooser');
  await page.locator('[data-act=avatar-upload]').click();
  await (await chooser).setFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: png });
  await page.locator('[data-act=avatar-remove]').waitFor();
  await idle(page);
  assert.equal(backend.state.avatarUploaded, true);
  assert.equal(backend.state.profile.name, name, 'avatar upload preserves the saved name');
  await page.locator('[data-act=avatar-remove]').click(); await idle(page);
  assert.equal(backend.state.avatarUploaded, false);
  assert.equal(backend.state.profile.avatar, 0);
  await page.locator('[data-act=avatar][data-i="2"]').click(); await idle(page);
  assert.equal(backend.state.profile.avatar, 2);
  await page.locator('[data-act=avatar-shuffle]').click(); await idle(page);
  assert.notEqual(backend.state.profile.avatar, 2);

  await go(page, 'settings/1');
  await page.locator('[data-act=theme][data-v=dark]').click(); await idle(page);
  await page.locator('[data-input=prefAgent]').selectOption('claude'); await idle(page);
  await page.locator('[data-act=send-key][data-i="1"]').click(); await idle(page);
  await go(page, 'settings/2');
  await page.locator('[data-act=notif][data-i="0"]').click(); await idle(page);
  assert.deepEqual([backend.state.preferences.theme, backend.state.preferences.prefs, backend.state.preferences.notifs[0]], ['dark', { agent: 'claude', send: 1 }, false]);

  await go(page, 'api');
  await page.locator('[data-act=api-range][data-i="1"]').click(); await idle(page);
  await page.locator('[data-act=new-key]').click();
  await page.locator('[data-form=key] [name=name]').fill('Contract key');
  await page.locator('[data-form=key] [name=limit]').fill('5');
  await page.locator('[data-form=key] .btn.pri').click();
  await page.locator('.dlg pre').waitFor();
  const secret = await page.locator('.dlg pre').innerText();
  assert.match(secret, /^sk-/);
  assert.equal(backend.state.keys[0].limit, 5_000_000);
  assert.equal(JSON.stringify(await page.evaluate(() => ({ ...localStorage, ...sessionStorage }))).includes(secret), false);
  await page.locator('.dlg [data-act=close]').last().click();
  const keyID = backend.state.keys[0].id;
  await page.locator(`[data-act=key-limit][data-id="${keyID}"]`).click();
  await page.locator('[data-form=key-limit] [name=limit]').fill('7.000001');
  await page.locator('[data-form=key-limit] .btn.pri').click();
  await page.locator('.scrim').waitFor({ state: 'detached' });
  assert.equal(backend.state.keys[0].limit, 7_000_001);
  await page.locator(`[data-act=revoke][data-id="${keyID}"]`).click(); await idle(page);
  assert.equal(backend.state.keys[0].revoked, true);

  await page.reload();
  await page.locator('#fx .sb').waitFor();
  await go(page, 'chat/' + backend.state.chats[0].id);
  assert.equal(await page.locator('.msg-body').count(), 2);
  await page.locator('[data-act=del-chat]').click(); await idle(page);
  assert.deepEqual(backend.state.chats, []);
  assert.equal(await page.evaluate(() => window.__injected), undefined);
  assert.deepEqual(errors, []);
});

test('main chat honors IME, newlines and both Enter sending preferences', async t => {
  const { backend, page, base, errors } = await open(t, {}, { preferences: { ...onboarded } });
  await page.goto(base + '/app/');
  await page.locator('#fx .sb').waitFor();
  await createWorkspace(page);
  const input = page.locator('#fx-input');
  await input.press('Enter');
  assert.equal(backend.state.chats.length, 0);
  await input.fill('中文输入');
  await input.evaluate(input => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: true })));
  assert.equal(backend.state.chats.length, 0);
  assert.equal(await input.inputValue(), '中文输入');
  await input.press('Shift+Enter');
  assert.equal(await input.inputValue(), '中文输入\n');
  await input.press('Enter'); await idle(page);
  await page.locator('[data-form=send][data-chat]').waitFor();
  assert.equal(backend.state.chats[0].messages[0][1], '中文输入');
  await go(page, 'settings/1');
  await page.locator('[data-act=send-key][data-i="1"]').click(); await idle(page);
  await go(page, 'new');
  await page.locator('#fx-input').fill('Modifier sends');
  await page.locator('#fx-input').press('Enter');
  assert.equal(await page.locator('#fx-input').inputValue(), 'Modifier sends\n');
  assert.equal(backend.state.chats.length, 1);
  await page.locator('#fx-input').press('Control+Enter'); await idle(page);
  await page.locator('[data-form=send][data-chat]').waitFor();
  assert.equal(backend.state.chats.length, 2);
  assert.equal(backend.state.chats[1].messages[0][1], 'Modifier sends');
  assert.deepEqual(errors, []);
});

test('a failed chat write keeps the draft, shows no fake success and a real retry saves it', async t => {
  const { backend, page, base, errors } = await open(t, {}, { preferences: { ...onboarded } });
  await page.goto(base + '/app/');
  await page.locator('#fx .sb').waitFor();
  await createWorkspace(page);
  backend.state.failChatWrites = true;
  await page.locator('#fx-input').fill('Keep this draft');
  await page.locator('[data-form=send] .send').click(); await idle(page);
  assert.equal(await page.locator('#fx-input').inputValue(), 'Keep this draft');
  assert.deepEqual(backend.state.chats, []);
  assert.equal(await page.locator('.msg-body').count(), 0);
  backend.state.failChatWrites = false;
  await page.locator('[data-form=send] .send').click(); await idle(page);
  await page.locator('.msg-body').filter({ hasText: 'Keep this draft' }).waitFor();
  assert.equal(backend.state.chats[0].messages[0][1], 'Keep this draft');
  assert.ok(errors.every(message => !/Keep this draft/.test(message)));
});

test('command palette filters, keyboard-selects routes and handles empty results', async t => {
  const { page, base, errors } = await open(t, {}, { preferences: { ...onboarded } });
  await page.goto(base + '/app/');
  await page.locator('#fx .sb').waitFor();
  await createWorkspace(page);
  await page.keyboard.press('Control+k');
  await page.locator('[data-input=pal]').fill('API');
  assert.ok(await page.locator('[data-act=pal-run]').count() >= 1);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#fx').dataset.route !== '#/new');
  await page.keyboard.press('Control+k');
  await page.locator('[data-input=pal]').fill('missing palette command');
  assert.equal(await page.locator('[data-act=pal-run]').count(), 0);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await page.locator('.scrim').waitFor({ state: 'detached' });
  await page.keyboard.press('Control+Shift+o');
  await page.locator('#fx-input').waitFor();
  assert.equal(await page.locator('#fx').getAttribute('data-route'), '#/new');
  assert.deepEqual(errors, []);
});

test('logout revokes the server session and returns to the account entry', async t => {
  const { backend, page, base, errors } = await open(t, {}, { preferences: { ...onboarded } });
  await page.goto(base + '/app/');
  await page.locator('#fx .sb').waitFor();
  await page.locator('[data-act=account]').click();
  await page.locator('[data-act=logout]').click();
  await page.waitForURL(/\/app\/start\/?$/);
  assert.equal(backend.state.signedIn, false);
  assert.deepEqual(errors, []);
});

test('workspace rename, members, password, billing views and the read-only example work in every locale', async t => {
  for (const prefix of ['', '/zh', '/zh-hant', '/ja', '/ko', '/es']) {
    const { backend, page, base, errors } = await open(t, {}, { preferences: { ...onboarded } });
    await page.goto(base + prefix + '/app/');
    await page.locator('#fx .sb').waitFor();
    await createWorkspace(page, `Workspace ${prefix || 'en'}`);
    await go(page, 'ws-settings/0');
    await page.locator('[data-form=rename] [name=name]').fill(`Renamed ${prefix || 'en'}`);
    await page.locator('[data-form=rename] .btn').click(); await idle(page);
    assert.equal(backend.state.workspaces[0].name, `Renamed ${prefix || 'en'}`);
    await go(page, 'members');
    assert.ok((await page.locator('#fx-main').innerText()).includes(backend.state.profile.name));
    for (const route of ['billing/credits', 'billing/market', 'api', 'settings/2', 'import', 'ws-settings/1', 'ws-settings/2']) {
      await go(page, route);
      assert.ok((await page.locator('#fx-main').innerText()).length > 20, route);
    }
    await go(page, 'settings/3');
    await page.locator('[data-form=password] [name=current_password]').fill('current-password');
    await page.locator('[data-form=password] [name=new_password]').fill('short');
    await page.locator('[data-form=password] [name=confirm_password]').fill('short');
    await page.locator('[data-form=password] .btn.pri').click();
    assert.equal(backend.state.writes.some(write => write.path === '/api/app/password'), false, 'an invalid new password is rejected before submission');
    await page.locator('[data-act=switcher]').click();
    await page.locator('.pop [data-act=switch][data-id=example]').click(); await idle(page);
    for (const route of ['new', 'members', 'settings/0', 'ws-settings/0']) {
      await go(page, route);
      assert.ok((await page.locator('#fx-main').innerText()).length > 20, route);
    }
    await page.locator('[data-act=switcher]').click();
    await page.locator(`.pop [data-act=switch][data-id="${backend.state.workspaces[0].id}"]`).click(); await idle(page);
    await go(page, 'ws-settings/0');
    await page.locator('[data-form=del-ws] [name=name]').fill(`Renamed ${prefix || 'en'}`);
    await page.locator('[data-form=del-ws] .btn.danger').click(); await idle(page);
    assert.deepEqual(backend.state.workspaces, []);
    assert.deepEqual(errors, []);
  }
});

test('the support launcher leaves the main chat send button clickable across desktop and mobile breakpoints', async t => {
  for (const width of [390, 1100, 1101, 1280, 1440, 1920]) {
    const { page, context, base, errors } = await open(t, { viewport: { width, height: 720 } }, { preferences: { ...onboarded } });
    await page.goto(base + '/app/');
    await page.locator('#fx .sb').waitFor();
    await createWorkspace(page);
    await page.locator('[data-support-open]').waitFor({ state: 'visible' });
    await page.locator('#fx-input').fill(`Message at ${width}px`);
    const send = page.locator('[data-form=send] .send');
    assert.equal(await send.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return top === element || element.contains(top);
    }), true, `${width}px main send button receives pointer events`);
    await send.click(); await idle(page);
    await page.locator('.msg-body').filter({ hasText: `Message at ${width}px` }).waitFor();
    assert.deepEqual(errors, []);
    await context.close();
  }
});
