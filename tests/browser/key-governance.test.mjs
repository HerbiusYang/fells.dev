import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserFixture } from '../helpers/browser.mjs';
import { createAppBackend } from '../helpers/app-backend.mjs';
const fixture = createBrowserFixture(); before(() => fixture.start()); after(() => fixture.stop());
const initial = () => ({ id: 17, name: 'Governed <key>', prefix: 'sk-synthetic…', kind: 'user', created_at: 1700000000, revoked: false, expires_at: 0, quota_limit_micros: 25_000_000, used_quota_micros: 1_234_567, allowed_models: ['model/*'], allowed_cidrs: ['192.0.2.0/24'], allow_wallet_fallback: false });
async function open(t, options = {}) {
  const session = await fixture.setup(t, { viewport: options.viewport ?? { width: 1280, height: 1000 }, colorScheme: options.theme ?? 'light' }), { context, page, base } = session;
  const backend = createAppBackend({ keys: [{ ...initial(), ...options.metering }], preferences: { theme: options.theme ?? 'light', prefs: { agent: '', send: 0 }, notifs: [true, true, true, false], onboarded: true, answers: [[0], [0], [0], [0]], promoClosed: true, sbHidden: false } });
  await backend.install(context);
  const events = [], patches = [], creations = [];
  const dto = key => ({ ...key, daily_allow_micro: 0, monthly_allow_micro: 0, monthly_allow_limit_micro: key.limit ?? 0, rpm: 0,
    self_governance: { key_id: key.id, quota_limit_micros: key.quota_limit_micros, used_quota_micros: key.used_quota_micros, net_used_quota_micros: key.net_used_quota_micros, inherited_used_quota_micros: key.inherited_used_quota_micros, metering_started_at: key.metering_started_at, expires_at: key.expires_at, allowed_models: [...key.allowed_models], allowed_cidrs: [...key.allowed_cidrs] } });
  await context.route('**/api/app/keys', async route => {
    const request = route.request();
    if (request.method() === 'GET') {
      events.push('GET');
      return route.fulfill({ json: { keys: backend.state.keys.map(dto), self_keys: true, limit_defaults: { daily_micro: 0, monthly_micro: 0, rpm: 0 } } });
    }
    const body = request.postDataJSON(); creations.push(body); events.push('POST');
    const key = { ...initial(), id: 18, name: body.name, prefix: 'sk-created…', ...body, allow_wallet_fallback: false };
    backend.state.keys.push(key);
    return route.fulfill({ json: { raw: 'sk-synthetic-one-time-key-never-a-live-secret', key: dto(key) } });
  });
  await context.route('**/api/app/keys/17', async route => {
    const request = route.request(), body = request.postDataJSON();
    events.push('PATCH'); patches.push({ body, expectedUser: request.headers()['x-fells-expected-user'], expectedSession: request.headers()['x-fells-expected-session'] });
    if (options.rejected) return route.fulfill({ status: 400, json: { error: 'Invalid CIDR from server' } });
    if (!options.ignored) {
      Object.assign(backend.state.keys[0], body);
      if (options.recordedCIDRs) backend.state.keys[0].allowed_cidrs = [...options.recordedCIDRs];
    }
    const receipt = options.receiptCIDRs ? { ...backend.state.keys[0], allowed_cidrs: options.receiptCIDRs } : backend.state.keys[0];
    return route.fulfill({ json: { ok: true, key: options.missingReceipt ? null : dto(receipt), governance: {} } });
  });
  await page.goto(base + (options.language && options.language !== 'en' ? '/' + options.language : '') + '/app/#/api');
  await page.locator('[data-act=key-governance][data-id="17"]').waitFor();
  return { ...session, backend, events, patches, creations };
}
async function edit(page) {
  await page.locator('[data-act=key-governance][data-id="17"]').click();
  await page.locator('[data-form=key-governance]').waitFor();
  return page.locator('[data-form=key-governance]');
}

test('governance PATCH uses bound identity and the correct endpoint, then verifies persisted rules by GET', async t => {
  const { page, backend, events, patches, errors } = await open(t);
  const form = await edit(page);
  assert.match(await form.locator('[data-governance-usage]').innerText(), /1\.234567/);
  assert.equal(await form.locator('[name=governance_models]').inputValue(), 'model/*');
  assert.equal(await form.locator('[name=governance_cidrs]').inputValue(), '192.0.2.0/24');
  await form.locator('[name=governance_quota]').fill('30.000001');
  await form.locator('[name=governance_models]').fill('model/*\nnew/model');
  await form.locator('button[type=submit]').click(); await form.waitFor({ state: 'detached' });
  assert.equal(patches.length, 1);
  assert.deepEqual(patches[0], { body: { quota_limit_micros: 30_000_001, allowed_models: ['model/*', 'new/model'] }, expectedUser: '42', expectedSession: 'c'.repeat(64) });
  assert.ok(events.lastIndexOf('GET') > events.indexOf('PATCH'));
  assert.equal(backend.state.keys[0].allow_wallet_fallback, false);
  const reloaded = await edit(page);
  assert.equal(await reloaded.locator('[name=governance_quota]').inputValue(), '30.000001');
  assert.equal(await reloaded.locator('[name=governance_models]').inputValue(), 'model/*\nnew/model');
  assert.deepEqual(errors, []);
});

test('server rejection and an ignored successful PATCH retain the draft and cannot claim saved rules', async t => {
  for (const options of [{ rejected: true }, { ignored: true }]) {
    const { page, backend, patches, errors } = await open(t, options);
    const form = await edit(page);
    await form.locator('[name=governance_quota]').fill('31');
    await form.locator('button[type=submit]').click();
    await form.locator('[data-key-error]').filter({ hasText: options.rejected ? 'Invalid CIDR from server' : 'unavailable' }).waitFor();
    assert.equal(await form.locator('[name=governance_quota]').inputValue(), '31');
    assert.equal(backend.state.keys[0].quota_limit_micros, 25_000_000);
    assert.equal(patches.length, 1);
    assert.equal(await page.getByText('Server rules saved and reloaded.', { exact: true }).count(), 0);
    assert.deepEqual(errors, []);
  }
});

test('concurrent rule changes are reported before PATCH, without overwriting another edit', async t => {
  const { page, backend, patches, errors } = await open(t);
  const form = await edit(page);
  backend.state.keys[0].quota_limit_micros = 40_000_000;
  await form.locator('[name=governance_quota]').fill('35'); await form.locator('button[type=submit]').click();
  await form.locator('[data-key-error]').filter({ hasText: 'changed elsewhere' }).waitFor();
  assert.deepEqual(patches, []); assert.equal(backend.state.keys[0].quota_limit_micros, 40_000_000);
  assert.equal(await form.locator('[name=governance_quota]').inputValue(), '35'); assert.deepEqual(errors, []);
});

test('closing a governance form during its preflight read cancels the write before PATCH', { timeout: 20_000 }, async t => {
  const { page, context, backend, patches, errors } = await open(t);
  const form = await edit(page);
  let release, started, completed;
  const gate = new Promise(resolve => { release = resolve; }), held = new Promise(resolve => { started = resolve; }), delivered = new Promise(resolve => { completed = resolve; });
  t.after(() => release());
  await context.route('**/api/app/keys', async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    started(); await gate;
    await route.fulfill({ json: { keys: backend.state.keys, self_keys: true, limit_defaults: { daily_micro: 0, monthly_micro: 0, rpm: 0 } } }); completed();
  });
  try {
    await form.locator('[name=governance_quota]').fill('32'); await form.locator('button[type=submit]').click();
    await held; await page.keyboard.press('Escape'); await form.waitFor({ state: 'detached' });
    release(); await delivered;
    await page.locator('#fx[aria-busy=false],#fx:not([aria-busy])').waitFor();
    assert.deepEqual(patches, []); assert.equal(backend.state.keys[0].quota_limit_micros, 25_000_000); assert.deepEqual(errors, []);
  } finally { release(); }
});

test('new-key access rules are included atomically in the creation request, with no wallet fallback field', async t => {
  const { page, creations, patches, errors } = await open(t);
  await page.locator('.bar [data-act=new-key]').click();
  const form = page.locator('[data-form=key]');
  await form.locator('[name=name]').fill('Atomic policy key');
  await form.locator('[data-new-key-governance] > summary').click();
  await form.locator('[name=governance_quota]').fill('0.000001');
  await form.locator('[name=governance_models]').fill('specific/model');
  await form.locator('[name=governance_cidrs]').fill('203.0.113.0/24');
  await form.locator('button.btn.pri').click(); await page.locator('[data-key-secret]').waitFor();
  assert.deepEqual(creations, [{ name: 'Atomic policy key', monthly_micro: 0, quota_limit_micros: 1, allowed_models: ['specific/model'], allowed_cidrs: ['203.0.113.0/24'] }]);
  assert.deepEqual(patches, []); assert.deepEqual(errors, []);
});

test('missing governance data does not create an unrestricted editor; 401 removes the private dialog', async t => {
  const { page, context, base, backend, errors } = await open(t);
  await context.route('**/api/app/keys', route => route.fulfill({ json: { keys: [{ id: 17, expires_at: 0 }], self_keys: true } }));
  await page.locator('[data-act=key-governance][data-id="17"]').click();
  await page.locator('.dlg [role=alert]').filter({ hasText: 'unavailable' }).waitFor();
  assert.equal(await page.locator('[data-form=key-governance]').count(), 0);
  backend.state.signedIn = false;
  await context.route('**/api/app/keys', route => route.fulfill({ status: 401, json: { error: 'session changed' } }));
  await page.locator('.dlg [data-act=key-governance]').click();
  await page.waitForURL(url => url.origin === base && url.pathname === '/app/start/' && url.searchParams.get('session') === 'changed');
  assert.equal(await page.locator('[data-form=key-governance]').count(), 0); assert.deepEqual(errors, []);
});

test('governance forms and key actions remain contained and keyboard accessible in the site themes', async t => {
  for (const options of [{ theme: 'dark', viewport: { width: 320, height: 800 } }, { theme: 'light', viewport: { width: 1280, height: 1000 } }]) {
    const { page, patches, errors } = await open(t, options);
    const form = await edit(page);
    assert.equal(await page.locator('#fx').getAttribute('data-theme'), options.theme);
    assert.equal(await page.locator('.dlg').evaluate(element => element.scrollWidth <= element.clientWidth + 1), true);
    await form.locator('[name=governance_models]').focus(); await page.keyboard.press('Tab');
    assert.equal(await form.locator('[name=governance_cidrs]').evaluate(element => element === document.activeElement), true);
    await page.keyboard.press('Escape'); await form.waitFor({ state: 'detached' });
    assert.equal(await page.locator('[data-act=key-governance][data-id="17"]').evaluate(element => element === document.activeElement), true);
    assert.deepEqual(patches, []); assert.deepEqual(errors, []);
  }
});

for (const [raw, recorded] of [
  ['203.0.113.9/24', '203.0.113.0/24'],
  ['2001:0DB8:0000:0000:0000:0000:0000:0001/64', '2001:db8::/64'],
  ['2001:0DB8:0000:0000:0000:0000:0000:0001', '2001:db8::1'],
]) test(`server-recorded CIDR text is reviewed without automatic resubmission: ${raw}`, async t => {
  const { page, patches, errors } = await open(t, { recordedCIDRs: [recorded] });
  const form = await edit(page);
  await form.locator('[name=governance_cidrs]').fill(raw);
  await form.locator('button[type=submit]').click();
  const review = page.locator('[data-governance-review]'); await review.waitFor();
  assert.equal(await review.locator('[data-governance-submitted]').innerText(), raw);
  assert.equal(await review.locator('[data-governance-recorded]').innerText(), recorded);
  assert.equal(await page.locator('[data-form=key-governance]').count(), 0);
  assert.equal(await review.locator('button[type=submit],form').count(), 0);
  assert.equal(await page.getByText('Server rules saved and reloaded.', { exact: true }).count(), 0);
  assert.equal(patches.length, 1);
  await review.locator('[data-act=key-governance-use-recorded]').click();
  const adopted = page.locator('[data-form=key-governance]'); await adopted.waitFor();
  assert.equal(await adopted.locator('[name=governance_cidrs]').inputValue(), recorded);
  assert.equal(patches.length, 1, 'adopting the recorded values sends no PATCH');
  await adopted.locator('button[type=submit]').click();
  assert.equal(await adopted.locator('[data-key-error]').innerText(), 'No rule changes to save.');
  assert.equal(patches.length, 1, 'the recorded baseline is not written again');
  assert.deepEqual(errors, []);
});

test('a missing save receipt or a receipt that disagrees with the fresh GET fails closed', async t => {
  for (const options of [{ missingReceipt: true }, { receiptCIDRs: ['203.0.114.0/24'] }]) {
    const { page, patches, errors } = await open(t, { recordedCIDRs: ['203.0.113.0/24'], ...options });
    const form = await edit(page);
    await form.locator('[name=governance_cidrs]').fill('203.0.113.9/24');
    await form.locator('button[type=submit]').click();
    await form.locator('[data-key-error]').filter({ hasText: 'unavailable' }).waitFor();
    assert.equal(await page.locator('[data-governance-review]').count(), 0);
    assert.equal(await form.locator('[name=governance_cidrs]').inputValue(), '203.0.113.9/24');
    assert.equal(patches.length, 1);
    assert.equal(await page.getByText('Server rules saved and reloaded.', { exact: true }).count(), 0);
    assert.deepEqual(errors, []);
  }
});

test('an ignored CIDR-only PATCH shows the actual old rules for review and never claims the input was saved', async t => {
  const { page, patches, errors } = await open(t, { ignored: true });
  const form = await edit(page);
  await form.locator('[name=governance_cidrs]').fill('203.0.113.0/24');
  await form.locator('button[type=submit]').click();
  const review = page.locator('[data-governance-review]'); await review.waitFor();
  assert.equal(await review.locator('[data-governance-submitted]').innerText(), '203.0.113.0/24');
  assert.equal(await review.locator('[data-governance-recorded]').innerText(), '192.0.2.0/24');
  assert.equal(await page.getByText('Server rules saved and reloaded.', { exact: true }).count(), 0);
  assert.equal(patches.length, 1); assert.deepEqual(errors, []);
});

test('CIDR review has six localized, contained mobile views and keyboard adoption never repeats a write', async t => {
  const notices = new Set();
  for (const language of ['en', 'zh', 'zh-hant', 'ja', 'ko', 'es']) {
    const { page, patches, errors } = await open(t, { language, recordedCIDRs: ['2001:db8::/64'], viewport: { width: 320, height: 900 }, theme: 'dark' });
    const form = await edit(page);
    await form.locator('[name=governance_cidrs]').fill('2001:0DB8:0000:0000:0000:0000:0000:0001/64');
    await form.locator('button[type=submit]').click();
    const review = page.locator('[data-governance-review]'); await review.waitFor();
    notices.add(await review.locator('[role=status]').innerText());
    assert.equal(await page.locator('.dlg').evaluate(element => element.scrollWidth <= element.clientWidth + 1), true);
    assert.equal(await review.locator('[data-act=key-governance-use-recorded]').evaluate(element => element === document.activeElement), true);
    await page.keyboard.press('Enter');
    await page.locator('[data-form=key-governance]').waitFor();
    assert.equal(await page.locator('[name=governance_cidrs]').inputValue(), '2001:db8::/64');
    assert.equal(patches.length, 1); assert.deepEqual(errors, []);
  }
  assert.equal(notices.size, 6, 'localized routes must not silently fall back to one English review');
});

test('session invalidation removes a CIDR review and cannot adopt private values into another session', async t => {
  const { page, backend, patches, base, errors } = await open(t, { recordedCIDRs: ['203.0.113.0/24'] });
  const form = await edit(page);
  await form.locator('[name=governance_cidrs]').fill('203.0.113.9/24');
  await form.locator('button[type=submit]').click();
  await page.locator('[data-governance-review]').waitFor();
  backend.state.signedIn = false;
  await page.evaluate(() => dispatchEvent(new CustomEvent('fells.session.changed', { detail: { audience: 'customer' } })));
  await page.waitForURL(url => url.origin === base && url.pathname === '/app/start/' && url.searchParams.get('session') === 'changed');
  assert.equal(await page.locator('[data-governance-review],[data-form=key-governance]').count(), 0);
  assert.equal(patches.length, 1); assert.deepEqual(errors, []);
});


test('missing meter details stay unknown while the recorded budget total remains visible', async t => {
  const { page, errors } = await open(t);
  const form = await edit(page);
  assert.match(await form.locator('[data-governance-usage]').innerText(), /Recorded total budget usage \(USD\): 1\.234567/);
  assert.match(await form.locator('[data-governance-net]').innerText(), /Unknown/);
  assert.match(await form.locator('[data-governance-inherited]').innerText(), /Unknown/);
  assert.match(await form.locator('[data-governance-meter-start]').innerText(), /Unknown/);
  assert.deepEqual(errors, []);
});

test('real zero and inherited budget use remain distinct from current-owner charges', async t => {
  for (const metering of [
    { used_quota_micros: 0, net_used_quota_micros: 0, inherited_used_quota_micros: 0, metering_started_at: 1_700_000_000 },
    { used_quota_micros: 3_000_000, net_used_quota_micros: 1_000_000, inherited_used_quota_micros: 2_000_000, metering_started_at: 1_700_000_000, meter_id: 'INTERNAL_METER_MUST_NOT_RENDER' },
  ]) {
    const { page, errors } = await open(t, { metering });
    const form = await edit(page);
    assert.equal(await form.locator('[data-governance-net]').innerText(), `Current ownership: net actual charges (USD): ${metering.net_used_quota_micros / 1_000_000}`);
    assert.doesNotMatch(await form.locator('[data-governance-meter-start]').innerText(), /Unknown/);
    if (metering.inherited_used_quota_micros === 0) assert.equal(await form.locator('[data-governance-inherited]').count(), 0);
    else {
      assert.equal(await form.locator('[data-governance-inherited]').innerText(), 'Inherited budget usage (USD): 2');
      assert.match(await form.innerText(), /does not mean the current owner was charged again/);
    }
    assert.doesNotMatch(await form.innerText(), /INTERNAL_METER/);
    assert.deepEqual(errors, []);
  }
});
