/** A secret-free custom-provider configuration for an eligible Responses model. */
export function codexConfig(base: string, model: string): string {
  if (!model.trim() || !model.isWellFormed() || !base.isWellFormed()) throw new Error("Invalid Codex configuration value");
  const toml = (value: string) => JSON.stringify(value).replace(/\u007f/g, "\\u007F");
  return [
    `model = ${toml(model)}`,
    'model_provider = "fells"',
    '',
    '[model_providers.fells]',
    'name = "Fells"',
    `base_url = ${toml(base)}`,
    'env_key = "FELLS_API_KEY"',
    'wire_api = "responses"',
    'supports_websockets = false',
  ].join("\n");
}
