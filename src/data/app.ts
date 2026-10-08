// Data for the /app prototype. Models and prices come from catalog.ts so the app,
// the marketplace and the pricing section never disagree.
import { models, channels } from "./catalog";

type AgentId = "codex" | "claude" | "grok" | "opencode" | "kimi" | "lite" | "media";

export type Agent = {
  id: AgentId;
  name: string;
  maker: string;
  hue: string;
  // 1–5 meters; null hides the meter (Media generation has no agent).
  capability: number | null;
  value: number | null;
  openness: number | null;
  // Default model and the providers this agent can call.
  model: string;
  providers: string[];
};

export const agents: Agent[] = [
  { id: "codex", name: "Codex", maker: "OpenAI", hue: "#7c8cff", capability: 4, value: 5, openness: 3, model: "GPT-6.1 Sol", providers: ["OpenAI", "Google", "xAI", "DeepSeek", "Zhipu"] },
  { id: "claude", name: "Claude Code", maker: "Anthropic", hue: "#e07a55", capability: 5, value: 2, openness: 2, model: "Claude Opus 5.5", providers: ["Anthropic", "OpenAI", "Google", "xAI", "DeepSeek", "Moonshot", "Zhipu", "MiniMax"] },
  { id: "grok", name: "Grok Build", maker: "xAI", hue: "#9aa1ad", capability: 3, value: 3, openness: 4, model: "Grok 4.7", providers: ["xAI", "Anthropic", "OpenAI", "Google", "DeepSeek", "Moonshot", "Zhipu", "MiniMax"] },
  { id: "opencode", name: "OpenCode", maker: "Open source", hue: "#5f6b7a", capability: 3, value: 4, openness: 5, model: "Claude Sonnet 5.5", providers: ["Anthropic", "OpenAI", "Google", "xAI", "DeepSeek", "Moonshot", "Zhipu", "MiniMax"] },
  { id: "kimi", name: "Kimi Code", maker: "Moonshot", hue: "#4f8de0", capability: 3, value: 4, openness: 4, model: "Kimi K3", providers: ["Moonshot", "DeepSeek", "Zhipu", "MiniMax"] },
  { id: "lite", name: "Lite", maker: "Fells", hue: "#e07a55", capability: 3, value: 5, openness: 5, model: "Claude Sonnet 5.5", providers: ["Anthropic", "OpenAI", "Google", "xAI", "DeepSeek", "Moonshot", "Zhipu", "MiniMax"] },
  { id: "media", name: "Media", maker: "Fells", hue: "#a8a4ff", capability: null, value: null, openness: null, model: "GPT Image 2.5", providers: [] },
];

export const imageModels = ["GPT Image 2.5", "Gemini 4 Argon Image", "Grok Imagine 2"];

export const appModels = models.map((m) => ({ name: m.name, provider: m.provider, input: m.input, output: m.output, tag: m.tag ?? "" }));

// Plans that cover a model (allowance first, then pay-as-you-go).
export const planCovers: Record<string, string> = { "GPT-6.1 Sol": "Codex", "Claude Opus 5.5": "Claude Code", "Claude Sonnet 5.5": "Claude Code" };

export const regions = ["us-west", "us-east", "eu-west", "eu-east", "ap"] as const;

export type Plugin = { id: string; name: string; by: string; cat: number; skills: number; mcp: number; hue: string; builtin?: boolean };
// cat indexes app.plugins.cats (after "All").
export const plugins: Plugin[] = [
  { id: "widgets", name: "Widgets", by: "Fells", cat: 3, skills: 3, mcp: 0, hue: "#1f2329", builtin: true },
  { id: "schedules", name: "Scheduled tasks", by: "Fells", cat: 3, skills: 2, mcp: 0, hue: "#1f2329", builtin: true },
  { id: "sites", name: "Site builder", by: "Fells", cat: 2, skills: 4, mcp: 0, hue: "#e07a55", builtin: true },
  { id: "image", name: "Image studio", by: "Fells", cat: 4, skills: 3, mcp: 0, hue: "#a8a4ff", builtin: true },
  { id: "github", name: "GitHub", by: "Community", cat: 2, skills: 6, mcp: 1, hue: "#24292f" },
  { id: "docs", name: "Live docs", by: "Community", cat: 0, skills: 1, mcp: 1, hue: "#0f9d58" },
  { id: "search", name: "Web search", by: "Community", cat: 0, skills: 2, mcp: 1, hue: "#2f6fed" },
  { id: "scrape", name: "Web data", by: "Community", cat: 0, skills: 8, mcp: 0, hue: "#3a7bd5" },
  { id: "notion", name: "Notion", by: "Community", cat: 1, skills: 4, mcp: 1, hue: "#111111" },
  { id: "lark", name: "Lark / Feishu", by: "Community", cat: 1, skills: 6, mcp: 1, hue: "#3370ff" },
  { id: "sheets", name: "Spreadsheets", by: "Community", cat: 1, skills: 5, mcp: 0, hue: "#188038" },
  { id: "slides", name: "Slides", by: "Community", cat: 1, skills: 3, mcp: 0, hue: "#f4b400" },
  { id: "postgres", name: "Postgres", by: "Community", cat: 3, skills: 7, mcp: 1, hue: "#336791" },
  { id: "duckdb", name: "DuckDB", by: "Community", cat: 3, skills: 9, mcp: 0, hue: "#f2c300" },
  { id: "stripe", name: "Payments", by: "Community", cat: 2, skills: 5, mcp: 1, hue: "#635bff" },
  { id: "auth", name: "Auth & SSO", by: "Community", cat: 2, skills: 2, mcp: 0, hue: "#eb5424" },
  { id: "expo", name: "Mobile apps", by: "Community", cat: 2, skills: 11, mcp: 0, hue: "#000020" },
  { id: "design", name: "Frontend design", by: "Community", cat: 4, skills: 1, mcp: 0, hue: "#d97757" },
  { id: "diagrams", name: "Diagrams", by: "Community", cat: 4, skills: 0, mcp: 1, hue: "#6965db" },
  { id: "analytics", name: "Analytics", by: "Community", cat: 3, skills: 4, mcp: 1, hue: "#f46800" },
];

// Local preview credit subscriptions: USD per month and estimated API allowance.
export const creditTiers = [
  { mult: "1×", monthly: 10, apiValue: 241, badge: "" },
  { mult: "2×", monthly: 20, apiValue: 482, badge: "" },
  { mult: "5×", monthly: 50, apiValue: 1043, badge: "popular" },
  { mult: "20×", monthly: 200, apiValue: 3954, badge: "limited" },
];
export const topups = [10, 25, 50, 100];
// Dedicated plan choices in the local preview use the same USD tiers.
export const dedicatedPlans = (["claude", "codex"] as const).map(id => ({
  id,
  tiers: creditTiers.map(({ mult, monthly }) => ({ mult, monthly })),
}));
export const signupBonus = 1;

export const appChannels = channels.map((c) => ({ id: c.id, kind: c.kind, name: c.name, style: c.style ?? "", hue: c.hue, models: c.models, total: c.total, from: c.from, badge: c.badge ?? "", metrics: c.metrics }));
