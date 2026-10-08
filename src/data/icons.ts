// One source for every AI / vendor / tool icon on the site and in /app.
// Vendor marks come from brand-icons.ts; Fells' own things use plain stroke glyphs, never a lookalike logo.
import { brandIcons } from "./brand-icons";

const stroke = (d: string) =>
  `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;

// Fells-own glyphs.
const own = {
  lite: stroke("M13 3 5 14h6l-1 7 8-11h-6z"),
  media: stroke("M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01"),
  fells: stroke("M6 20V4h12M6 12h9"),
  widgets: stroke("M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z"),
  schedules: stroke("M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2"),
  sites: stroke("M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18"),
  docs: stroke("M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21V5M8 7h7"),
  search: stroke("M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4"),
  scrape: stroke("M8 8l-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"),
  chat: stroke("M4 5h16v11H9l-5 4z"),
  lock: stroke("M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3"),
  pen: stroke("M4 20l4-1 11-11-3-3L5 16zM14 6l3 3"),
  shapes: stroke("M4 4h7v7H4zM17.5 4a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM4 20l3.5-6 3.5 6zM14 14h6v6h-6z"),
  chart: stroke("M4 20V10M10 20V4M16 20v-7M22 20H2"),
};

export type Mark = { svg: string; hue: string };
// "var(--text)" = neutral mark (follows the light/dark theme).
const N = "var(--text)";
const m = (svg: string, hue: string): Mark => ({ svg, hue });

export const agentMarks: Record<string, Mark> = {
  codex: m(brandIcons.codex, "#6e7bff"),
  claude: m(brandIcons.claudecode, "#d97757"),
  grok: m(brandIcons.grok, N),
  opencode: m(brandIcons.opencode, N),
  kimi: m(brandIcons.kimi, "#1f7aff"),
  lite: m(own.lite, "#1fa37a"),
  media: m(own.media, "#8b7cf6"),
};

export const providerMarks: Record<string, Mark> = {
  Anthropic: m(brandIcons.anthropic, "#d97757"),
  OpenAI: m(brandIcons.openai, N),
  Google: m(brandIcons.gemini, "#4285f4"),
  xAI: m(brandIcons.xai, N),
  DeepSeek: m(brandIcons.deepseek, "#4d6bfe"),
  Moonshot: m(brandIcons.moonshot, N),
  Zhipu: m(brandIcons.zhipu, "#3859ff"),
  MiniMax: m(brandIcons.minimax, "#f23f5d"),
  Fells: m(own.fells, "#e07a55"),
};

// Image models → maker mark.
export const imageModelMarks: Record<string, Mark> = {
  "GPT Image 2.5": providerMarks.OpenAI,
  "Gemini 4 Argon Image": providerMarks.Google,
  "Grok Imagine 2": providerMarks.xAI,
};

export const channelMarks: Record<string, Mark> = {
  "claude-dedicated": agentMarks.claude,
  "codex-dedicated": agentMarks.codex,
  official: providerMarks.Fells,
  glm: providerMarks.Zhipu,
  fireworks: m(brandIcons.fireworks, "#6720ff"),
  together: m(brandIcons.together, "#0f6fff"),
  deepinfra: m(brandIcons.deepinfra, "#5b8def"),
  baseten: m(brandIcons.baseten, N),
  bedrock: m(brandIcons.bedrock, "#ff9900"),
  azure: m(brandIcons.azure, "#0078d4"),
  vertex: m(brandIcons.vertexai, "#4285f4"),
  novita: m(brandIcons.novita, N),
};

export const pluginMarks: Record<string, Mark> = {
  widgets: m(own.widgets, "#e07a55"),
  schedules: m(own.schedules, "#e07a55"),
  sites: m(own.sites, "#e07a55"),
  image: m(own.media, "#8b7cf6"),
  github: m(brandIcons.github, N),
  docs: m(own.docs, "#0f9d58"),
  search: m(own.search, "#2f6fed"),
  scrape: m(own.scrape, "#3a7bd5"),
  notion: m(brandIcons.notion, N),
  lark: m(own.chat, "#3370ff"),
  sheets: m(brandIcons.googlesheets, "#188038"),
  slides: m(brandIcons.googleslides, "#f4b400"),
  postgres: m(brandIcons.postgresql, "#336791"),
  duckdb: m(brandIcons.duckdb, "#d9a400"),
  stripe: m(brandIcons.stripe, "#635bff"),
  auth: m(own.lock, "#eb5424"),
  expo: m(brandIcons.expo, N),
  design: m(own.pen, "#d97757"),
  diagrams: m(own.shapes, "#6965db"),
  analytics: m(own.chart, "#f46800"),
};
