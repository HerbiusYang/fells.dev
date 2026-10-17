/** Parse decimal micro units without binary floating-point rounding or exponents. */
export function parseCashMicro(value: string): number | null {
  if (!/^\d+(?:\.\d{1,6})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const micro = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  return micro > 0n && micro <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(micro) : null;
}
export interface ExchangeQuote {
  id: string; source: "ECB"; as_of: string; fetched_at: string; expires_at: string;
  fee_bp: 10; reference_rate: string; effective_rate: string; cash_micro: number;
  principal_cash_micro: number; fee_cny_micro: number; usd_micro: number; currency: "USD";
  api_keys_will_enable?: boolean;
}
export function validExchangeQuote(value: unknown, cashMicro?: number): value is ExchangeQuote {
  if (!value || typeof value !== "object") return false;
  const q = value as ExchangeQuote;
  const positive = (n: unknown) => Number.isSafeInteger(n) && Number(n) > 0;
  const decimal = (n: unknown) => typeof n === "string" && /^\d+(?:\.\d+)?$/.test(n) && Number.isFinite(Number(n)) && Number(n) > 0;
  return /^[a-f0-9-]{36}$/.test(q.id) && q.source === "ECB" && q.currency === "USD" && q.fee_bp === 10
    && /^\d{4}-\d{2}-\d{2}$/.test(q.as_of) && Number.isFinite(Date.parse(q.as_of))
    && Number.isFinite(Date.parse(q.fetched_at)) && Number.isFinite(Date.parse(q.expires_at))
    && decimal(q.reference_rate) && decimal(q.effective_rate) && Number(q.effective_rate) > Number(q.reference_rate)
    && (q.api_keys_will_enable === undefined || typeof q.api_keys_will_enable === "boolean")
    && positive(q.cash_micro) && (cashMicro === undefined || q.cash_micro === cashMicro)
    && Number.isSafeInteger(q.fee_cny_micro) && q.fee_cny_micro >= 0 && positive(q.principal_cash_micro)
    && q.principal_cash_micro + q.fee_cny_micro === q.cash_micro && positive(q.usd_micro);
}
export function microText(micro: number): string {
  const value = BigInt(micro), negative = value < 0n, absolute = negative ? -value : value;
  const fraction = (absolute % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${absolute / 1_000_000n}${fraction ? `.${fraction}` : ""}`;
}
/** Transaction intent is scoped by real identity; it never stores credentials. */
export function storeMoneyIntent(key: string, value: unknown): void {
  const text = JSON.stringify(value);
  sessionStorage.setItem(key, text);
  if (sessionStorage.getItem(key) !== text) throw new Error("Operation storage unavailable");
}

/** Only the original CNY debit and USD credit can resolve a held FX operation. */
export function validExchangeReconciliation(value: unknown, quote: ExchangeQuote): boolean {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>, receipt = result.receipt as Record<string, unknown> | undefined;
  return result.ok === true && result.reconciled === true && typeof result.operation_id === "string" && /^[a-f0-9-]{36}$/.test(result.operation_id) && typeof result.business_ref === "string" && result.business_ref.length > 0 && !!receipt && typeof receipt === "object" && receipt.kind === "allowance" && receipt.reference === result.business_ref && receipt.cashMicro === quote.cash_micro && receipt.allowanceMicro === quote.usd_micro;
}
