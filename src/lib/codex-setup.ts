import type { ClaudePlatform } from "./claude-setup";

/** A secret-free custom-provider configuration for an eligible Responses model. */
export function codexConfig(base: string, model: string): string {
  if (!model.trim() || !model.isWellFormed() || !base.isWellFormed()) throw new Error("Invalid Codex configuration value");
  const toml = (value: string) => JSON.stringify(value).replace(/\u007f/g, "\\u007F");
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
const powershellQuote = (value: string) => "'" + value.replace(/'/g, "''") + "'";

// Official Codex CLI packages: https://developers.openai.com/codex/cli
export function codexInstall(platform: ClaudePlatform): string {
  return platform === "macos" ? "brew install --cask codex" : "npm install -g @openai/codex";
}

/**
 * The terminal asks for the key with hidden input and stores it as FELLS_API_KEY.
 * The copied command never contains a credential and the webpage never collects one.
 */
export function codexKeyCommand(platform: ClaudePlatform, prompt: string, emptyKey: string): string {
  if (platform === "windows") {
    // Read-Host adds its own ": " after the prompt.
    return `$k = Read-Host ${powershellQuote(prompt.replace(/[:：]\s*$/, ""))} -AsSecureString; $v = [Net.NetworkCredential]::new('', $k).Password; if ($v) { [Environment]::SetEnvironmentVariable('FELLS_API_KEY', $v, 'User') } else { Write-Host ${powershellQuote(emptyKey)} }`;
  }
  return `bash -c 'IFS= read -r -s -p "$1" k; printf "\\n"; if [ -n "$k" ]; then printf "export FELLS_API_KEY=%q\\n" "$k" >> "$2"; else printf "%s\\n" "$3" >&2; exit 1; fi' \\
  fells ${shellQuote(prompt)} ${platform === "macos" ? "~/.zshrc" : "~/.bashrc"} ${shellQuote(emptyKey)}`;
}

/** Creates the user config only when it does not exist; an existing file is never overwritten. */
export function codexWriteConfig(platform: ClaudePlatform, config: string, exists: string): string {
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
