/** A provider's bounded diagnostic is data, never a partial answer or retry instruction. */
export interface ChatRefusalDetails { type: "refusal"; category?: string; explanation?: string }
export function parseChatRefusal(value: unknown): ChatRefusalDetails | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const detail = value as Record<string, unknown>;
  if (detail.type !== "refusal") return undefined;
  const category = detail.category, explanation = detail.explanation;
  const bounded = (text: unknown, limit: number) => typeof text === "string" && text.length <= limit && new TextEncoder().encode(text).length <= limit;
  if (category != null && (!bounded(category, 80) || /[\u0000\r\n]/.test(category as string))) return undefined;
  if (explanation != null && (!bounded(explanation, 4096) || (explanation as string).includes("\u0000"))) return undefined;
  return { type: "refusal", ...(typeof category === "string" ? { category } : {}), ...(typeof explanation === "string" ? { explanation } : {}) };
}
