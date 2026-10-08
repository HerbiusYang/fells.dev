// Plans and model prices shown on the site.

// ---- Launch products: Claude Token Plan and group buy (拼团). Prices are CNY. ----

// CNY per USD, used for every "official price" comparison on the site.
export const FX = 7;

// Token Plan: quota is USD of usage at official API list prices. `quota` is guaranteed every month;
// `burst` is the most a month can reach when spare capacity is available.
export type TokenPlan = {
  id: "trial" | "1500" | "3500";
  price: number; // CNY
  period: "once" | "month";
  quota: number;
  burst?: number;
  badge?: "newUser" | "best";
};

export const tokenPlans: TokenPlan[] = [
  { id: "trial", price: 99, period: "once", quota: 100, badge: "newUser" },
  { id: "1500", price: 2088, period: "month", quota: 1500, burst: 4000 },
  { id: "3500", price: 3788, period: "month", quota: 3500, burst: 8000, badge: "best" },
];
// TODO(launch): confirm how long the trial quota stays valid.
export const trialDays = 30;

// Group buy: one official Claude Max 20× subscription sold as shares. A seat of N× gets N/20 of every
// 5-hour window and of the weekly limit. `officialUsd` is what the same allowance costs from Anthropic
// (Claude Pro is $20 per 1×, Max 5× is $100).
export const groupBase = { plan: "Claude Max 20×", units: 20 };
export type GroupSeat = { id: string; units: number; price: number; officialUsd: number; badge?: "popular" };
// TODO(pricing): seat sizes and prices are placeholders. While this is true the cards show an "example price" tag.
export const groupPricePending = true;
export const groupSeats: GroupSeat[] = [
  { id: "g2", units: 2, price: 168, officialUsd: 40 },
  { id: "g5", units: 5, price: 398, officialUsd: 100, badge: "popular" },
  { id: "g10", units: 10, price: 788, officialUsd: 200 },
];

export const officialCny = (usd: number) => usd * FX;
// CNY paid per USD of guaranteed quota, e.g. 1.08.
export const cnyPerUsd = (price: number, usd: number) => Math.round((price / usd) * 100) / 100;
export const cny = (n: number) => `¥${n.toLocaleString("en-US")}`;
export const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
// Simplest fraction of the Max 20× subscription a seat stands for: 5 → "1/4".
export const seatShare = (units: number) => {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const g = gcd(units, groupBase.units);
  return `${units / g}/${groupBase.units / g}`;
};

export type ModelPrice = {
  name: string;
  provider: "Anthropic" | "OpenAI" | "DeepSeek" | "Moonshot" | "Zhipu" | "MiniMax" | "xAI" | "Google";
  input: number; // ours, USD / 1M tokens
  output: number;
  refInput: number; // public list price
  refOutput: number;
  tag?: "new" | "long";
};

export const models: ModelPrice[] = [
  { name: "Claude Opus 5.5", provider: "Anthropic", input: 2, output: 10, refInput: 4, refOutput: 20, tag: "new" },
  { name: "Claude Sonnet 5.5", provider: "Anthropic", input: 1, output: 5, refInput: 2, refOutput: 10 },
  { name: "Claude Fable 5.1", provider: "Anthropic", input: 5, output: 25, refInput: 10, refOutput: 50 },
  { name: "Claude Haiku 4.5", provider: "Anthropic", input: 0.5, output: 2.5, refInput: 1, refOutput: 5 },
  { name: "GPT-6.1 Sol", provider: "OpenAI", input: 1, output: 5, refInput: 2, refOutput: 10, tag: "long" },
  // TODO(launch): Gemini 4 Argon price is a placeholder — replace with the real list price.
  { name: "Gemini 4 Argon", provider: "Google", input: 1, output: 5, refInput: 2, refOutput: 10, tag: "new" },
  { name: "Grok 4.7", provider: "xAI", input: 0.5, output: 1.5, refInput: 2, refOutput: 6, tag: "long" },
  { name: "DeepSeek V4 Pro", provider: "DeepSeek", input: 1.32, output: 3.96, refInput: 1.32, refOutput: 3.96 },
  { name: "DeepSeek V4 Flash", provider: "DeepSeek", input: 0.04, output: 0.08, refInput: 0.04, refOutput: 0.08 },
  { name: "Kimi K3", provider: "Moonshot", input: 2.1, output: 10.95, refInput: 2.1, refOutput: 10.95 },
  { name: "GLM 5.2", provider: "Zhipu", input: 1.4, output: 4.4, refInput: 1.4, refOutput: 4.4 },
  { name: "GLM 5.3 Flash", provider: "Zhipu", input: 0.09, output: 0.3, refInput: 0.09, refOutput: 0.3 },
  { name: "MiniMax M3", provider: "MiniMax", input: 0.3, output: 1.2, refInput: 0.3, refOutput: 1.2 },
];

export const marketStats = { models: 102, channels: 14 };

export const offPct = (price: number, ref: number) => Math.round((1 - price / ref) * 100);

// Marketplace channels (/market). Starting prices mirror the agent.space template (Oct 2026).
// Metric levels: 1 low · 2 good · 3 high · 4 great. Computed from price/latency data, not hand-scored.
// TODO(launch): replace with Fells' own channel list and measured metrics.
export type Level = 1 | 2 | 3 | 4;
export type Channel = {
  id: string;
  kind: "sub" | "payg";
  name?: string; // provider channels; Fells' own channels take their name from the page copy
  style?: "provider" | "direct";
  hue: string;
  models: string[]; // shown as chips, first 1–2 then "+N more"
  total: number; // number of models served
  from: number; // USD per month (sub) or per 1M input tokens (payg)
  badge?: "recommended" | "default";
  metrics: { value: Level; privacy: Level; capability: Level; speed: Level };
};

export const channels: Channel[] = [
  { id: "claude-dedicated", kind: "sub", hue: "#e07a55", models: ["Claude Opus 5.5", "Claude Sonnet 5.5"], total: 4, from: 10, badge: "recommended", metrics: { value: 4, privacy: 3, capability: 4, speed: 3 } },
  { id: "codex-dedicated", kind: "sub", hue: "#7c8cff", models: ["GPT-6.1 Sol"], total: 10, from: 10, badge: "recommended", metrics: { value: 4, privacy: 3, capability: 4, speed: 3 } },
  { id: "official", kind: "payg", hue: "#f3a37f", models: ["Claude Opus 5.5", "GPT-6.1 Sol", "Gemini 4 Argon"], total: 18, from: 0.04, badge: "default", metrics: { value: 4, privacy: 3, capability: 4, speed: 3 } },
  { id: "glm", kind: "payg", name: "GLM Direct", style: "direct", hue: "#86d6ad", models: ["GLM 5.2"], total: 2, from: 0.09, metrics: { value: 1, privacy: 3, capability: 3, speed: 2 } },
  { id: "fireworks", kind: "payg", name: "Fireworks", style: "provider", hue: "#ff8a5b", models: ["Kimi K3"], total: 4, from: 0.242, metrics: { value: 1, privacy: 3, capability: 3, speed: 4 } },
  { id: "together", kind: "payg", name: "Together", style: "provider", hue: "#7aa2ff", models: ["DeepSeek V4 Flash"], total: 1, from: 0.154, metrics: { value: 1, privacy: 3, capability: 2, speed: 3 } },
  { id: "deepinfra", kind: "payg", name: "DeepInfra", style: "provider", hue: "#a8a4ff", models: ["DeepSeek V4 Pro"], total: 25, from: 0.055, metrics: { value: 4, privacy: 3, capability: 3, speed: 2 } },
  { id: "baseten", kind: "payg", name: "Baseten", style: "provider", hue: "#5fd0c4", models: ["Kimi K3"], total: 3, from: 1.05, metrics: { value: 1, privacy: 3, capability: 3, speed: 3 } },
  { id: "bedrock", kind: "payg", name: "Amazon Bedrock", style: "provider", hue: "#ffb454", models: ["Claude Sonnet 5.5"], total: 13, from: 0.33, metrics: { value: 1, privacy: 4, capability: 4, speed: 3 } },
  { id: "azure", kind: "payg", name: "Azure", style: "provider", hue: "#4fb3ff", models: ["GPT-6.1 Sol"], total: 31, from: 0.11, metrics: { value: 1, privacy: 4, capability: 4, speed: 3 } },
  { id: "vertex", kind: "payg", name: "Google Vertex AI", style: "provider", hue: "#8ab4f8", models: ["Gemini 4 Argon"], total: 9, from: 0.1, metrics: { value: 2, privacy: 4, capability: 4, speed: 3 } },
  { id: "novita", kind: "payg", name: "Novita", style: "provider", hue: "#c9ccd3", models: ["MiniMax M3"], total: 20, from: 0.05, metrics: { value: 2, privacy: 3, capability: 2, speed: 2 } },
];
