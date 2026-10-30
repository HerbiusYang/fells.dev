/** Only public purchase context is retained across sign-in. Never credentials. */
export interface SupportPurchaseIntent { title?: string; product?: string; poolId?: number; amountMicro?: number; serviceDays?: number; publicCode?: string; source: string; createdAt: number }
const key = "fells.support.purchase.v1";
export function saveSupportIntent(input: unknown): SupportPurchaseIntent {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const result: SupportPurchaseIntent = { source: location.pathname.slice(0, 200), createdAt: Date.now() };
  if (typeof value.title === "string") result.title = value.title.slice(0, 200);
  if (["subscription", "token_plan", "allowance", "other"].includes(String(value.product))) result.product = String(value.product);
  if (typeof value.publicCode === "string" && /^[a-zA-Z0-9._:-]{1,200}$/.test(value.publicCode)) result.publicCode = value.publicCode;
  if (typeof value.serviceDays === "number" && Number.isSafeInteger(value.serviceDays) && value.serviceDays > 0) result.serviceDays = value.serviceDays;
  for (const name of ["poolId", "amountMicro"] as const) if (typeof value[name] === "number" && Number.isSafeInteger(value[name]) && value[name] >= 0) result[name] = value[name];
  try { sessionStorage.setItem(key, JSON.stringify(result)); } catch { /* Support remains available without storage. */ }
  return result;
}
export function readSupportIntent(): SupportPurchaseIntent | null {
  try { const value = JSON.parse(sessionStorage.getItem(key) ?? "null"); if (!value || typeof value.source !== "string" || !value.source.startsWith("/") || Date.now() - value.createdAt > 3_600_000 || value.createdAt > Date.now()) { sessionStorage.removeItem(key); return null; } return value; } catch { return null; }
}
export function clearSupportIntent() { try { sessionStorage.removeItem(key); } catch { /* Optional convenience. */ } }
export function supportSignInHref(lang: string) {
  const prefix = lang === "en" ? "" : lang === "zh-CN" ? "/zh" : lang === "zh-TW" ? "/zh-hant" : `/${lang}`;
  const next = new URL(`${prefix}/app/`, location.origin); next.searchParams.set("support", "1");
  return `${prefix}/app/start?next=${encodeURIComponent(next.pathname + next.search)}`;
}
