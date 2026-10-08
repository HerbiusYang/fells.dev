import { freshState, validateState, InvalidState, type PreviewState } from "./preview-state.ts";

export const PREVIEW_DB = "fells.preview.v2";
export const PREVIEW_CHANNEL = "fells.preview.changed.v2";
export type Snapshot = { session: string; revision: number; state: PreviewState };
export class StaleState extends Error {}
export class EndedSession extends Error {}

// Do not migrate v1: it contains plaintext environment secrets and unsafe IDs.
export function removeLegacyStorage() {
  localStorage.removeItem("fells.app.v1");
  localStorage.removeItem("fells.email");
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PREVIEW_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("preview");
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Preview storage is blocked"));
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
  });
}

function snapshot(value: unknown): Snapshot | null {
  if (value === undefined || value === null) return null;
  const v = value as Snapshot;
  if (!v || typeof v.session !== "string" || !/^[\w-]{36}$/.test(v.session) || !Number.isSafeInteger(v.revision) || v.revision < 0) throw new InvalidState("Invalid session");
  return { session: v.session, revision: v.revision, state: validateState(v.state) };
}

// Compare and write in ONE readwrite transaction. A notification is only for UI
// freshness; missed/delayed notifications cannot authorize a stale write.
async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, value: unknown) => T): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction("preview", mode);
      const store = tx.objectStore("preview");
      let result: T, failure: unknown;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(failure ?? tx.error ?? new Error("Preview write aborted"));
      const request = store.get("active");
      request.onsuccess = () => {
        try { result = run(store, request.result); }
        catch (error) { failure = error; tx.abort(); }
      };
    });
  } finally { db.close(); }
}

function notifyPreview() {
  if (typeof BroadcastChannel === "undefined") return;
  // A best-effort UI notification must not turn a committed write into a
  // reported failure (some browser policies disable this API).
  let channel: BroadcastChannel | undefined;
  try {
    channel = new BroadcastChannel(PREVIEW_CHANNEL);
    channel.postMessage("changed");
  } catch { /* Focus refresh and transaction checks still protect stale tabs. */ }
  finally { channel?.close(); }
}

export async function beginPreview(email: string, bonus: number): Promise<Snapshot> {
  removeLegacyStorage();
  const next = { session: crypto.randomUUID(), revision: 0, state: validateState({ ...freshState(bonus), email }) };
  await transaction("readwrite", (store, previous) => {
    // Customer support belongs to this preview session. Keep fictional support
    // demos separate so an account switch cannot expose the previous customer.
    store.delete("support.user");
    const oldSession = (previous as Snapshot | undefined)?.session;
    if (typeof oldSession === "string" && /^[\w-]{36}$/.test(oldSession)) {
      store.delete(`support.typing.user.user-${oldSession}`);
      store.delete(`support.typing.agent.user-${oldSession}`);
    }
    store.put(next, "active");
  });
  notifyPreview();
  return next;
}

export function readPreview(): Promise<Snapshot | null> {
  return transaction("readonly", (_store, value) => snapshot(value));
}

export async function commitPreview(expected: Snapshot, state: PreviewState): Promise<Snapshot> {
  const clean = validateState(state);
  const next = await transaction("readwrite", (store, value) => {
    const current = snapshot(value);
    if (!current || current.session !== expected.session) throw new EndedSession("Preview ended");
    if (current.revision !== expected.revision) throw new StaleState("Preview changed in another tab");
    const next = { session: current.session, revision: current.revision + 1, state: clean };
    store.put(next, "active");
    return next;
  });
  notifyPreview();
  return next;
}

export async function endPreview(session: string): Promise<void> {
  removeLegacyStorage();
  await transaction("readwrite", (store, value) => {
    // A stale page must never delete a newer user's session. Deletion does not
    // serialize chat data, so a large draft cannot block logout.
    if (value && (value as Snapshot).session === session) {
      store.delete("support.user");
      store.delete(`support.typing.user.user-${session}`);
      store.delete(`support.typing.agent.user-${session}`);
      store.delete("active");
    }
  });
  notifyPreview();
}
