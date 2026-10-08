import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserFixture, enterPreview, createWorkspace } from '../helpers/browser.mjs';

const fixture = createBrowserFixture();
before(() => fixture.start());
after(() => fixture.stop());

async function idle(page) {
  await page.waitForFunction(() => document.querySelector('#fx')?.getAttribute('aria-busy') !== 'true');
}

async function go(page, route) {
  await idle(page);
  await page.evaluate(route => { location.hash = '#/' + route; }, route);
  await page.waitForFunction(route => document.querySelector('#fx')?.dataset.route === '#/' + route, route);
}

async function record(page, value) {
  return page.evaluate(value => new Promise((resolve, reject) => {
    const request = indexedDB.open('fells.preview.v2', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('preview', value === undefined ? 'readonly' : 'readwrite');
      const store = tx.objectStore('preview');
      const operation = value === undefined ? store.get('active') : store.put(value, 'active');
      tx.oncomplete = () => { db.close(); resolve(operation.result ?? null); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), value);
}

test('environment values cannot leave this tab through native form submission', async t => {
  const { page, base } = await fixture.setup(t);
  await enterPreview(page, base);
  await createWorkspace(page);
  await go(page, 'ws-settings/1');
  const secret = 'DUMMY-ENV-SECRET-NATIVE';
  await page.locator('[data-form=env] [name=k]').fill('DUMMY_TOKEN');
  await page.locator('[data-env-value]').fill(secret);
  // Guard against serialization independently of any event listener.
  const serialized = await page.locator('[data-form=env]').evaluate(form => [...new FormData(form)]);
  assert.equal(JSON.stringify(serialized).includes(secret), false);
  await page.route('**/app/', route => route.request().isNavigationRequest() ? route.abort() : route.continue());
  const navigation = page.waitForRequest(request => request.isNavigationRequest());
  await page.locator('[data-form=env]').evaluate(form => HTMLFormElement.prototype.submit.call(form));
  const request = await navigation;
  assert.equal(request.method(), 'POST');
  assert.equal(decodeURIComponent(request.url()).includes(secret), false);
  assert.equal((request.postData() || '').includes(secret), false);
});

test('dynamic chat and profile forms keep user input out of native GET URLs', async t => {
  const { page, base } = await fixture.setup(t);
  await enterPreview(page, base);
  await createWorkspace(page);
  for (const route of ['new', 'settings/0', 'ws-settings/0', 'ws-settings/1', 'ws-settings/4', 'billing/credits']) {
    await go(page, route);
    assert.ok(await page.locator('#fx form').count(), route);
    for (const form of await page.locator('#fx form').all()) assert.equal(await form.getAttribute('method'), 'post', route);
  }
  await go(page, 'new');
  const text = 'SYNTHETIC-CHAT-CONTENT';
  await page.locator('#fx-input').fill(text);
  await page.route('**/app/', route => route.request().isNavigationRequest() ? route.abort() : route.continue());
  const navigation = page.waitForRequest(request => request.isNavigationRequest());
  await page.locator('[data-form=send]').evaluate(form => HTMLFormElement.prototype.submit.call(form));
  const request = await navigation;
  assert.equal(request.method(), 'POST');
  assert.equal(request.url().includes(text), false);
});

test('all rendered persisted text stays literal across chat, file, schedule, key and account views', async t => {
  const { page, base, errors } = await fixture.setup(t);
  await enterPreview(page, base);
  await createWorkspace(page);
  const saved = await record(page);
  const payload = "\"'><svg/onload=__injected=1>";
  saved.state.profile.name = payload;
  saved.state.email = payload;
  saved.state.workspaces[0].name = payload;
  const workspace = saved.state.current;
  saved.state.chats = [{ id: 'hostile-chat', ws: workspace, title: payload, agent: 'codex', model: payload, created: 0, messages: [[payload, payload]] }];
  saved.state.files = [{ id: 'hostile-file', ws: workspace, parent: '', name: payload, folder: false, size: 0, modified: 0 }];
  saved.state.schedules = [{ id: 'hostile-schedule', ws: workspace, name: payload, prompt: payload, agent: 'codex', cadence: 1, time: '09:00', paused: false }];
  saved.state.keys = [{ id: 'hostile-key', name: payload, limit: 0, created: 0, last4: '<&\'"' }];
  await record(page, saved);
  await page.reload();
  await page.locator('#fx .sb').waitFor();
  for (const route of ['chat/hostile-chat', 'files', 'schedules', 'api', 'settings/0', 'settings/2']) {
    await go(page, route);
    assert.ok((await page.locator('#fx').innerText()).includes(payload), route);
    assert.equal(await page.locator('#fx [onerror],#fx [onload]').count(), 0, route);
    assert.equal(await page.evaluate(() => window.__injected), undefined, route);
  }
  await go(page, 'settings/0');
  assert.equal(await page.locator('[data-form=profile] [name=name]').inputValue(), payload);
  assert.deepEqual(errors, []);
});

test('oversized persisted data never renders and a clean preview can replace it', async t => {
  const { page, base, errors } = await fixture.setup(t);
  await enterPreview(page, base);
  await createWorkspace(page);
  const saved = await record(page);
  saved.state.chats = [{ id: 'oversize-chat', ws: saved.state.current, title: 'Oversized', agent: 'codex', model: 'Sample', created: 0,
    messages: Array.from({ length: 40 }, () => ['you', 'x'.repeat(32768)]) }];
  await record(page, saved);
  await page.reload();
  await page.locator('#fx a').waitFor();
  assert.match(await page.locator('#fx').innerText(), /unavailable or invalid/);
  assert.equal(await page.locator('#fx .sb').count(), 0);
  await enterPreview(page, base, '', 'recovered@example.invalid');
  const recovered = await record(page);
  assert.equal(recovered.state.email, 'recovered@example.invalid');
  assert.deepEqual(recovered.state.chats, []);
  assert.notEqual(recovered.session, saved.session);
  assert.deepEqual(errors, []);
});
