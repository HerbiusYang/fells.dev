import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserFixture } from '../helpers/browser.mjs';
import { createAppBackend } from '../helpers/app-backend.mjs';
const fixture = createBrowserFixture(); before(() => fixture.start()); after(() => fixture.stop());
const preferences = { theme: 'light', prefs: { agent: '', send: 0 }, notifs: [true, true, true, false], onboarded: true, answers: [[], [], [], []], promoClosed: true, sbHidden: false };
for (const nextUser of [42, 7]) test(`expired sign-in preserves its destination and restores the text only to its account: ${nextUser}`, async t => {
  const { context, page, base, errors } = await fixture.setup(t);
  const backend = createAppBackend({ preferences, modelChat: true,
    workspaces: [{ id: 'draft-space', name: 'Draft workspace', region: 'auto', tz: 'UTC', created: 1700000000000, role: 'owner' }],
    chats: [{ id: 'draft-chat', ws: 'draft-space', title: 'Saved conversation', agent: 'claude', model: 'Server text model', created: 1700000000001, messages: [['you', 'Existing message']] }],
  });
  await backend.install(context);
  await context.route('**/api/app/auth/config', route => route.fulfill({ json: { signup_enabled: true, email_enabled: true, channels: ['email'], turnstile_site_key: '', min_password_length: 8 } }));
  await context.route('**/api/app/agreement*', route => route.fulfill({ json: { version: 'fixture-v1', h1: 'Original terms', lede: 'Synthetic terms.', clauses: [], ui: {} } }));
  await context.route('**/api/app/session', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    backend.state.userID = nextUser; backend.state.signedIn = true; backend.state.sessionID = 'd'.repeat(64);
    await route.fulfill({ json: { ok: true, username: 'synthetic-user', display_name: 'Synthetic user' } });
  });
  await page.goto(base + '/zh/app/#/chat/draft-chat');
  await page.locator('#fx-input').waitFor();
  await page.locator('.sb [data-go=members] .end').filter({ hasText: /^1\/32$/ }).waitFor();
  const draft = 'Only my account may recover this unsent message.';
  await page.locator('#fx-input').fill(draft);
  backend.state.signedIn = false;
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('fells.session.changed', { detail: { audience: 'customer' } })));
  await page.waitForURL(url => url.pathname.startsWith('/zh/app/start'));
  assert.equal(new URL(page.url()).searchParams.get('next'), '/zh/app/#/chat/draft-chat');
  await page.locator('[data-auth-form] [type=submit]:enabled').waitFor();
  await page.locator('#auth-email').fill('synthetic@example.invalid'); await page.locator('#auth-password').fill('synthetic-password');
  await page.locator('[data-auth-form] [type=submit]').click();
  await page.waitForURL(url => url.pathname === '/zh/app/' && url.hash === '#/chat/draft-chat');
  await page.locator('#fx-input').waitFor();
  assert.equal(await page.locator('#fx-input').inputValue(), nextUser === 42 ? draft : '', 'a different user never receives the previous user’s text');
  assert.equal(backend.state.generations.length, 0, 'restoring a draft never submits it');
  assert.deepEqual(errors, []);
});
