import { workBuddyWordsOf } from "../i18n/workbuddy-guide";

const WORKBUDDY_DOCUMENTATION = "https://www.codebuddy.ai/docs/zh/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Model";
const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

// WorkBuddy's standard custom API uses Chat Completions, not Responses or
// native Claude Code OAuth. Require the selected key's explicit API projection.
function compatibleModels(catalog: unknown): string[] {
  if (!catalog || typeof catalog !== "object" || !Array.isArray((catalog as { models?: unknown }).models)) return [];
  const models = (catalog as { models: unknown[] }).models;
  return [...new Set(models.flatMap(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const model = value as Record<string, unknown>;
    const clients = model.client_formats as { api?: unknown } | undefined;
    return model.offered === true && model.routable === true
      && typeof model.model === "string" && model.model.trim() && model.model.length <= 512
      && Array.isArray(model.formats) && model.formats.includes("openai-completions")
      && clients && Array.isArray(clients.api) && clients.api.includes("openai-completions")
      ? [model.model] : [];
  }))];
}

export function workBuddyGuideBody(input: { language: string; state: "loading" | "no-key" | "ready" | "error"; origin: string; catalog?: unknown }): string {
  const words = workBuddyWordsOf(input.language);
  const models = input.state === "ready" ? compatibleModels(input.catalog) : [];
  const base = input.origin.replace(/\/$/, "") + "/v1";
  const status = input.state === "loading" ? words.loading : input.state === "no-key" ? words.noKey : input.state === "error" ? words.error : words.empty;
  const body = models.length
    ? `<ol class="workbuddy-steps"><li>${escape(words.setup)}</li><li><dl class="workbuddy-fields"><div><dt>${escape(words.base)}</dt><dd><code data-workbuddy-base>${escape(base)}</code><button type="button" class="btn sm" data-act="copy" data-text="${escape(base)}">${escape(words.copy)}</button></dd></div><div><dt>${escape(words.key)}</dt><dd>${escape(words.keyValue)}</dd></div><div><dt><label for="workbuddy-model">${escape(words.model)}</label></dt><dd><select id="workbuddy-model" data-workbuddy-model>${models.map(model => `<option value="${escape(model)}">${escape(model)}</option>`).join("")}</select></dd></div></dl></li><li>${escape(words.save)}</li></ol><p class="hint">${escape(words.capabilities)}</p><p class="hint">${escape(words.billing)}</p>`
    : `<p role="status" data-workbuddy-state="${input.state}">${escape(status)}</p>${input.state === "loading" ? "" : `<p class="hint">${escape(words.requires)}</p>`}`;
  return `${body}<div class="workbuddy-links"><button type="button" class="btn" data-act="workbuddy-keys">${escape(words.keys)}</button><a href="${WORKBUDDY_DOCUMENTATION}" target="_blank" rel="noopener noreferrer">${escape(words.docs)} ↗</a></div>`;
}
