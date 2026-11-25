/** Only public purchase context is retained across sign-in. Never credentials. */
export interface SupportPurchaseIntent { title?: string; product?: string; poolId?: number; amountMicro?: number; serviceDays?: number; months?: number; publicCode?: string; userId?: string; source: string; createdAt: number }
const key = "fells.support.purchase.v1";
const accountID = (value: unknown) => (typeof value === "string" || typeof value === "number") && /^[1-9]\d{0,18}$/.test(String(value)) ? String(value) : undefined;
// A signed-in page can put private context (for example an operation ID) in
// the title. `owner` is the verified support session's user; `userId` in the
// input is the account page's own identity. Either binds the intent to that
// account, and conflicting identities store nothing.
export function saveSupportIntent(input: unknown, owner?: string): SupportPurchaseIntent {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const result: SupportPurchaseIntent = { source: location.pathname.slice(0, 200), createdAt: Date.now() };
  const bound = accountID(owner), declared = accountID(value.userId);
  if (bound && declared && bound !== declared) { clearSupportIntent(); return result; }
  if (typeof value.title === "string") result.title = value.title.slice(0, 200);
  if (["subscription", "token_plan", "allowance", "other"].includes(String(value.product))) result.product = String(value.product);
  if (typeof value.publicCode === "string" && /^[a-zA-Z0-9._:-]{1,200}$/.test(value.publicCode)) result.publicCode = value.publicCode;
  if (typeof value.serviceDays === "number" && Number.isSafeInteger(value.serviceDays) && value.serviceDays > 0) result.serviceDays = value.serviceDays;
  // Token Plan purchase term in months (1, 3, 6, 12); amountMicro is then the whole term.
  if (typeof value.months === "number" && Number.isSafeInteger(value.months) && value.months >= 1 && value.months <= 24) result.months = value.months;
  for (const name of ["poolId", "amountMicro"] as const) if (typeof value[name] === "number" && Number.isSafeInteger(value[name]) && value[name] >= 0) result[name] = value[name];
  const userId = bound ?? declared;
  if (userId) result.userId = userId;
  try { sessionStorage.setItem(key, JSON.stringify(result)); } catch { /* Support remains available without storage. */ }
  return result;
}
/** Public (unbound) context follows the visitor through sign-in; another account's intent is deleted. */
export function readSupportIntent(userId: string): SupportPurchaseIntent | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (!value || typeof value.source !== "string" || !value.source.startsWith("/") || Date.now() - value.createdAt > 3_600_000 || value.createdAt > Date.now()
      || value.userId !== undefined && (accountID(value.userId) === undefined || value.userId !== userId)) { sessionStorage.removeItem(key); return null; }
    return value;
  } catch { clearSupportIntent(); return null; }
}
export function clearSupportIntent() { try { sessionStorage.removeItem(key); } catch { /* Optional convenience. */ } }
export function supportSignInHref(lang: string) {
  const prefix = lang === "en" ? "" : lang === "zh-CN" ? "/zh" : lang === "zh-TW" ? "/zh-hant" : `/${lang}`;
  const next = new URL(`${prefix}/app/`, location.origin); next.searchParams.set("support", "1");
  return `${prefix}/app/start?next=${encodeURIComponent(next.pathname + next.search)}`;
}
