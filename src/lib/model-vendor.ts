/** Picker groups follow the vendor the directory reports; an id prefix only fills a missing vendor. */
const vendorPrefixes: [RegExp, string][] = [
  [/^claude-/, "Anthropic"], [/^(gpt-|chatgpt-|codex|o\d)/, "OpenAI"], [/^(gemini-|imagen-)/, "Google"], [/^grok-/, "xAI"],
  [/^deepseek/, "DeepSeek"], [/^glm-/, "Zhipu"], [/^(kimi|k3)/, "Moonshot"], [/^qwen/, "Alibaba"], [/^minimax/, "MiniMax"],
];
const families: Record<string, string> = { Anthropic: "Claude", OpenAI: "ChatGPT", Google: "Gemini", xAI: "Grok", Moonshot: "Kimi", Zhipu: "GLM", Alibaba: "Qwen" };
const leading = ["Anthropic", "OpenAI", "Google"];

export function modelVendor(model: { model: string; vendor?: string }): string {
  if (model.vendor) return model.vendor;
  const id = model.model.toLowerCase();
  return vendorPrefixes.find(([prefix]) => prefix.test(id))?.[1] ?? "";
}

/** Customers know the product family (Claude, ChatGPT) better than the lab's company name. */
export const vendorFamily = (vendor: string) => families[vendor] ?? vendor;

/** Claude, ChatGPT and Gemini lead; other vendors follow by name; unknown models come last. Order within a group is kept. */
export function groupByVendor<T extends { model: string; vendor?: string }>(models: T[]): { vendor: string; models: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const model of models) {
    const vendor = modelVendor(model);
    groups.set(vendor, [...(groups.get(vendor) ?? []), model]);
  }
  const rank = (vendor: string) => !vendor ? leading.length + 1 : leading.includes(vendor) ? leading.indexOf(vendor) : leading.length;
  return [...groups].map(([vendor, models]) => ({ vendor, models })).sort((a, b) => rank(a.vendor) - rank(b.vendor) || a.vendor.localeCompare(b.vendor));
}
