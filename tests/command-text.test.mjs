import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { commandModelId, commandTextSafe } from '../src/lib/command-text.ts';

test('runnable snippets accept ordinary catalogue model IDs', () => {
  for (const id of ['claude-sonnet-5-5', 'gpt-5.1', 'gemini-3-pro', 'deepseek/deepseek-v4', 'org/model:tag@2', 'kimi-k3', 'GLM-5_Air', 'a', 'x'.repeat(200)]) {
    assert.equal(commandModelId(id), true, id);
  }
});

test('model IDs with shell, quoting, Unicode or control characters never enter a runnable snippet', () => {
  for (const id of ['', 'x'.repeat(201), 'a b', "a'b", 'a"b', 'a!b', 'a$b', 'a`b', 'a\\b', 'a;b', 'a\nb', 'a\tb', 'a\u001bb', 'a\u009bb', 'a\u202Eb', 'a\u2019b', 'café', '模型', 'a%27b', 'a?b', 'a#b']) {
    assert.equal(commandModelId(id), false, JSON.stringify(id));
  }
  for (const value of [undefined, null, 7, ['gpt-5.1'], { toString: () => 'gpt-5.1' }]) assert.equal(commandModelId(value), false);
});

test('copied command text refuses terminal controls, C1 controls, line separators and direction controls', () => {
  assert.equal(commandTextSafe('curl https://api.fells.dev/v1/messages \\\n  -H @- \\\n\t-d \'{"model": "claude-sonnet-5-5"}\''), true);
  assert.equal(commandTextSafe('请输入 Fells API Key： %USERPROFILE%\\.claude\\settings.json'), true);
  for (const character of ['\u0000', '\u0007', '\u0008', '\u000b', '\u000c', '\r', '\u001b', '\u007f', '\u0080', '\u0085', '\u009b', '\u009f', '\u061C', '\u200E', '\u200F', '\u2028', '\u2029', '\u202A', '\u202E', '\u2066', '\u2069']) {
    assert.equal(commandTextSafe(`echo safe${character}text`), false, character.codePointAt(0).toString(16));
  }
});

test('the console guards copied text and quotes the Gemini URL against interactive expansion', () => {
  const app = readFileSync(new URL('../src/scripts/app.ts', import.meta.url), 'utf8');
  const copy = app.slice(app.indexOf('  const copy = async (text: string'), app.indexOf('  // ---------- sidebar ----------'));
  assert.match(copy, /if \(!commandTextSafe\(text\)\) \{[^}]*toast\(feedback\.copyUnsafe\); return false; \}\s*try \{\s*await navigator\.clipboard\.writeText\(text\);/);
  assert.match(app, /: `curl '\$\{apiOrigin\}\/v1beta\/models\/\$\{encodeURIComponent\(curlModel\.model\)\.replace\(\/'\/g, "%27"\)\}:generateContent'/);
  assert.doesNotMatch(app, /curl "\$\{apiOrigin\}\/v1beta/);
  for (const ready of ['curlReady', 'claudeReady', 'codexReady']) assert.match(app, new RegExp(`const ${ready} = [^;]*commandModelId\\(`));
  assert.match(app, /!commandModelId\(openAIModel\.model\) \? unsafeModel/);
});
