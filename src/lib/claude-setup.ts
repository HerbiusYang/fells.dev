export type ClaudePlatform = "macos" | "linux" | "windows";

// Examples contain a placeholder only. Never accept a customer's credential in
// the website or substitute a masked key prefix into a runnable configuration.
export function claudeSettings(origin: string, model: string): string {
  return JSON.stringify({
    model,
    env: {
      ANTHROPIC_BASE_URL: origin,
      ANTHROPIC_AUTH_TOKEN: "YOUR_FELLS_API_KEY",
    },
  }, null, 2);
}

export function claudeSettingsPath(platform: ClaudePlatform): string {
  return platform === "windows"
    ? "%USERPROFILE%\\.claude\\settings.json"
    : "~/.claude/settings.json";
}

export function claudeInstall(platform: ClaudePlatform): string {
  // Official alternatives avoid evaluating a web page if the native installer
  // endpoint returns HTML. Prerequisites and availability are explained beside
  // the command; changing installers does not change service availability.
  // https://code.claude.com/docs/en/setup#install-with-npm
  if (platform === "macos") return "brew install --cask claude-code";
  if (platform === "windows") return "winget install Anthropic.ClaudeCode";
  return "npm install -g @anthropic-ai/claude-code";
}

const shellQuote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
const powershellQuote = (value: string) => "'" + value.replace(/'/g, "''") + "'";

// The quickstart's primary copy action is a shell command, not a settings file.
// Bash owns the hidden input on macOS and Linux. The outer invocation uses only
// POSIX quoting, so it also launches correctly when pasted into Zsh. Secrets are
// entered at the prompt and never appear in the copied command or shell history.
export function claudeCommand(origin: string, model: string, prompt: string, emptyKey: string): string {
  return `bash -c 'unset fells_key; IFS= read -r -s -p "$3" fells_key; printf "\\n"
[ -n "$fells_key" ] || { printf "%s\\n" "$4" >&2; exit 1; }
ANTHROPIC_BASE_URL="$1" ANTHROPIC_AUTH_TOKEN="$fells_key" claude --model "$2"' \\
  fells ${shellQuote(origin)} ${shellQuote(model)} \\
  ${shellQuote(prompt)} ${shellQuote(emptyKey)}`;
}

export function claudeTemporary(
  origin: string,
  model: string,
  platform: ClaudePlatform,
  prompt = "Fells API Key: ",
  emptyKey = "No key entered.",
): string {
  if (platform === "windows") {
    return `& {
  $fellsNames = @('ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN')
  $fellsPrevious = @{}
  foreach ($name in $fellsNames) {
    $fellsPrevious[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
  }
  $fellsKey = Read-Host ${powershellQuote(prompt)} -AsSecureString
  try {
    $fellsToken = [System.Net.NetworkCredential]::new('', $fellsKey).Password
    if ([string]::IsNullOrWhiteSpace($fellsToken)) { throw ${powershellQuote(emptyKey)} }
    $env:ANTHROPIC_BASE_URL = ${powershellQuote(origin)}
    $env:ANTHROPIC_AUTH_TOKEN = $fellsToken
    claude --model ${powershellQuote(model)}
  } finally {
    foreach ($name in $fellsNames) {
      [Environment]::SetEnvironmentVariable($name, $fellsPrevious[$name], 'Process')
    }
    if ($fellsKey) { $fellsKey.Dispose() }
    Remove-Variable fellsToken -ErrorAction SilentlyContinue
  }
}`;
  }
  const read = platform === "macos"
    ? `read -r -s ${shellQuote("FELLS_API_KEY?" + prompt)}`
    : `IFS= read -r -s -p ${shellQuote(prompt)} FELLS_API_KEY`;
  // A subshell confines the key and the gateway variables to this launch. Read
  // the credential from the terminal, never from a copied command/history item.
  return `(
  ${read}
  printf '\\n'
  if [ -n "$FELLS_API_KEY" ]; then
    ANTHROPIC_BASE_URL=${shellQuote(origin)} \\
    ANTHROPIC_AUTH_TOKEN="$FELLS_API_KEY" \\
    claude --model ${shellQuote(model)}
  else
    printf '%s\\n' ${shellQuote(emptyKey)}
  fi
)`;
}

// A parser is required so setup merges the existing user document instead of
// replacing hooks, permissions or unrelated environment values. The credential
// reaches this program through stdin; it is never part of a command argument.
const persistentSettingsProgram = String.raw`
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), crypto = require("node:crypto");
const [origin, model, saved, failed, invalid] = process.argv.slice(1);
const windows = process.platform === "win32";
let lockFd, lockPath, lockIdentity, temporary;
function privateFile(name, text) {
  const fd = fs.openSync(name, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
  try {
    if (windows) {
      const quoted = "'" + name.replace(/'/g, "''") + "'";
      const script = "$ErrorActionPreference='Stop';$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User;$acl=New-Object System.Security.AccessControl.FileSecurity;$acl.SetOwner($sid);$acl.SetAccessRuleProtection($true,$false);$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'FullControl','Allow')));Set-Acl -LiteralPath " + quoted + " -AclObject $acl";
      const result = require("node:child_process").spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: "ignore", windowsHide: true });
      if (result.status !== 0) throw new Error("private permissions unavailable");
    } else fs.fchmodSync(fd, 0o600);
    fs.writeFileSync(fd, text, "utf8"); fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
}
function readSettings(file) {
  let info;
  try { info = fs.lstatSync(file); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
  if (!info.isFile() || info.isSymbolicLink() || info.size > 4 * 1024 * 1024 || (!windows && info.uid !== process.getuid())) throw new Error("unsafe settings file");
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const opened = fs.fstatSync(fd);
    if (opened.ino !== info.ino || opened.dev !== info.dev) throw new Error("settings changed");
    return { text: fs.readFileSync(fd, "utf8"), ino: opened.ino, dev: opened.dev, mtime: opened.mtimeMs, size: opened.size };
  } finally { fs.closeSync(fd); }
}
try {
  const key = fs.readFileSync(0, "utf8").replace(/\r?\n$/, "");
  if (!/^sk-ap-[a-fA-F0-9]{48}$/.test(key)) { const error = new Error("invalid key"); error.invalid = true; throw error; }
  const directory = path.resolve(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"));
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const directoryInfo = fs.lstatSync(directory);
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || (!windows && (directoryInfo.uid !== process.getuid() || (directoryInfo.mode & 0o022)))) throw new Error("unsafe settings directory");
  const target = path.join(directory, "settings.json");
  lockPath = target + ".fells-setup.lock";
  lockFd = fs.openSync(lockPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
  lockIdentity = fs.fstatSync(lockFd);
  const original = readSettings(target);
  const current = original ? JSON.parse(original.text.replace(/^\uFEFF/, "")) : {};
  if (!current || typeof current !== "object" || Array.isArray(current) || (Object.hasOwn(current, "env") && (!current.env || typeof current.env !== "object" || Array.isArray(current.env)))) throw new Error("invalid settings document");
  const env = current.env || {};
  const enabled = value => /^(1|true)$/i.test(String(value || ""));
  if (["CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY"].some(name => enabled(env[name]) || enabled(process.env[name])) || current.forceLoginMethod || current.forceLoginGatewayUrl || current.forceLoginOrgUUID) throw new Error("another provider or policy is active");
  const next = { ...current, model, env: { ...env, ANTHROPIC_BASE_URL: origin, ANTHROPIC_AUTH_TOKEN: key } };
  const nonce = Date.now() + "-" + crypto.randomBytes(8).toString("hex");
  if (original) privateFile(target + ".fells-backup-" + nonce, original.text);
  temporary = path.join(directory, ".settings.json.fells-" + nonce + ".tmp");
  privateFile(temporary, JSON.stringify(next, null, 2) + "\n");
  const latest = readSettings(target);
  if ((original === null) !== (latest === null) || (original && ["text", "ino", "dev", "mtime", "size"].some(name => latest[name] !== original[name]))) throw new Error("settings changed during setup");
  fs.renameSync(temporary, target); temporary = undefined;
  process.stdout.write(saved + "\n");
} catch (error) {
  process.stderr.write((error.invalid ? invalid : failed) + "\n"); process.exitCode = 1;
} finally {
  if (temporary) { try { fs.unlinkSync(temporary); } catch {} }
  if (lockFd !== undefined) {
    try { fs.closeSync(lockFd); } catch {}
    try { const info = fs.lstatSync(lockPath); if (info.ino === lockIdentity.ino && info.dev === lockIdentity.dev) fs.unlinkSync(lockPath); } catch {}
  }
}
`.trim();

export function claudePersistent(
  origin: string,
  model: string,
  platform: ClaudePlatform,
  prompt = "Fells API Key: ",
  emptyKey = "No key entered.",
  savedMessage = "Saved. Next time, run claude.",
  missingRuntime = "Install Node.js, then run this setup command again.",
  saveFailure = "Setup could not finish. Check the existing settings, permissions and other active setup commands, then try again.",
  invalidKey = "Enter the complete Fells API key. A masked key or placeholder cannot be saved.",
): string {
  if (platform === "windows") {
    return `& {
  Set-PSDebug -Off
  $fellsNode = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $fellsNode) { Write-Error ${powershellQuote(missingRuntime)}; return }
  & $fellsNode.Source -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'
  if ($LASTEXITCODE -ne 0) { Write-Error ${powershellQuote(missingRuntime)}; return }
  $fellsKey = Read-Host ${powershellQuote(prompt)} -AsSecureString
  try {
    $fellsToken = [System.Net.NetworkCredential]::new('', $fellsKey).Password
    if ([string]::IsNullOrEmpty($fellsToken)) { Write-Error ${powershellQuote(emptyKey)}; return }
    $fellsToken | & $fellsNode.Source -e ${powershellQuote(persistentSettingsProgram)} -- ${powershellQuote(origin)} ${powershellQuote(model)} ${powershellQuote(savedMessage)} ${powershellQuote(saveFailure)} ${powershellQuote(invalidKey)}
  } finally {
    if ($fellsKey) { $fellsKey.Dispose() }
    Remove-Variable fellsToken -ErrorAction SilentlyContinue
  }
}`;
  }
  const program = `set +x
fells_node=$(type -P node)
[ -n "$fells_node" ] && "$fells_node" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' >/dev/null 2>&1 || { printf '%s\\n' "$6" >&2; exit 1; }
unset fells_key
IFS= read -r -s -p "$3" fells_key; printf '\\n'
[ -n "$fells_key" ] || { printf '%s\\n' "$4" >&2; exit 1; }
printf '%s' "$fells_key" | "$fells_node" -e ${shellQuote(persistentSettingsProgram)} -- "$1" "$2" "$5" "$7" "$8"
fells_status=$?; unset fells_key; exit "$fells_status"`;
  return `bash -c ${shellQuote(program)} \\
  fells ${shellQuote(origin)} ${shellQuote(model)} \\
  ${shellQuote(prompt)} ${shellQuote(emptyKey)} \\
  ${shellQuote(savedMessage)} ${shellQuote(missingRuntime)} \\
  ${shellQuote(saveFailure)} ${shellQuote(invalidKey)}`;
}
