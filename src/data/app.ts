// Data for the /app prototype. Models and prices come from catalog.ts so the app,
// the marketplace and the pricing section never disagree.
import { models, products, channels } from "./catalog";

type AgentId = "codex" | "claude" | "grok" | "opencode" | "kimi" | "lite" | "media";

export type Agent = {
  id: AgentId;
  name: string;
  maker: string;
  hue: string;
  glyph: string;
  // 1–5 meters; null hides the meter (Media generation has no agent).
  capability: number | null;
  value: number | null;
  openness: number | null;
  // Default model and the providers this agent can call.
  model: string;
  providers: string[];
};

export const agents: Agent[] = [
  { id: "codex", name: "Codex", maker: "OpenAI", hue: "#7c8cff", glyph: "◎", capability: 4, value: 5, openness: 3, model: "GPT-6.1 Sol", providers: ["OpenAI", "Google", "xAI", "DeepSeek", "Zhipu"] },
  { id: "claude", name: "Claude Code", maker: "Anthropic", hue: "#e07a55", glyph: "✳", capability: 5, value: 2, openness: 2, model: "Claude Opus 5.5", providers: ["Anthropic", "OpenAI", "Google", "xAI", "DeepSeek", "Moonshot", "Zhipu", "MiniMax"] },
  { id: "grok", name: "Grok Build", maker: "xAI", hue: "#9aa1ad", glyph: "⌁", capability: 3, value: 3, openness: 4, model: "Grok 4.7", providers: ["xAI", "Anthropic", "OpenAI", "Google", "DeepSeek", "Moonshot", "Zhipu", "MiniMax"] },
  { id: "opencode", name: "OpenCode", maker: "Open source", hue: "#5f6b7a", glyph: "▢", capability: 3, value: 4, openness: 5, model: "Claude Sonnet 5.5", providers: ["Anthropic", "OpenAI", "Google", "xAI", "DeepSeek", "Moonshot", "Zhipu", "MiniMax"] },
  { id: "kimi", name: "Kimi Code", maker: "Moonshot", hue: "#4f8de0", glyph: "K", capability: 3, value: 4, openness: 4, model: "Kimi K3", providers: ["Moonshot", "DeepSeek", "Zhipu", "MiniMax"] },
  { id: "lite", name: "Lite", maker: "Fells", hue: "#e07a55", glyph: "◇", capability: 3, value: 5, openness: 5, model: "Claude Sonnet 5.5", providers: ["Anthropic", "OpenAI", "Google", "xAI", "DeepSeek", "Moonshot", "Zhipu", "MiniMax"] },
  { id: "media", name: "Media", maker: "Fells", hue: "#a8a4ff", glyph: "✦", capability: null, value: null, openness: null, model: "GPT Image 2.5", providers: [] },
];

export const imageModels = ["GPT Image 2.5", "Gemini 4 Argon Image", "Grok Imagine 2"];

export const appModels = models.map((m) => ({ name: m.name, provider: m.provider, input: m.input, output: m.output, tag: m.tag ?? "" }));

// Plans that cover a model (allowance first, then pay-as-you-go).
export const planCovers: Record<string, string> = { "GPT-6.1 Sol": "Codex", "Claude Opus 5.5": "Claude Code", "Claude Sonnet 5.5": "Claude Code" };

// Credit subscription tiers mirror the Codex plan tiers (credits/month = price).
export const creditTiers = products[1].tiers.map((x) => ({ mult: x.mult, monthly: x.monthly, apiValue: x.apiValue, badge: x.badge ?? "" }));
export const signupBonus = 1;

export const appChannels = channels.map((c) => ({ id: c.id, kind: c.kind, name: c.name, style: c.style ?? "", hue: c.hue, models: c.models, total: c.total, from: c.from, badge: c.badge ?? "", metrics: c.metrics }));
