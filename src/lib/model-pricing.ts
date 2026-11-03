/** Server-calculated prices only. Never recalculate a Key's tariff from a global tier. */
const modelPriceFields = ["usd_in", "usd_out", "usd_cache_r", "usd_cache_w", "usd_cache_w_1h", "usd_cache_w_30m", "usd_cache_w_12h", "usd_req"] as const;
type BasePriceField = typeof modelPriceFields[number];
export type ModelPriceField = BasePriceField | `${BasePriceField}_long`;
export interface SellingPrices extends Partial<Record<ModelPriceField, number>> { price_bp: number; long_threshold?: number }
interface ModelPricing { source: "selling" | "reference" | "unavailable"; rates: Partial<Record<ModelPriceField, number>>; longThreshold: number; priceBP: number | null }
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const empty = (): ModelPricing => ({ source: "unavailable", rates: {}, longThreshold: 0, priceBP: null });
export function modelPricing(row: Record<string, unknown>): ModelPricing {
  if (row.list_priced !== true) return empty();
  const supplied = row.selling_prices !== undefined;
  const candidate = supplied ? row.selling_prices : row;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return empty();
  const values = candidate as Record<string, unknown>;
  if (supplied && (!integer(values.price_bp) || values.price_bp === 0 || !integer(values.usd_in) || !integer(values.usd_out))) return empty();
  if (values.long_threshold !== undefined && !integer(values.long_threshold)) return empty();
  const rates: ModelPricing["rates"] = {};
  for (const base of modelPriceFields) for (const field of [base, `${base}_long` as const]) {
    if (values[field] === undefined) continue;
    if (!integer(values[field])) return empty();
    rates[field] = values[field];
  }
  return { source: supplied ? "selling" : "reference", rates, longThreshold: Number(values.long_threshold ?? 0), priceBP: supplied ? Number(values.price_bp) : null };
}

/** The official list prices beside a valid selling quote, for comparison only. Never a fallback when the quote is invalid. */
export function officialPricing(row: Record<string, unknown>): ModelPricing | null {
  if (modelPricing(row).source !== "selling") return null;
  const official = modelPricing({ ...row, selling_prices: undefined });
  return official.source === "reference" ? official : null;
}

/** TTL applicability comes from the model vendor, never its compatible wire protocol. */
export function cachePriceApplicability(row: Record<string, unknown>, field: string): boolean | null {
  const base = field.replace(/_long$/, "");
  if (!["usd_cache_w", "usd_cache_w_1h", "usd_cache_w_30m", "usd_cache_w_12h"].includes(base)) return true;
  const vendor = typeof row.vendor === "string" ? row.vendor.trim().toLowerCase() : "";
  if (!vendor) return null;
  return ["usd_cache_w_30m", "usd_cache_w_12h"].includes(base) ? vendor === "openai" : vendor === "anthropic";
}
