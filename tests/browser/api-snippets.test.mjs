import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createBrowserFixture } from '../helpers/browser.mjs';
import { createAppBackend } from '../helpers/app-backend.mjs';

const fixture = createBrowserFixture();
before(() => fixture.start());
after(() => fixture.stop());
const preferences = { theme: 'light', prefs: { agent: '', send: 0 }, notifs: [true, true, true, false], onboarded: true, answers: [[0], [0], [0], [0]], promoClosed: true, sbHidden: false };
const activeKey = { id: 17, name: 'Personal key', prefix: 'sk-personal…', kind: 'user', expires_at: 0, revoked: false, created_at: 1700000000 };
const catalogPath = /\/api\/app\/catalog(?:\?.*)?$/;

async function clipboard(page) {
  await page.addInitScript(() => {
    window.copied = [];
    navigator.clipboard.writeText = async value => { window.copied.push(value); };
  });
}

async function prepare(t, options = {}) {
  const session = await fixture.setup(t);
  await clipboard(session.page);
  const backend = createAppBackend({ preferences, ...options });
  await backend.install(session.context);
  return { ...session, backend };
}

async function open(t, models) {
  const session = await prepare(t);
  const { context, page, base } = session;
  await context.route(catalogPath, route => route.fulfill({ json: { models } }));
  await context.route('**/api/app/logs?*', route => route.fulfill({ json: { logs: [], retention_days: 37 } }));
  await page.goto(base + '/app/#/api');
  // Account views and the key-bound catalog settle independently.
  await page.getByText('Request logs retained for 37 days', { exact: true }).waitFor();
  await page.locator('.codebox[data-catalog-state=ready]').waitFor();
  return session;
}

async function copiedSnippet(page, tab = 0) {
  await page.locator(`[data-act=quick][data-i="${tab}"]`).click();
  const text = await page.locator('.codebox pre').innerText();
  await page.locator('.codebox [data-act=copy]').click();
  assert.equal(await page.evaluate(() => window.copied.at(-1)), text, 'clipboard matches the visible example');
  return text;
}

// Execute the copied shell syntax with curl replaced by an argument recorder.
// This validates quoting and environment expansion without making a request.
function curlRequest(snippet) {
  assert.match(snippet, /^curl /);
  const result = spawnSync('/bin/sh', ['-c', 'curl() { printf "%s\\0" "$@"; };\n' + snippet], {
    env: { PATH: '/usr/bin:/bin', FELLS_API_KEY: 'contract-test-key' },
    encoding: 'utf8', timeout: 3000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  const args = result.stdout.split('\0');
  assert.equal(args.pop(), '');
  const headers = {};
  let body;
  for (let i = 1; i < args.length; i += 2) {
    if (args[i] === '-H') {
      const split = args[i + 1].indexOf(':');
      assert.ok(split > 0, 'header has a name');
      headers[args[i + 1].slice(0, split).toLowerCase()] = args[i + 1].slice(split + 1).trim();
    } else {
      assert.equal(args[i], '-d', 'only expected curl options are emitted');
      body = JSON.parse(args[i + 1]);
    }
  }
  assert.equal(headers['content-type'], 'application/json');
  return { url: new URL(args[0]), headers, body };
}

const formats = [
  ['anthropic-messages', '/v1/messages', 'x-api-key', 'contract-test-key'],
  ['openai-completions', '/v1/chat/completions', 'authorization', 'Bearer contract-test-key'],
  ['openai-responses', '/v1/responses', 'authorization', 'Bearer contract-test-key'],
  ['gemini-generatecontent', '/v1beta/models/orbit-chat:generateContent', 'x-goog-api-key', 'contract-test-key'],
];

for (const [format, path, authHeader, authValue] of formats) {
  test(`copied ${format} curl targets the offered model using the protocol's request contract`, async t => {
    const { page, base, errors } = await open(t, [
      { model: 'not-a-chat-route', example_format: 'embeddings' },
      { model: 'orbit-chat', example_format: format, formats: [format] },
    ]);
    const { url, headers, body } = curlRequest(await copiedSnippet(page));
    assert.equal(url.origin, base, 'self-hosted console uses its own API origin');
    assert.equal(url.pathname, path);
    assert.equal(await page.locator('.quick-endpoint').innerText(), `Endpoint: ${format === 'gemini-generatecontent' ? '/v1beta/models/{model}:generateContent' : path}`);
    assert.equal(headers[authHeader], authValue);
    if (format === 'gemini-generatecontent') {
      assert.deepEqual(body, { contents: [{ parts: [{ text: 'Hello' }] }] });
    } else {
      assert.equal(body.model, 'orbit-chat');
      if (format === 'openai-responses') assert.equal(body.input, 'Hello');
      else assert.deepEqual(body.messages, [{ role: 'user', content: 'Hello' }]);
      if (format === 'anthropic-messages') {
        assert.equal(headers['anthropic-version'], '2023-06-01');
        assert.ok(Number.isInteger(body.max_tokens) && body.max_tokens > 0);
      }
    }
    assert.deepEqual(errors, []);
  });
}

for (const format of ['openai-completions', 'openai-responses']) {
  test(`OpenAI SDK ${format} uses an available compatible model and environment key`, async t => {
    const model = 'SDK "quoted" \\ model\n测试';
    const { page, base, errors } = await open(t, [
      { model: 'anthropic-only', example_format: 'anthropic-messages', formats: ['anthropic-messages'] },
      { model, example_format: format, formats: [format] },
    ]);
    const snippet = await copiedSnippet(page, 1);
    assert.match(snippet, /import os\nfrom openai import OpenAI/);
    assert.ok(snippet.includes(`base_url="${base}/v1"`));
    assert.ok(snippet.includes('api_key=os.environ["FELLS_API_KEY"]'));
    const modelLiteral = snippet.match(/^\s*model=(.+),$/m)?.[1];
    assert.equal(JSON.parse(modelLiteral), model, 'SDK model is a valid escaped string literal');
    if (format === 'openai-completions') {
      assert.equal(await page.locator('.quick-endpoint').innerText(), 'Endpoint: /v1/chat/completions');
      assert.match(snippet, /client\.chat\.completions\.create\(/);
      assert.deepEqual(JSON.parse(snippet.match(/^\s*messages=(.+),$/m)?.[1]), [{ role: 'user', content: 'Hello' }]);
      assert.doesNotMatch(snippet, /client\.responses/);
    } else {
      assert.equal(await page.locator('.quick-endpoint').innerText(), 'Endpoint: /v1/responses');
      assert.match(snippet, /client\.responses\.create\(/);
      assert.equal(JSON.parse(snippet.match(/^\s*input=(.+),$/m)?.[1]), 'Hello');
      assert.doesNotMatch(snippet, /chat\.completions/);
    }
    assert.doesNotMatch(snippet, /anthropic-only/);
    assert.deepEqual(errors, []);
  });
}

test('SDK can use an advertised compatible format when the preferred example is Anthropic', async t => {
  const { page, errors } = await open(t, [{ model: 'multi-protocol', example_format: 'anthropic-messages', formats: ['anthropic-messages', 'openai-responses'] }]);
  const snippet = await copiedSnippet(page, 1);
  assert.match(snippet, /client\.responses\.create\(/);
  assert.equal(JSON.parse(snippet.match(/^\s*model=(.+),$/m)?.[1]), 'multi-protocol');
  assert.deepEqual(errors, []);
});

test('Claude Code requires an offered Messages route and selects its actual model', async t => {
  const model = 'claude/\'"$(printf DO_NOT_RUN)`false` <svg onload="window.__forged=1"> 模型';
  const { page, base, errors } = await open(t, [{ model, formats: ['anthropic-messages'], routable: true }]);
  const snippet = await copiedSnippet(page, 2);
  assert.deepEqual(JSON.parse(snippet), { model, env: { ANTHROPIC_BASE_URL: base, ANTHROPIC_AUTH_TOKEN: 'YOUR_FELLS_API_KEY' } });
  assert.equal(await page.locator('.quick-endpoint').innerText(), 'Endpoint: /v1/messages');
  assert.equal(await page.locator('.claude-guide [data-input=claudeModel] option').getAttribute('value'), model);
  assert.equal(await page.locator('.codebox pre svg,.codebox svg[onload]').count(), 0);
  assert.equal(await page.evaluate(() => window.__forged), undefined); assert.deepEqual(errors, []);
});

test('OpenAI-only catalogs do not advertise a Claude Code route', async t => {
  const { page, errors } = await open(t, [{ model: 'openai/real-route', formats: ['openai-responses'] }]);
  const snippet = await copiedSnippet(page, 2);
  assert.match(snippet, /^# No Claude Code-compatible model/);
  assert.doesNotMatch(snippet, /export |\nclaude/); assert.equal(await page.locator('.quick-endpoint').count(), 0);
  assert.deepEqual(errors, []);
});

test('curl and OpenAI SDK use the advertised formats when example_format is absent', async t => {
  const { page, base, errors } = await open(t, [{ model: 'scope/openai-real-id', formats: ['openai-responses'] }]);
  const { url, body } = curlRequest(await copiedSnippet(page));
  assert.equal(url.pathname, '/v1/responses'); assert.equal(body.model, 'scope/openai-real-id');
  assert.ok((await copiedSnippet(page, 1)).includes('client.responses.create('));
  assert.match(await page.locator('#fx-main').innerText(), /OpenAI Base URL/);
  assert.ok((await page.locator('#fx-main').innerText()).includes(`${base}/v1`));
  assert.deepEqual(errors, []);
});

test('Quickstart ignores unroutable entries and stale preferred formats', async t => {
  const { page, errors } = await open(t, [
    { model: 'disabled-route', routable: false, format: 'anthropic-messages', formats: ['anthropic-messages', 'openai-responses'] },
    { model: 'actual-openai-route', example_format: 'anthropic-messages', format: 'gemini-generatecontent', formats: ['openai-completions'] },
  ]);
  const { url, body } = curlRequest(await copiedSnippet(page));
  assert.equal(url.pathname, '/v1/chat/completions'); assert.equal(body.model, 'actual-openai-route');
  const sdk = await copiedSnippet(page, 1);
  assert.match(sdk, /client\.chat\.completions\.create\(/);
  assert.equal(JSON.parse(sdk.match(/^\s*model=(.+),$/m)?.[1]), 'actual-openai-route');
  assert.doesNotMatch(sdk, /disabled-route|client\.responses/);
  assert.deepEqual(errors, []);
});

for (const status of ['loading', 'error']) test(`Quickstart distinguishes catalog ${status} from an empty list`, async t => {
  const { context, page, base, errors } = await fixture.setup(t);
  await clipboard(page); await createAppBackend({ preferences }).install(context);
  let release; const gate = new Promise(resolve => { release = resolve; });
  await context.route('**/api/app/catalog', async route => {
    if (status === 'loading') await gate;
    await route.fulfill({ status: 503, json: { error: 'Catalog failed' } });
  });
  await page.goto(base + '/app/#/api');
  if (status === 'error') await page.locator('.codebox pre').filter({ hasText: 'could not be loaded' }).waitFor();
  const snippet = await copiedSnippet(page, 1);
  assert.match(snippet, status === 'loading' ? /Loading the model catalog/ : /could not be loaded/);
  assert.doesNotMatch(snippet, /No OpenAI-compatible endpoint|\.create\(/);
  assert.match(await copiedSnippet(page, 2), status === 'loading' ? /Loading the model catalog/ : /could not be loaded/);
  if (status === 'loading') { release(); await page.locator('.codebox pre').filter({ hasText: 'could not be loaded' }).waitFor(); }
  assert.deepEqual(errors, []);
});

test('empty and non-chat catalogs explain unavailability without inventing runnable model examples', async t => {
  for (const models of [[], [{ model: 'embedding-only', example_format: 'embeddings', formats: ['embeddings'] }]]) {
    const { page, errors } = await open(t, models);
    const curl = await copiedSnippet(page);
    const sdk = await copiedSnippet(page, 1);
    assert.match(curl, /^# No chat endpoint is currently available/);
    assert.match(sdk, /^# No OpenAI-compatible endpoint is currently available/);
    assert.doesNotMatch(curl + sdk, /curl |\.create\(|embedding-only|claude-opus/);
    const claude = await copiedSnippet(page, 2);
    assert.match(claude, /^# No Claude Code-compatible model/);
    assert.doesNotMatch(claude, /export |\nclaude/);
    assert.equal(await page.locator('.quick-endpoint').count(), 0);
    assert.deepEqual(errors, []);
  }
});

for (const modelChat of [true, false]) test(`Quickstart uses the selected owned key's formats, including legacy capability=${modelChat}`, async t => {
  const { context, page, base, backend, errors } = await prepare(t, { modelChat, keys: [{ ...activeKey, id: 1, kind: 'cli' }, activeKey, { ...activeKey, id: 18, name: 'Private scope <svg onload=window.__forged=1>' }] });
  const reads = [];
  await context.route(catalogPath, route => {
    const request = route.request(), keyID = Number(new URL(request.url()).searchParams.get('key_id'));
    reads.push({ keyID, headers: request.headers() });
    const format = keyID === 17 ? 'anthropic-messages' : 'openai-responses';
    return route.fulfill({ json: { models: [{ model: `scope/key-${keyID}`, formats: [format], routable: true }] } });
  });
  await page.goto(base + '/app/#/api'); await page.locator('.codebox[data-catalog-state=ready]').waitFor();
  assert.equal(await page.locator('[data-input=apiKey]').inputValue(), '17');
  assert.equal(await page.locator('[data-input=apiKey] option').count(), 2);
  const first = curlRequest(await copiedSnippet(page)); assert.equal(first.body.model, 'scope/key-17'); assert.equal(first.url.pathname, '/v1/messages');
  assert.match(await copiedSnippet(page, 1), /^# No OpenAI-compatible endpoint/);
  assert.equal(JSON.parse(await copiedSnippet(page, 2)).model, 'scope/key-17');
  await page.locator('[data-input=apiKey]').selectOption('18');
  await page.locator('.codebox[data-catalog-state=ready] pre').filter({ hasText: 'No Claude Code-compatible model' }).waitFor();
  const second = curlRequest(await copiedSnippet(page)); assert.equal(second.body.model, 'scope/key-18'); assert.equal(second.url.pathname, '/v1/responses');
  assert.match(await copiedSnippet(page, 1), /client\.responses\.create/);
  assert.match(await copiedSnippet(page, 2), /^# No Claude Code-compatible model/);
  assert.deepEqual(reads.filter(read => read.keyID > 0).map(read => read.keyID), [17, 18]);
  for (const { headers } of reads) { assert.equal(headers['x-fells-expected-user'], '42'); assert.equal(headers['x-fells-expected-session'], 'c'.repeat(64)); }
  assert.equal(await page.locator('.quick-key-control svg[onload]').count(), 0); assert.equal(await page.evaluate(() => window.__forged), undefined);
  assert.equal(backend.state.generations.length, 0); assert.equal(backend.state.writes.some(write => write.path === '/api/app/keys'), false); assert.deepEqual(errors, []);
});

test('a late catalog for the previous key cannot replace the selected scope', async t => {
  const { context, page, base, backend, errors } = await prepare(t, { modelChat: true, keys: [activeKey, { ...activeKey, id: 18, name: 'Second scope' }] });
  let release; const gate = new Promise(resolve => { release = resolve; }), reads = [];
  await context.route(catalogPath, async route => {
    const id = Number(new URL(route.request().url()).searchParams.get('key_id')); reads.push(id);
    if (id === 17) { await page.evaluate(() => { window.__catalog17Started = true; }); await gate; }
    return route.fulfill({ json: { models: [{ model: `scope/key-${id}-only`, formats: ['openai-responses'], routable: true }] } });
  });
  await page.goto(base + '/app/#/api'); await page.waitForFunction(() => window.__catalog17Started === true);
  await page.locator('[data-input=apiKey]').selectOption('18');
  assert.equal(await page.locator('.codebox').getAttribute('data-catalog-state'), 'loading');
  assert.doesNotMatch(await page.locator('.codebox pre').innerText(), /key-17-only/);
  release(); await page.locator('.codebox[data-catalog-state=ready] pre').filter({ hasText: 'key-18-only' }).waitFor();
  assert.equal(curlRequest(await copiedSnippet(page)).body.model, 'scope/key-18-only');
  assert.equal(await page.locator('[data-input=apiKey]').inputValue(), '18');
  assert.deepEqual(reads.filter(id => id > 0), [17, 18]); assert.equal(backend.state.generations.length, 0); assert.deepEqual(errors, []);
});

test('a native Messages example never becomes a fallback browser conversation model', async t => {
  const { context, page, base, backend, errors } = await prepare(t, { modelChat: true, keys: [activeKey], chatModels: [], workspaces: [{ id: 'browser-space', name: 'Browser conversations', region: 'auto', tz: 'UTC', created: 1700000000000, role: 'owner' }] });
  await context.route(catalogPath, route => route.fulfill({ json: { models: [{ model: 'claude/native-cli-only', formats: ['anthropic-messages'], client_formats: { api: [], claude_code: ['anthropic-messages'] }, routable: true }] } }));
  await page.goto(base + '/app/#/api'); await page.locator('.codebox[data-catalog-state=ready]').waitFor();
  assert.match(await copiedSnippet(page), /^# No chat endpoint/);
  assert.match(await copiedSnippet(page, 1), /^# No OpenAI-compatible endpoint/);
  assert.equal(JSON.parse(await copiedSnippet(page, 2)).model, 'claude/native-cli-only');
  await page.evaluate(() => { location.hash = '/new'; });
  await page.locator('.chat-model-state[data-model-state=empty]').waitFor();
  assert.equal(await page.locator('.model-btn').innerText(), 'No available models');
  assert.equal(await page.locator('[data-form=send] .send').isDisabled(), true);
  assert.doesNotMatch(await page.locator('#fx-main').innerText(), /native-cli-only/);
  assert.equal(backend.state.generations.length, 0); assert.deepEqual(errors, []);
});

test('Quickstart without an eligible personal key never falls back to the global model catalog', async t => {
  const { context, page, base, backend, errors } = await prepare(t, { modelChat: true, keys: [{ ...activeKey, kind: 'cli' }, { ...activeKey, id: 18, revoked: true }, { ...activeKey, id: 19, expires_at: 1 }] });
  const reads = []; await context.route(catalogPath, route => { reads.push(route.request().url()); return route.fulfill({ json: { models: [{ model: 'global/should-not-appear', formats: ['anthropic-messages'], routable: true }] } }); });
  await page.goto(base + '/app/#/api'); await page.locator('.codebox[data-catalog-state=no-key]').waitFor();
  assert.equal(await page.locator('[data-input=apiKey]').isDisabled(), true);
  for (const tab of [0, 1, 2]) {
    const snippet = await copiedSnippet(page, tab);
    assert.match(snippet, /Choose an active personal API key/); assert.doesNotMatch(snippet, /curl |export |\.create\(|global\//);
  }
  await page.evaluate(() => { location.hash = '/billing/market'; });
  await page.locator('[data-market-models]').filter({ hasText: 'global/should-not-appear' }).waitFor();
  assert.ok(reads.every(path => !new URL(path).searchParams.has('key_id')), 'only the separate marketplace may read the public catalog');
  assert.equal(backend.state.generations.length, 0); assert.deepEqual(errors, []);
});

for (const status of [403, 503, 'invalid', 'empty']) test(`a key-bound catalog ${status} does not produce a runnable fallback`, async t => {
  const { context, page, base, backend, errors } = await prepare(t, { modelChat: true, keys: [activeKey] });
  const paths = [];
  await context.route(catalogPath, route => {
    paths.push(route.request().url());
    return route.fulfill(typeof status === 'number' ? { status, json: { error: 'Unavailable for this key' } } : { json: { models: status === 'empty' ? [] : 'invalid' } });
  });
  await page.goto(base + '/app/#/api'); await page.locator(`.codebox[data-catalog-state=${status === 'empty' ? 'ready' : 'error'}]`).waitFor();
  for (const tab of [0, 1, 2]) {
    const snippet = await copiedSnippet(page, tab);
    assert.match(snippet, status === 'empty' ? /^# No / : /could not be loaded/);
    assert.doesNotMatch(snippet, /curl |export |\.create\(/);
  }
  assert.ok(paths.some(path => new URL(path).searchParams.get('key_id') === '17'));
  assert.ok(paths.every(path => !new URL(path).searchParams.has('key_id') || new URL(path).searchParams.get('key_id') === '17'));
  assert.equal(await page.locator('.quick-endpoint').count(), 0); assert.equal(backend.state.generations.length, 0); assert.deepEqual(errors, []);
});

test('copied curl preserves quotes, newlines, shell metacharacters and HTML in model IDs', async t => {
  const model = 'orbit/\'"\\\n$(printf EXPANDED)`printf EXPANDED` <svg onload=alert(1)> 测试';
  for (const format of ['openai-responses', 'gemini-generatecontent']) {
    const { page, base, errors } = await open(t, [{ model, example_format: format }]);
    const { url, body } = curlRequest(await copiedSnippet(page));
    assert.equal(url.origin, base);
    if (format === 'openai-responses') assert.equal(body.model, model);
    else assert.equal(decodeURIComponent(url.pathname.slice('/v1beta/models/'.length, -':generateContent'.length)), model);
    assert.equal(await page.locator('.codebox pre svg').count(), 0, 'model content is rendered as text');
    assert.deepEqual(errors, []);
  }
});

test('Claude guide distinguishes saved setup, daily launch and secure temporary commands for all platforms', async t => {
  const { page, base, backend, errors } = await open(t, [{ model: 'claude/real-id', formats: ['anthropic-messages'], client_formats: { api: [], claude_code: ['anthropic-messages'] }, routable: true }]);
  assert.equal(await page.locator('[data-act=quick][data-i="2"]').getAttribute('aria-selected'), 'true', 'a CLI-only key opens its usable guide automatically');
  assert.equal(JSON.parse(await copiedSnippet(page, 2)).env.ANTHROPIC_AUTH_TOKEN, 'YOUR_FELLS_API_KEY');
  assert.equal(await page.locator('[data-claude-guide] input').count(), 0, 'the website never asks for a secret');
  assert.equal(await page.locator('[data-claude-guide] .setup-code pre').filter({ hasText: /^claude$/ }).count(), 1);
  assert.equal(await page.locator('[data-claude-help]').getAttribute('open'), null, 'troubleshooting is progressively disclosed');
  for (const [platform, path, prompt] of [
    ['macos', '~/.claude/settings.json', 'read -r -s'],
    ['linux', '~/.claude/settings.json', 'IFS= read -r -s -p'],
    ['windows', '%USERPROFILE%\\.claude\\settings.json', 'Read-Host'],
  ]) {
    await page.locator('[data-input=claudePlatform]').selectOption(platform);
    await page.locator('[data-act=claude-mode][data-v=saved]').click();
    assert.equal(await page.locator('.claude-settings-path code').innerText(), path);
    const json = JSON.parse(await copiedSnippet(page, 2));
    assert.deepEqual(json, { model: 'claude/real-id', env: { ANTHROPIC_BASE_URL: base, ANTHROPIC_AUTH_TOKEN: 'YOUR_FELLS_API_KEY' } });
    await page.locator('[data-claude-prerequisites] summary').click();
    const install = await page.locator('[data-claude-prerequisites] pre').innerText();
    assert.match(install, platform === 'windows' ? /claude\.ai\/install\.ps1/ : /claude\.ai\/install\.sh/);
    await page.locator('[data-act=claude-mode][data-v=temporary]').click();
    const temporary = await copiedSnippet(page, 2);
    assert.ok(temporary.includes(prompt)); assert.ok(temporary.includes("claude --model 'claude/real-id'"));
    assert.doesNotMatch(temporary, /sk-personal|YOUR_FELLS_API_KEY|\.claude\/settings\.json/);
    assert.equal(await page.locator('[data-claude-guide] .setup-code pre').filter({ hasText: /^claude$/ }).count(), 0, 'temporary mode does not claim the next launch is already configured');
  }
  assert.equal(backend.state.generations.length, 0); assert.equal(backend.state.writes.some(write => write.path === '/api/app/keys'), false); assert.deepEqual(errors, []);
});

test('Claude model picker only offers actual compatible key-scoped models and updates copied JSON', async t => {
  const { page, errors } = await open(t, [
    { model: 'api-only', formats: ['openai-responses'] },
    { model: 'claude/native-one', formats: ['anthropic-messages'], routable: true },
    { model: 'claude/native-two', formats: ['anthropic-messages'], routable: true },
    { model: 'claude/disabled', formats: ['anthropic-messages'], routable: false },
  ]);
  assert.equal(JSON.parse(await copiedSnippet(page, 2)).model, 'claude/native-one');
  assert.deepEqual(await page.locator('[data-input=claudeModel] option').evaluateAll(nodes => nodes.map(n => n.value)), ['claude/native-one', 'claude/native-two']);
  await page.locator('[data-input=claudeModel]').selectOption('claude/native-two');
  assert.equal(JSON.parse(await copiedSnippet(page, 2)).model, 'claude/native-two');
  assert.deepEqual(errors, []);
});

test('all six localized Claude guides explain persisted credentials and login recovery', async t => {
  const { page, context, base, backend, errors } = await prepare(t);
  await context.route(catalogPath, route => route.fulfill({ json: { models: [{ model: 'claude/available', formats: ['anthropic-messages'], routable: true }] } }));
  for (const prefix of ['', '/zh', '/zh-hant', '/ja', '/ko', '/es']) {
    await page.goto(base + prefix + '/app/#/api');
    await page.locator('.codebox[data-catalog-state=ready]').waitFor();
    assert.equal(JSON.parse(await copiedSnippet(page, 2)).model, 'claude/available');
    assert.equal(await page.locator('[data-claude-guide] .claude-guide-steps > li').count(), 3);
    await page.locator('[data-claude-help] summary').click();
    assert.equal(await page.locator('[data-claude-help] dt').count(), 5);
    const text = await page.locator('[data-claude-guide]').innerText();
    for (const token of ['ANTHROPIC_AUTH_TOKEN', 'YOUR_FELLS_API_KEY', '/status', 'api.fells.dev', 'settings.json', 'Not logged in', '401', '403']) assert.ok(text.includes(token), `${prefix}: ${token}`);
    assert.doesNotMatch(text, /undefined|\[object Object\]|\/logout/);
  }
  assert.equal(backend.state.generations.length, 0); assert.deepEqual(errors, []);
});

for (const width of [320, 390, 768, 1280]) test(`Claude onboarding remains readable at ${width}px and preserves review evidence`, async t => {
  const { page, errors } = await open(t, [{ model: 'claude/available', formats: ['anthropic-messages'], routable: true }]);
  await page.setViewportSize({ width, height: 900 });
  await copiedSnippet(page, 2);
  await page.locator('[data-claude-guide]').scrollIntoViewIfNeeded();
  const controls = page.locator('.claude-guide-controls');
  const bounds = await controls.boundingBox();
  assert.ok(bounds.width > 0 && bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
  assert.ok(await page.locator('.main > .scroll').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'no horizontal content overflow');
  assert.equal(await page.locator('.claude-guide-steps > li').count(), 3);
  const pre = page.locator('.claude-guide .codebox pre');
  const preBounds = await pre.boundingBox(); assert.ok(preBounds.x >= 0 && preBounds.x + preBounds.width <= width + 1);
  await mkdir('test-results/claude-onboarding', { recursive: true });
  await page.locator('#claude-setup-title').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `test-results/claude-onboarding/guide-${width}.png`, animations: 'disabled' });
  await pre.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `test-results/claude-onboarding/config-${width}.png`, animations: 'disabled' });
  assert.deepEqual(errors, []);
});

test('all public locales advertise the canonical API root and matching client configuration paths', async t => {
  const { page, base, errors } = await fixture.setup(t);
  await clipboard(page);
  for (const prefix of ['', '/zh', '/zh-hant', '/ja', '/ko', '/es']) {
    await page.goto(base + prefix + '/');
    assert.match(await page.locator('.pane.term pre').innerText(), /ANTHROPIC_BASE_URL=\s*\\?\s*"https:\/\/api\.fells\.dev"/);
    const code = page.locator('[data-code]');
    for (const tab of [0, 1, 2]) {
      await code.locator(`[data-code-tab="${tab}"]`).click();
      const text = await code.locator(`[data-code-pane="${tab}"]`).innerText();
      await code.locator('[data-code-copy]').click();
      assert.equal(await page.evaluate(() => window.copied.at(-1)), text);
      if (tab === 0) assert.match(text, /ANTHROPIC_BASE_URL="https:\/\/api\.fells\.dev"/);
      if (tab === 1) {
        assert.match(text, /base_url = "https:\/\/api\.fells\.dev\/v1"/);
        assert.match(text, /wire_api = "responses"/);
      }
      if (tab === 2) assert.equal(curlRequest(text).url.href, 'https://api.fells.dev/v1/messages');
    }
    assert.deepEqual(await code.locator('.endpoints span').allTextContents(), ['/v1/messages', '/v1/responses', '/v1/chat/completions']);

    await page.goto(base + prefix + '/developer-api/');
    const cfg = page.locator('[data-cfg]');
    for (const id of ['claude', 'opencode', 'codex']) {
      await cfg.locator(`[data-cfg-tab=${id}]`).click();
      const pane = cfg.locator(`[data-cfg-pane=${id}]`);
      const text = await pane.locator('pre').innerText();
      await pane.locator('[data-copy]').click();
      assert.equal(await page.evaluate(() => window.copied.at(-1)), text);
      if (id === 'claude') {
        assert.equal(JSON.parse(text).env.ANTHROPIC_BASE_URL, 'https://api.fells.dev');
        assert.equal(await pane.locator('.check li').count(), 5);
        const guide = await pane.innerText();
        assert.ok(guide.includes('settings.json') && guide.includes('/status') && guide.includes('claude'));
        assert.doesNotMatch(guide, /\/logout|"model":\s*"claude-opus/);
        assert.equal(await pane.locator('a[href$="/app/#/api"]').count(), 1);
      }
      if (id === 'opencode') assert.equal(JSON.parse(text).provider.fells.options.baseURL, 'https://api.fells.dev/v1');
      if (id === 'codex') {
        assert.match(text, /base_url = "https:\/\/api\.fells\.dev\/v1"/);
        assert.match(text, /wire_api = "responses"/);
      }
    }
  }
  assert.deepEqual(errors, []);
});
