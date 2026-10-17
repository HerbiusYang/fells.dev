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
  await page.locator('.main [data-act=del-chat]').click(); await idle(page);
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

test('Token Plan account view uses the live catalog and current, conditional, queued server fields', async t => {
  const periodEnd = 1900000000;
  const { backend, page, base, errors } = await open(t, {}, {
    preferences: { ...onboarded },
    apiAllowance: { user_id: 42, micro: 25_000_000, plan_micro: 16_000_000, expires_at: 1950000000 },
    tokenPlans: {
      plans: [{ code: '1000', name: 'Server-priced Token Plan', price_micro: 1_288_000_000,
        quota_usd_micro: 1_000_000_000, burst_usd_micro: 2_000_000_000,
        period: 'month', period_days: 30, new_user_only: true, enabled: true }],
      current: { id: 7, user_id: 42, plan_id: 3, plan_code: '1000', name: 'Current plan',
        price_micro: 1_288_000_000, quota_usd_micro: 20_000_000, burst_usd_micro: 40_000_000,
        period_start: periodEnd - 30 * 86400, period_end: periodEnd, used_usd_micro: 14_000_000,
        status: 'active', ref: 'support-order-7', created_at: 1700000000,
        remaining_guaranteed_usd_micro: 6_000_000, remaining_burst_usd_micro: 20_000_000,
        burst_allowed: false, queued: { id: 8, user_id: 42, plan_id: 3, plan_code: '1000',
          price_micro: 1_288_000_000, quota_usd_micro: 20_000_000, burst_usd_micro: 40_000_000,
          period_start: periodEnd, period_end: periodEnd + 30 * 86400, used_usd_micro: 0,
          status: 'queued', ref: 'support-order-8', created_at: 1700000001 } },
      burst_allowed: false,
    },
  });
  await page.goto(base + '/app/');
  await page.locator('#fx .sb').waitFor();
  await go(page, 'billing/market');
  await page.locator('[data-token-plan-catalog]').getByText('Server-priced Token Plan').waitFor();
  const catalog = await page.locator('[data-token-plan-catalog]').innerText();
  assert.match(catalog, /Server-priced Token Plan/);
  assert.match(catalog, /¥1,288/);
  assert.match(catalog, /New users only; once per account/);
  assert.match(catalog, /Support confirms supply, eligibility and the final price/);
  await page.locator('.market-account-link').click();
  await page.waitForFunction(() => document.querySelector('#fx')?.dataset.route === '#/billing/credits');
  await page.locator('[data-token-plan] b').first().waitFor();
  const status = await page.locator('[data-token-plan]').innerText();
  assert.match(status, /Current plan/);
  assert.match(status, /\$6\.00.*\$20\.00/s);
  assert.match(status, /\$20\.00.*Currently unavailable/s);
  assert.match(status, /Queued next period/);
  assert.match(status, /no automatic renewal or automatic charge/i);
  assert.match(await page.locator('.balance').innerText(), /Independent USD API allowance\s+\$9\.00/);
  backend.state.tokenPlans.current.burst_allowed = true;
  await page.reload();
  await go(page, 'billing/credits');
  await page.locator('[data-token-plan] b').first().waitFor();
  assert.match(await page.locator('[data-token-plan]').innerText(), /Available now while the account pool/);
  backend.state.tokenPlans.current = null;
  await page.reload();
  await go(page, 'billing/credits');
  await page.locator('[data-token-plan]').getByText('No active Token Plan').waitFor();
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

test('workspace invitations require acceptance; owner can revoke and a member can leave', async t => {
  const { backend, page, base, errors } = await open(t, {}, { preferences: { ...onboarded } });
  page.on('dialog', dialog => dialog.accept());
  await page.goto(base + '/app/');
  await page.locator('#fx .sb').waitFor();
  await createWorkspace(page);
  await go(page, 'members');
  await page.locator('[data-act=invite-link][data-role=viewer]').click();
  await page.locator('[data-form=prompt] [name=v]').fill('teammate@example.test');
  await page.locator('[data-form=prompt] .btn.pri').click();
  await page.locator('.scrim').waitFor({ state: 'detached' });
  await page.locator('[data-act=revoke-invitation]').waitFor();
  assert.equal(backend.state.pendingInvitations.length, 1);
  assert.equal(backend.state.workspaces.length, 1, 'sending does not add a member or another workspace');
  assert.match(await page.locator('#fx-main').innerText(), /t\*\*\*@example\.test/);
  assert.match(await page.locator('#fx-main').innerText(), /2030/, 'millisecond expiry renders as a calendar date');
  await page.locator('[data-act=revoke-invitation]').click();
  await page.locator('[data-act=revoke-invitation]').waitFor({ state: 'detached' });
  assert.equal(backend.state.pendingInvitations.length, 0);

  backend.state.receivedInvitations.push({ id: 'received-1', workspace_id: 'accepted-room', workspace_name: 'Invited room', role: 'viewer', inviter_name: 'Member #8', created: 1700000000000, expires: 1900000000000 });
  await page.reload();
  await page.locator('#fx .sb').waitFor();
  await go(page, 'invitations');
  await page.locator('[data-act=accept-invitation]').waitFor();
  assert.match(await page.locator('#fx-main').innerText(), /Invited room/);
  assert.match(await page.locator('#fx-main').innerText(), /2030/, 'inbox expiry uses milliseconds too');
  await page.locator('[data-act=accept-invitation]').click();
  await page.locator('.sb [data-act=switcher]').filter({ hasText: 'Invited room' }).waitFor();
  assert.equal(backend.state.workspaces.find(w => w.id === 'accepted-room')?.role, 'viewer');
  await go(page, 'members');
  await page.locator('[data-act=leave-workspace]').click();
  await page.locator('[data-act=leave-workspace]').waitFor({ state: 'detached' });
  assert.equal(backend.state.workspaces.some(w => w.id === 'accepted-room'), false);

  backend.state.receivedInvitations.push({ id: 'received-2', workspace_id: 'declined-room', workspace_name: 'Declined room', role: 'editor', inviter_name: 'Member #9', created: 1700000000000, expires: 1900000000000 });
  await page.reload();
  await page.locator('#fx .sb').waitFor();
  await go(page, 'invitations');
  await page.locator('[data-act=decline-invitation]').click();
  await page.locator('[data-act=decline-invitation]').waitFor({ state: 'detached' });
  assert.equal(backend.state.receivedInvitations.length, 0);
  assert.deepEqual(errors, []);
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

test('a password change submits every password field exactly as typed', async t => {
  const { backend, page, base, errors } = await open(t, {}, { preferences: { ...onboarded } });
  await page.goto(base + '/app/');
  await page.locator('#fx .sb').waitFor();
  await go(page, 'settings/3');
  await page.locator('[data-form=password] [name=current_password]').fill('  current secret ');
  await page.locator('[data-form=password] [name=new_password]').fill(' next-password-1  ');
  await page.locator('[data-form=password] [name=confirm_password]').fill(' next-password-1  ');
  await page.locator('[data-form=password] .btn.pri').click();
  await page.waitForURL(/\/app\/start\/?\?password=changed$/);
  const write = backend.state.writes.find(item => item.path === '/api/app/password');
  assert.deepEqual(write?.body, { current_password: '  current secret ', new_password: ' next-password-1  ' });
  assert.deepEqual(errors, []);
});

test('a customer session change in another tab clears private content even when the refresh fails', async t => {
  const { context, page, base } = await open(t, {}, { preferences: { ...onboarded } });
  await page.goto(base + '/app/');
  await page.locator('#fx .sb').waitFor();
  await createWorkspace(page, 'Private workspace marker');
  assert.ok((await page.locator('#fx').innerText()).includes('Private workspace marker'));
  // Another tab switches account while this tab cannot reach the API.
  await page.route('**/api/app/**', route => route.abort('internetdisconnected'));
  const other = await context.newPage();
  await other.goto(base + '/');
  await other.evaluate(() => new BroadcastChannel('fells.session.changed').postMessage({ audience: 'customer' }));
  await page.waitForURL(/\/app\/start\/?(?:\?.*)?$/);
  assert.equal((await page.content()).includes('Private workspace marker'), false);
});

for (const scenario of ['negative allowance', 'unlimited key', 'revoked unlimited key']) test(`app remains usable with ${scenario}`, async t => {
  const keys = scenario === 'negative allowance' ? [] : [{ id: 1, name: 'Operations key', prefix: 'sk-test', created_at: 1700000000, revoked: scenario === 'revoked unlimited key', limit: -1 }];
  const { backend, page, base, errors } = await open(t, {}, { preferences: { ...onboarded }, keys, ...(scenario === 'negative allowance' ? { apiAllowance: { micro: -100000, expires_at: 1900000000 } } : {}) });
  await page.goto(base + '/app/'); await page.locator('[data-act=account]').waitFor();
  if (scenario === 'negative allowance') assert.match(await page.locator('[data-act=account]').innerText(), /-0\.10/);
  await go(page, 'api');
  if (scenario !== 'unlimited key') {
    assert.equal(await page.locator('[data-act=key-limit]').count(), 0);
  } else {
    assert.match(await page.locator('#fx-main').innerText(), /Unlimited \(set by operations\)/);
    await page.locator('[data-act=key-limit]').click();
    const limit = page.locator('[data-form=key-limit] [name=limit]');
    assert.equal(await limit.inputValue(), '');
    assert.match(await page.locator('[data-form=key-limit]').innerText(), /Leave blank to keep/);
    await page.locator('[data-form=key-limit] .btn.pri').click();
    await page.locator('.scrim').waitFor({ state: 'detached' });
    assert.equal(backend.state.writes.filter(write => write.path.endsWith('/limits')).length, 0);
    assert.equal(backend.state.keys[0].limit, -1);
    for (const [value, micro] of [['0', 0], ['7.000001', 7000001]]) {
      await page.locator('[data-act=key-limit]').click(); await limit.fill(value);
      await page.locator('[data-form=key-limit] .btn.pri').click();
      await page.locator('.scrim').waitFor({ state: 'detached' }); await idle(page);
      assert.equal(backend.state.keys[0].limit, micro);
      assert.equal(backend.state.writes.filter(write => write.path.endsWith('/limits')).at(-1).body.monthly_micro, micro);
    }
    await page.reload(); await go(page, 'api');
    assert.match(await page.locator('#fx-main').innerText(), /7/);
  }
  assert.deepEqual(errors, []);
});
