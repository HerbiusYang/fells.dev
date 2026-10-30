import { getMaintenanceStatus, isBusinessBlocked, observeMaintenanceResponse } from "./maintenance.ts";
import { readTimeoutMessage } from "../i18n/read-timeout.ts";

export const API_READ_TIMEOUT_MS = 20_000;

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
  // Only reads receive an automatic deadline. A write may already have
  // committed when its response is delayed; its caller owns that recovery.
  const controller = method.toUpperCase() === "GET" ? new AbortController() : null;
  let deadline: ReturnType<typeof setTimeout> | undefined, timedOut = false;
  const abortParent = () => { clearTimeout(deadline); controller?.abort(options.signal?.reason); };
  if (controller && options.signal) {
    if (options.signal.aborted) abortParent();
    else options.signal.addEventListener("abort", abortParent, { once: true });
  }
  if (controller && !controller.signal.aborted) deadline = setTimeout(() => {
    if (!controller.signal.aborted) { timedOut = true; controller.abort(); }
  }, API_READ_TIMEOUT_MS);
  const signal = controller?.signal ?? options.signal;
  try {
    const response = await fetch(path, { method, headers, body, signal, credentials: "same-origin", cache: "no-store", redirect: "error" });
    if (options.expectedStatus !== undefined && response.ok && response.status !== options.expectedStatus)
      throw new APIError(response.status, "The server returned an unexpected response. Please refresh before retrying.");
    if (response.status === 204) return undefined as T;
    const retryAfter = retryAfterSeconds(response.headers.get("Retry-After"));
    let value: any;
    try { value = await response.json(); }
    catch (error) {
      if (controller?.signal.aborted) throw controller.signal.reason ?? error;
      throw new APIError(response.status, "服务返回了无效响应，请稍后重试", "", "", false, retryAfter);
    }
    observeMaintenanceResponse(response, value);
    if (!response.ok || value?.ok === false) {
      const message = typeof value?.error === "string" ? value.error : value?.error?.message ?? "请求失败，请稍后重试";
      throw new APIError(response.status, message, value?.error?.code ?? value?.code ?? "", response.headers.get("X-Fells-Operation-ID") ?? "", value?.transaction_rejected === true, retryAfter, value && typeof value === "object" && !Array.isArray(value) ? value : {});
    }
    // Financial callers need the server operation identity for explicit receipt
    // acknowledgement. Never infer it from the client's idempotency key.
    const operation = response.headers.get("X-Fells-Operation-ID");
    if (options.idempotencyKey && operation && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operation)
      && value && typeof value === "object" && !Array.isArray(value)) {
      if (value.operation_id !== undefined && value.operation_id !== operation) throw new APIError(502, "The operation receipt could not be verified. Check its status before trying again.", "operation_identity_mismatch");
      value = { ...value, operation_id: operation };
    }
    return value as T;
  } catch (error) {
    if (timedOut) throw new APIError(408, readTimeoutMessage(typeof document === "undefined" ? "en" : document.documentElement?.lang || "en"), "api_read_timeout");
    throw error;
  } finally {
    clearTimeout(deadline);
    options.signal?.removeEventListener("abort", abortParent);
  }
}

export const operationKey = () => crypto.randomUUID();
