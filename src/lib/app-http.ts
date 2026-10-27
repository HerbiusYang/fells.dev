import { getMaintenanceStatus, isBusinessBlocked, observeMaintenanceResponse } from "./maintenance.ts";

export class APIError extends Error {
  status: number;
  code: string;
  operationId: string;
  transactionRejected: boolean;
  retryAfter: number;
  details: Record<string, unknown>;
  constructor(status: number, message: string, code = "", operationId = "", transactionRejected = false, retryAfter = 0, details: Record<string, unknown> = {}) {
    super(message); this.name = "APIError"; this.transactionRejected = transactionRejected;
    this.status = status; this.code = code; this.operationId = operationId;
    this.retryAfter = retryAfter; this.details = details;
  }
}

export type APIOptions = {
  method?: string; body?: unknown; headers?: Record<string, string>;
  signal?: AbortSignal; idempotencyKey?: string; expectedStatus?: number;
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
  if (isBusinessBlocked()) {
    const state = getMaintenanceStatus()!;
    throw new APIError(503, state.message || state.title || "Service temporarily unavailable", "service_maintenance", "", false, state.retry_after_seconds, { maintenance: state });
  }
  const headers = new Headers(options.headers);
  const method = options.method ?? (options.body === undefined ? "GET" : "POST");
  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    if (options.body instanceof FormData || options.body instanceof Blob) body = options.body;
    else { headers.set("Content-Type", "application/json"); body = JSON.stringify(options.body); }
  }
  if (options.idempotencyKey) headers.set("Idempotency-Key", options.idempotencyKey);
  const response = await fetch(path, { method, headers, body, signal: options.signal, credentials: "same-origin", cache: "no-store", redirect: "error" });
  if (options.expectedStatus !== undefined && response.ok && response.status !== options.expectedStatus)
    throw new APIError(response.status, "The server returned an unexpected response. Please refresh before retrying.");
  if (response.status === 204) return undefined as T;
  const retryAfter = retryAfterSeconds(response.headers.get("Retry-After"));
  let value: any;
  try { value = await response.json(); } catch { throw new APIError(response.status, "服务返回了无效响应，请稍后重试", "", "", false, retryAfter); }
  observeMaintenanceResponse(response, value);
  if (!response.ok || value?.ok === false) {
    const message = typeof value?.error === "string" ? value.error : value?.error?.message ?? "请求失败，请稍后重试";
    throw new APIError(response.status, message, value?.error?.code ?? value?.code ?? "", response.headers.get("X-Fells-Operation-ID") ?? "", value?.transaction_rejected === true, retryAfter, value && typeof value === "object" && !Array.isArray(value) ? value : {});
  }
  return value as T;
}

export const operationKey = () => crypto.randomUUID();
