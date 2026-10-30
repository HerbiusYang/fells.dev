import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { prepareSupportOperator } from './helpers/support-live-session.mjs';

// The Go fixture verifies real RS256 JWTs and serves the real admin, frontend,
// API and DB. Only its identity control endpoint and external Access logout
// redirect are synthetic. No successful product API reply is intercepted.
test('console Access only: admin entry, role checks, host isolation, identity change and complete logout', { timeout: 180000 }, async t => {
  if (process.env.FELLS_ACCESS_BROWSER_TEST !== '1') { t.skip('Requires the isolated real Access/DB fixture'); return; }
  const consoleBase = new URL(process.env.FELLS_ACCESS_CONSOLE_BASE), publicBase = new URL(process.env.FELLS_ACCESS_PUBLIC_BASE);
  for (const origin of [consoleBase, publicBase]) {
    assert.equal(origin.hostname, '127.0.0.1'); assert.equal(origin.protocol, 'http:');
    assert.equal(origin.username + origin.password + origin.search + origin.hash, '');
  }
  assert.notEqual(consoleBase.origin, publicBase.origin);
  const evidenceDirectory = process.env.FELLS_ACCESS_EVIDENCE_DIR;
  if (evidenceDirectory) await mkdir(evidenceDirectory, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  t.after(() => browser.close());
  const errors = [], checks = [], requests = [], adminDebug = [];
  t.after(async () => {
    if (evidenceDirectory) await writeFile(resolve(evidenceDirectory, 'access-admin-debug.json'), JSON.stringify({ errors, requests, adminDebug }, null, 2));
  });
  const context = async (width = 1440, reducedMotion = 'reduce') => {
    const ctx = await browser.newContext({ viewport: { width, height: width === 320 ? 568 : 1000 }, reducedMotion });
    await ctx.route(/^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//, route => route.abort());
    ctx.on('page', page => {
      page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
      page.on('requestfailed', request => adminDebug.push({ kind: 'requestfailed', path: new URL(request.url()).pathname, failure: request.failure()?.errorText }));
      page.on('request', request => { const url = new URL(request.url()); if (url.pathname === '/api/support/session') requests.push({ method: request.method(), path: url.pathname, expected: Boolean(request.headers()['x-fells-expected-operator-session']) }); });
    });
    return ctx;
  };
  const identity = async (ctx, role) => {
    const response = await ctx.request.post(new URL('/__support_access_fixture/identity', consoleBase).href, { data: { identity: role } });
    assert.equal(response.status(), 204, 'Select only a synthetic fixture identity');
  };
  const capture = async (page, name) => { if (evidenceDirectory) await page.screenshot({ path: resolve(evidenceDirectory, `${name}.png`), fullPage: true }); };
  const noPassword = async page => assert.equal(await page.locator('input[type=password],[data-support-login-form]').count(), 0);
  const adminWithoutPassword = async (page, role) => {
    const debug = await page.context().newCDPSession(page);
    await debug.send('Debugger.enable');
    debug.on('Debugger.paused', async event => {
      adminDebug.push({ kind: 'exception', role, reason: event.reason, description: event.data?.description, frames: event.callFrames.slice(0, 6).map(frame => ({ function: frame.functionName, url: frame.url, line: frame.location.lineNumber + 1, column: frame.location.columnNumber + 1 })) });
      await debug.send('Debugger.resume').catch(() => {});
    });
    await debug.send('Debugger.setPauseOnExceptions', { state: 'all' });
    const replies = [];
    page.on('response', response => { if (new URL(response.url()).pathname === '/admin/api/me') replies.push(response); });
    const document = await page.goto(new URL('/admin/', consoleBase).href);
    if (!['owner', 'ops', 'viewer'].includes(role) && [401, 403].includes(document.status())) {
      adminDebug.push({ kind: 'document-denied', role, status: document.status() });
      assert.equal(await page.locator('input[type=password]').count(), 0, `${role}: rejected Access document must not contain a password form`);
      return document;
    }
    const reply = replies[0] ?? await page.waitForResponse(response => new URL(response.url()).pathname === '/admin/api/me');
    const account = await reply.json();
    adminDebug.push({ kind: 'identity', role, status: reply.status(), body: account });
    assert.equal(account.auth_method, 'cloudflare_access', `${role}: server declares the real configured authentication mode`);
    assert.ok((['owner', 'ops', 'viewer'].includes(role) ? [200] : [401, 403]).includes(reply.status()), `${role}: real admin identity response`);
    await page.waitForFunction(() => document.querySelector('#app:not(.hide),#login:not(.hide)'));
    await capture(page, `${role}-admin-auth-${page.viewportSize().width}-${await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduce' : 'motion')}`);
    assert.equal(await page.locator('#login input[type=password]').isVisible(), false, `${role}: Access must never fall back to a password form`);
    if (['owner', 'ops', 'viewer'].includes(role)) assert.equal(await page.locator('#app').isVisible(), true, `${role}: verified identity must initialize the real admin application`);
    return reply;
  };
  const loaded = async page => { await page.locator('[data-support-search]:enabled').waitFor(); await noPassword(page); };
  const denied = async page => {
    await page.locator('[data-support-session-notice]').waitFor({ state: 'visible' });
    assert.match(await page.locator('[data-support-session-error]').innerText(), /Cloudflare Access/);
    assert.equal(await page.locator('[data-support-console-return]').getAttribute('href'), '/admin/');
    assert.equal(await page.locator('[data-support-list]').innerText(), ''); await noPassword(page);
  };
  for (const role of ['owner', 'ops']) for (const width of [1440, 320]) for (const motion of ['reduce', 'no-preference']) {
    const ctx = await context(width, motion); await identity(ctx, role);
    const admin = await ctx.newPage(); await adminWithoutPassword(admin, role);
    const entry = admin.locator(width === 320 ? '#mod-sheet .support-entry' : '#support-entry');
    if (width === 320) await admin.locator('#nav-more').click();
    await entry.waitFor({ state: 'visible' }); assert.equal(await entry.getAttribute('href'), '/support/desk');
    assert.equal(await entry.getAttribute('target'), '_blank');
    assert.ok((await entry.getAttribute('rel') ?? '').split(/\s+/).includes('noopener'));
    if (width === 1440) {
      // The current admin footer places its open-source notice after the desk
      // entry. Live service status is a separate asynchronous model snapshot.
      assert.deepEqual(await entry.evaluate(node => ({
        inRailFooter: node.parentElement?.classList.contains('rail-foot'),
        followedByNotice: node.nextElementSibling?.matches('a.tr-credit'),
        noticePath: node.nextElementSibling?.getAttribute('href'),
      })), { inRailFooter: true, followedByNotice: true, noticePath: '/assets/tokenrouter/NOTICE.txt' });
    }
    await capture(admin, `${role}-admin-${width}`);
    const opened = ctx.waitForEvent('page'); await entry.click(); const desk = await opened; await loaded(desk);
    assert.equal(new URL(admin.url()).pathname, '/admin/');
    assert.match(new URL(desk.url()).pathname, /^\/support\/desk\/?$/);
    const session = await prepareSupportOperator(ctx, { base: consoleBase }); assert.equal(session.authMethod, 'access');
    assert.equal(await desk.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await capture(desk, `${role}-desk-${width}-${motion}`); checks.push(`${role}/${width}/${motion}: real admin opens a separate Access desk without password`);
    await ctx.close();
  }
  for (const role of ['viewer', 'missing', 'disabled', 'customer', 'unknown', 'expired']) for (const motion of role === 'viewer' ? ['reduce', 'no-preference'] : ['reduce']) {
    const ctx = await context(320, motion); await identity(ctx, role);
    const admin = await ctx.newPage(); await adminWithoutPassword(admin, role); await admin.close();
    const page = await ctx.newPage(), before = requests.length;
    await page.goto(new URL('/zh/support/desk/', consoleBase).href); await denied(page);
    assert.equal(new URL(page.url()).pathname, '/zh/support/desk/');
    assert.deepEqual(requests.slice(before).map(request => request.method), ['GET'], 'Denied entry makes one restore request and never loops');
    if (role === 'missing') await capture(page, 'denied-mobile');
    checks.push(`${role}: denied without password form or redirect loop`); await ctx.close();
  }
  {
    const ctx = await context(); await identity(ctx, 'owner');
    const page = await ctx.newPage();
    await page.route('**/admin/app.js?*', async route => {
      const reply = await route.fetch(); assert.equal(reply.status(), 200);
      const source = await reply.text(); assert.ok(source.includes('function navPaint(prev){'));
      await route.fulfill({ response: reply, body: source.replace('function navPaint(prev){', 'function navPaint(prev){throw new Error("SYNTHETIC_NAV_PAINT_FAILURE");') });
    });
    const identityReply = page.waitForResponse(response => new URL(response.url()).pathname === '/admin/api/me');
    await page.goto(new URL('/admin/', consoleBase).href);
    const reply = await identityReply; assert.equal(reply.status(), 200); assert.equal((await reply.json()).role, 'owner');
    await page.getByText('后台未能完成加载', { exact: true }).waitFor();
    assert.equal(await page.locator('#login input[type=password]').isVisible(), false);
    assert.equal(await page.locator('#app').isVisible(), false);
    assert.match(await page.locator('#lg-sub').innerText(), /登录状态已确认/);
    await capture(page, 'owner-initialization-failure');
    checks.push('Authenticated owner with an injected navPaint exception sees an initialization error and never a password fallback');
    await ctx.close();
  }
  const operator = await context(); await identity(operator, 'ops');
  const desk = await operator.newPage(); await desk.goto(new URL('/support/desk/', consoleBase).href); await loaded(desk);
  const original = await prepareSupportOperator(operator, { base: consoleBase });
  const bound = { 'X-Fells-Support-Audience': 'operator', 'X-Fells-Expected-Operator': original.operator.id, 'X-Fells-Expected-Operator-Session': original.sessionId };
  const copied = await context(); await copied.addCookies((await operator.cookies()).filter(cookie => cookie.name !== 'support_access_browser_fixture_identity'));
  const copiedResponse = await copied.request.get(new URL('/api/support/session', publicBase).href, { headers: bound });
  assert.ok([401, 403].includes(copiedResponse.status()), 'Console support cookie cannot authenticate on the public host'); await copied.close();
  // Give the desk a real blur/focus transition. Its session refresh or event
  // stream may already replace the document when the identity changes.
  const focusCover = await operator.newPage(); await focusCover.bringToFront();
  await identity(operator, 'owner');
  const stale = await operator.request.get(new URL('/api/support/session', consoleBase).href, { headers: bound });
  assert.equal(stale.status(), 401); assert.equal((await stale.json()).error.code, 'session_changed');
  await Promise.all([desk.waitForURL(url => url.pathname === '/admin/'), desk.bringToFront()]);
  await focusCover.close();
  assert.equal(await desk.locator('[data-support-message]').count(), 0);
  checks.push('Identity replacement rejects the old binding and purges the existing desk');
  await identity(operator, 'expired'); await desk.goto(new URL('/support/desk/', consoleBase).href); await denied(desk);
  checks.push('Expired Access cannot restore the remaining cookie'); await operator.close();

  const shared = await context(); await identity(shared, 'ops');
  const login = await shared.request.post(new URL('/api/app/session', publicBase).href, { headers: { Origin: publicBase.origin }, data: { username: process.env.FELLS_ACCESS_CUSTOMER_USERNAME || 'support-browser-customer', password: process.env.FELLS_ACCESS_CUSTOMER_PASSWORD || 'support-browser-password' } });
  assert.equal(login.status(), 200);
  const user = await shared.newPage(); await user.goto(new URL('/zh/app/', publicBase).href);
  const bootstrapReply = await shared.request.get(new URL('/api/app/bootstrap', publicBase).href);
  assert.equal(bootstrapReply.status(), 200);
  const customerBootstrap = await bootstrapReply.json();
  if (!customerBootstrap.agreement.accepted) {
    // This synthetic customer must perform the same explicit current-terms
    // consent as a real customer before the protected support action is shown.
    const agreement = user.locator('[data-form=agreement]');
    await agreement.locator('[name=consent]').check();
    const acceptedReply = user.waitForResponse(response => new URL(response.url()).pathname === '/api/app/agreement/accept' && response.request().method() === 'POST');
    await agreement.locator('button').click();
    const accepted = await acceptedReply;
    assert.equal(accepted.status(), 200); assert.equal((await accepted.json()).ok, true);
    assert.equal(accepted.request().headers()['x-fells-expected-user'], String(customerBootstrap.user.id));
    assert.equal(accepted.request().headers()['x-fells-expected-session'], customerBootstrap.session_id);
    await agreement.waitFor({ state: 'detached' });
    const confirmedReply = await shared.request.get(new URL('/api/app/bootstrap', publicBase).href);
    assert.equal(confirmedReply.status(), 200);
    const confirmed = await confirmedReply.json();
    assert.equal(confirmed.agreement.accepted, true);
    assert.equal(confirmed.user.id, customerBootstrap.user.id); assert.equal(confirmed.session_id, customerBootstrap.session_id);
  }
  await user.locator('[data-chat-support]:visible,[data-support-open]:visible').click();
  const text = `Access logout isolation ${crypto.randomUUID()}`;
  await user.locator('#support-widget [data-support-text]').fill(text); await user.locator('#support-widget [data-support-send]').click();
  await user.locator('[data-support-message]').filter({ hasText: text }).waitFor();
  const first = await shared.newPage(), second = await shared.newPage();
  await first.goto(new URL('/support/desk/', consoleBase).href); await loaded(first);
  await second.goto(new URL('/zh/support/desk/', consoleBase).href); await loaded(second);
  const revoked = await prepareSupportOperator(shared, { base: consoleBase });
  const exits = []; shared.on('request', request => { if (new URL(request.url()).pathname === '/cdn-cgi/access/logout') exits.push(request.url()); });
  await first.locator('[data-support-logout]').click();
  await Promise.all([first, second].map(page => page.waitForURL(url => url.pathname === '/support/')));
  await denied(first); await denied(second); assert.ok(exits.length >= 2, 'Each desk follows the fixed Access exit');
  const after = await shared.request.get(new URL('/api/support/session', consoleBase).href, { headers: { 'X-Fells-Support-Audience': 'operator', 'X-Fells-Expected-Operator': revoked.operator.id, 'X-Fells-Expected-Operator-Session': revoked.sessionId } });
  assert.ok([401, 403].includes(after.status()));
  await user.bringToFront(); const remaining = `${text} still a customer`;
  await user.locator('#support-widget [data-support-text]').fill(remaining); await user.locator('#support-widget [data-support-send]').click();
  await user.locator('[data-support-message]').filter({ hasText: remaining }).waitFor(); await capture(first, 'signed-out');
  checks.push('Real revoke and Access logout close both desks; same browser customer remains usable');
  for (const locale of ['', '/zh', '/zh-hant', '/ja', '/ko', '/es']) {
    for (const suffix of ['/support/', '/support/desk/']) assert.equal((await shared.request.get(new URL(locale + suffix, publicBase).href)).status(), 404);
    for (const base of [consoleBase, publicBase]) for (const suffix of ['/fells-test-portal/', '/fells-test-portal/desk/', '/support/login/']) assert.equal((await shared.request.get(new URL(locale + suffix, base).href)).status(), 404);
  }
  checks.push('All fixed operator pages are denied on public host; all retired login/desk paths return 404 on both hosts');
  assert.equal(requests.some(request => request.method === 'POST'), false, 'No browser operator password request');
  assert.deepEqual(errors, []);
  if (evidenceDirectory) await writeFile(resolve(evidenceDirectory, 'access-browser-result.json'), JSON.stringify({ checks, requests, errors, fixture: 'Real Go admin + frontend + RS256 verification + DB; synthetic identity selection and external Access logout' }, null, 2));
  await shared.close();
});
