import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { createBrowserFixture } from '../helpers/browser.mjs';
import { observeSecurity, unexpectedBrowserErrors } from '../helpers/security-observer.mjs';

const fixture = createBrowserFixture();
const dist = resolve(process.env.TEST_DIST_DIR || 'dist');
const localeNames = ['en', 'zh', 'zh-hant', 'ja', 'ko', 'es'];
const localePrefix = locale => locale === 'en' ? '' : `/${locale}`;
let documents;

async function htmlDocuments(directory = dist) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await htmlDocuments(path));
    else if (entry.name.endsWith('.html')) {
      const name = relative(dist, path).split('\\').join('/');
      paths.push('/' + name.replace(/(?:^|\/)index\.html$/, match => match.startsWith('/') ? '/' : ''));
    }
  }
  return paths.sort();
}

before(async () => { documents = await htmlDocuments(); await fixture.start(); });
after(() => fixture.stop());

async function setup(t, bootstrapStatus = 401) {
  const { context, page, base } = await fixture.setup(t, { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  // Install observers on this already-created page as well as later pages.
  // The common helper creates one page, so attach observers before replacing it.
  await page.close();
  const observed = await observeSecurity(context);
  const external = [];
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === base) { await route.continue(); return; }
    // Keep font loading deterministic without aborting a legitimate request
    // and disguising its console error as an application failure.
    if (url.origin === 'https://fonts.googleapis.com') {
      await route.fulfill({ status: 200, contentType: 'text/css', body: '' }); return;
    }
    external.push(url.href);
    await route.abort();
  });
  await context.route('**/api/app/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const status = path === '/api/app/bootstrap' ? bootstrapStatus : path === '/api/app/session' ? 401 : 200;
    const data = path === '/api/app/auth/config'
      ? { signup_enabled: true, channels: ['email'], min_password_length: 8, turnstile_site_key: '' }
      : path === '/api/app/agreement'
        ? { version: 'security-test', h1: 'Test terms', lede: 'Test terms.', clauses: [{ heading: 'Service', paras: ['Isolated test only.'] }], ui: {} }
        : { error: status === 503 ? 'Temporary bootstrap outage' : 'Sign in required' };
    await route.fulfill({ status, headers: { 'cache-control': 'no-store' }, json: data });
  });
  await context.route('**/api/support/session', route => route.fulfill({ status: 200, headers: { 'cache-control': 'no-store' }, json: { ok: true, data: null, requestId: 'security-test' } }));
  const observedPage = await context.newPage();
  return { context, page: observedPage, base, observed, external };
}

function assertHeaders(headers, route) {
  assert.equal(headers['x-content-type-options'], 'nosniff', route);
  assert.equal(headers['x-frame-options'], 'DENY', route);
  assert.equal(headers['referrer-policy'], 'no-referrer', route);
  // Loopback HTTP verifies the configured header value. HSTS transport behavior
  // still needs the HTTPS deployment acceptance check on the test VPS.
  assert.match(headers['strict-transport-security'] ?? '', /^max-age=31536000;\s*includeSubDomains$/, route);
  const policy = headers['content-security-policy'] ?? '';
  for (const directive of ["frame-ancestors 'none'", "base-uri 'self'", "object-src 'none'", "form-action 'self'"]) assert.ok(policy.includes(directive), `${route}: ${directive}`);
}

async function assertScriptPolicy(page, route) {
  const policy = await page.locator('meta[http-equiv="Content-Security-Policy" i]').getAttribute('content');
  assert.match(policy, /(?:^|;)\s*script-src\s/, route);
  assert.match(policy, /'sha(?:256|384|512)-[^']+'/, `${route}: build hashes authorize the site's inline scripts`);
  const scriptDirective = policy.split(';').find(part => /^\s*script-src\s/.test(part));
  assert.ok(!scriptDirective.includes("'unsafe-inline'") && !scriptDirective.includes("'unsafe-eval'"), route);
  const ordered = await page.evaluate(() => {
    const meta = document.querySelector('meta[http-equiv="Content-Security-Policy" i]');
    return [...document.scripts].filter(script => !script.type || /^(?:module|(?:application|text)\/(?:java|ecma)script)$/i.test(script.type))
      .every(script => Boolean(meta.compareDocumentPosition(script) & Node.DOCUMENT_POSITION_FOLLOWING));
  });
  assert.equal(ordered, true, `${route}: CSP appears before every executable script`);
  await page.locator('html.js').waitFor({ state: 'attached' });
}

function assertOriginalDocumentPolicy(html, route) {
  // Check the requested document too: a client-side redirect from /app or
  // /desk must not let its source policy escape the six-language route audit.
  const meta = html.match(/<meta\b[^>]*http-equiv=(?:"Content-Security-Policy"|'Content-Security-Policy'|Content-Security-Policy)[^>]*>/i);
  assert.ok(meta, `${route}: the original HTTP document contains enforced CSP`);
  assert.match(meta[0], /script-src/, route);
  for (const script of html.matchAll(/<script\b([^>]*)>[\s\S]*?<\/script>/gi)) {
    const type = script[1].match(/\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const mime = (type?.[1] ?? type?.[2] ?? type?.[3] ?? '').trim().toLowerCase();
    if (['', 'module', 'text/javascript', 'application/javascript', 'text/ecmascript', 'application/ecmascript'].includes(mime)) {
      assert.ok(meta.index < script.index, `${route}: original CSP precedes executable scripts`);
    }
  }
}

function assertNormalDiagnostics(observed, base, route, external) {
  assert.deepEqual(observed.applicationErrors, [], `${route}: no explicit application console.error calls`);
  assert.deepEqual(observed.pageErrors, [], `${route}: no uncaught JavaScript errors`);
  assert.deepEqual(observed.violations, [], `${route}: legitimate UI has no CSP violations`);
  assert.deepEqual(unexpectedBrowserErrors(observed.browserErrors, base, ['/api/app/bootstrap', '/api/app/session']), [], `${route}: only expected anonymous HTTP 401 diagnostics`);
  assert.deepEqual(external, [], `${route}: no unhandled external resources`);
}

for (const locale of localeNames) {
  test(`public customer widget security policy: all built ${locale} pages initialize under enforced CSP`, async t => {
    const prefix = localePrefix(locale);
    const routes = documents.filter(route => locale === 'en'
      ? !localeNames.slice(1).some(name => route.startsWith(`/${name}/`))
      : route.startsWith(prefix + '/'));
    assert.ok(routes.length > 0, `the current build includes ${locale} pages`);
    const { context, page, base, observed, external } = await setup(t);
    for (const route of routes) {
      // Read the requested document independently before its scripts can
      // redirect: Chromium discards its response body after that navigation.
      const original = await context.request.get(base + route);
      assert.equal(original.status(), 200, route);
      assertHeaders(original.headers(), route);
      assertOriginalDocumentPolicy(await original.text(), route);
      const response = await page.goto(base + route, { waitUntil: 'networkidle' });
      assert.equal(response.status(), 200, route);
      assertHeaders(response.headers(), route);
      // App/desk routes can redirect an anonymous visitor to their sign-in page.
      await assertScriptPolicy(page, route);
      if (await page.locator('#support-widget').count()) {
        await page.locator('[data-support-open]').waitFor({ state: 'visible' });
        assert.equal(await page.locator('[data-support-retry]').count(), 0, `${route}: 401 is signed out, not unavailable`);
      }
      if (await page.locator('[data-auth-form]').count()) await page.locator('#auth-password:not([disabled])').waitFor();
      const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth);
      assert.ok(overflow <= 1, `${route}: no mobile horizontal overflow (${overflow}px)`);
      assertNormalDiagnostics(observed, base, route, external);
    }
    const anonymous = observed.responses.filter(response => response.path === '/api/app/bootstrap');
    assert.ok(anonymous.length > 0, `${locale}: real UI made its anonymous session checks`);
    assert.ok(anonymous.every(response => response.status === 401 && response.cacheControl === 'no-store'), `${locale}: anonymous bootstrap remains 401 and no-store`);
    t.diagnostic(`Visited ${routes.length} HTML routes from TEST_DIST_DIR under enforced CSP.`);
  });
}

test('public customer widget security policy: bootstrap 503 remains a visible recoverable failure', async t => {
  const { page, context, base, observed, external } = await setup(t, 503);
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.locator('[data-support-open]').click();
  await page.locator('[data-support-retry]').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#support-panel .support-greeting a').count(), 0, 'outage must not be converted into signed-out success');
  assert.equal(await page.locator('[data-support-text]').isDisabled(), true);
  assert.ok(observed.responses.some(response => response.path === '/api/app/bootstrap' && response.status === 503), 'failure remains visible in HTTP observations');
  await context.route('**/api/app/bootstrap', route => route.fulfill({ status: 401, headers: { 'cache-control': 'no-store' }, json: { error: 'Sign in required' } }));
  await page.locator('[data-support-retry]').click();
  await page.locator('#support-panel .support-greeting a').waitFor({ state: 'visible' });
  assert.equal(await page.locator('[data-support-retry]').count(), 0, 'retry recovers into the normal anonymous branch');
  assert.deepEqual(observed.pageErrors, []);
  assert.deepEqual(observed.violations, []);
  assert.deepEqual(external, []);
});

test('public customer widget security policy: browser blocks unknown inline, eval and foreign scripts', async t => {
  for (const locale of localeNames) {
    const { page, context, base, observed, external } = await setup(t);
    await page.goto(base + localePrefix(locale) + '/', { waitUntil: 'networkidle' });
    await assertScriptPolicy(page, locale);
    assertNormalDiagnostics(observed, base, locale, external);
    let foreignRequests = 0;
    const foreignURL = 'https://untrusted-script.example.test/__csp-probe.js';
    await context.route(foreignURL, route => { foreignRequests++; return route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.__fellsForeignExecuted=true;' }); });
    await context.route(base + '/__csp-probe.js', route => route.fulfill({
      status: 200, contentType: 'text/javascript',
      body: 'window.__fellsAllowedExecuted=true;try{eval("window.__fellsEvalExecuted=true;")}catch{window.__fellsEvalBlocked=true;}',
    }));
    // Playwright evaluation is only used to insert DOM nodes. The browser must
    // execute (or reject) their scripts through its normal CSP enforcement path.
    await page.evaluate(({ foreignURL, allowedURL }) => {
      const inline = document.createElement('script'); inline.textContent = 'window.__fellsInlineExecuted=true;'; document.head.append(inline);
      const foreign = document.createElement('script'); foreign.src = foreignURL; document.head.append(foreign);
      const allowed = document.createElement('script'); allowed.src = allowedURL; document.head.append(allowed);
    }, { foreignURL, allowedURL: base + '/__csp-probe.js' });
    await page.waitForFunction(() => window.__fellsAllowedExecuted && window.__fellsEvalBlocked
      && ['inline', 'eval'].every(uri => window.__fellsTestCSPViolations.some(event => event.blockedURI === uri))
      && window.__fellsTestCSPViolations.some(event => event.blockedURI.includes('untrusted-script.example.test')));
    const execution = await page.evaluate(() => ({ inline: window.__fellsInlineExecuted, foreign: window.__fellsForeignExecuted, eval: window.__fellsEvalExecuted, allowed: window.__fellsAllowedExecuted }));
    assert.deepEqual(execution, { inline: undefined, foreign: undefined, eval: undefined, allowed: true }, locale);
    assert.equal(foreignRequests, 0, `${locale}: forbidden script is stopped before the network request`);
    assert.ok(observed.violations.every(event => event.disposition === 'enforce' && event.directive.startsWith('script-src')), `${locale}: browser enforces rather than only reports`);
    assert.deepEqual(observed.applicationErrors, []);
    assert.deepEqual(observed.pageErrors, []);
    await context.close();
  }
});
