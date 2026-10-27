type MaintenanceMode = "normal" | "scheduled" | "maintenance" | "incident" | "recovering";
export type MaintenanceStatus = {
  version: 1; revision: number; mode: MaintenanceMode; incident_id: string;
  title: string; message: string; starts_at: string | null; expected_end_at: string | null;
  next_update_at: string | null; updated_at: string; retry_after_seconds: number; status_url: string;
};

const modes = new Set(["normal", "scheduled", "maintenance", "incident", "recovering"]);
const timestamp = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
const forbiddenControl = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
export function parseMaintenanceStatus(value: unknown): MaintenanceStatus | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || !Number.isSafeInteger(v.revision) || Number(v.revision) < 0 || typeof v.mode !== "string" || !modes.has(v.mode)) return null;
  // JavaScript string length is the shared protocol's UTF-16 code-unit bound.
  for (const [key, limit] of [["incident_id", 128], ["title", 200], ["message", 4000], ["status_url", 2048]] as const)
    if (typeof v[key] !== "string" || v[key].length > limit || forbiddenControl.test(v[key])) return null;
  if (!["normal", "scheduled"].includes(v.mode) && !String(v.incident_id).trim()) return null;
  if (!timestamp(v.updated_at) || !["starts_at", "expected_end_at", "next_update_at"].every(key => v[key] === null || timestamp(v[key]))) return null;
  if (!Number.isSafeInteger(v.retry_after_seconds) || Number(v.retry_after_seconds) < 1 || Number(v.retry_after_seconds) > 3600) return null;
  if (v.status_url) {
    try { const url = new URL(String(v.status_url)); if (url.protocol !== "https:" || url.username || url.password || String(v.status_url).includes("#")) return null; }
    catch { return null; }
  }
  return Object.freeze({ version: 1, revision: Number(v.revision), mode: v.mode as MaintenanceMode,
    incident_id: String(v.incident_id), title: String(v.title), message: String(v.message), starts_at: v.starts_at as string | null,
    expected_end_at: v.expected_end_at as string | null, next_update_at: v.next_update_at as string | null,
    updated_at: String(v.updated_at), retry_after_seconds: Number(v.retry_after_seconds), status_url: String(v.status_url) });
}

/** The edge status is independent of customer authentication and business APIs. */
export function createMaintenanceClient(request: typeof fetch = (...args) => fetch(...args)) {
  let status: MaintenanceStatus | null = null, transient: MaintenanceStatus | null = null;
  let transientEpoch = 0;
  let pending: Promise<MaintenanceStatus | null> | null = null;
  const listeners = new Set<(value: MaintenanceStatus) => void>();
  const get = () => transient ?? status;
  const blocked = () => { const value = get(); return value !== null && !["normal", "scheduled"].includes(value.mode); };
  function accept(value: unknown, readEpoch?: number): boolean {
    const next = parseMaintenanceStatus(value);
    if (!next) return false;
    if (next.mode === "incident" && next.revision === 0 && ["origin-status-unavailable", "edge-status-unavailable"].includes(next.incident_id)) {
      // Source outages have no durable revision. Keep their admission pause
      // separate so a later successful read can recover the unchanged base.
      transient = next; transientEpoch++;
      for (const listener of listeners) listener(next);
      return true;
    }
    if (status && (next.revision < status.revision || next.revision === status.revision && JSON.stringify(next) !== JSON.stringify(status))) return false;
    const previous = get(), advanced = !status || next.revision > status.revision;
    if (advanced) status = next;
    // A read started before a new outage cannot lift that outage, including
    // when its response has a newer durable revision. Never inflate revisions.
    const clearTransient = transient !== null && (readEpoch === transientEpoch || advanced && !["normal", "scheduled"].includes(next.mode));
    if (clearTransient) transient = null;
    const effective = get();
    if (effective && effective !== previous) for (const listener of listeners) listener(effective);
    return advanced || clearTransient;
  }
  function observe(response: Pick<Response, "status" | "headers">, value: unknown): boolean {
    if (response.status !== 503 || response.headers.get("X-Fells-Maintenance") !== "1" || !value || typeof value !== "object") return false;
    const envelope = value as { error?: { code?: string }; maintenance?: unknown };
    const next = parseMaintenanceStatus(envelope.maintenance);
    if (!["service_maintenance", "service_unavailable"].includes(envelope.error?.code ?? "") || !next || ["normal", "scheduled"].includes(next.mode)) return false;
    return accept(next);
  }
  function read(): Promise<MaintenanceStatus | null> {
    if (pending) return pending;
    const readEpoch = transientEpoch;
    pending = (async () => {
      try {
        const response = await request("/__maintenance/status", { credentials: "omit", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(3000) });
        // A site without the edge route remains usable. A 404 or transport
        // failure never clears a previously confirmed incident.
        if (response.status === 200) accept(await response.json(), readEpoch);
      } catch { /* Keep the last confirmed state; unknown is not healthy. */ }
      return get();
    })().finally(() => { pending = null; });
    return pending;
  }
  return { get, blocked, accept, observe, read,
    subscribe(listener: (value: MaintenanceStatus) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; } };
}

const client = createMaintenanceClient();
export const getMaintenanceStatus = client.get;
export const isBusinessBlocked = client.blocked;
export const observeMaintenanceResponse = client.observe;
export const readMaintenanceStatus = client.read;
export const subscribeMaintenance = client.subscribe;

/** One monitor per document. Importing the transport alone starts no timers. */
export function installMaintenanceMonitor() {
  const refresh = () => { if (!document.hidden && navigator.onLine) void client.read(); };
  const timer = setInterval(refresh, 30000);
  addEventListener("online", refresh); addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", refresh);
  refresh();
  return () => {
    clearInterval(timer); removeEventListener("online", refresh); removeEventListener("focus", refresh);
    document.removeEventListener("visibilitychange", refresh);
  };
}
