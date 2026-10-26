import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserFixture } from '../helpers/browser.mjs';
import { createAppBackend } from '../helpers/app-backend.mjs';

const fixture = createBrowserFixture();
before(() => fixture.start()); after(() => fixture.stop());
const preferences = { theme: 'light', prefs: { agent: '', send: 0 }, notifs: [true, true, true, false], onboarded: true, answers: [[0], [0], [0], [0]], promoClosed: true, sbHidden: false };
const key = { id: 17, name: 'Original personal key', prefix: 'sk-original…', kind: 'user', expires_at: 0, revoked: false, created_at: 1700000000, limit: 0 };
const catalogPath = /\/api\/app\/catalog(?:\?.*)?$/;
const logsPath = /\/api\/app\/logs(?:\?.*)?$/;
async function open(t, configure) {
  const session = await fixture.setup(t);
  const backend = createAppBackend({ preferences, modelChat: true, keys: [{ ...key }] });
  await backend.install(session.context);
  const catalogReads = [];
  await session.context.route(catalogPath, route => {
    const url = new URL(route.request().url()), id = Number(url.searchParams.get('key_id'));
    catalogReads.push({ id, headers: route.request().headers() });
    return route.fulfill({ json: { models: [{ model: `scope/key-${id}`, formats: ['openai-responses'], routable: true }] } });
  });
  await configure?.({ ...session, backend });
  await session.page.goto(session.base + '/app/#/api');
  await session.page.locator('.codebox[data-catalog-state=ready]').waitFor();
  await session.page.evaluate(() => { window.__apiDocumentMarker = 'same-document'; });
  return { ...session, backend, catalogReads };
}

test('a created key is selected and loads its catalog immediately; revocation invalidates that scope', async t => {
  const { page, backend, catalogReads, errors } = await open(t);
  assert.equal(await page.locator('[data-input=apiKey]').inputValue(), '17');
  await page.locator('.bar [data-act=new-key]').click();
  await page.locator('[data-form=key] [name=name]').fill('New scoped key');
  await page.locator('[data-form=key] .btn.pri').click();
  await page.locator('.dlg .codebox pre').waitFor();
  const created = backend.state.keys.find(item => item.name === 'New scoped key');
  assert.ok(created); assert.equal(created.kind, 'user'); assert.equal(created.expires_at, 0);
  const secret = await page.locator('.dlg .codebox pre').innerText();
  assert.equal(JSON.stringify(await page.evaluate(() => ({ ...localStorage, ...sessionStorage }))).includes(secret), false);
  await page.locator('.dlg [data-act=close]').last().click();
  await page.locator('.codebox[data-catalog-state=ready] pre').filter({ hasText: `scope/key-${created.id}` }).waitFor();
  assert.equal(await page.locator('[data-input=apiKey]').inputValue(), String(created.id));
  assert.ok(catalogReads.some(read => read.id === created.id));
  assert.equal(await page.evaluate(() => window.__apiDocumentMarker), 'same-document', 'creation never needs a reload');
  assert.equal((await page.locator('#fx-main').innerText()).includes(secret), false, 'the full credential leaves the page when its one-time dialog closes');

  await page.locator(`[data-act=revoke][data-id="${created.id}"]`).click();
  await page.locator('.codebox[data-catalog-state=ready] pre').filter({ hasText: 'scope/key-17' }).waitFor();
  assert.equal(created.revoked, true);
  assert.equal(await page.locator('[data-input=apiKey]').inputValue(), '17');
  assert.equal(await page.locator(`[data-input=apiKey] option[value="${created.id}"]`).count(), 0);
  assert.equal(await page.evaluate(() => window.__apiDocumentMarker), 'same-document');
  await page.locator('[data-act=revoke][data-id="17"]').click();
  await page.locator('.codebox[data-catalog-state=no-key]').waitFor();
  assert.equal(await page.locator('[data-input=apiKey]').isDisabled(), true);
  assert.doesNotMatch(await page.locator('.codebox pre').innerText(), /scope\/key-|curl |\.create\(/);
  assert.ok(catalogReads.filter(read => read.id > 0).every(read => [17, created.id].includes(read.id)), 'private catalogs stay bound to an owned key');
  assert.equal(backend.state.writes.filter(write => write.path === '/api/app/keys').length, 1);
  assert.equal(backend.state.generations.length, 0); assert.deepEqual(errors, []);
});

test('request logs are fetched only for their dialog and retain search, range and earlier-record controls', async t => {
  const reads = [];
  const rows = Array.from({ length: 50 }, (_, index) => ({ id: 1000 - index, ts: 1700000100 - index,
    model: index === 0 ? 'alpha/model' : 'beta/model', key_name: 'Selected account key', status: index === 0 ? 429 : 200,
    latency_ms: 50, input_tokens: 2, output_tokens: 3, allow_micro: 1000,
    ...(index === 0 ? { error: '<svg onload="window.__forged=1">Rate limited</svg>' } : {}) }));
  const { page, errors } = await open(t, async ({ context }) => {
    await context.route(logsPath, route => {
      const url = new URL(route.request().url()); reads.push(url);
      return route.fulfill({ json: { retention_days: 37, logs: url.searchParams.has('before_id')
        ? [{ ...rows[1], id: 950, model: 'older/model' }] : rows } });
    });
  });
  assert.equal(reads.length, 0);
  assert.equal(await page.locator('[data-api-logs],.api-log-row').count(), 0);
  assert.doesNotMatch(await page.locator('#fx-main').innerText(), /alpha\/model|Rate limited|Request logs retained/);
  await page.locator('[data-act=api-range][data-i="1"]').click();
  assert.equal(reads.length, 0, 'usage controls do not fetch request logs');
  await page.locator('[data-act=api-logs]').click();
  const dialog = page.locator('.api-log-dialog');
  await dialog.locator('.api-log-row').filter({ hasText: 'alpha/model' }).waitFor();
  assert.equal(reads.length, 1); assert.equal(reads[0].searchParams.has('before_id'), false);
  assert.equal(await dialog.locator('.api-log-row').count(), 50);
  assert.match(await dialog.innerText(), /Request logs retained for 37 days/);
  assert.equal(await dialog.locator('svg[onload],img[onerror]').count(), 0);
  assert.equal(await page.evaluate(() => window.__forged), undefined);
  await dialog.locator('[data-input=logsQuery]').fill('alpha');
  assert.equal(await dialog.locator('.api-log-row').count(), 1);
  assert.equal(reads.length, 1, 'search filters the fetched records without a new request');
  await dialog.locator('[data-input=logsQuery]').fill('');
  await dialog.locator('[data-act=logs-more]').click();
  await dialog.locator('.api-log-row').filter({ hasText: 'older/model' }).waitFor();
  assert.equal(await dialog.locator('.api-log-row').count(), 51);
  assert.equal(reads[1].searchParams.get('before_id'), '951');
  await dialog.locator('[data-act=api-logs-range][data-i="0"]').click();
  await dialog.locator('.api-log-row').filter({ hasText: 'alpha/model' }).waitFor();
  assert.equal(reads.length, 3);
  assert.ok(Number(reads[2].searchParams.get('since')) > Number(reads[0].searchParams.get('since')),
    'switching from 30 days to seven days requests a shorter range');
  assert.equal(reads[2].searchParams.has('before_id'), false, 'changing range resets pagination');
  assert.equal(await dialog.locator('.api-log-row').count(), 50);
  await dialog.locator('[data-act=close]').click();
  assert.equal(await page.locator('[data-api-logs],.api-log-row').count(), 0);
  assert.equal(reads.length, 3); assert.deepEqual(errors, []);
});
