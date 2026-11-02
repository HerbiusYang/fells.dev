import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { codexConfig } from '../src/lib/codex-setup.ts';
import { codexSetupWordsOf } from '../src/i18n/codex-setup.ts';

test('Codex custom provider TOML preserves hostile model values without injecting configuration or credentials', () => {
  const base = 'https://api.example.test/v1', model = 'gpt-"quoted"\\line\n[model_providers.forged]\nkey="bad"\u007f模型';
  const config = codexConfig(base, model);
  const result = spawnSync('python3', ['-I', '-B', '-c', 'import json,sys,tomllib; print(json.dumps(tomllib.loads(sys.stdin.read())))'], { input: config, encoding: 'utf8', timeout: 3000 });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { model, model_provider: 'fells', service_tier: 'default', web_search: 'disabled', model_providers: { fells: { name: 'Fells', base_url: base, env_key: 'FELLS_API_KEY', wire_api: 'responses', supports_websockets: false } } });
  assert.doesNotMatch(config, /YOUR_FELLS_API_KEY|experimental_bearer_token|Authorization|auth\.json/);
});

test('Codex configuration rejects empty and malformed Unicode values', () => {
  for (const model of ['', ' ', '\ud800']) assert.throws(() => codexConfig('https://api.example.test/v1', model));
  assert.throws(() => codexConfig('\ud800', 'gpt-fixture'));
});

test('Codex setup has complete six-language guidance without asking for a browser key', () => {
  for (const locale of ['en', 'zh', 'zh-hant', 'ja', 'ko', 'es', 'zh-TW', 'zh-CN', 'de']) {
    const words = codexSetupWordsOf(locale);
    assert.equal(Object.keys(words).length, 11);
    assert.ok(Object.values(words).every(value => typeof value === 'string' && value.trim()));
    assert.match(words.key, /FELLS_API_KEY/); assert.match(words.key, /auth\.json/);
    assert.match(words.path, /config\.toml/); assert.match(words.client, /ChatGPT/);
    assert.match(words.tools, /function\/custom/); assert.match(words.tools, /web_search/);
    assert.match(words.tools, /service_tier/); assert.match(words.tools, /default/);
  }
});
