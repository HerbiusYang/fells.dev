import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserFixture } from '../helpers/browser.mjs';
import { createAppBackend } from '../helpers/app-backend.mjs';
import { acceptSiteConfirm } from '../helpers/site-confirm.mjs';

const fixture = createBrowserFixture();
before(() => fixture.start());
after(() => fixture.stop());

const agreement = { version: 'v1', h1: 'Terms', lede: 'Read these terms.', clauses: [{ title: 'Service', body: 'Service terms.' }], ui: {} };
const preferences = { theme: 'light', prefs: { agent: '', send: 0 }, notifs: [true, true, true, false], onboarded: true, answers: [[], [], [], []], promoClosed: true, sbHidden: false };

test('marketing ?ref= persists in sessionStorage and propagates to start and language links across pages', async t => {
  const { page, base, errors } = await fixture.setup(t);
  await page.goto(`${base}/?ref=FRIEND99`);
  const startHref = await page.locator('a[href*="/zh/app/start"]').first().getAttribute('href');
  const startUrl = new URL(startHref, base);
  assert.equal(startUrl.searchParams.get('ref'), 'FRIEND99');
  assert.equal(startUrl.hash, '#signup');

  const enSwitch = await page.locator('[data-lang] a[hreflang="en"]').first().getAttribute('href');
  assert.equal(new URL(enSwitch, base).searchParams.get('ref'), 'FRIEND99');

  await page.goto(`${base}/en/`);
  const enStartHref = await page.locator('a[href*="/app/start"]').first().getAttribute('href');
  assert.equal(new URL(enStartHref, base).searchParams.get('ref'), 'FRIEND99');
  assert.deepEqual(errors, []);
});

test('signup page prefills referral code, live-syncs edits to GitHub/language links, submits code and clears storage', async t => {
  const { context, page, base, errors } = await fixture.setup(t);
  const backend = createAppBackend({ signedIn: false, preferences });
  const calls = [];
  await backend.install(context);
  await context.route('**/api/app/auth/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname, method = req.method();
    if (method === 'POST') {
      calls.push({ path, body: req.postDataJSON() });
      if (path === '/api/app/auth/signup') backend.state.signedIn = true;
      return route.fulfill({ json: { ok: true, username: 'new-user', gift_micro: 0, referred: true } });
    }
    if (path === '/api/app/auth/config') return route.fulfill({ json: { signup_enabled: true, email_enabled: true, github_enabled: true, channels: ['email'], min_password_length: 8, turnstile_site_key: '' } });
    return route.fallback();
  });
  await context.route('**/api/app/agreement**', route => route.fulfill({ json: agreement }));

  await page.goto(`${base}/app/start/?ref=FRIEND99#signup`);
  await page.locator('[data-auth-form] [type=submit]:not([disabled])').waitFor();
  assert.equal(await page.locator('#auth-referral').inputValue(), 'FRIEND99');
  assert.equal(new URL(await page.locator('[data-github]').getAttribute('href'), base).searchParams.get('ref'), 'FRIEND99');

  await page.locator('#auth-referral').fill('CUSTOM88');
  assert.equal(new URL(await page.locator('[data-github]').getAttribute('href'), base).searchParams.get('ref'), 'CUSTOM88');
  assert.equal(new URL(await page.locator('[data-auth-locale][hreflang="zh-CN"]').getAttribute('href'), base).searchParams.get('ref'), 'CUSTOM88');

  await page.locator('#auth-username').fill('new_referral_user');
  await page.locator('#auth-email').fill('new-user@example.test');
  await page.locator('#auth-code').fill('123456');
  await page.locator('#auth-password').fill('correct-horse');
  await page.locator('#auth-confirm').fill('correct-horse');
  await page.locator('[name=agree]').check();
  await page.locator('[data-auth-form] [type=submit]').click();

  await page.waitForURL(url => /\/app\/?$/.test(url.pathname));
  const signup = calls.find(c => c.path === '/api/app/auth/signup');
  assert.ok(signup, 'signup request should be sent');
  assert.equal(signup.body.referral_code, 'CUSTOM88');
  assert.equal(await page.evaluate(() => sessionStorage.getItem('fells.referral.v1')), null);
  assert.deepEqual(errors, []);
});

test('invite dialog shows full referral details and sends rebate-credit:-prefixed ref on transfer', async t => {
  const transfers = [];
  const f = await fixture.setup(t, { viewport: { width: 1280, height: 760 } });
  const backend = createAppBackend({
    preferences,
    workspaces: [{ id: 'ref-ws', name: 'Referral WS', region: 'auto', tz: 'UTC', created: 1700000000000, role: 'owner' }],
  });
  await backend.install(f.context);
  await f.context.route('**/api/app/referral', route => route.fulfill({
    json: {
      active: true,
      name: 'Referral Program',
      reward_terms: '好友首次付费 14 天后，你和好友各得 ¥100',
      referee_reward_terms: '首次付费 14 天后，你得 ¥100',
      bonus_min_topup_micro: 99_000_000,
      stat: { code: 'HOST8888', invited: 3, converted: 2, rewards: 1, pending: 1 },
      pending_bonuses: [{ referee: 'guest-one', referrer_micro: 100_000_000, due_at: 1800000000 }],
    },
  }));
  await f.context.route('**/api/app/rebates', route => route.fulfill({
    json: {
      active: true,
      percents: [1.5, 0.5, 0.25],
      team: [3, 1, 0],
      hold_days: 30,
      window_months: 12,
      summary: { payable_micro: 25_000_000, held_micro: 5_000_000, pending_bonus_micro: 100_000_000, accrued_micro: 30_000_000 },
      entries: [{ kind: 'referral_bonus', level: 1, referee: 'guest-zero', created_at: 1790000000, delta_micro: 25_000_000 }],
    },
  }));
  await f.context.route('**/api/app/rebates/credit', route => {
    transfers.push({ body: route.request().postDataJSON(), key: route.request().headers()['idempotency-key'] });
    return route.fulfill({ json: { ok: true } });
  });

  await f.page.goto(`${f.base}/zh/app/`);
  await f.page.locator('.sb [data-act=invite]').click();
  const dlg = f.page.locator('[data-invite-dialog]');
  await dlg.waitFor();
  const text = await dlg.innerText();
  assert.match(text, /HOST8888/);
  assert.match(text, /1级 1\.5% \/ 2级 0\.5% \/ 3级 0\.25%/);
  assert.match(text, /单笔最低实付：¥99\.00/);
  assert.match(text, /guest-one/);
  assert.match(text, /推荐固定奖励/);

  await f.page.locator('[data-act=rebate-credit]').click();
  await acceptSiteConfirm(f.page);
  await f.page.locator('.scrim').waitFor({ state: 'detached' });

  assert.equal(transfers.length, 1);
  assert.equal(transfers[0].body.expected_payable, 25_000_000);
  assert.equal(transfers[0].body.ref, `rebate-credit:${transfers[0].key}`);
  assert.deepEqual(f.errors, []);
});

test('disabling referral capability hides sidebar, account menu and palette invite triggers', async t => {
  const f = await fixture.setup(t, { viewport: { width: 1280, height: 760 } });
  const backend = createAppBackend({
    preferences,
    referral: false,
    workspaces: [{ id: 'no-ref-ws', name: 'No Ref WS', region: 'auto', tz: 'UTC', created: 1700000000000, role: 'owner' }],
  });
  await backend.install(f.context);
  await f.page.goto(`${f.base}/zh/app/`);
  await f.page.locator('.sb .me-btn').waitFor();

  assert.equal(await f.page.locator('.sb [data-act=invite]').count(), 0);
  await f.page.locator('.sb .me-btn').click();
  assert.equal(await f.page.locator('.invite-banner').count(), 0);
  await f.page.keyboard.press('Escape');

  await f.page.keyboard.press('Control+k');
  await f.page.locator('[data-input=pal]').waitFor();
  assert.doesNotMatch(await f.page.locator('[data-pal]').innerText(), /邀请好友|Invite friends/i);
  assert.deepEqual(f.errors, []);
});
