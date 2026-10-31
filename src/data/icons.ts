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
  lock: stroke("M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3"),
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

