import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createBrowserFixture } from '../helpers/browser.mjs';

const fixture = createBrowserFixture();
before(() => fixture.start());
after(() => fixture.stop());

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const close = server => new Promise(resolve => server.close(resolve));

// Both origins stay on loopback. This exercises the browser's real redirect
// behavior without sending demo codes or emails to an external service.
async function redirectEndpoint(t, context, status) {
  const sourceRequests = [], forwarded = [];
  const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' };
  const sink = createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      if (request.method !== 'OPTIONS') forwarded.push({ method: request.method, body });
      response.writeHead(request.method === 'OPTIONS' ? 204 : 200, { ...headers, 'content-type': 'application/json' }).end('{}');
    });
  });
  await listen(sink);
  const source = createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      if (request.method === 'OPTIONS') { response.writeHead(204, headers).end(); return; }
      sourceRequests.push({ method: request.method, body: JSON.parse(body) });
      response.writeHead(status, { ...headers, location: `http://127.0.0.1:${sink.address().port}/collect` }).end();
    });
  });
  await listen(source);
  t.after(async () => { await close(source); await close(sink); });
  await context.route('http://127.0.0.1:*/*', route => route.continue());
  return { url: `http://127.0.0.1:${source.address().port}/submit`, sourceRequests, forwarded };
}

async function fillRedemption(page) {
  await page.locator('[name=email]').fill('redeem-audit@example.invalid');
  await page.locator('[data-field=cdk]').fill('DUMMY-AUDIT-CDK');
  await page.locator('[name=agree]').check();
}

for (const status of [307, 308]) {
  test(`redemption rejects ${status} instead of forwarding a CDK to another origin`, async t => {
    const { page, context, base, errors } = await fixture.setup(t);
    const endpoint = await redirectEndpoint(t, context, status);
    await page.goto(base + '/checkout/?mode=redeem');
    await page.locator('[data-checkout]').evaluate((form, url) => { form.dataset.redeem = url; }, endpoint.url);
    await fillRedemption(page);
    await page.locator('[data-submit]').click();
    await page.locator('[data-msg].err').waitFor();
    assert.deepEqual(endpoint.sourceRequests, [{ method: 'POST', body: { email: 'redeem-audit@example.invalid', cdk: 'DUMMY-AUDIT-CDK' } }]);
    assert.deepEqual(endpoint.forwarded, []);
    assert.equal(await page.locator('[data-field=cdk]').inputValue(), 'DUMMY-AUDIT-CDK');
    assert.equal(await page.locator('[data-submit]').isEnabled(), true);
    assert.equal(/DUMMY-AUDIT|redeem-audit/.test(page.url()), false);
    assert.deepEqual(errors, []);
  });

  test(`marketing and order waitlists reject ${status} before forwarding an email`, async t => {
    const { page, context, base, errors } = await fixture.setup(t);
    const endpoint = await redirectEndpoint(t, context, status);
    await page.addInitScript(() => {
      const original = window.fetch.bind(window);
      window.fetch = async (...args) => {
        try { const response = await original(...args); window.__auditFetch = 'resolved'; return response; }
        catch (error) { window.__auditFetch = 'rejected'; throw error; }
      };
    });
    for (const marketing of [true, false]) {
      await page.goto(base + (marketing ? '/' : '/checkout/?plan=1500'));
      const form = page.locator(marketing ? '[data-waitlist]' : '[data-checkout]');
      await form.evaluate((form, { url, marketing }) => { form.dataset[marketing ? 'action' : 'wait'] = url; }, { url: endpoint.url, marketing });
      await form.locator('[name=email]').fill('wait-audit@example.invalid');
      if (!marketing) await form.locator('[name=agree]').check();
      await form.locator('[type=submit]').first().click();
      await page.waitForFunction(() => window.__auditFetch === 'rejected');
      assert.equal(await form.locator('[name=email]').inputValue(), 'wait-audit@example.invalid');
      assert.equal(await form.locator('[type=submit]').first().isEnabled(), true);
    }
    assert.equal(endpoint.sourceRequests.length, 2);
    assert.equal(endpoint.sourceRequests.every(request => request.method === 'POST' && request.body.email === 'wait-audit@example.invalid'), true);
    assert.deepEqual(endpoint.forwarded, []);
    assert.deepEqual(errors, []);
  });
}

test('pending redemption prevents double-click and synthetic resubmission, and permits retry after failure', async t => {
  const { page, base, errors } = await fixture.setup(t);
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const requests = [];
  await page.route('**/__pending-redeem', async route => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) await pending;
    await route.fulfill({ status: requests.length === 1 ? 500 : 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto(base + '/checkout/?mode=redeem');
  await page.locator('[data-checkout]').evaluate(form => { form.dataset.redeem = '/__pending-redeem'; });
  await fillRedemption(page);
  try {
    await page.locator('[data-submit]').dblclick();
    assert.equal(await page.locator('[data-submit]').isDisabled(), true);
    assert.equal(await page.locator('[data-bar-submit]').isDisabled(), true);
    assert.equal(await page.locator('[data-field=cdk]').isDisabled(), true);
    assert.equal(await page.locator('[data-mode=token]').isDisabled(), true);
    await page.locator('[data-checkout]').evaluate(form => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  } finally { release(); }
  await page.locator('[data-msg].err').waitFor();
  assert.equal(requests.length, 1);
  assert.equal(await page.locator('[data-field=cdk]').inputValue(), 'DUMMY-AUDIT-CDK');
  assert.equal(await page.locator('[data-submit]').isEnabled(), true);
  await page.locator('[data-submit]').click();
  await page.waitForFunction(() => document.querySelector('[data-field=cdk]').value === '');
  assert.deepEqual(requests, Array.from({ length: 2 }, () => ({ email: 'redeem-audit@example.invalid', cdk: 'DUMMY-AUDIT-CDK' })));
  assert.deepEqual(errors, []);
});

test('unopened redemption sends only an email to the waitlist and retains the CDK', async t => {
  const { page, base, errors } = await fixture.setup(t);
  const requests = [];
  await page.route('**/__redeem-waitlist', route => {
    requests.push({ url: route.request().url(), body: route.request().postDataJSON() });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto(base + '/checkout/?mode=redeem');
  await page.locator('[data-checkout]').evaluate(form => { form.dataset.redeem = ''; form.dataset.wait = '/__redeem-waitlist'; });
  await fillRedemption(page);
  await page.locator('[data-submit]').click();
  await page.locator('[data-msg]').filter({ hasText: 'redeem-audit@example.invalid' }).waitFor();
  assert.deepEqual(requests.map(request => request.body), [{ email: 'redeem-audit@example.invalid', order: 'redeem' }]);
  assert.equal(JSON.stringify(requests).includes('DUMMY-AUDIT'), false);
  assert.equal(await page.locator('[data-field=cdk]').inputValue(), 'DUMMY-AUDIT-CDK');
  assert.deepEqual(errors, []);
});

test('checkout stays disabled in frames across locales even when the host omits framing headers', async t => {
  const { page, context, base, errors } = await fixture.setup(t);
  await context.route('**/checkout/**', async route => {
    const response = await route.fetch(), headers = response.headers();
    delete headers['content-security-policy']; delete headers['x-frame-options'];
    await route.fulfill({ response, headers });
  });
  await page.goto(base + '/');
  await page.evaluate(() => { const frame = document.createElement('iframe'); document.body.append(frame); });
  for (const locale of ['', '/zh', '/zh-hant', '/ja', '/ko', '/es']) {
    await page.locator('iframe').evaluate((frame, url) => { frame.src = url; }, locale + '/checkout/?mode=redeem');
    const frame = page.frameLocator('iframe');
    await frame.locator('[data-msg]').filter({ hasText: /\S/ }).waitFor();
    assert.equal(await frame.locator('[data-checkout] input:not([disabled])').count(), 0);
    assert.equal(await frame.locator('[data-submit]').isDisabled(), true);
    await frame.locator('[data-mode=redeem]').click();
    assert.equal(await frame.locator('[data-field=cdk]').isDisabled(), true);
  }
  assert.deepEqual(errors, []);
});

test('query markup cannot execute or change a hosted payment destination', async t => {
  const { page, base, errors } = await fixture.setup(t);
  const markup = '<img src=x onerror="window.__injected=true">';
  for (const key of ['mode', 'plan', 'seat', 'product', 'tier', 'period']) {
    await page.goto(base + '/checkout/?' + new URLSearchParams({ [key]: markup }));
    assert.equal(await page.locator('[data-submit]').isDisabled(), true);
    assert.equal(await page.evaluate(() => window.__injected), undefined);
    assert.equal(await page.locator('[data-checkout] img').count(), 0);
  }
  await page.goto(base + '/checkout/?' + new URLSearchParams({ plan: '1500', code: markup, redirect: 'javascript:window.__injected=true' }));
  assert.equal(await page.locator('[name=code]').inputValue(), markup);
  assert.equal(await page.evaluate(() => window.__injected), undefined);
  assert.equal(new URL(page.url()).searchParams.has('code'), false);
  assert.equal(new URL(page.url()).searchParams.has('redirect'), false);
  await page.locator('[name=code]').fill('ABCD-EFGH');
  const email = 'audit&inject=1+tag@example.invalid';
  await page.locator('[name=email]').fill(email);
  await page.locator('[name=agree]').check();
  await page.locator('[data-checkout]').evaluate(form => { form.dataset.pay = '/__payment?sku={sku}&email={email}&code={code}'; });
  await page.route('**/__payment?*', route => route.fulfill({ contentType: 'text/html', body: '<p>Fixture payment</p>' }));
  await page.locator('[data-submit]').click();
  await page.waitForURL(url => url.pathname === '/__payment');
  const query = new URL(page.url()).searchParams;
  assert.deepEqual([...query], [['sku', 'token-1500'], ['email', email], ['code', 'ABCD-EFGH']]);
  assert.equal(await page.evaluate(() => window.__injected), undefined);
  assert.deepEqual(errors, []);
});

test('configured shop handoff cannot access its opener or receive a referring checkout URL', async t => {
  const { page, context, base, errors } = await fixture.setup(t);
  await page.route('**/checkout/**', async route => {
    const response = await route.fetch();
    const shops = JSON.stringify({ taobao: { name: 'Fixture shop', url: base + '/__shop' }, xianyu: { name: 'Fixture shop', url: '' } });
    await route.fulfill({ response, body: (await response.text()).replace(/data-shops="[^"]*"/, `data-shops='${shops}'`) });
  });
  let referrer;
  await context.route('**/__shop', route => {
    referrer = route.request().headers().referer;
    return route.fulfill({ contentType: 'text/html', body: '<p>Fixture shop</p>' });
  });
  await page.goto(base + '/checkout/?plan=1500&code=ABCD-EFGH');
  await page.locator('label.opt:has([name=channel][value=taobao])').click();
  assert.equal(await page.locator('[data-account]').isHidden(), true);
  const opened = context.waitForEvent('page');
  await page.locator('[data-submit]').click();
  const shop = await opened;
  await shop.waitForLoadState();
  assert.equal(await shop.evaluate(() => window.opener), null);
  assert.equal(referrer, undefined);
  assert.deepEqual(errors, []);
});

for (const failure of ['missing', 'throwing']) {
  test(`themes keep content and interactions when optional observers are ${failure}`, async t => {
    const { page, base, errors } = await fixture.setup(t, { reducedMotion: 'no-preference', viewport: { width: 390, height: 844 } });
    await page.addInitScript(failure => {
      const unavailable = failure === 'missing' ? undefined : class { constructor() { throw new Error('Fixture observer failure'); } };
      window.IntersectionObserver = unavailable; window.ResizeObserver = unavailable;
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.__copied = text; } } });
    }, failure);
    await page.goto(base + '/themes/synara/?token=PRIVATE-FIXTURE&email=private@example.invalid#demo');
    assert.equal(await page.locator('.rv:not(.in)').count(), 0);
    await page.locator('[data-copy]').click();
    const prompt = await page.evaluate(() => window.__copied);
    assert.ok(prompt.includes(base + '/themes/synara/'));
    assert.equal(/PRIVATE-FIXTURE|private@example|#demo/.test(prompt), false);
    for (const attributes of await page.locator('[data-ask]').evaluateAll(links => links.map(link => ({ href: link.href, rel: link.rel })))) {
      assert.ok(decodeURIComponent(attributes.href).includes(prompt));
      assert.match(attributes.rel, /noopener/); assert.match(attributes.rel, /noreferrer/);
    }
    await page.locator('[data-menu]').click();
    assert.equal(await page.locator('[data-menu]').getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('[data-menu]').getAttribute('aria-expanded'), 'false');
    await page.goto(base + '/themes/apple-launch/');
    assert.equal(await page.locator('.reveal:not(.in)').count(), 0);
    await page.locator('[data-sheet=real]').click();
    await page.locator('#sheet').waitFor({ state: 'visible' });
    await page.locator('#sheet [data-close]').click();
    assert.equal(await page.locator('#sheet').isVisible(), false);
    const pair = page.locator('[data-pair="1"]');
    await pair.click();
    assert.equal(await pair.getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('.pair-stage img.on').count(), 1);
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.waitForFunction(() => [...document.querySelectorAll('[data-scroller] .track')].every(track => track.tabIndex === (track.scrollWidth - track.clientWidth > 2 ? 0 : -1)));
    assert.deepEqual(errors, []);
  });
}

test('theme referrer policy survives omitted host headers and disabled scripting', async t => {
  const { page, context, base } = await fixture.setup(t, { javaScriptEnabled: false });
  await page.route('**/themes/**', async route => {
    const response = await route.fetch(), headers = response.headers();
    delete headers['referrer-policy'];
    const body = (await response.text()).replace('</body>', '<a href="/__referrer-sink" data-audit-link style="position:fixed;left:0;top:0;z-index:1000">Local target</a></body>');
    await route.fulfill({ response, headers, body });
  });
  const referrers = [];
  await context.route('**/__referrer-sink', route => {
    referrers.push(route.request().headers().referer);
    return route.fulfill({ contentType: 'text/html', body: '<p>Local target</p>' });
  });
  for (const theme of ['synara', 'apple-launch']) {
    await page.goto(base + `/themes/${theme}/?token=PRIVATE-FIXTURE`);
    assert.equal(await page.locator('meta[name=referrer]').getAttribute('content'), 'no-referrer');
    await page.locator('[data-audit-link]').click();
    await page.waitForURL(url => url.pathname === '/__referrer-sink');
  }
  assert.deepEqual(referrers, [undefined, undefined]);
});
