import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserFixture } from '../helpers/browser.mjs';
import { createAppBackend } from '../helpers/app-backend.mjs';

// Consent-based workspace membership against the in-memory /api/app contract:
// invitee inbox, accept/decline, leave, the owner's pending list and the
// neutral member labels that replace contact addresses.
const onboarded = { theme: 'system', prefs: { agent: '', send: 0 }, notifs: [true, true, true, false], onboarded: true, answers: [[0], [0], [0], [0]], promoClosed: false, sbHidden: false };
const fixture = createBrowserFixture();
before(() => fixture.start());
after(() => fixture.stop());

async function open(t, backendOptions = {}) {
  const backend = createAppBackend({ preferences: { ...onboarded }, ...backendOptions });
  const { context, page, base, errors } = await fixture.setup(t);
  await backend.install(context);
  return { backend, page, base, errors };
}
async function idle(page) { await page.waitForFunction(() => document.querySelector('#fx')?.getAttribute('aria-busy') !== 'true'); }
async function go(page, route) {
  await idle(page);
  await page.evaluate(route => { location.hash = '#/' + route; }, route);
  await page.waitForFunction(route => document.querySelector('#fx')?.dataset.route === '#/' + route, route);
}
const toast = page => page.locator('#fx .toast');
const shared = { id: 'w-shared', name: 'Shared space', region: 'ap', tz: 'UTC', created: 1700000000000 };
const invitation = (over = {}) => ({ id: '11111111-1111-4111-8111-111111111111', workspace_id: 'w-shared', workspace_name: 'Shared <img src=x onerror="window.__injected=1">', role: 'editor', inviter_name: 'Member #7', created: 1700000000000, expires: 1701209600000, ...over });

test('an invitee sees pending invitations, declines one and accepts another into the workspace list', async t => {
  const { backend, page, base, errors } = await open(t, {
    inbox: [invitation(), invitation({ id: '22222222-2222-4222-8222-222222222222', workspace_id: 'w-other', workspace_name: 'Other team', role: 'viewer', inviter_name: 'Dana' })],
    joinable: { 'w-shared': { ...shared, name: 'Shared <img src=x onerror="window.__injected=1">' } },
  });
  await page.goto(base + '/app/');
  await page.locator('[data-invitation-banner]').waitFor();
  assert.match(await page.locator('[data-invitation-banner]').innerText(), /Pending workspace invitations: 2/);
  assert.equal(await page.locator('.sb [data-invitation-count]').innerText(), '2', 'the sidebar switcher shows the pending count');
  await page.locator('[data-invitation-banner] [data-act=invitations]').click();
  await page.locator('.dlg [data-invitation]').first().waitFor();
  const dialog = await page.locator('.dlg [data-invitations]').innerText();
  assert.match(dialog, /Invited by Member #7/);
  assert.match(dialog, /Invited by Dana/);
  assert.ok(dialog.includes('Shared <img src=x onerror="window.__injected=1">'), 'workspace names render as text');
  assert.match(dialog, /Expires /);

  await page.locator('.dlg [data-act=invite-decline][data-id="22222222-2222-4222-8222-222222222222"]').click();
  await idle(page);
  await page.locator('.dlg [data-invitation]').first().waitFor();
  assert.equal(await page.locator('.dlg [data-invitation]').count(), 1);
  assert.ok(backend.state.writes.some(w => w.method === 'POST' && w.path === '/api/app/invitations/22222222-2222-4222-8222-222222222222/decline'));
  assert.deepEqual(backend.state.workspaces, [], 'declining joins nothing');

  await page.locator('.dlg [data-act=invite-accept]').click();
  await page.locator('.scrim').waitFor({ state: 'detached' });
  await idle(page);
  assert.match(await toast(page).innerText(), /You joined Shared/);
  assert.deepEqual(backend.state.workspaces.map(w => [w.id, w.role]), [['w-shared', 'editor']]);
  assert.deepEqual(backend.state.inbox, []);
  await page.locator('#fx-input').waitFor();
  assert.equal(await page.locator('[data-invitation-banner]').count(), 0);
  await page.locator('.sb [data-invitation-count]').waitFor({ state: 'detached' });
  await page.locator('[data-act=switcher]').click();
  assert.equal(await page.locator('.pop [data-act=switch][data-id="w-shared"]').count(), 1);
  assert.equal(await page.locator('.pop [data-act=invitations] .tag').count(), 0, 'no pending count remains');
  assert.equal(await page.evaluate(() => window.__injected), undefined);
  assert.deepEqual(errors, []);
});

test('accepting at a membership limit explains the limit and keeps the invitation', async t => {
  const { backend, page, base, errors } = await open(t, { inbox: [invitation({ workspace_name: 'Full team' })], joinable: { 'w-shared': shared }, acceptStatus: 413 });
  await page.goto(base + '/app/');
  await page.locator('[data-invitation-banner] [data-act=invitations]').click();
  await page.locator('.dlg [data-act=invite-accept]').click();
  await idle(page);
  await page.locator('.dlg [data-invitation]').waitFor();
  assert.match(await toast(page).innerText(), /workspace is full or you have reached the 50-workspace limit/);
  assert.equal(backend.state.inbox.length, 1);
  assert.deepEqual(backend.state.workspaces, []);
  assert.deepEqual(errors, []);
});

test('a member sees neutral labels and no email, and can leave after confirming', async t => {
  for (const [prefix, label] of [['', 'Member #7'], ['/zh', '成员 #7']]) {
    const { backend, page, base, errors } = await open(t, {
      workspaces: [{ ...shared, role: 'viewer' }],
      members: { 'w-shared': [{ user_id: 1, name: 'Workspace owner', role: 'owner' }, { user_id: 42, name: 'UI user', role: 'viewer' }, { user_id: 7, name: 'Member #7', role: 'editor' }] },
    });
    await page.goto(base + prefix + '/app/');
    await page.locator('#fx .sb').waitFor();
    await go(page, 'members');
    await page.locator('[data-member="7"]').waitFor();
    const text = await page.locator('#fx-main').innerText();
    assert.ok(text.includes(label), `${prefix}: neutral member label is localized`);
    assert.equal(/@|example\.test/.test(text), false, `${prefix}: no email is rendered for members`);
    assert.equal(await page.locator('[data-act=invite-link],[data-act=member-role],[data-act=remove-member],[data-pending-list]').count(), 0, 'viewers get no owner controls');
    assert.equal(await page.locator('[data-member="42"] [data-act=leave-ws]').count(), 1);
    assert.equal(await page.locator('[data-member="7"] [data-act=leave-ws]').count(), 0);

    await go(page, 'ws-settings/0');
    let prompt = '';
    page.once('dialog', dialog => { prompt = dialog.message(); dialog.dismiss(); });
    await page.locator('#fx-main [data-act=leave-ws]').click();
    assert.ok(prompt.includes('Shared space'));
    assert.equal(backend.state.writes.some(w => w.path.endsWith('/leave')), false, 'cancelling the confirmation writes nothing');
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#fx-main [data-act=leave-ws]').click();
    await page.waitForFunction(() => document.querySelector('#fx')?.dataset.route === '' || document.querySelector('#fx')?.dataset.route === '#/' || document.querySelector('#fx')?.dataset.route === '#');
    await idle(page);
    assert.ok(backend.state.writes.some(w => w.method === 'POST' && w.path === '/api/app/workspaces/w-shared/leave'));
    assert.deepEqual(backend.state.workspaces, []);
    assert.match(await toast(page).innerText(), /Shared space/);
    assert.equal((await page.locator('#fx .sb').innerText() + await page.locator('#fx-main').innerText()).includes('Shared space'), false, 'the left workspace disappears locally');
    assert.deepEqual(errors, []);
  }
});

test('an owner invites without learning whether the account exists, sees masked pending invitations, handles 429 and cancels', async t => {
  const { backend, page, base, errors } = await open(t, {
    workspaces: [{ ...shared, role: 'owner' }],
    members: { 'w-shared': [{ user_id: 42, name: 'UI user', role: 'owner' }, { user_id: 7, name: 'Member #7', role: 'viewer' }] },
  });
  await page.goto(base + '/app/');
  await page.locator('#fx .sb').waitFor();
  await go(page, 'members');
  await page.locator('[data-pending-list] .muted', { hasText: 'No pending invitations' }).waitFor();
  assert.match(await page.locator('#fx-main').innerText(), /join only after accepting/);

  await page.locator('[data-act=invite-link][data-role=editor]').click();
  await page.locator('[data-form=prompt] [name=v]').fill('someone.with.a.long.address@example.test');
  await page.locator('[data-form=prompt] .btn.pri').click();
  await page.locator('[data-pending]').waitFor();
  assert.match(await toast(page).innerText(), /If this account exists/);
  assert.deepEqual(backend.state.writes.find(w => w.path === '/api/app/workspaces/w-shared/members')?.body, { username: 'someone.with.a.long.address@example.test', role: 'editor' });
  const pending = await page.locator('[data-pending-list]').innerText();
  assert.match(pending, /s\*\*\*@example\.test/);
  assert.equal(pending.includes('someone.with'), false, 'only the masked label is shown');
  assert.equal(await page.locator('[data-member]').count(), 2, 'an invitation does not add a member');

  backend.state.inviteStatus = 429;
  await page.locator('[data-act=invite-link][data-role=viewer]').click();
  await page.locator('[data-form=prompt] [name=v]').fill('another-user');
  await page.locator('[data-form=prompt] .btn.pri').click();
  await idle(page);
  assert.match(await toast(page).innerText(), /Too many pending invitations/);
  assert.equal(backend.state.pending['w-shared'].length, 1);

  await page.keyboard.press('Escape');
  await page.locator('[data-act=cancel-invite]').click();
  await idle(page);
  await page.locator('[data-pending]').waitFor({ state: 'detached' });
  assert.ok(backend.state.writes.some(w => w.method === 'DELETE' && /^\/api\/app\/workspaces\/w-shared\/invitations\/9/.test(w.path)));
  assert.deepEqual(backend.state.pending['w-shared'], []);
  assert.deepEqual(errors, []);
});

test('a rate-limited password change shows the Retry-After wait and stays signed in', async t => {
  const { backend, page, base, errors } = await open(t, { password: { status: 429, retryAfter: '900' } });
  await page.goto(base + '/app/');
  await page.locator('#fx .sb').waitFor();
  await go(page, 'settings/3');
  const submit = async () => {
    await page.locator('[data-form=password] [name=current_password]').fill('current-password');
    await page.locator('[data-form=password] [name=new_password]').fill('next-password-1');
    await page.locator('[data-form=password] [name=confirm_password]').fill('next-password-1');
    await page.locator('[data-form=password] .btn.pri').click();
    await page.locator('[data-form=password] .btn.pri:not([disabled])').waitFor();
  };
  await submit();
  assert.match(await toast(page).innerText(), /Too many attempts\. Try again in 15 minutes\./);
  backend.state.password.retryAfter = '';
  await submit();
  assert.match(await toast(page).innerText(), /Too many attempts\. Try again later\./);
  assert.match(page.url(), /\/app\/(#.*)?$/);
  assert.equal(backend.state.writes.filter(w => w.path === '/api/app/password').length, 2);
  assert.deepEqual(errors, []);
});

test('GitHub sign-in reports an unverified account email on the account entry', async t => {
  for (const [prefix, expected] of [['', /has not verified its address/], ['/zh', /还没有验证邮箱/], ['/ja', /メール認証が完了していない/]]) {
    const { page, base, errors } = await open(t, { signedIn: false });
    await page.goto(`${base}${prefix}/app/start?gh_error=unverified`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-msg].err').waitFor();
    assert.match(await page.locator('[data-msg]').innerText(), expected);
    await page.goto(`${base}${prefix}/app/start?gh_error=%3Cb%3Ex`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-msg].err').waitFor();
    assert.equal(await page.locator('[data-msg] b').count(), 0);
    assert.doesNotMatch(await page.locator('[data-msg]').innerText(), /<b>|has not verified|还没有验证|メール認証/);
    assert.deepEqual(errors, []);
  }
});
