import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserFixture } from '../helpers/browser.mjs';
import { createAppBackend } from '../helpers/app-backend.mjs';

const fixture = createBrowserFixture();
before(() => fixture.start()); after(() => fixture.stop());
const preferences = { theme: 'light', prefs: { agent: '', send: 0 }, notifs: [true, true, true, false], onboarded: true, answers: [[], [], [], []], promoClosed: true, sbHidden: false };
// IDs match the public production configuration snapshot from 2026-10-29.
// Capability flags are deliberately synthetic and inverted in the matrix below;
// these tests exercise UI contracts and never contact a paid model provider.
const modelIDs = ['claude-fable-5', 'claude-fable-5-1', 'claude-haiku-4-5', 'claude-haiku-5-5', 'claude-opus-4-1', 'claude-opus-4-5', 'claude-opus-4-6', 'claude-opus-4-7', 'claude-opus-4-8', 'claude-opus-5', 'claude-opus-5-5', 'claude-sonnet-4', 'claude-sonnet-4-5', 'claude-sonnet-4-6', 'claude-sonnet-5', 'claude-sonnet-5-5'];
const models = (inverted = false) => modelIDs.map((model, index) => ({ model, label: model, format: 'anthropic-messages', formats: ['anthropic-messages'], web_search: (index % 2 === 0) !== inverted }));
const webSearch = { available: true, provider: 'synthetic-native-tools', reason: 'available' };
async function open(t, { width = 390, locale = '', backend: options = {}, configure } = {}) {
  const session = await fixture.setup(t, { viewport: { width, height: 800 } });
  const backend = createAppBackend({ preferences: structuredClone(preferences), modelChat: true, workspaces: [{ id: 'search-space', name: 'Synthetic search space', region: 'auto', tz: 'UTC', created: 1700000000000, role: 'owner' }], chatModels: models(), webSearch: { ...webSearch }, ...options });
  await backend.install(session.context); await configure?.({ ...session, backend });
  await session.page.goto(`${session.base}${locale}/app/#/new`);
  await session.page.locator('.chat-model-state[data-model-state=ready]').waitFor({ state: 'attached' });
  return { ...session, backend };
}
async function select(page, model, available) {
  await page.locator('[data-act=model]').click();
  const entry = page.locator(`[data-act=pick-model][data-name="${model}"]`);
  if (available !== undefined) assert.equal(await entry.locator('[data-web-supported]').count(), available ? 1 : 0, 'menu support badges use the actual model flag');
  await entry.click();
  assert.equal(await page.locator('[data-form=send]').getAttribute('data-model'), model);
}

for (const width of [320, 390]) test(`${width}px: all 16 real model IDs respect advertised search flags and manual opt-in`, { timeout: 60_000 }, async t => {
  const { page, backend, errors } = await open(t, { width });
  for (const inverted of [false, true]) {
    if (inverted) {
      backend.state.chatModels = models(true);
      const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/app/chat-models');
      await page.locator('[data-act=chat-models]').click(); await refreshed;
      await page.locator('.chat-model-state[data-model-state=ready]').waitFor({ state: 'attached' });
    }
    for (const entry of models(inverted)) {
      await select(page, entry.model, entry.web_search);
      const toggle = page.locator('[data-act=chat-web-search]');
      assert.equal(await toggle.getAttribute('aria-pressed'), 'false', 'every model switch requires a fresh opt-in');
      assert.equal(await toggle.isDisabled(), false, 'unsupported search remains a usable explanation entry');
      assert.equal(await toggle.getAttribute('data-web-state'), entry.web_search ? 'available' : 'modelUnavailable');
      const geometry = await toggle.boundingBox();
      assert.ok(geometry.x >= 0 && geometry.x + geometry.width <= width, 'search stays inside the mobile viewport');
      if (entry.web_search) {
        assert.match(await page.locator('#chat-search-charges').innerText(), /additional charges.*account/);
        await toggle.click(); assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
      } else {
        await toggle.click();
        const dialog = page.locator('.chat-search-dialog');
        assert.match(await dialog.locator('[data-web-reason=modelUnavailable]').innerText(), /does not support/);
        assert.equal(await dialog.locator('.chat-search-model-id').innerText(), entry.model);
        assert.deepEqual(await dialog.locator('[data-act=chat-web-model]').evaluateAll(buttons => buttons.map(button => button.dataset.name)), models(inverted).filter(model => model.web_search).map(model => model.model));
        assert.ok(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth), 'long model names do not overflow the dialog');
        await page.keyboard.press('Escape');
        assert.equal(await toggle.evaluate(element => element === document.activeElement), true, 'closing restores keyboard focus');
      }
      assert.equal(backend.state.generations.length, 0, 'selection, explanation and opt-in do not send inference');
    }
  }
  assert.deepEqual(errors, []);
});

test('the unsupported-search explanation offers only supported models and switching never opts in or sends', async t => {
  const { page, backend, errors } = await open(t);
  await select(page, modelIDs[1]);
  await page.locator('[data-act=chat-web-search]').click();
  await page.locator(`[data-act=chat-web-model][data-name="${modelIDs[0]}"]`).click();
  assert.equal(await page.locator('.dlg').count(), 0);
  assert.equal(await page.locator('[data-form=send]').getAttribute('data-model'), modelIDs[0]);
  assert.equal(await page.locator('[data-act=chat-web-search]').getAttribute('aria-pressed'), 'false');
  assert.equal(backend.state.generations.length, 0);
  assert.match(await page.locator('#chat-search-charges').innerText(), /additional charges/);
  await page.locator('[data-act=chat-web-search]').click();
  await page.locator('#fx-input').fill('An explicitly opted-in synthetic request');
  await page.locator('[data-form=send] .send').click();
  await page.locator('.thread[data-run-status=completed]').waitFor();
  assert.equal(backend.state.generations.length, 1);
  assert.equal(backend.state.generations[0].model, modelIDs[0]);
  assert.equal(backend.state.generations[0].web_search, true);
  assert.deepEqual(errors, []);
});

for (const legacy of [false, true]) test(`${legacy ? 'missing legacy capabilities' : 'all-unavailable catalog'} can be explained and refreshed after a failed read`, async t => {
  let fail = false;
  const { page, backend, errors } = await open(t, { backend: { webSearch: legacy ? undefined : { available: false, provider: 'synthetic-native-tools', reason: 'route_unsupported' }, chatModels: models().map(({ web_search, ...model }) => legacy ? model : { ...model, web_search }) }, configure: async ({ context }) => {
    await context.route('**/api/app/chat-models', route => fail ? route.fulfill({ status: 503, json: { error: 'Synthetic catalog outage' } }) : route.fallback());
  } });
  await page.locator('[data-act=chat-web-search]').click();
  assert.match(await page.locator('[data-web-reason=serviceUnavailable]').innerText(), /unavailable.*account/);
  assert.equal(await page.locator('[data-act=chat-web-model]').count(), 0, 'a per-model flag cannot override the account capability');
  fail = true;
  await page.locator('[data-act=chat-web-refresh]').click();
  await page.locator('[data-act=chat-web-search][data-web-state=error]').waitFor();
  await page.locator('[data-act=chat-web-search]').click();
  assert.match(await page.locator('[data-web-reason=error]').innerText(), /could not be loaded/);
  fail = false; backend.state.webSearch = { ...webSearch }; backend.state.chatModels = models();
  await page.locator('[data-act=chat-web-refresh]').click();
  await page.locator('[data-act=chat-web-search][data-web-state=available]').waitFor();
  assert.equal(await page.locator('[data-act=chat-web-search]').getAttribute('aria-pressed'), 'false');
  assert.equal(backend.state.generations.length, 0);
  assert.deepEqual(errors, []);
});

for (const [locale, expected] of [['', 'The selected model does not support web search.'], ['/zh', '当前选择的模型不支持联网搜索。'], ['/zh-hant', '目前選擇的模型不支援聯網搜尋。'], ['/ja', '選択中のモデルはウェブ検索に対応していません。'], ['/ko', '현재 선택한 모델은 웹 검색을 지원하지 않습니다.'], ['/es', 'El modelo seleccionado no admite la búsqueda web.']]) test(`${locale || '/en'} search explanation is localized and keyboard accessible`, async t => {
  const { page, backend, errors } = await open(t, { locale, width: 320 });
  await select(page, modelIDs[1]);
  await page.locator('[data-act=chat-web-search]').focus(); await page.keyboard.press('Enter');
  assert.equal(await page.locator('[data-web-reason=modelUnavailable]').innerText(), expected);
  const dialog = page.locator('.chat-search-dialog');
  assert.ok(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth));
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-act=chat-web-search]').evaluate(element => element === document.activeElement), true);
  assert.equal(backend.state.generations.length, 0);
  assert.deepEqual(errors, []);
});

for (const malformed of [false, true]) test(`Fable model_refused shows only ${malformed ? 'a generic failure for invalid' : 'escaped typed'} immediate provider diagnostics`, async t => {
  const explanation = 'Synthetic Fable refusal: <img src=x onerror="window.__refusalXSS=1">\n<script>window.__refusalXSS=1</script>';
  const { page, backend, errors } = await open(t, { configure: async ({ context, backend }) => {
    await context.route('**/api/app/chats/*/generate', async route => {
      const input = route.request().postDataJSON(), chatID = new URL(route.request().url()).pathname.split('/')[4];
      const chat = backend.state.chats.find(item => item.id === chatID);
      chat.model = input.model; chat.messages.push(['you', input.body]); backend.state.generations.push(input);
      const run = backend.state.chatRuns[input.request_id] = { request_id: input.request_id, status: 'failed', error_code: 'model_refused' };
      await route.fulfill({ status: 422, json: { run, error: 'The model declined to complete this request. No automatic retry was made.', stop_details: { type: malformed ? 'untrusted' : 'refusal', category: 'synthetic_category', explanation, content: 'private unfinished partial', thinking: 'private thinking' } } });
    });
  } });
  assert.equal(await page.locator('[data-form=send]').getAttribute('data-model'), 'claude-fable-5');
  await page.locator('#fx-input').fill('Synthetic Fable diagnostic request');
  await page.locator('[data-form=send] .send').click();
  const notice = page.locator('.chat-run-status[data-run-status=failed]'); await notice.waitFor();
  assert.match(await notice.innerText(), /model_refused/);
  assert.equal(await notice.locator('[data-chat-refusal]').count(), malformed ? 0 : 1);
  if (!malformed) {
    assert.equal(await notice.locator('[data-chat-refusal] p').last().innerText(), explanation);
    assert.equal(await notice.locator('[data-chat-refusal] img,[data-chat-refusal] script').count(), 0);
    assert.doesNotMatch(await notice.innerText(), /private unfinished partial|private thinking/);
  }
  assert.equal(await page.evaluate(() => window.__refusalXSS), undefined);
  assert.equal(await page.locator('.msg:not(.user)').count(), 0, 'a refusal does not fabricate an assistant answer');
  assert.equal(backend.state.generations.length, 1);
  await page.reload(); await page.locator('#fx-input:not([disabled])').waitFor();
  assert.equal(await page.locator('[data-chat-refusal]').count(), 0, 'a reload cannot invent diagnostics that were never stored in history');
  assert.equal(backend.state.generations.length, 1);
  assert.deepEqual(errors, []);
});
