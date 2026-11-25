import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { codexConfig, codexInstall, codexKeyCommand, codexWriteConfig } from '../src/lib/codex-setup.ts';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    assert.equal(Object.keys(words).length, 16);
    assert.ok(Object.values(words).every(value => typeof value === 'string' && value.trim()));
    assert.match(words.key, /FELLS_API_KEY/); assert.match(words.key, /auth\.json/);
    assert.match(words.path, /config\.toml/); assert.match(words.client, /ChatGPT/);
    assert.match(words.tools, /function\/custom/); assert.match(words.tools, /web_search/);
    assert.match(words.tools, /service_tier/); assert.match(words.tools, /default/);
    assert.match(words.keyPrompt, /Fells API Key|Fells/); assert.match(words.merge, /model_providers\.fells/);
  }
});

const parseToml = text => {
  const result = spawnSync('python3', ['-I', '-B', '-c', 'import json,sys,tomllib; print(json.dumps(tomllib.loads(sys.stdin.read())))'], { input: text, encoding: 'utf8', timeout: 3000 });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};

test('Codex install and key commands follow each system without carrying a credential', () => {
  assert.equal(codexInstall('macos'), 'brew install --cask codex');
  for (const platform of ['linux', 'windows']) assert.equal(codexInstall(platform), 'npm install -g @openai/codex');
  for (const platform of ['macos', 'linux', 'windows']) {
    const command = codexKeyCommand(platform, "Paste key (hidden) 'x': ", 'No key.');
    assert.match(command, /FELLS_API_KEY/);
    assert.doesNotMatch(command, /sk-|YOUR_FELLS_API_KEY|config\.toml/);
  }
  for (const platform of ['macos', 'linux', 'windows']) {
    assert.doesNotMatch(codexKeyCommand(platform, 'k: ', 'e'), /\.zshrc|\.bashrc|SetEnvironmentVariable|auth\.json/);
  }
  assert.match(codexKeyCommand('windows', 'k: ', 'e'), /powershell\.exe -NoProfile -Command/);
  assert.match(codexKeyCommand('windows', 'k: ', 'e'), /-AsSecureString/);
});

test('the hidden prompt supplies the key only to the launched Codex process', () => {
  const home = mkdtempSync(join(tmpdir(), 'codex-key-'));
  const env = { PATH: home + ':' + process.env.PATH, HOME: home };
  writeFileSync(join(home, 'codex'), '#!/bin/sh\n[ "$FELLS_API_KEY" = "synthetic key with spaces" ]\n', { mode: 0o700 });
  for (const platform of ['linux', 'macos']) {
    const command = codexKeyCommand(platform, "Paste 'key': ", "No key 'entered'.");
    const run = input => spawnSync('bash', ['-c', command], { input, cwd: home, encoding: 'utf8', env, timeout: 3000 });
    const typed = run('synthetic key with spaces\n');
    assert.equal(typed.status, 0, typed.stderr);
    assert.doesNotMatch(typed.stdout + typed.stderr, /synthetic key/);
    const empty = run('\n');
    assert.notEqual(empty.status, 0);
    assert.match(empty.stderr, /No key 'entered'/);
  }
  assert.equal(existsSync(join(home, '.bashrc')), false);
  assert.equal(existsSync(join(home, '.zshrc')), false);
});

test('the config command creates config.toml once and never overwrites an existing file', () => {
  const home = mkdtempSync(join(tmpdir(), 'codex-config-'));
  const config = codexConfig('https://api.example.test/v1', 'gpt-"quoted"\nFELLS_CODEX_CONFIG');
  const command = codexWriteConfig('linux', config, "Exists, 'unchanged'.");
  const first = spawnSync('bash', ['-c', command], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home }, timeout: 3000 });
  assert.equal(first.status, 0, first.stderr);
  const path = join(home, '.codex', 'config.toml');
  assert.deepEqual(parseToml(readFileSync(path, 'utf8')), parseToml(config));
  writeFileSync(path, 'model = "kept"\n');
  const second = spawnSync('bash', ['-c', command], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home }, timeout: 3000 });
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /Exists, 'unchanged'\./);
  assert.equal(readFileSync(path, 'utf8'), 'model = "kept"\n');
  const windows = codexWriteConfig('windows', config, "Exists, 'unchanged'.");
  assert.match(windows, /Test-Path \$p/);
  assert.match(windows, /WriteAllText\(\$p, @'\n/);
  assert.ok(windows.includes(`\n${config}\n'@)`), 'the PowerShell here-string carries the exact configuration');
  assert.match(windows, /Write-Host 'Exists, ''unchanged''\.'/);
});

test('Codex TOML escapes C1, line-separator and direction controls instead of emitting them raw', () => {
  const model = 'gpt\u0085\u2028\u202Efixture\u009b';
  const config = codexConfig('https://api.example.test/v1', model);
  assert.ok(config.includes('model = "gpt\\u0085\\u2028\\u202Efixture\\u009B"'));
  assert.doesNotMatch(config, /[\u0080-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/);
  assert.equal(parseToml(config).model, model);
});

test('the config command refuses text that could end its here-string or heredoc or hide terminal controls', () => {
  const valid = codexConfig('https://api.example.test/v1', 'gpt-fixture');
  for (const platform of ['linux', 'macos', 'windows']) assert.doesNotThrow(() => codexWriteConfig(platform, valid, 'Exists.'));
  for (const injected of ["'@", "\u2018@", "\u2019@)", "\u201a@", "\u201b@", "  '@", 'FELLS_CODEX_CONFIG', 'FELLS_CODEX_CONFIG  ', '\tkey = 1', 'key = 1\r', 'key = "\u001b[2J"', 'key = "\u009b2J"', 'key = "a\u202Eb"', 'key = "a\u2028b"', 'key = "\ud800"']) {
    const config = `${valid}\n${injected}\n# trailing`;
    for (const platform of ['linux', 'windows']) assert.throws(() => codexWriteConfig(platform, config, 'Exists.'), /Invalid Codex configuration value/, JSON.stringify(injected));
  }
  assert.doesNotThrow(() => codexWriteConfig('linux', `${valid}\nname = "FELLS_CODEX_CONFIG"\nnote = "it'@s"`, 'Exists.'), 'the delimiter text inside a value is not a terminator line');
});

test('Codex PowerShell commands double every PowerShell single-quote character', () => {
  const message = "Exists: \u2018a\u2019 \u201ab \u201bc 'd'";
  const doubled = "'Exists: \u2018\u2018a\u2019\u2019 \u201a\u201ab \u201b\u201bc ''d'''";
  const config = codexConfig('https://api.example.test/v1', 'gpt-fixture');
  assert.ok(codexWriteConfig('windows', config, message).includes(`Write-Host ${doubled}`));
  const key = codexKeyCommand('windows', "Paste \u2019key\u2019: ", "No \u2018key\u2019.");
  assert.ok(key.includes("Write-Error ''No \u2018\u2018\u2018\u2018key\u2019\u2019\u2019\u2019.''"), 'the inner script literal is quoted again for powershell.exe -Command');
  assert.ok(key.startsWith("powershell.exe -NoProfile -Command '"));
  assert.ok(key.endsWith("'"));
});
