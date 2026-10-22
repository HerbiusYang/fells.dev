import { api, type APIOptions } from "./app-http";

/** Server DTOs retain their currency and integer micro units. */
export interface SessionDto {
  id?: number; username: string; display_name: string; created_at: number;
  self_keys: boolean; agreement: { version: string; accepted: boolean; accepted_at?: number };
}
export interface AllowanceDto { user_id: number; micro: number; expires_at: number; comp_micro?: number; comp_expires_at?: number; plan_micro?: number }
export interface BootstrapDto {
  schema_version: number;
  session_id: string;
  user: { id: number; username: string; email: string; name: string; joined_at: number; self_keys: boolean; self_keys_exchange_blocked?: boolean };
  wallet: { currency: "CNY"; cash_micro: number; grant_micro: number; grant_expires_at: number };
  api_allowance: { currency: "USD"; balance: AllowanceDto; term_months: number; price_cny?: number };
  agreement: SessionDto["agreement"]; capabilities: Record<string, boolean>;
}
export interface AuthConfigDto { signup_enabled: boolean; email_enabled?: boolean; github_enabled?: boolean; channels: string[]; turnstile_site_key: string; min_password_length: number; gift?: { amount_micro: number; expires_days: number } }
export interface AgreementDto { version: string; h1: string; lede: string; updated: string; clauses: { title?: string; h?: string; body?: string; paragraphs?: string[]; [key: string]: unknown }[]; ui: Record<string, string> }
export interface WalletDto {
  balance_micro: number; cash_micro: number; grant_micro: number; grant_expires_at: number;
  pay_info: string; pay_qr: string; corp_open: boolean; corp_account_name: string;
  corp_bank_name: string; corp_bank_account: string; corp_tax_pct: number; invoice_enabled: boolean;
  invoice_prefill: { title: string; tax_no: string; email: string };
}
export interface AllowanceResponse { allowance: AllowanceDto; ledger: Record<string, unknown>[]; quote_usd_micro: number; multiplier: number; price_cny: number; on_sale: boolean; term_months: number; cash_micro: number }
interface SubscriptionPlanDto {
  pool_id: number; tier: number; name: string; price_micro: number; list_price_micro: number;
  blurb: string; cars: number; capacity: number; free: number; current: boolean; held: boolean; upgrade_from?: number;
}
export interface SubscriptionsDto {
  cash_micro: number; grant_micro: number; plans: SubscriptionPlanDto[]; now: number;
  subscription?: { tier: number; price_micro: number; terms: number; expires_at: number; active: boolean; seconds_left: number };
  rides?: Record<string, unknown>[]; preferred_ride_mode?: "monthly" | "allowance" | string;
  [key: string]: unknown;
}
interface TokenPlanSubscriptionDto {
  id: number; user_id: number; plan_id: number; plan_code: string;
  price_micro: number; quota_usd_micro: number; burst_usd_micro: number;
  period_start: number; period_end: number; used_usd_micro: number;
  status: "active" | "queued" | "expired"; ref: string; created_at: number;
}
interface TokenPlanCurrentDto extends TokenPlanSubscriptionDto {
  name: string; remaining_guaranteed_usd_micro: number;
  remaining_burst_usd_micro: number; burst_allowed: boolean;
  queued?: TokenPlanSubscriptionDto;
}
export interface TokenPlansDto {
  plans: { code: string; name: string; price_micro: number; quota_usd_micro: number;
    burst_usd_micro: number; period: "once" | "month"; period_days: number;
    new_user_only: boolean; enabled: boolean; terms_hash: string }[];
  current: TokenPlanCurrentDto | null;
  burst_allowed: boolean;
  api_keys_will_enable?: boolean;
}
export interface IssuedKeyDto {
  id: number; name: string; prefix: string; created_at: number; expires_at: number; revoked: boolean;
  daily_allow_micro: number; monthly_allow_micro: number; rpm: number; [key: string]: unknown;
}
export interface KeysDto { keys: IssuedKeyDto[]; self_keys: boolean; limit_defaults: { daily_micro: number; monthly_micro: number; rpm: number } }
export interface TopupDto {
  id: number; user_id: number; amount_micro: number; status: "unpaid" | "pending" | "approved" | "rejected" | string;
  note: string; admin_memo: string; created_at: number; decided_at: number; discount_micro: number; tax_micro: number;
  coupon_id: number; bonus_micro: number; pay_method: string; [key: string]: unknown;
}
export interface TopupInput { amount_micro: number; draft: boolean; id?: number; note?: string; coupon_id?: number; pay_method?: string; need_invoice?: boolean; invoice_title?: string; invoice_tax_no?: string; invoice_email?: string }
export interface KeyLimitsInput { daily_micro?: number; monthly_micro?: number; rpm?: number }
export interface SignupInput { username?: string; dest: string; code: string; password: string; display_name?: string; locale?: string; referral_code?: string; agreement_version: string }
export type Query = Record<string, string | number | boolean | undefined>;

/** Mirrors store.PromptTokens: OpenAI/Gemini input includes cache reads; writes are separate. */
export function usageTokens(row: Record<string, unknown>): number {
  const input = Number(row.tokens_in ?? 0), output = Number(row.tokens_out ?? 0);
  const includesCache = row.protocol === "openai" || row.protocol === "gemini";
  return input + output + Number(row.tokens_cache_w ?? 0) + (includesCache ? 0 : Number(row.tokens_cache_r ?? 0));
}

let expectedIdentity: { userId: number; sessionId: string } | null = null;
/** Binds requests from an already loaded page to that real account. */
export function setExpectedUser(identity: { userId: number; sessionId: string } | null) {
  if (identity !== null && (!Number.isSafeInteger(identity.userId) || identity.userId <= 0 || !/^[a-f0-9]{64}$/.test(identity.sessionId))) throw new Error("Invalid account identity");
  expectedIdentity = identity;
}
function request<T>(path: string, options: APIOptions = {}, publicRequest = false): Promise<T> {
  if (!publicRequest && expectedIdentity === null) throw new Error("Account session is not bound; reload this page before continuing");
  const headers = { ...options.headers };
  if (!publicRequest && expectedIdentity !== null) {
    headers["X-Fells-Expected-User"] = String(expectedIdentity.userId);
    headers["X-Fells-Expected-Session"] = expectedIdentity.sessionId;
  }
  return api<T>(`/api/app/${path}`, { ...options, headers });
}
function query(values: Query = {}) {
  const p = new URLSearchParams();
  Object.entries(values).forEach(([k, v]) => { if (v !== undefined) p.set(k, String(v)); });
  return p.size ? `?${p}` : "";
}
const idPath = (id: number | string) => {
  const n = Number(id);
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error("Invalid resource identity");
  return String(n);
};
const get = <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal });
const post = <T>(path: string, body: unknown, signal?: AbortSignal) => request<T>(path, { body, signal });
const moneyPost = <T>(path: string, body: unknown, key: string, signal?: AbortSignal) => {
  if (!/^[\x21-\x7e]{8,128}$/.test(key)) throw new Error("A stable transaction key is required");
  return request<T>(path, { body, signal, idempotencyKey: key });
};

export const accountApi = {
  session: (signal?: AbortSignal) => request<SessionDto>("session", { signal }, true),
  bootstrap: (signal?: AbortSignal) => request<BootstrapDto>("bootstrap", { signal }, true),
  login: (username: string, password: string, turnstile_token = "", signal?: AbortSignal) => request<{ ok: true; username: string; display_name: string }>("session", { body: { username, password, turnstile_token }, signal }, true),
  logout: (signal?: AbortSignal) => request<{ ok: true }>("session", { method: "DELETE", signal }),
  authConfig: (signal?: AbortSignal) => request<AuthConfigDto>("auth/config", { signal }, true),
  verifyHuman: (dest: string, purpose: "signup" | "reset", turnstile_token: string, signal?: AbortSignal) => request<{ ok: true; expires_in: number }>("auth/human", { body: { channel: "email", dest, purpose, turnstile_token }, signal }, true),
  sendCode: (dest: string, purpose: "signup" | "reset", turnstile_token = "", signal?: AbortSignal) => request<{ ok: true; resend_after?: number; expires_in?: number }>("auth/code", { body: { channel: "email", dest, purpose, turnstile_token }, signal }, true),
  signup: (body: SignupInput, signal?: AbortSignal) => request<{ ok: true; username: string; gift_micro: number; referred: boolean }>("auth/signup", { body: { ...body, channel: "email" }, signal }, true),
  reset: (dest: string, code: string, password: string, signal?: AbortSignal) => request<{ ok: true }>("auth/reset", { body: { dest, code, password }, signal }, true),
  password: (current_password: string, new_password: string, signal?: AbortSignal) => post<{ ok: true }>("password", { current_password, new_password }, signal),
  agreement: (signal?: AbortSignal, language?: string) => request<AgreementDto>(`agreement${query(language === undefined ? {} : { lang: /^zh(?:-|$)/i.test(language) ? "zh-CN" : "en" })}`, { signal }, true),
  acceptAgreement: (version: string, signal?: AbortSignal) => post<{ ok: true }>("agreement/accept", { version }, signal),
  profile: (signal?: AbortSignal) => get<{ profile: { name: string; avatar: number | string }; email: string }>("profile", signal),
  updateProfile: (body: { name?: string; avatar?: number }, signal?: AbortSignal) => post<{ profile: { name: string; avatar: number | string }; email: string }>("profile", body, signal),
  preferences: (signal?: AbortSignal) => get<Record<string, unknown>>("preferences", signal),
  updatePreferences: (body: Record<string, unknown>, signal?: AbortSignal) => post<Record<string, unknown>>("preferences", body, signal),
  keys: (signal?: AbortSignal) => get<KeysDto>("keys", signal),
  createKey: (body: { name: string; ttl_days?: number; project_id?: number }, signal?: AbortSignal) => post<{ raw: string; key: IssuedKeyDto }>("keys", body, signal),
  revokeKey: (id: number | string, signal?: AbortSignal) => post<{ ok: true }>(`keys/${idPath(id)}/revoke`, {}, signal),
  deleteKey: (id: number | string, signal?: AbortSignal) => request<{ ok: true }>(`keys/${idPath(id)}`, { method: "DELETE", signal }),
  keyLimits: (id: number | string, signal?: AbortSignal) => get<Record<string, unknown>>(`keys/${idPath(id)}/limits`, signal),
  setKeyLimits: (id: number | string, body: KeyLimitsInput, signal?: AbortSignal) => post<Record<string, unknown>>(`keys/${idPath(id)}/limits`, body, signal),
  usage: (q?: Query, signal?: AbortSignal) => get<{ usage: Record<string, unknown>[]; keys: IssuedKeyDto[]; now: number }>(`usage${query(q)}`, signal),
  activity: (signal?: AbortSignal) => get<Record<string, unknown>>("usage/activity", signal),
  usageValue: (q?: Query, signal?: AbortSignal) => get<Record<string, unknown>>(`usage/value${query(q)}`, signal),
  logs: (q?: Query, signal?: AbortSignal) => get<Record<string, unknown>>(`logs${query(q)}`, signal),
  models: (signal?: AbortSignal) => get<Record<string, unknown>>("models", signal),
  catalog: (signal?: AbortSignal) => get<Record<string, unknown>>("catalog", signal),
  chatModels: (key_id: number, signal?: AbortSignal) => get<unknown>(`chat-models${query({ key_id })}`, signal),
  model: (model: string, signal?: AbortSignal) => get<Record<string, unknown>>(`catalog/model/${encodeURIComponent(model)}`, signal),
  wallet: (signal?: AbortSignal) => get<WalletDto>("wallet", signal),
  walletLedger: (page = 1, signal?: AbortSignal) => get<Record<string, unknown>>(`wallet/ledger${query({ page })}`, signal),
  allowance: (signal?: AbortSignal) => get<AllowanceResponse>("allowance", signal),
  allowanceLedger: (page = 1, signal?: AbortSignal) => get<Record<string, unknown>>(`allowance/ledger${query({ page })}`, signal),
  quoteAllowance: (cash_micro: number, signal?: AbortSignal) => post<{ quote: import("./currency-flow").ExchangeQuote }>("allowance/quote", { cash_micro }, signal),
  buyAllowance: (cash_micro: number, quote_id: string, key: string, signal?: AbortSignal) => moneyPost<{ allowance: AllowanceDto; car: unknown; exchange: import("./currency-flow").ExchangeQuote }>("allowance/buy", { cash_micro, quote_id }, key, signal),
  subscriptions: (signal?: AbortSignal) => get<SubscriptionsDto>("subscriptions", signal),
  tokenPlans: (signal?: AbortSignal) => get<TokenPlansDto>("plans", signal),
  buyTokenPlan: (body: { plan: string; max_charge_micro: number; terms_hash: string }, key: string, signal?: AbortSignal) => moneyPost<Record<string, unknown>>("plans/buy", body, key, signal),
  setCurrentSubscription: (pool_id: number, signal?: AbortSignal) => post<{ ok: true; ride_pool_id: number }>("subscriptions/current", { pool_id }, signal),
  setRideMode: (mode: "monthly" | "allowance", signal?: AbortSignal) => post<{ ok: true; preferred_ride_mode: string; car?: string }>("subscriptions/ride-mode", { mode }, signal),
  buySubscription: (body: { pool_id: number; tier: number; months: number; max_charge_micro: number; coupon_id?: number }, key: string, signal?: AbortSignal) => moneyPost<Record<string, unknown>>("subscriptions/buy", body, key, signal),
  upgradeQuote: (body: Record<string, number>, signal?: AbortSignal) => post<Record<string, unknown>>("subscriptions/upgrade-quote", body, signal),
  upgradeSubscription: (body: Record<string, number>, key: string, signal?: AbortSignal) => moneyPost<Record<string, unknown>>("subscriptions/upgrade", body, key, signal),
  topups: (signal?: AbortSignal) => get<{ requests: TopupDto[] }>("topups", signal),
  createTopup: (body: TopupInput, key: string, signal?: AbortSignal) => moneyPost<{ ok: true; request: TopupDto }>("topups", body, key, signal),
  markTopupPaid: (id: number | string, note: string, key: string, signal?: AbortSignal) => moneyPost<{ ok: true; request: TopupDto }>(`topups/${idPath(id)}/paid`, { note }, key, signal),
  deleteTopup: (id: number | string, signal?: AbortSignal) => request<{ ok: true }>(`topups/${idPath(id)}`, { method: "DELETE", signal }),
  coupons: (signal?: AbortSignal) => get<Record<string, unknown>>("coupons", signal),
  usableCoupons: (q?: Query, signal?: AbortSignal) => get<Record<string, unknown>>(`coupons/usable${query(q)}`, signal),
  claimCoupon: (code: string, key: string, signal?: AbortSignal) => moneyPost<Record<string, unknown>>("coupons/claim", { code }, key, signal),
  referral: (signal?: AbortSignal) => get<Record<string, unknown>>("referral", signal),
  rebates: (signal?: AbortSignal) => get<Record<string, unknown>>("rebates", signal),
  invoices: (signal?: AbortSignal) => get<{ files: { id: number; topup_id: number; filename: string; size_bytes: number; uploaded_at: number }[] }>("invoices", signal),
  creditRebate: (body: Record<string, number | string>, key: string, signal?: AbortSignal) => moneyPost<Record<string, unknown>>("rebates/credit", body, key, signal),
};

/** Decode agreement text without constructing elements or loading DTO resources. */
export function agreementText(value: unknown): string {
  // Parse only escaped text: even entity-encoded markup remains a text node.
  const escaped = String(value ?? "").replaceAll("<", "&lt;");
  const text = new DOMParser().parseFromString(escaped, "text/html").body.textContent ?? "";
  // These removals affect presentation only; callers still render the result as text.
  return text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<!--[\s\S]*?-->|<\/?[a-z][^>]*>/gi, "");
}

export function announceSessionChange() {
  setExpectedUser(null);
  const detail = { audience: "customer" };
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("fells.session.changed", { detail }));
  // Best effort: a blocked channel must not stop the caller's cleanup or redirect.
  if (typeof BroadcastChannel !== "undefined") {
    try {
      const channel = new BroadcastChannel("fells.session.changed");
      channel.postMessage(detail); channel.close();
    } catch { /* Browser policy can disable cross-tab notifications. */ }
  }
}

/** Codes GitHub sign-in puts in ?gh_error=; anything else is reported as a server failure. */
const GITHUB_ERRORS = ["unverified", "taken", "denied", "state", "exchange", "signup_closed", "disabled", "expired", "server"] as const;
export type GitHubErrorCode = typeof GITHUB_ERRORS[number];
export function githubErrorCode(value: string | null): GitHubErrorCode | null {
  if (value === null || value === "") return null;
  return (GITHUB_ERRORS as readonly string[]).includes(value) ? value as GitHubErrorCode : "server";
}

export function passwordIsValid(password: string, min = 8) {
  return [...password].length >= min && new TextEncoder().encode(password).byteLength <= 72;
}

/** Matches the server's optional, self-selected account name without normalizing it. */
export function usernameIsValid(username: string) {
  return username.length >= 3 && username.length <= 32 && !/[^a-z0-9_-]/.test(username);
}

/** Only app and checkout destinations on this site can follow sign-in. */
export function authNextPath(candidate: string | null, fallback: string): string {
  if (!candidate || !/^\/(?!\/)/.test(candidate) || /[\\\u0000-\u0020]/.test(candidate)) return fallback;
  const path = candidate.split(/[?#]/, 1)[0];
  return /^\/(?:en\/|zh\/|zh-hant\/|ja\/|ko\/|es\/)?(?:app(?:\/[^.]*)?|checkout)\/?$/.test(path) ? candidate : fallback;
}
