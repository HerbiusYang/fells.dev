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
