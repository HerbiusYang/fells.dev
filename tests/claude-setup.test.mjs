import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

async function loadTypeScript(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

const { claudeSettings, claudeTemporary, claudeInstall, claudeSettingsPath } = await loadTypeScript('../src/lib/claude-setup.ts');
const { claudeSetupWordsOf } = await loadTypeScript('../src/i18n/claude-setup.ts');
const platforms = ['macos', 'linux', 'windows'];
const hostile = `claude/'"$(printf FORGED_COMMAND)\`printf FORGED_BACKTICK\` <svg onload="alert(1)">\n模型 \\ $HOME`;

test('persistent Claude Code settings contain only a placeholder credential and the actual model ID', () => {
  const origin = 'https://api.fells.dev';
  const output = claudeSettings(origin, 'claude-sonnet-5-5');
  assert.deepEqual(JSON.parse(output), {
    model: 'claude-sonnet-5-5',
    env: { ANTHROPIC_BASE_URL: origin, ANTHROPIC_AUTH_TOKEN: 'YOUR_FELLS_API_KEY' },
  });
  assert.equal(output, JSON.stringify(JSON.parse(output), null, 2), 'the copied configuration is readable strict JSON');
  assert.doesNotMatch(output, /FELLS_API_KEY\?|\$FELLS_API_KEY|sk-ap-/);
  assert.equal(Object.hasOwn(JSON.parse(output).env, 'ANTHROPIC_MODEL'), false, 'a higher-priority model environment override must not defeat a future /model choice');
});

test('persistent configuration safely round-trips quotes, HTML, newlines and shell syntax as JSON data', () => {
  const origin = `https://api.example.test/'"\n\\$HOME`;
  const output = claudeSettings(origin, hostile);
  const settings = JSON.parse(output);
  assert.equal(settings.model, hostile);
  assert.equal(settings.env.ANTHROPIC_BASE_URL, origin);
  assert.equal(settings.env.ANTHROPIC_AUTH_TOKEN, 'YOUR_FELLS_API_KEY');
  assert.deepEqual(Object.keys(settings).sort(), ['env', 'model']);
  assert.deepEqual(Object.keys(settings.env).sort(), ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL']);
  assert.ok(output.includes('\\n'), 'a model newline is escaped inside its JSON string');
});

test('installation and global settings paths match each supported shell and operating system', () => {
  assert.equal(claudeInstall('macos'), 'brew install --cask claude-code');
  assert.equal(claudeInstall('linux'), 'npm install -g @anthropic-ai/claude-code');
  assert.equal(claudeInstall('windows'), 'winget install Anthropic.ClaudeCode');
  for (const platform of ['macos', 'linux']) {
    assert.equal(claudeSettingsPath(platform), '~/.claude/settings.json');
  }
  assert.equal(claudeSettingsPath('windows'), '%USERPROFILE%\\.claude\\settings.json');
  for (const platform of platforms) {
    const command = claudeInstall(platform);
    assert.doesNotMatch(command, /sudo|--force|curl|\birm\b|\biex\b|install\.(?:sh|ps1)|\|/,
      'installation must not evaluate a regional HTML or failed download response');
    assert.doesNotMatch(command, /uninstall|Remove-Item|\brm\b|\.claude|settings\.json/,
      'installation must not remove an existing client or its saved settings');
    assert.equal(command.split('\n').length, 1, 'the copied package-manager command stays compact');
  }
});

// Only the CI test runner executes these generated examples. Claude is replaced
// by a shell function that records arguments; no model request or file write runs.
function runLinuxExample(snippet, input) {
  const call = '__FELLS_CLAUDE_CALL__';
  const restored = '__FELLS_OUTER_ENV__';
  const script = `claude() {
    printf '${call}\\0%s\\0%s\\0' "$ANTHROPIC_BASE_URL" "$ANTHROPIC_AUTH_TOKEN"
    printf '%s\\0' "$@"
  }
${snippet}
printf '${restored}\\0%s\\0%s\\0%s\\0' "$ANTHROPIC_BASE_URL" "$ANTHROPIC_AUTH_TOKEN" "$FELLS_API_KEY"
`;
  const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-c', script], {
    env: {
      PATH: '/usr/bin:/bin',
      ANTHROPIC_BASE_URL: 'https://previous.example.test',
      ANTHROPIC_AUTH_TOKEN: 'previous-token',
      FELLS_API_KEY: 'previous-input-variable',
    },
    input: `${input}\n`, encoding: 'utf8', timeout: 3000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  const callOffset = result.stdout.indexOf(`${call}\0`);
  const restoredOffset = result.stdout.indexOf(`${restored}\0`);
  assert.ok(restoredOffset >= 0, 'the caller continues after the isolated launch');
  const outside = result.stdout.slice(restoredOffset + restored.length + 1).split('\0');
  assert.deepEqual(outside, ['https://previous.example.test', 'previous-token', 'previous-input-variable', ''], 'temporary variables cannot overwrite the caller’s existing values');
  const invocation = callOffset < 0 ? null : result.stdout.slice(callOffset + call.length + 1, restoredOffset).split('\0');
  if (invocation) assert.equal(invocation.pop(), '');
  return { ...result, invocation };
}

test('the temporary Linux example reads a hidden key and invokes the exact model without executing substitutions', () => {
  const origin = `https://example.test/'$(printf BAD_ORIGIN)\`printf BAD_ORIGIN_BACKTICK\``;
  const key = `sk-test-'"$HOME;$(printf BAD_KEY)\\literal`;
  const prompt = `Fells key: ' $(printf BAD_PROMPT)\`printf BAD_PROMPT_BACKTICK\` `;
  const snippet = claudeTemporary(origin, hostile, 'linux', prompt);
  assert.ok(snippet.includes('IFS= read -r -s -p '));
  const result = runLinuxExample(snippet, key);
  assert.deepEqual(result.invocation, [origin, key, '--model', hostile]);
  assert.doesNotMatch(result.stderr, /BAD_KEY|BAD_ORIGIN|BAD_PROMPT|FORGED_COMMAND|FORGED_BACKTICK/);
  assert.equal(result.stdout.startsWith('\n__FELLS_CLAUDE_CALL__'), true, 'only the explicit newline precedes the recorded invocation');
  assert.equal(snippet.includes(key), false, 'the user supplies the key after pasting the command');
});

test('an empty temporary key never launches Claude and quotes the localized error literally', () => {
  const emptyMessage = `No key: '$(printf BAD_EMPTY)\`printf BAD_EMPTY_BACKTICK\` "$HOME"`;
  const snippet = claudeTemporary('https://api.fells.dev', 'claude-sonnet-5-5', 'linux', 'Key: ', emptyMessage);
  const result = runLinuxExample(snippet, '');
  assert.equal(result.invocation, null);
  assert.equal(result.stdout.split('__FELLS_OUTER_ENV__')[0], `\n${emptyMessage}\n`);
  assert.doesNotMatch(result.stderr, /BAD_EMPTY/);
});

for (const platform of ['macos', 'linux']) {
  test(`the ${platform} temporary launch keeps credentials out of commands, histories and files`, () => {
    const snippet = claudeTemporary('https://api.fells.dev', 'claude-sonnet-5-5', platform);
    assert.ok(snippet.startsWith('(\n') && snippet.endsWith('\n)'), 'a subshell isolates the temporary variables');
    assert.match(snippet, /read -r -s /);
    assert.ok(snippet.includes('ANTHROPIC_AUTH_TOKEN="$FELLS_API_KEY"'));
    assert.ok(snippet.includes('if [ -n "$FELLS_API_KEY" ]; then'));
    assert.doesNotMatch(snippet, /\bexport\b|YOUR_FELLS_API_KEY|sk-ap-|\.claude|settings\.json|\.zshrc|\.bashrc|\btee\b|pbcopy|xclip|localStorage|sessionStorage/);
    assert.doesNotMatch(snippet, /(?:printf|echo)[^\n]*\$FELLS_API_KEY/);
    if (platform === 'macos') assert.ok(snippet.includes("read -r -s 'FELLS_API_KEY?Fells API Key: '"), 'macOS presents a zsh hidden-read prompt');
    else assert.ok(snippet.includes("IFS= read -r -s -p 'Fells API Key: ' FELLS_API_KEY"), 'Linux uses the Bash hidden-read syntax');
  });
}

test('macOS and Linux share literal model and origin quoting while preserving their own hidden-read syntax', () => {
  const mac = claudeTemporary(hostile, hostile, 'macos', hostile, hostile);
  const linux = claudeTemporary(hostile, hostile, 'linux', hostile, hostile);
  const afterRead = value => value.slice(value.indexOf('\n  printf '));
  assert.equal(afterRead(mac), afterRead(linux), 'the executable model invocation has exactly the Bash-tested quoting on both platforms');
  const quotedPrompt = `'${(`FELLS_API_KEY?${hostile}`).replace(/'/g, "'\\''")}'`;
  assert.ok(mac.includes(`read -r -s ${quotedPrompt}`));
});

test('Windows uses SecureString input and restores previous process environment in finally', () => {
  const snippet = claudeTemporary('https://api.fells.dev', 'claude-sonnet-5-5', 'windows');
  assert.match(snippet, /^& \{/);
  assert.ok(snippet.includes("$fellsNames = @('ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN')"));
  assert.ok(snippet.includes("[Environment]::GetEnvironmentVariable($name, 'Process')"));
  assert.match(snippet, /Read-Host 'Fells API Key: ' -AsSecureString/);
  assert.match(snippet, /try \{[\s\S]*\[string\]::IsNullOrWhiteSpace\(\$fellsToken\)[\s\S]*\$env:ANTHROPIC_BASE_URL[\s\S]*\$env:ANTHROPIC_AUTH_TOKEN = \$fellsToken[\s\S]*claude --model 'claude-sonnet-5-5'[\s\S]*\} finally \{/);
  const cleanup = snippet.slice(snippet.indexOf('} finally {'));
  assert.ok(cleanup.includes("[Environment]::SetEnvironmentVariable($name, $fellsPrevious[$name], 'Process')"));
  assert.ok(cleanup.includes('$fellsKey.Dispose()'));
  assert.ok(cleanup.includes('Remove-Variable fellsToken'));
  assert.doesNotMatch(snippet, /Set-Content|Add-Content|Out-File|Set-Clipboard|settings\.json|localStorage|sessionStorage|YOUR_FELLS_API_KEY|sk-ap-/);
  assert.doesNotMatch(snippet, /(?:Write-Host|Write-Output|echo)[^\n]*\$fellsToken/);
});

test('Windows preserves model, URL and translated prompts as single-quoted PowerShell data', () => {
  const snippet = claudeTemporary(hostile, hostile, 'windows', hostile, hostile);
  const quoted = `'${hostile.replace(/'/g, "''")}'`;
  assert.ok(snippet.includes(`Read-Host ${quoted} -AsSecureString`));
  assert.ok(snippet.includes(`throw ${quoted}`));
  assert.ok(snippet.includes(`$env:ANTHROPIC_BASE_URL = ${quoted}`));
  assert.ok(snippet.includes(`claude --model ${quoted}`));
});

function assertTranslationShape(value, reference, path = 'copy') {
  if (typeof reference === 'string') {
    assert.equal(typeof value, 'string', path);
    assert.ok(value.trim().length > 0, `${path} must have translated content`);
    assert.doesNotMatch(value, /\b(?:undefined|TODO|FIXME)\b/, path);
    return;
  }
  assert.equal(Array.isArray(value), Array.isArray(reference), path);
  assert.ok(value && typeof value === 'object', path);
  assert.deepEqual(Object.keys(value).sort(), Object.keys(reference).sort(), `${path} must retain the complete guide contract`);
  for (const key of Object.keys(reference)) assertTranslationShape(value[key], reference[key], `${path}.${key}`);
}

const guideFields = [
  'title', 'intro', 'platform', 'model', 'modelHint', 'saved', 'temporary',
  'installTitle', 'installBody', 'installLink', 'keyTitle', 'keyBody',
  'settingsTitle', 'settingsBody', 'mergeNote', 'replaceKey', 'secretNote', 'pathLabel',
  'runTitle', 'runBody', 'verifyTitle', 'verifyBody', 'statusExpected', 'promptNote',
  'temporaryTitle', 'temporaryBody', 'temporaryKeyPrompt', 'emptyKeyMessage',
  'helpTitle', 'docs', 'permissionNote', 'noModelHint', 'copyConfig', 'copyCommand', 'help',
];

for (const locale of ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es']) {
  test(`${locale} includes the complete nonempty Claude Code onboarding copy`, () => {
    const reference = claudeSetupWordsOf('en');
    const copy = claudeSetupWordsOf(locale);
    assert.deepEqual(Object.keys(copy).sort(), [...guideFields].sort());
    assert.equal(copy.help.length, 6);
    assertTranslationShape(copy, reference);
    if (locale !== 'en') assert.notDeepEqual(copy, reference, 'a supported locale must not silently use the English fallback');
    const text = JSON.stringify(copy);
    for (const marker of ['/status', '/login', '401', '403', 'YOUR_FELLS_API_KEY', 'settings.json', 'env', 'claude']) assert.ok(text.includes(marker), `${locale} retains actionable ${marker} guidance`);
    for (const marker of ['claude --version', 'Node.js 22+', 'Homebrew', 'WinGet', 'npm', 'HTML', 'App unavailable in region']) assert.ok(text.includes(marker), `${locale} retains installation prerequisite and failure guidance: ${marker}`);
  });
}

test('Claude Code onboarding normalizes Chinese locale aliases and falls back to complete English', () => {
  assert.deepEqual(claudeSetupWordsOf('zh'), claudeSetupWordsOf('zh-CN'));
  assert.deepEqual(claudeSetupWordsOf('zh-hant'), claudeSetupWordsOf('zh-TW'));
  for (const locale of ['fr', '', 'not-a-locale', 'constructor', 'toString', '__proto__']) assert.deepEqual(claudeSetupWordsOf(locale), claudeSetupWordsOf('en'));
});
