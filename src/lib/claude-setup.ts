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
