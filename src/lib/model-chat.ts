export const TEXT_MODEL_FORMATS = ["anthropic-messages", "openai-completions", "openai-responses", "gemini-generatecontent"] as const;
export type TextModelFormat = typeof TEXT_MODEL_FORMATS[number];
export interface ChatModel { model: string; label: string; formats: TextModelFormat[]; format: TextModelFormat }
export interface ChatModelCatalog { models: ChatModel[]; capability: "model_chat"; key_id: number }

export function modelFormat(value: unknown, allowed: readonly string[] = TEXT_MODEL_FORMATS): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  const advertised = v.formats === undefined ? undefined : Array.isArray(v.formats) ? v.formats : [];
  for (const candidate of [v.format, v.example_format, ...(advertised ?? [])]) {
    if (typeof candidate === "string" && allowed.includes(candidate) && (advertised === undefined || advertised.includes(candidate))) return candidate;
  }
  return undefined;
}

export function parseChatModels(value: unknown, expectedKey: number): ChatModelCatalog {
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v !== "object" || !Number.isSafeInteger(expectedKey) || expectedKey <= 0 || v.capability !== "model_chat" || v.key_id !== expectedKey || !Array.isArray(v.models) || v.models.length > 5000) throw new Error("Invalid model conversation catalog");
  const seen = new Set<string>();
  const models = v.models.map(raw => {
    const m = raw as Record<string, unknown> | null;
    if (!m || typeof m.model !== "string" || !m.model.trim() || m.model.length > 200 || /[\u0000-\u001f\u007f]/.test(m.model) || seen.has(m.model) || !Array.isArray(m.formats) || !m.formats.every(f => typeof f === "string")) throw new Error("Invalid conversation model");
    const format = modelFormat(m);
    if (!format || typeof m.format !== "string" || !m.formats.includes(m.format) || !TEXT_MODEL_FORMATS.includes(m.format as TextModelFormat)) throw new Error("Unsupported conversation model format");
    if (m.label !== undefined && (typeof m.label !== "string" || m.label.length > 500)) throw new Error("Invalid conversation model label");
    seen.add(m.model);
    return { model: m.model, label: typeof m.label === "string" && m.label ? m.label : m.model,
      formats: m.formats.filter(f => TEXT_MODEL_FORMATS.includes(f as TextModelFormat)) as TextModelFormat[], format: m.format as TextModelFormat };
  });
  return { models, key_id: expectedKey, capability: "model_chat" };
}

export function conversationKey(key: { kind?: unknown; revoked?: unknown; expires_at?: unknown; id?: unknown }, now = Date.now() / 1000): boolean {
  return key.kind === "user" && key.revoked === false && typeof key.id === "number" && Number.isSafeInteger(key.id) && key.id > 0
    && typeof key.expires_at === "number" && Number.isSafeInteger(key.expires_at) && (key.expires_at === 0 || key.expires_at > now);
}
