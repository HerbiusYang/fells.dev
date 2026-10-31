import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { supportBrowser, supportFixture } from './helpers/support-http-fixture.mjs';
import { png } from '../fixtures/support-images.mjs';

let environment;
before(async () => { environment = await supportBrowser(); });
after(async () => { await environment?.close(); });

async function openMarketingWidget(t) {
  const fixture = await supportFixture(t, environment);
  await fixture.context.addInitScript(() => {
    // Observe the event contract deterministically; this does not claim that a
    // real browser back navigation entered BFCache in this environment.
    let streams = 0;
    window.EventSource = class extends EventTarget {
      static CLOSED = 2;
      readyState = 1;
      onerror = null;
      constructor() { super(); streams++; }
      close() { if (this.readyState !== 2) { this.readyState = 2; streams--; } }
    };
    const polls = new Set(), interval = window.setInterval.bind(window), clear = window.clearInterval.bind(window);
    window.setInterval = (handler, delay, ...args) => { const id = interval(handler, delay, ...args); if (delay === 15000) polls.add(id); return id; };
    window.clearInterval = id => { polls.delete(id); clear(id); };
    window.__supportResources = () => ({ streams, polls: polls.size });
    window.__supportDocument = 'same-document';
  });
  const page = await fixture.context.newPage();
  await page.goto(environment.base + '/zh/');
  await page.locator('[data-support-open]').waitFor({ state: 'visible' });
  await page.locator('[data-support-open]').click();
  await page.locator('[data-support-text]').fill('Unsent private support draft');
  return { ...fixture, page };
}
const transition = (page, type) => page.evaluate(type => dispatchEvent(new PageTransitionEvent(type, { persisted: true })), type);

test('synthetic persisted lifecycle preserves same-session text and attachment with one resumed stream and poll', async t => {
  const fixture = await openMarketingWidget(t), { page } = fixture;
  await page.locator('[data-support-file]').setInputFiles({ name: 'retained.png', mimeType: 'image/png', buffer: png });
  await page.locator('[data-support-preview]').waitFor({ state: 'visible' });
  const preview = await page.locator('[data-support-preview] img').getAttribute('src');
  for (let cycle = 0; cycle < 2; cycle++) {
    await transition(page, 'pagehide');
    assert.equal(await page.locator('#support-widget').evaluate(element => element.hidden), true);
    assert.equal(await page.locator('[data-support-text]').inputValue(), 'Unsent private support draft');
    assert.deepEqual(await page.evaluate(() => window.__supportResources()), { streams: 0, polls: 0 });
    await transition(page, 'pageshow');
    await page.locator('#support-widget:not([hidden])').waitFor();
    assert.equal(await page.locator('[data-support-text]').inputValue(), 'Unsent private support draft');
    assert.equal(await page.locator('[data-support-preview] img').getAttribute('src'), preview);
    assert.deepEqual(await page.evaluate(() => window.__supportResources()), { streams: 1, polls: 1 });
    assert.equal(await page.evaluate(() => window.__supportDocument), 'same-document');
    assert.equal(fixture.state.messages.length, 0, 'Restoration does not send the retained draft');
  }
  await page.locator('[data-support-send]').click();
  await page.locator('[data-support-message]').filter({ hasText: 'Unsent private support draft' }).waitFor();
  assert.equal(fixture.state.messages.length, 1);
  assert.deepEqual(fixture.errors, []);
});

test('synthetic persisted restore hides an unverifiable identity and retains its draft until a successful read', async t => {
  const fixture = await openMarketingWidget(t), { page } = fixture;
  await transition(page, 'pagehide'); fixture.state.failBootstrap = true;
  const failed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/app/bootstrap' && response.status() === 503);
  await transition(page, 'pageshow'); await failed;
  assert.equal(await page.locator('#support-widget').evaluate(element => element.hidden), true);
  assert.equal(await page.locator('[data-support-text]').inputValue(), 'Unsent private support draft');
  fixture.state.failBootstrap = false;
  await page.evaluate(() => dispatchEvent(new Event('focus')));
  await page.locator('#support-widget:not([hidden])').waitFor();
  assert.equal(await page.locator('[data-support-text]').inputValue(), 'Unsent private support draft');
  assert.deepEqual(await page.evaluate(() => window.__supportResources()), { streams: 1, polls: 1 });
  assert.equal(fixture.state.messages.length, 0); assert.deepEqual(fixture.errors, []);
});

for (const replacement of ['signed-out', 'new-session']) test(`synthetic persisted restore clears the old private draft after ${replacement}`, async t => {
  const fixture = await openMarketingWidget(t), { page } = fixture;
  await transition(page, 'pagehide');
  if (replacement === 'signed-out') fixture.state.customerSignedIn = false;
  else await fixture.context.route('**/api/app/bootstrap', route => route.fulfill({ json: { session_id: 'c'.repeat(64), user: { id: 42, username: 'customer' } } }));
  await transition(page, 'pageshow');
  await page.locator('#support-widget:not([hidden])').waitFor();
  assert.equal(await page.locator('[data-support-text]').inputValue(), '');
  assert.equal(fixture.state.messages.length, 0);
  assert.deepEqual(await page.evaluate(() => window.__supportResources()), replacement === 'signed-out' ? { streams: 0, polls: 0 } : { streams: 1, polls: 1 });
  assert.deepEqual(fixture.errors, []);
});
