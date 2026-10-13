export class APIError extends Error {
  status: number;
  code: string;
  operationId: string;
  /** Seconds from a Retry-After response header; 0 when absent or invalid. */
  retryAfter: number;
  /** The parsed error body, for documented extra fields such as current_price_micro. */
  details: Record<string, unknown>;
  constructor(status: number, message: string, code = "", operationId = "", retryAfter = 0, details: Record<string, unknown> = {}) {
    super(message); this.name = "APIError";
    this.status = status; this.code = code; this.operationId = operationId;
    this.retryAfter = retryAfter; this.details = details;
  }
}

export type APIOptions = {
  method?: string; body?: unknown; headers?: Record<string, string>;
  signal?: AbortSignal; idempotencyKey?: string;
};

/** Retry-After is either delay-seconds or an HTTP date (RFC 9110 §10.2.3). */
function retryAfterSeconds(value: string | null, now = Date.now()): number {
  const text = value?.trim() ?? "";
  if (!text) return 0;
  if (/^\d+$/.test(text)) return Math.min(Number(text), 86_400);
  const date = Date.parse(text);
  return Number.isFinite(date) ? Math.min(Math.max(0, Math.ceil((date - now) / 1000)), 86_400) : 0;
}

export async function api<T = any>(path: string, options: APIOptions = {}): Promise<T> {
  if (!path.startsWith("/api/app/") && !path.startsWith("/api/support/")) throw new Error("Invalid API path");
  const headers = new Headers(options.headers);
  const method = options.method ?? (options.body === undefined ? "GET" : "POST");
  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    if (options.body instanceof FormData || options.body instanceof Blob) body = options.body;
    else { headers.set("Content-Type", "application/json"); body = JSON.stringify(options.body); }
  }
  if (options.idempotencyKey) headers.set("Idempotency-Key", options.idempotencyKey);
  const response = await fetch(path, { method, headers, body, signal: options.signal, credentials: "same-origin", cache: "no-store", redirect: "error" });
  if (response.status === 204) return undefined as T;
  const retryAfter = retryAfterSeconds(response.headers.get("Retry-After"));
  let value: any;
  try { value = await response.json(); } catch { throw new APIError(response.status, "服务返回了无效响应，请稍后重试", "", "", retryAfter); }
  if (!response.ok || value?.ok === false) {
    const message = typeof value?.error === "string" ? value.error : value?.error?.message ?? "请求失败，请稍后重试";
    const details = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    throw new APIError(response.status, message, value?.error?.code ?? "", response.headers.get("X-Fells-Operation-ID") ?? "", retryAfter, details);
  }
  return value as T;
}

export const operationKey = () => crypto.randomUUID();
