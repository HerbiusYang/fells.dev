import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createBrowserFixture } from '../helpers/browser.mjs';
import { createAppBackend } from '../helpers/app-backend.mjs';

const fixture = createBrowserFixture();
before(() => fixture.start());
after(() => fixture.stop());
const preferences = { theme: 'light', prefs: { agent: '', send: 0 }, notifs: [true, true, true, false], onboarded: true, answers: [[0], [0], [0], [0]], promoClosed: true, sbHidden: false };

async function clipboard(page) {
  await page.addInitScript(() => {
    window.copied = [];
    navigator.clipboard.writeText = async value => { window.copied.push(value); };
  });
}

async function open(t, models) {
  const session = await fixture.setup(t);
  const { context, page, base } = session;
  await clipboard(page);
  await createAppBackend({ preferences }).install(context);
  await context.route('**/api/app/catalog', route => route.fulfill({ json: { models } }));
  await context.route('**/api/app/logs?*', route => route.fulfill({ json: { logs: [], retention_days: 37 } }));
  await page.goto(base + '/app/#/api');
  // The account views commit together; this proves the catalog has loaded even
  // when it is empty, without accepting the initial unavailable placeholder.
  await page.getByText('Request logs retained for 37 days', { exact: true }).waitFor();
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
      assert.match(snippet, /client\.chat\.completions\.create\(/);
      assert.deepEqual(JSON.parse(snippet.match(/^\s*messages=(.+),$/m)?.[1]), [{ role: 'user', content: 'Hello' }]);
      assert.doesNotMatch(snippet, /client\.responses/);
    } else {
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
  if (status === 'loading') { release(); await page.locator('.codebox pre').filter({ hasText: 'could not be loaded' }).waitFor(); }
  assert.deepEqual(errors, []);
});

test('empty and non-chat catalogs explain unavailability without inventing runnable model examples', async t => {
  for (const models of [[], [{ model: 'embedding-only', example_format: 'embeddings', formats: ['embeddings'] }]]) {
    const { page, base, errors } = await open(t, models);
    const curl = await copiedSnippet(page);
    const sdk = await copiedSnippet(page, 1);
    assert.match(curl, /^# No chat endpoint is currently available/);
    assert.match(sdk, /^# No OpenAI-compatible endpoint is currently available/);
    assert.doesNotMatch(curl + sdk, /curl |\.create\(|embedding-only|claude-opus/);
    const claude = await copiedSnippet(page, 2);
    assert.ok(claude.includes(`ANTHROPIC_BASE_URL="${base}"`));
    assert.ok(claude.includes('ANTHROPIC_AUTH_TOKEN="$FELLS_API_KEY"'));
    assert.deepEqual(errors, []);
  }
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
      if (id === 'claude') assert.equal(JSON.parse(text).env.ANTHROPIC_BASE_URL, 'https://api.fells.dev');
      if (id === 'opencode') assert.equal(JSON.parse(text).provider.fells.options.baseURL, 'https://api.fells.dev/v1');
      if (id === 'codex') {
        assert.match(text, /base_url = "https:\/\/api\.fells\.dev\/v1"/);
        assert.match(text, /wire_api = "responses"/);
      }
    }
  }
  assert.deepEqual(errors, []);
});
