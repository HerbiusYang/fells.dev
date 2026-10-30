import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, mkdirSync, statSync, lstatSync, symlinkSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

async function loadTypeScript(path) {
  return import(new URL(path, import.meta.url).href);
}

const { claudeSettings, claudeCommand, claudeTemporary, claudePersistent, claudeInstall, claudeSettingsPath } = await loadTypeScript('../src/lib/claude-setup.ts');
const { claudeSetupWordsOf } = await loadTypeScript('../src/i18n/claude-setup.ts');
const platforms = ['macos', 'linux', 'windows'];
const hostile = `claude/'"$(printf FORGED_COMMAND)\`printf FORGED_BACKTICK\` <svg onload="alert(1)">\n模型 \\ $HOME`;

function runCommand(snippet, key) {
  for (const shell of ['/bin/sh', '/bin/bash']) {
    const parsed = spawnSync(shell, ['-n'], { input: snippet, encoding: 'utf8' });
    assert.equal(parsed.status, 0, parsed.stderr);
  }
  const directory = mkdtempSync(join(tmpdir(), 'fells-claude-command-'));
  try {
    writeFileSync(join(directory, 'claude'), '#!/bin/sh\n[ -z "${fells_key+x}" ] || exit 93\nprintf "%s\\0" "$ANTHROPIC_BASE_URL" "$ANTHROPIC_AUTH_TOKEN" "$@"\n', { mode: 0o700 });
    const result = spawnSync('/bin/sh', ['-c', snippet], {
      env: { PATH: `${directory}:/usr/bin:/bin`, fells_key: 'inherited-not-a-key' }, input: `${key}\n`, encoding: 'utf8', timeout: 3000,
    });
    assert.equal(result.error, undefined);
    return result;
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test('retained temporary command prompts for a full key and passes literal URL, key and catalog model to Claude', () => {
  const origin = `https://example.test/'$(printf BAD_ORIGIN)\`printf BAD_BACKTICK\``;
  const key = `sk-synthetic-'"$HOME;$(printf BAD_KEY)\\literal`;
  const command = claudeCommand(origin, hostile, `Key: '$(printf BAD_PROMPT) `, 'No key.');
  const result = runCommand(command, key);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.split('\0'), ['\n'+origin, key, '--model', hostile, '']);
  assert.equal(result.stderr, '');
  assert.match(command, /^bash -c '/);
  assert.doesNotMatch(command, /YOUR_FELLS_API_KEY|sk-synthetic|settings\.json|export |localStorage|sessionStorage/);
});

test('retained temporary command does not launch Claude after an empty hidden key', () => {
  const message = `No key: '$(printf FORGED) $HOME`;
  const result = runCommand(claudeCommand('https://api.fells.dev', 'claude/actual', 'Key: ', message), '');
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '\n');
  assert.equal(result.stderr, message+'\n');
});

test('persistent Claude Code settings contain only a placeholder credential and the actual model ID', () => {
  const origin = 'https://api.fells.dev';
  const output = claudeSettings(origin, 'claude-sonnet-5-5');
  assert.deepEqual(JSON.parse(output), {
    model: 'claude-sonnet-5-5',
    env: { ANTHROPIC_BASE_URL: origin, ANTHROPIC_AUTH_TOKEN: 'YOUR_FELLS_API_KEY', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-sonnet-5-5' },
  });
  assert.equal(output, JSON.stringify(JSON.parse(output), null, 2), 'the copied configuration is readable strict JSON');
  assert.doesNotMatch(output, /FELLS_API_KEY\?|\$FELLS_API_KEY|sk-ap-/);
  assert.equal(Object.hasOwn(JSON.parse(output).env, 'ANTHROPIC_MODEL'), false, 'a higher-priority model environment override must not defeat a future /model choice');
});


test('permanent settings explicitly pin a supplied background model without changing the main model', () => {
  const settings = JSON.parse(claudeSettings('https://api.fells.dev', 'claude-fable-5-1', 'claude-sonnet-5-5'));
  assert.equal(settings.model, 'claude-fable-5-1');
  assert.equal(settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'claude-sonnet-5-5');
  assert.equal(Object.hasOwn(settings.env, 'ANTHROPIC_SMALL_FAST_MODEL'), false);
  assert.equal(Object.hasOwn(settings.env, 'ANTHROPIC_MODEL'), false);
  const fallback = JSON.parse(claudeSettings('https://api.fells.dev', hostile));
  assert.equal(fallback.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, hostile, 'an absent optional model uses the exact selected model');
});

test('the ordinary CLI guide presents three permanent steps without embedding an automatic setup script', () => {
  const app = readFileSync(new URL('../src/scripts/app.ts', import.meta.url), 'utf8');
  const guide = app.slice(app.indexOf('    const claudeModels ='), app.indexOf('    const keys = S.keys;', app.indexOf('    const claudeModels =')));
  assert.match(guide, /: claudeSettings\(apiOrigin, claudeModel\.model, claudeBackgroundModel\.model\)/);
  assert.match(guide, /data-claude-mode="saved"/);
  assert.match(guide, /data-text="claude"/);
  assert.equal((guide.match(/<li data-claude-(?:install|settings|run)>/g) ?? []).length, 3);
  assert.doesNotMatch(guide, /claudePersistent\(|claudeTemporary\(|claudeCommand\(|data-act="claude-mode"/);
  assert.ok(claudeSettings('https://api.fells.dev', 'claude/example').split('\n').length <= 12);
});

test('persistent configuration safely round-trips quotes, HTML, newlines and shell syntax as JSON data', () => {
  const origin = `https://api.example.test/'"\n\\$HOME`;
  const output = claudeSettings(origin, hostile);
  const settings = JSON.parse(output);
  assert.equal(settings.model, hostile);
  assert.equal(settings.env.ANTHROPIC_BASE_URL, origin);
  assert.equal(settings.env.ANTHROPIC_AUTH_TOKEN, 'YOUR_FELLS_API_KEY');
  assert.deepEqual(Object.keys(settings).sort(), ['env', 'model']);
  assert.deepEqual(Object.keys(settings.env).sort(), ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL']);
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
  'background', 'backgroundSame',
  'simpleInstall', 'simpleMerge', 'simpleRun', 'webKeyNote',
  'title', 'intro', 'platform', 'model', 'modelHint', 'saved', 'temporary', 'commandBody', 'configFileNote',
  'setup', 'setupBody', 'setupSaved', 'setupRuntime', 'setupFailure', 'invalidKeyMessage', 'setupRuntimeHint',
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


const syntheticFullKey = 'sk-ap-' + 'b'.repeat(48);
function persistentFixture(initial, { custom = false, link = false, lock = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'fells-persistent-'));
  const config = custom ? join(directory, 'custom config') : join(directory, '.claude');
  mkdirSync(config, { mode: 0o700 });
  const target = join(config, 'settings.json');
  if (initial !== undefined) writeFileSync(target, initial, { mode: 0o600 });
  if (link) {
    const actual = join(directory, 'other-settings.json');
    writeFileSync(actual, '{"unrelated":true}', { mode: 0o600 });
    symlinkSync(actual, target);
  }
  if (lock) writeFileSync(target + '.fells-setup.lock', 'another setup owns this', { mode: 0o600 });
  const environment = {
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: directory,
    ...(custom ? { CLAUDE_CONFIG_DIR: config } : {}),
    fells_key: 'inherited-secret-must-not-be-reused',
  };
  const run = (key = syntheticFullKey, origin = 'https://api.fells.dev', model = 'claude-opus-5-5') => {
    const command = claudePersistent(origin, model, 'macos', 'Key: ', 'Empty key.', 'Saved; next time claude.', 'Node required.', 'Could not save.', 'Complete key required.');
    const result = spawnSync('/bin/sh', ['-c', command], {
      env: environment, input: key + '\n', encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(result.error, undefined);
    if (key) assert.ok(!result.stdout.includes(key) && !result.stderr.includes(key), 'the credential is not printed');
    return { ...result, command };
  };
  return { directory, config, target, environment, run, close: () => rmSync(directory, { recursive: true, force: true }) };
}

test('one-time setup preserves unrelated settings and a subsequent plain claude reads saved credentials without Fells environment', () => {
  const before = { permissions: { allow: ['Read', 'Bash(git status:*)'] }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'printf unchanged' }] }] }, env: { OTHER_SERVICE: '2026-10-27T00:00:00Z', UNRELATED: 'keep-me' }, model: 'old-model' };
  const f = persistentFixture(JSON.stringify(before));
  try {
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Saved; next time claude\./);
    const saved = JSON.parse(readFileSync(f.target, 'utf8'));
    assert.deepEqual(saved, { ...before, model: 'claude-opus-5-5', env: { ...before.env, ANTHROPIC_BASE_URL: 'https://api.fells.dev', ANTHROPIC_AUTH_TOKEN: syntheticFullKey } });
    assert.equal(statSync(f.target).mode & 0o777, 0o600);
    const backups = readdirSync(f.config).filter(name => name.startsWith('settings.json.fells-backup-'));
    assert.equal(backups.length, 1);
    assert.equal(readFileSync(join(f.config, backups[0]), 'utf8'), JSON.stringify(before));
    assert.equal(statSync(join(f.config, backups[0])).mode & 0o777, 0o600);
    assert.equal(existsSync(f.target + '.fells-setup.lock'), false);
    writeFileSync(join(f.directory, 'claude'), `#!${process.execPath}\nconst f=require('node:fs'),p=require('node:path');if(process.env.ANTHROPIC_AUTH_TOKEN||process.env.ANTHROPIC_BASE_URL)process.exit(3);const c=JSON.parse(f.readFileSync(p.join(process.env.HOME,'.claude/settings.json'),'utf8'));if(c.model!=='claude-opus-5-5'||c.env.ANTHROPIC_BASE_URL!=='https://api.fells.dev'||c.env.ANTHROPIC_AUTH_TOKEN!=='${syntheticFullKey}')process.exit(4);console.log('saved-config-loaded');\n`, { mode: 0o700 });
    const next = spawnSync('/bin/sh', ['-c', 'claude'], { env: { HOME: f.directory, PATH: `${f.directory}:${dirname(process.execPath)}:/usr/bin:/bin` }, encoding: 'utf8', timeout: 3000 });
    assert.equal(next.status, 0, next.stderr);
    assert.equal(next.stdout, 'saved-config-loaded\n');
  } finally { f.close(); }
});

test('persistent setup respects CLAUDE_CONFIG_DIR, preserves literal catalog strings and creates a private new file', () => {
  const f = persistentFixture(undefined, { custom: true });
  try {
    const result = f.run(syntheticFullKey, hostile, hostile);
    assert.equal(result.status, 0, result.stderr);
    const saved = JSON.parse(readFileSync(f.target, 'utf8'));
    assert.equal(saved.model, hostile);
    assert.equal(saved.env.ANTHROPIC_BASE_URL, hostile);
    assert.equal(saved.env.ANTHROPIC_AUTH_TOKEN, syntheticFullKey);
    assert.equal(statSync(f.target).mode & 0o777, 0o600);
    assert.equal(existsSync(join(f.directory, '.claude')), false);
    assert.doesNotMatch(result.command, /sk-ap-b{48}/);
    for (const shell of ['/bin/sh', '/bin/bash']) assert.equal(spawnSync(shell, ['-n'], { input: result.command, encoding: 'utf8' }).status, 0);
  } finally { f.close(); }
});

test('malformed or incompatible existing JSON is left unchanged and is never printed', () => {
  for (const original of ['{private-secret-invalid-json', 'null', '[]', '{"env":null}', '{"env":[]}', '{"env":"private-secret"}']) {
    const f = persistentFixture(original);
    try {
      const result = f.run();
      assert.equal(result.status, 1);
      assert.equal(result.stderr, 'Could not save.\n');
      assert.equal(readFileSync(f.target, 'utf8'), original);
      assert.doesNotMatch(result.stdout + result.stderr, /private-secret/);
      assert.equal(readdirSync(f.config).some(name => name.includes('backup-')), false);
      assert.equal(existsSync(f.target + '.fells-setup.lock'), false);
    } finally { f.close(); }
  }
});

test('masked, placeholder, empty and shell-syntax keys cannot be persisted', () => {
  for (const key of ['', 'YOUR_FELLS_API_KEY', 'sk-ap-123456…', 'sk-ap-123456...', 'sk-ap-' + 'a'.repeat(47), syntheticFullKey + ' ', '$(touch /tmp/not-a-command)']) {
    const f = persistentFixture('{"keep":true}');
    try {
      const result = f.run(key);
      assert.equal(result.status, 1);
      assert.equal(readFileSync(f.target, 'utf8'), '{"keep":true}');
      assert.match(result.stderr, /Empty key\.|Complete key required\./);
      assert.equal(readdirSync(f.config).length, 1);
    } finally { f.close(); }
  }
});

test('existing settings symlinks and another setup lock cannot be replaced', () => {
  for (const options of [{ link: true }, { lock: true }]) {
    const f = persistentFixture(options.link ? undefined : '{"keep":true}', options);
    try {
      const result = f.run();
      assert.equal(result.status, 1);
      assert.equal(result.stderr, 'Could not save.\n');
      if (options.link) {
        assert.equal(lstatSync(f.target).isSymbolicLink(), true);
        assert.equal(readFileSync(f.target, 'utf8'), '{"unrelated":true}');
      } else {
        assert.equal(readFileSync(f.target, 'utf8'), '{"keep":true}');
        assert.equal(readFileSync(f.target + '.fells-setup.lock', 'utf8'), 'another setup owns this');
      }
    } finally { f.close(); }
  }
});

test('persistent Windows command uses hidden input and shared JSON parser without putting the key in argv', () => {
  const command = claudePersistent('https://api.fells.dev', 'claude-opus-5-5', 'windows');
  assert.match(command, /Read-Host[^\n]*-AsSecureString/);
  assert.match(command, /\$fellsToken \| & \$fellsNode.Source -e /);
  assert.match(command, /FileSecurity/);
  assert.match(command, /SetAccessRuleProtection/);
  assert.match(command, /Set-Acl -LiteralPath/);
  assert.doesNotMatch(command, /ConvertFrom-Json|ConvertTo-Json|ANTHROPIC_AUTH_TOKEN = \$fellsToken|YOUR_FELLS_API_KEY/);
});


test('another configured provider or required login is not silently replaced', () => {
  for (const name of ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY']) {
    for (const inProcess of [false, true]) {
      const original = JSON.stringify(inProcess ? { keep: true } : { keep: true, env: { [name]: '1' } });
      const f = persistentFixture(original);
      try {
        if (inProcess) f.environment[name] = '1';
        const result = f.run();
        assert.equal(result.status, 1);
        assert.equal(readFileSync(f.target, 'utf8'), original);
        assert.equal(result.stderr, 'Could not save.\n');
      } finally { f.close(); }
    }
  }
  for (const required of [{ forceLoginMethod: 'claudeai' }, { forceLoginGatewayUrl: 'https://gateway.example.test' }, { forceLoginOrgUUID: 'required-org' }]) {
    const original = JSON.stringify({ ...required, keep: true });
    const f = persistentFixture(original);
    try { assert.equal(f.run().status, 1); assert.equal(readFileSync(f.target, 'utf8'), original); }
    finally { f.close(); }
  }
});


test('a UTF-8 BOM is accepted while the protected original backup retains its bytes', () => {
  const original = '\ufeff{"permissions":{"allow":["Read"]},"env":{"OTHER":"unchanged"}}';
  const f = persistentFixture(original);
  try {
    assert.equal(f.run().status, 0);
    assert.deepEqual(JSON.parse(readFileSync(f.target, 'utf8')).permissions, { allow: ['Read'] });
    const backup = readdirSync(f.config).find(name => name.startsWith('settings.json.fells-backup-'));
    assert.equal(readFileSync(join(f.config, backup), 'utf8'), original);
  } finally { f.close(); }
});

test('an external settings edit detected during setup is preserved instead of overwritten', () => {
  const f = persistentFixture('{"keep":"original"}');
  try {
    const hook = join(f.directory, 'external-edit.cjs');
    writeFileSync(hook, `const fs=require('node:fs'),cp=require('node:child_process');const original=fs.writeFileSync;let edited=false;fs.writeFileSync=function(...args){const result=original.apply(this,args);if(!edited&&typeof args[1]==='string'&&args[1].includes('ANTHROPIC_AUTH_TOKEN')){edited=true;const writer=cp.spawnSync(process.execPath,['-e',${JSON.stringify(`require('node:fs').writeFileSync(${JSON.stringify(f.target)}, '{"external":"must survive"}')`)}],{encoding:'utf8'});if(writer.status!==0)throw Error('synthetic external writer failed');}return result;};\n`, { mode: 0o600 });
    f.environment.NODE_OPTIONS = `--require=${hook}`;
    const result = f.run();
    assert.equal(result.status, 1);
    assert.equal(result.stderr, 'Could not save.\n');
    assert.deepEqual(JSON.parse(readFileSync(f.target, 'utf8')), { external: 'must survive' });
    assert.equal(existsSync(f.target + '.fells-setup.lock'), false);
    assert.equal(readdirSync(f.config).some(name => name.endsWith('.tmp')), false);
  } finally { f.close(); }
});
