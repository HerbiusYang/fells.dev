import type { ClaudePlatform } from "./claude-setup";
import { commandTextSafe } from "./command-text.ts";

/** A secret-free custom-provider configuration for an eligible Responses model. */
export function codexConfig(base: string, model: string): string {
  if (!model.trim() || !model.isWellFormed() || !base.isWellFormed()) throw new Error("Invalid Codex configuration value");
  // JSON escapes C0 controls. TOML basic strings also accept \uXXXX for DEL, C1,
  // Unicode line separators and bidirectional controls, so none stays raw.
  const toml = (value: string) => JSON.stringify(value).replace(/[\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, character => "\\u" + character.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0"));
  return [
    `model = ${toml(model)}`,
    'model_provider = "fells"',
    'service_tier = "default"',
    'web_search = "disabled"',
    '',
    '[model_providers.fells]',
    'name = "Fells"',
    `base_url = ${toml(base)}`,
    'env_key = "FELLS_API_KEY"',
    'wire_api = "responses"',
    'supports_websockets = false',
  ].join("\n");
}

const shellQuote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
// PowerShell also ends a single-quoted string at U+2018-U+201B. Doubling each
// of the five quote characters keeps it literal in Windows PowerShell and pwsh.
const powershellQuote = (value: string) => "'" + value.replace(/['\u2018\u2019\u201a\u201b]/g, "$&$&") + "'";
// A line starting with any PowerShell single quote followed by @ closes the
// here-string; a line reading FELLS_CODEX_CONFIG closes the shell heredoc.
const CONFIG_TERMINATOR = /^\s*(?:['\u2018\u2019\u201a\u201b]@|FELLS_CODEX_CONFIG\s*$)/m;

// Official Codex CLI packages: https://developers.openai.com/codex/cli
export function codexInstall(platform: ClaudePlatform): string {
  return platform === "macos" ? "brew install --cask codex" : "npm install -g @openai/codex";
}

/** Prompt in a child shell so the key only lives for this Codex invocation. */
export function codexKeyCommand(platform: ClaudePlatform, prompt: string, emptyKey: string): string {
  if (platform === "windows") {
    const script = [
      `$k = Read-Host ${powershellQuote(prompt.replace(/[:：]\s*$/, ""))} -AsSecureString`,
      `if (!$k.Length) { Write-Error ${powershellQuote(emptyKey)}; exit 1 }`,
      "$env:FELLS_API_KEY = [Net.NetworkCredential]::new('', $k).Password",
      "try { codex; exit $LASTEXITCODE } finally { Remove-Item Env:FELLS_API_KEY; $k.Dispose() }",
    ].join("; ");
    return `powershell.exe -NoProfile -Command ${powershellQuote(script)}`;
  }
  return `bash -c 'set +x; IFS= read -r -s -p "$1" k; printf "\\n"; if [ -z "$k" ]; then printf "%s\\n" "$2" >&2; exit 1; fi; FELLS_API_KEY="$k" exec codex' fells ${shellQuote(prompt)} ${shellQuote(emptyKey)}`;
}

/** Creates the user config only when it does not exist; an existing file is never overwritten. */
export function codexWriteConfig(platform: ClaudePlatform, config: string, exists: string): string {
  // The configuration is pasted verbatim between fixed delimiters. Refuse any
  // text that could end them early or carry hidden terminal controls.
  if (!config.isWellFormed() || /[\t\r]/.test(config) || !commandTextSafe(config) || CONFIG_TERMINATOR.test(config)) throw new Error("Invalid Codex configuration value");
  if (platform === "windows") {
    return [
      `$p = Join-Path $HOME '.codex\\config.toml'`,
      `if (Test-Path $p) { Write-Host ${powershellQuote(exists)} } else {`,
      `  New-Item -ItemType Directory -Force (Split-Path $p) | Out-Null`,
      `  [IO.File]::WriteAllText($p, @'`,
      config,
      `'@)`,
      `}`,
    ].join("\n");
  }
  return [
    `if [ -e ~/.codex/config.toml ]; then printf '%s\\n' ${shellQuote(exists)}; else mkdir -p ~/.codex && cat > ~/.codex/config.toml <<'FELLS_CODEX_CONFIG'`,
    config,
    "FELLS_CODEX_CONFIG",
    "fi",
  ].join("\n");
}
