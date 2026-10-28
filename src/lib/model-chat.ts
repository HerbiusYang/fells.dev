const TEXT_MODEL_FORMATS = ["anthropic-messages", "openai-completions", "openai-responses", "gemini-generatecontent"] as const;
type TextModelFormat = typeof TEXT_MODEL_FORMATS[number];
export interface ChatModel { model: string; label: string; formats: TextModelFormat[]; format: TextModelFormat; web_search?: boolean; attachments?: boolean; vision?: boolean; documents?: boolean }
const CHAT_DIAGNOSES = ["available", "no_visible_models", "pricing_unavailable", "model_restricted", "claude_code_only", "browser_provider_unsupported", "no_compatible_routes"] as const;
const CHAT_COUNTS = ["visible_models", "priced_models", "permitted_models", "web_models", "claude_code_only_models", "unsupported_provider_models", "no_route_models"] as const;
interface ChatModelDiagnostics { reason: typeof CHAT_DIAGNOSES[number]; counts: Record<typeof CHAT_COUNTS[number], number> }
export interface ChatModelCatalog { models: ChatModel[]; capability: "model_chat"; key_id?: number; billing_mode?: "account_allowance"; diagnostics?: ChatModelDiagnostics; web_search?: { available: boolean; provider: string; reason: string } }

export function modelFormat(value: unknown, allowed: readonly string[] = TEXT_MODEL_FORMATS, client?: "api" | "claude_code"): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  let advertised: unknown[] | undefined = v.formats === undefined ? undefined : Array.isArray(v.formats) ? v.formats : [];
  if (client && v.client_formats !== undefined) {
    const clients = v.client_formats;
    const clientFormats = clients && typeof clients === "object" && !Array.isArray(clients) ? (clients as Record<string, unknown>)[client] : undefined;
    const wireFormats = advertised;
    advertised = Array.isArray(clientFormats) ? clientFormats.filter(format => wireFormats === undefined || wireFormats.includes(format)) : [];
  }
  for (const candidate of [v.format, v.example_format, ...(advertised ?? [])]) {
    if (typeof candidate === "string" && allowed.includes(candidate) && (advertised === undefined || advertised.includes(candidate))) return candidate;
  }
  return undefined;
}

export function parseChatModels(value: unknown, expectedKey?: number): ChatModelCatalog {
  const v = value as Record<string, unknown> | null;
  const validScope = expectedKey === undefined
    ? v?.billing_mode === "account_allowance" && (v.key_id === undefined || v.key_id === 0)
    : Number.isSafeInteger(expectedKey) && expectedKey > 0 && v?.key_id === expectedKey;
  if (!v || typeof v !== "object" || !validScope || v.capability !== "model_chat" || !Array.isArray(v.models) || v.models.length > 5000) throw new Error("Invalid model conversation catalog");
  const seen = new Set<string>();
  const models = v.models.map(raw => {
    const m = raw as Record<string, unknown> | null;
    if (!m || typeof m.model !== "string" || !m.model.trim() || m.model.length > 200 || /[\u0000-\u001f\u007f]/.test(m.model) || seen.has(m.model) || !Array.isArray(m.formats) || !m.formats.every(f => typeof f === "string")) throw new Error("Invalid conversation model");
    const format = modelFormat(m);
    if (!format || typeof m.format !== "string" || !m.formats.includes(m.format) || !TEXT_MODEL_FORMATS.includes(m.format as TextModelFormat)) throw new Error("Unsupported conversation model format");
    if (m.label !== undefined && (typeof m.label !== "string" || m.label.length > 500)) throw new Error("Invalid conversation model label");
    if (m.web_search !== undefined && typeof m.web_search !== "boolean") throw new Error("Invalid model web search availability");
    for (const key of ["attachments", "vision", "documents"] as const) if (m[key] !== undefined && typeof m[key] !== "boolean") throw new Error("Invalid model attachment availability");
    seen.add(m.model);
    return { model: m.model, label: typeof m.label === "string" && m.label ? m.label : m.model,
      formats: m.formats.filter(f => TEXT_MODEL_FORMATS.includes(f as TextModelFormat)) as TextModelFormat[], format: m.format as TextModelFormat, ...(m.web_search === undefined ? {} : { web_search: m.web_search }),
      ...(m.attachments === undefined ? {} : { attachments: m.attachments }), ...(m.vision === undefined ? {} : { vision: m.vision }), ...(m.documents === undefined ? {} : { documents: m.documents }) };
  });
  let diagnostics: ChatModelDiagnostics | undefined;
  if (v.diagnostics !== undefined) {
    const d = v.diagnostics as Record<string, unknown> | null;
    const counts = d?.counts as Record<string, unknown> | null;
    if (!d || typeof d !== "object" || !CHAT_DIAGNOSES.includes(d.reason as ChatModelDiagnostics["reason"]) || !counts || typeof counts !== "object" || CHAT_COUNTS.some(key => !Number.isSafeInteger(counts[key]) || Number(counts[key]) < 0) || counts.web_models !== models.length || (d.reason === "available") !== (models.length > 0)) throw new Error("Invalid conversation availability diagnosis");
    diagnostics = { reason: d.reason as ChatModelDiagnostics["reason"], counts: Object.fromEntries(CHAT_COUNTS.map(key => [key, counts[key]])) as ChatModelDiagnostics["counts"] };
  }
  let webSearch: ChatModelCatalog["web_search"];
  if (v.web_search !== undefined) {
    const web = v.web_search as Record<string, unknown> | null;
    if (!web || typeof web !== "object" || typeof web.available !== "boolean" || typeof web.provider !== "string" || !web.provider.trim() || web.provider.length > 80 || typeof web.reason !== "string" || !web.reason.trim() || web.reason.length > 160 || /[\u0000-\u001f\u007f]/.test(web.provider + web.reason)) throw new Error("Invalid web search availability");
    webSearch = { available: web.available, provider: web.provider, reason: web.reason };
  }
  return { ...(expectedKey === undefined ? { models, billing_mode: "account_allowance" as const, capability: "model_chat" as const } : { models, key_id: expectedKey, capability: "model_chat" as const }), ...(diagnostics ? { diagnostics } : {}), ...(webSearch ? { web_search: webSearch } : {}) };
}

export function conversationKey(key: { kind?: unknown; revoked?: unknown; expires_at?: unknown; id?: unknown }, now = Date.now() / 1000): boolean {
  return key.kind === "user" && key.revoked === false && typeof key.id === "number" && Number.isSafeInteger(key.id) && key.id > 0
    && typeof key.expires_at === "number" && Number.isSafeInteger(key.expires_at) && (key.expires_at === 0 || key.expires_at > now);
}
