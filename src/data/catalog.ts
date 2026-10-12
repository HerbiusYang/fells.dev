// Plans and model prices shown on the site.

// ---- Launch products: Claude Token Plan and group buy (拼团). Prices are CNY. ----

// CNY per USD, used for every "official price" comparison on the site.
export const FX = 7;

// Token Plan: quota is USD of usage at official API list prices. `quota` is guaranteed every month;
// `burst` is the most a month can reach when spare capacity is available.
export type TokenPlan = {
  id: "trial" | "4000" | "2000" | "1000";
  price: number; // CNY
  period: "once" | "month";
  quota: number;
  burst?: number;
  badge?: "newUser" | "best";
};

export const tokenPlans: TokenPlan[] = [
  { id: "trial", price: 99, period: "once", quota: 100, badge: "newUser" },
  { id: "4000", price: 3988, period: "month", quota: 4000, burst: 8000, badge: "best" },
  { id: "2000", price: 2288, period: "month", quota: 2000, burst: 4000 },
  { id: "1000", price: 1288, period: "month", quota: 1000, burst: 2000 },
];
// TODO(launch): confirm how long the trial quota stays valid.

// Group buy: one official Claude Max 20× subscription sold as shares. A seat of N× gets N/20 of every
// 5-hour window and of the weekly limit. `officialUsd` is what the same allowance costs from Anthropic
// (Claude Pro is $20 per 1×, Max 5× is $100).
export const groupBase = { plan: "Claude Max 20×", units: 20 };
export type GroupSeat = { id: string; units: number; price: number; officialUsd: number; badge?: "popular" };
// TODO(pricing): seat sizes and prices are placeholders. While this is true the cards show an "example price" tag.
export const groupSeats: GroupSeat[] = [
  { id: "g2", units: 2, price: 168, officialUsd: 40 },
  { id: "g5", units: 5, price: 398, officialUsd: 100, badge: "popular" },
  { id: "g10", units: 10, price: 788, officialUsd: 200 },
];

export const officialCny = (usd: number) => usd * FX;
// CNY paid per USD of guaranteed quota, e.g. 1.08.
export const cny = (n: number) => `¥${n.toLocaleString("en-US")}`;
export const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
// Simplest fraction of the Max 20× subscription a seat stands for: 5 → "1/4".
export const seatShare = (units: number) => {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const g = gcd(units, groupBase.units);
  return `${units / g}/${groupBase.units / g}`;
};

// ---- Earlier USD plan tiers. Still used by the /app prototype's credit subscriptions. ----
// Numbers follow the agent.space template (Oct 2026). Reference prices = public list prices.

type Tier = {
  mult: string; // "1×", "5×" …
  monthly: number; // USD / month when billed monthly
  reference?: number; // official subscription price it maps to
  apiValue: number; // ≈ USD of usage at API list prices, for the "you save" line
  badge?: "popular" | "limited";
};

export type Product = {
  id: "claude" | "codex";
  name: string;
  maker: string;
  hue: string;
  basedOn: string; // official plan the 1× allowance is pegged to
  headline: string; // newest model, shown as a pill
  tiers: Tier[];
};

export const products: Product[] = [
  {
    id: "claude",
    name: "Claude Code",
    maker: "Anthropic",
    hue: "#e07a55",
    basedOn: "Claude Pro",
    headline: "Claude Opus 5.5",
    tiers: [
      { mult: "1×", monthly: 10, reference: 20, apiValue: 241 },
      { mult: "2×", monthly: 20, apiValue: 482 },
      { mult: "5×", monthly: 50, reference: 100, apiValue: 1043, badge: "popular" },
      { mult: "20×", monthly: 200, reference: 200, apiValue: 3954, badge: "limited" },
    ],
  },
  {
    id: "codex",
    name: "Codex",
    maker: "OpenAI",
    hue: "#7c8cff",
    basedOn: "ChatGPT Plus",
    headline: "GPT-6.1 Sol",
    tiers: [
      { mult: "1×", monthly: 10, reference: 20, apiValue: 241 },
      { mult: "2×", monthly: 20, apiValue: 482 },
      { mult: "5×", monthly: 50, reference: 100, apiValue: 1043, badge: "popular" },
      { mult: "20×", monthly: 200, reference: 200, apiValue: 3954, badge: "limited" },
    ],
  },
];

export type ModelPrice = {
  name: string;
  provider: "Anthropic" | "OpenAI" | "DeepSeek" | "Moonshot" | "Zhipu" | "MiniMax" | "xAI" | "Google";
  input: number; // ours, USD / 1M tokens
  output: number;
  refInput: number; // public list price
  refOutput: number;
  tag?: "new" | "long";
  // Tiered pricing: the rate that applies once a prompt exceeds `atK` thousand tokens.
  over?: { atK: number; input: number; output: number; refInput: number; refOutput: number };
};

// TODO(launch): only Anthropic models are live. Other providers go back in once they are online.
export const models: ModelPrice[] = [
  { name: "Claude Opus 5.5", provider: "Anthropic", input: 2, output: 10, refInput: 4, refOutput: 20, tag: "new" },
  { name: "Claude Sonnet 5.5", provider: "Anthropic", input: 1, output: 5, refInput: 2, refOutput: 10 },
  { name: "Claude Fable 5.1", provider: "Anthropic", input: 5, output: 25, refInput: 10, refOutput: 50 },
  { name: "Claude Haiku 5.5", provider: "Anthropic", input: 0.05, output: 0.25, refInput: 0.1, refOutput: 0.5, over: { atK: 100, input: 0.25, output: 1.25, refInput: 0.5, refOutput: 2.5 } },
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
