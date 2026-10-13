export class APIError extends Error {
  status: number;
  code: string;
  operationId: string;
  constructor(status: number, message: string, code = "", operationId = "") {
    super(message); this.name = "APIError";
    this.status = status; this.code = code; this.operationId = operationId;
  }
}

export type APIOptions = {
  method?: string; body?: unknown; headers?: Record<string, string>;
  signal?: AbortSignal; idempotencyKey?: string;
};

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
  let value: any;
  try { value = await response.json(); } catch { throw new APIError(response.status, "服务返回了无效响应，请稍后重试"); }
  if (!response.ok || value?.ok === false) {
    const message = typeof value?.error === "string" ? value.error : value?.error?.message ?? "请求失败，请稍后重试";
    throw new APIError(response.status, message, value?.error?.code ?? "", response.headers.get("X-Fells-Operation-ID") ?? "");
  }
  return value as T;
}

export const operationKey = () => crypto.randomUUID();
