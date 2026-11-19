import { api, APIError, API_READ_TIMEOUT_MS } from "./app-http.ts";
import { clearChatDraft, discardDraftBeforeLogout } from "./chat-draft.ts";

type Identity = { userId: number; sessionId: string };
type Logout = { at: number; identity?: Identity; changed?: boolean };
const key = "fells.customer.logout.v1";
const cookieName = "__Host-fells-pending-logout";
let memory: Logout | null = null;
let channel: BroadcastChannel | undefined;
let inFlight: { session: string; result: Promise<void> } | null = null;

function parse(value: string | null): Logout | null {
  if (!value) return null;
  try {
    const record = JSON.parse(value), id = record?.identity;
    if (!Number.isSafeInteger(record?.at) || record.at <= 0) return null;
    if (id !== undefined && (!Number.isSafeInteger(id?.userId) || id.userId <= 0 || !/^[a-f0-9]{64}$/.test(id.sessionId))) return null;
    return record;
  } catch { return null; }
}

export function logoutRecord(): Logout | null {
  let newest = memory;
  for (const name of ["localStorage", "sessionStorage"] as const) {
    try {
      const record = parse(globalThis[name].getItem(key));
      if (record && (!newest || record.at > newest.at || record.at === newest.at && !record.identity)) newest = record;
    } catch { /* Browser storage may be blocked. */ }
  }
  // With Web Storage disabled, an authenticated HTTPS browser may still accept
  // cookies. This fallback holds the public session binding, never a credential.
  if (!newest?.identity && typeof document !== "undefined") {
    try {
      const cookie = document.cookie.split("; ").find(entry => entry.startsWith(cookieName + "="));
      const record = cookie && parse(decodeURIComponent(cookie.slice(cookieName.length + 1)));
      if (record && (!newest || record.at > newest.at)) newest = record;
    } catch { /* Cookies are optional. */ }
  }
  return newest;
}

function notify(record: Logout, local: boolean) {
  memory = record;
  clearChatDraft();
  window.dispatchEvent(new CustomEvent("fells.session.changed", { detail: {
    audience: "customer", reason: record.identity ? "logout-pending" : "logout-finished", local, changed: record.changed,
  } }));
}

function publish(record: Logout) {
  if (typeof window === "undefined") return;
  const value = JSON.stringify(record);
  try { localStorage.setItem(key, value); }
  catch {
    try { sessionStorage.setItem(key, value); } catch { /* Memory still covers this document. */ }
    if (record.identity) {
      try { document.cookie = cookieName + "=" + encodeURIComponent(value) + "; Path=/; Secure; SameSite=Strict; Max-Age=31536000"; } catch { /* Optional storage. */ }
    }
  }
  if (!record.identity) {
    try { document.cookie = cookieName + "=; Path=/; Secure; SameSite=Strict; Max-Age=0"; } catch { /* Optional storage. */ }
  }
  notify(record, true);
  try { channel?.postMessage({ audience: "customer", logoutRecord: value }); } catch { /* Storage events also notify other tabs. */ }
}

if (typeof window !== "undefined") {
  const discardOldDraft = () => {
    const record = logoutRecord();
    if (record) discardDraftBeforeLogout(record.at);
  };
  memory = logoutRecord();
  discardOldDraft();
  window.addEventListener("pageshow", discardOldDraft);
  const receive = (value: string | null) => {
    const record = parse(value);
    if (!record || memory && (record.at < memory.at || record.at === memory.at && (!memory.identity || !!record.identity))) return;
    try { if (!localStorage.getItem(key)) sessionStorage.setItem(key, JSON.stringify(record)); }
    catch { try { sessionStorage.setItem(key, JSON.stringify(record)); } catch { /* Memory only. */ } }
    notify(record, false);
  };
  window.addEventListener("storage", event => { if (event.key === key) receive(event.newValue); });
  try {
    // Already-open tabs running an older client also observe the customer session change.
    channel = new BroadcastChannel("fells.session.changed");
    channel.onmessage = event => { if (event.data?.audience === "customer" && typeof event.data.logoutRecord === "string") receive(event.data.logoutRecord); };
  } catch { /* Optional in private browsing. */ }
}

export function revokeCustomerSession(identity: Identity): Promise<void> {
  if (inFlight?.session === identity.sessionId) return inFlight.result;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_READ_TIMEOUT_MS);
  const result = (async () => {
    let changed = false;
    try {
      const reply = await api("/api/app/session", { method: "DELETE", signal: controller.signal, headers: {
        "X-Fells-Expected-User": String(identity.userId), "X-Fells-Expected-Session": identity.sessionId,
      } });
      if (reply !== undefined && reply?.ok !== true) throw new Error("Unconfirmed sign-out");
    } catch (error) {
      // A bound 401 means this cookie no longer grants access to the old session.
      if (!(error instanceof APIError && error.status === 401)) throw error;
      changed = true;
    } finally { clearTimeout(timer); }
    const record = logoutRecord();
    if (record?.identity?.sessionId === identity.sessionId) publish({ at: record.at, changed });
  })().finally(() => { if (inFlight?.session === identity.sessionId) inFlight = null; });
  inFlight = { session: identity.sessionId, result };
  return result;
}

export function beginCustomerLogout(identity: Identity) {
  publish({ at: Math.max(Date.now(), (logoutRecord()?.at ?? 0) + 1), identity });
  return revokeCustomerSession(identity);
}
