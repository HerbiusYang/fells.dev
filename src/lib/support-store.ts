import { PREVIEW_DB, type Snapshot } from "./preview-store.ts";
import { validateState } from "./preview-state.ts";
import { readSupportImageDimensions } from "./support-image.ts";

export const SUPPORT_CHANNEL = "fells.support.changed.v1";
/** @internal Exported for message-length boundary tests. */
export const MAX_SUPPORT_TEXT = 4_000;
export const MAX_SUPPORT_IMAGE_BYTES = 2 * 1_024 * 1_024;
/** @internal Exported for message-capacity and concurrency tests. */
export const MAX_SUPPORT_MESSAGES = 200;
/** @internal Exported for conversation-capacity boundary tests. */
export const MAX_SUPPORT_CONVERSATIONS = 40;
/** @internal Exported for exact record-size boundary tests. */
export const MAX_SUPPORT_RECORD_BYTES = 8 * 1_024 * 1_024;
const MAX_SUPPORT_BOARD_BYTES = 2 * MAX_SUPPORT_RECORD_BYTES;

export type SupportImage = { name: string; type: string; dataUrl: string; size: number };
type SupportUser = { id: string; name: string; email: string; joined: number; locale: string; workspaceCount: number; credits: number };
type SupportMessage = { id: string; sender: "user" | "agent"; text: string; image?: SupportImage; created: number };
export type SupportConversation = {
  id: string; user: SupportUser; status: "open" | "resolved"; messages: SupportMessage[];
  userReadAt: number; agentReadAt: number; updatedAt: number; demo: boolean;
};
export type SupportAgent = { session: string; name: string; email: string };
export class SupportStorageFull extends Error {}
export class InvalidSupportData extends Error {}
export class SupportSessionEnded extends Error {}

// Local preview data only. These records share the preview's object store so
// checking a session and appending its message are one atomic operation.
const USER_KEY = "support.user", DEMO_KEY = "support.demo", AGENT_KEY = "support.agent";
const MAX_DATE = 8.64e15;
function fail(message = "Invalid support data"): never { throw new InvalidSupportData(message); }
const obj = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : fail();
const str = (value: unknown, max: number): string => typeof value === "string" && value.length <= max ? value : fail();
const num = (value: unknown, max = Number.MAX_VALUE): number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max ? value : fail();
const integer = (value: unknown, max: number): number => Number.isSafeInteger(num(value, max)) ? value as number : fail();
const id = (value: unknown): string => {
  const result = str(value, 64);
  return /^[a-zA-Z0-9_-]+$/.test(result) && !["__proto__", "constructor", "prototype"].includes(result) ? result : fail();
};
const sessionId = (value: unknown): string => {
  const result = str(value, 36);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result) ? result : fail();
};
const localeTag = (value: unknown): string => {
  const result = str(value, 35);
  return /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(result) ? result : fail();
};
const bytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).byteLength;

export function validateSupportImage(value: unknown): SupportImage {
  const image = obj(value), name = str(image.name, 255), type = str(image.type, 20);
  const size = integer(image.size, MAX_SUPPORT_IMAGE_BYTES);
  if (!name.trim() || /[\u0000-\u001f\u007f]/.test(name) || size === 0 || !["image/png", "image/jpeg", "image/webp"].includes(type)) fail("Choose a PNG, JPEG, or WebP image up to 2 MiB");
  const dataUrl = str(image.dataUrl, Math.ceil(MAX_SUPPORT_IMAGE_BYTES / 3) * 4 + 32);
  const prefix = `data:${type};base64,`;
  if (!dataUrl.startsWith(prefix)) fail("Image type does not match its data");
  const payload = dataUrl.slice(prefix.length);
  if (payload.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) fail("Invalid image data");
  let decoded: string;
  try { decoded = atob(payload); } catch { return fail("Invalid image data"); }
  if (decoded.length !== size || btoa(decoded) !== payload) fail("Image size does not match its data");
  if (!readSupportImageDimensions(decoded, type)) fail("Invalid image header or pixel dimensions");
  return { name, type, dataUrl, size };
}

function user(value: unknown): SupportUser {
  const v = obj(value);
  return { id: id(v.id), name: str(v.name, 100), email: str(v.email, 254), joined: num(v.joined, MAX_DATE), locale: localeTag(v.locale), workspaceCount: integer(v.workspaceCount, 50), credits: num(v.credits) };
}

function message(value: unknown): SupportMessage {
  const v = obj(value), text = str(v.text, MAX_SUPPORT_TEXT);
  if (v.sender !== "user" && v.sender !== "agent") fail();
  const image = v.image === undefined ? undefined : validateSupportImage(v.image);
  if (!text.trim() && !image) fail("Write a message or attach an image");
  return { id: id(v.id), sender: v.sender as SupportMessage["sender"], text, ...(image ? { image } : {}), created: num(v.created, MAX_DATE) };
}

// Reconstruct allowlisted fields on both reads and writes. This validator is
// also suitable for the response boundary of a future backend adapter.
/** @internal Exported for malformed-data and storage-boundary regression tests. */
export function validateSupportConversation(value: unknown): SupportConversation {
  const v = obj(value);
  if (v.status !== "open" && v.status !== "resolved" || typeof v.demo !== "boolean" || !Array.isArray(v.messages) || v.messages.length > MAX_SUPPORT_MESSAGES) fail();
  // Array.from visits holes as undefined, so corrupt IndexedDB arrays cannot
  // bypass validation and later become undefined messages during an append.
  const messages = Array.from(v.messages, message);
  if (new Set(messages.map(m => m.id)).size !== messages.length) fail();
  if (messages.some((m, index) => index > 0 && m.created <= messages[index - 1].created)) fail("Support messages must follow their server order");
  const conversation = {
    id: id(v.id), user: user(v.user), status: v.status as SupportConversation["status"], messages,
    userReadAt: num(v.userReadAt, MAX_DATE), agentReadAt: num(v.agentReadAt, MAX_DATE), updatedAt: num(v.updatedAt, MAX_DATE), demo: v.demo,
  };
  const latest = messages.at(-1)?.created ?? 0;
  if (conversation.userReadAt > latest || conversation.agentReadAt > latest) fail("Read position exceeds the conversation history");
  if (bytes(conversation) > MAX_SUPPORT_RECORD_BYTES) throw new SupportStorageFull("Support conversation storage limit reached");
  return conversation;
}

function demoBoard(value: unknown): SupportConversation[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_SUPPORT_CONVERSATIONS) fail();
  const result = Array.from(value, validateSupportConversation);
  if (result.some(c => !c.demo) || new Set(result.map(c => c.id)).size !== result.length) fail();
  if (bytes(result) > MAX_SUPPORT_RECORD_BYTES) throw new SupportStorageFull("Support demo storage limit reached");
  return result;
}

function agent(value: unknown): SupportAgent | null {
  if (value === undefined) return null;
  const v = obj(value), name = str(v.name, 100), email = str(v.email, 254);
  if (!name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail();
  return { session: sessionId(v.session), name, email };
}

function active(value: unknown): Snapshot | null {
  if (value === undefined) return null;
  const v = obj(value);
  try { return { session: sessionId(v.session), revision: integer(v.revision, Number.MAX_SAFE_INTEGER), state: validateState(v.state) }; }
  catch { return fail("Invalid preview session"); }
}

type Records = { active: unknown; customer: unknown; demos: unknown; agent: unknown; typing?: unknown; availability?: unknown };
type Result<T> = { value: T; changed: boolean };
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PREVIEW_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("preview");
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Support storage is blocked"));
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
  });
}

function storageError(error: unknown): unknown {
  return error !== null && typeof error === "object" && "name" in error && error.name === "QuotaExceededError" ? new SupportStorageFull("Support storage is full") : error;
}

async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, records: Records) => Result<T>, typingKey?: string, availabilityKey?: string): Promise<T> {
  const db = await open();
  let changed = false;
  try {
    const value = await new Promise<T>((resolve, reject) => {
      const tx = db.transaction("preview", mode), store = tx.objectStore("preview");
      const records: Records = { active: undefined, customer: undefined, demos: undefined, agent: undefined };
      const reads: [keyof Records, string][] = [["active", "active"], ["customer", USER_KEY], ["demos", DEMO_KEY], ["agent", AGENT_KEY]];
      if (typingKey) reads.push(["typing", typingKey]);
      if (availabilityKey) reads.push(["availability", availabilityKey]);
      let pending = reads.length, result: T, failure: unknown;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(storageError(failure ?? tx.error ?? new Error("Support write aborted")));
      for (const [field, key] of reads) {
        const request = store.get(key);
        request.onsuccess = () => {
          records[field] = request.result;
          if (--pending !== 0) return;
          try { const output = run(store, records); result = output.value; changed = output.changed; }
          catch (error) { failure = error; tx.abort(); }
        };
      }
    });
    if (changed) notifySupport();
    return value;
  } finally { db.close(); }
}

function notifySupport(): void {
  if (typeof BroadcastChannel === "undefined") return;
  let channel: BroadcastChannel | undefined;
  try { channel = new BroadcastChannel(SUPPORT_CHANNEL); channel.postMessage("changed"); }
  catch { /* Focus refresh and atomic session checks remain available. */ }
  finally { try { channel?.close(); } catch { /* Best-effort notification. */ } }
}

function requireUser(records: Records, session: string): Snapshot {
  const current = active(records.active);
  if (!current || current.session !== session) throw new SupportSessionEnded("Customer session ended");
  return current;
}
function requireAgent(records: Records, session: string): SupportAgent {
  const current = agent(records.agent);
  if (!current || current.session !== session) throw new SupportSessionEnded("Support session ended");
  return current;
}
function currentUser(snapshot: Snapshot, locale: string): SupportUser {
  const s = snapshot.state;
  const name = s.profile.name.trim() || s.email.split("@")[0].slice(0, 100) || "Customer";
  return user({ id: snapshot.session, name, email: s.email, joined: s.joined, locale, workspaceCount: s.workspaces.length, credits: s.credits.bonus + s.credits.never + s.credits.period });
}
function customer(records: Records, current: Snapshot): SupportConversation | null {
  if (records.customer === undefined) return null;
  const conversation = validateSupportConversation(records.customer);
  if (conversation.demo || conversation.user.id !== current.session || conversation.id !== `user-${current.session}`) fail("Invalid customer conversation");
  return conversation;
}
function checkBoard(mine: SupportConversation | null, demos: SupportConversation[]): void {
  const conversations = mine ? [...demos, mine] : demos;
  if (conversations.length > MAX_SUPPORT_CONVERSATIONS) throw new SupportStorageFull("Support board conversation limit reached");
  if (new Set(conversations.map(c => c.id)).size !== conversations.length) fail("Duplicate support conversation");
  if (bytes(conversations) > MAX_SUPPORT_BOARD_BYTES) throw new SupportStorageFull("Support board storage limit reached");
}
function saveCustomer(store: IDBObjectStore, records: Records, conversation: SupportConversation): SupportConversation {
  const clean = validateSupportConversation(conversation);
  checkBoard(clean, demoBoard(records.demos));
  store.put(clean, USER_KEY);
  return clean;
}
function saveDemos(store: IDBObjectStore, records: Records, conversations: SupportConversation[]): void {
  const clean = demoBoard(conversations), current = active(records.active);
  checkBoard(current ? customer(records, current) : null, clean);
  store.put(clean, DEMO_KEY);
}

export function readSupport(expectedAgentSession?: string): Promise<SupportConversation[]> {
  return transaction("readonly", (_store, records) => {
    if (expectedAgentSession !== undefined) requireAgent(records, expectedAgentSession);
    else if (!agent(records.agent)) return { value: [], changed: false };
    const current = active(records.active), mine = current ? customer(records, current) : null;
    const conversations = demoBoard(records.demos);
    if (mine && current) conversations.push({ ...mine, user: currentUser(current, mine.user.locale) });
    checkBoard(null, conversations);
    return { value: conversations.sort((a, b) => b.updatedAt - a.updatedAt), changed: false };
  });
}

export async function ensureUserConversation(snapshot: Snapshot, locale: string): Promise<SupportConversation> {
  const cleanLocale = localeTag(locale);
  return transaction("readwrite", (store, records) => {
    const current = requireUser(records, snapshot.session), existing = customer(records, current);
    const nextUser = currentUser(current, cleanLocale);
    if (existing) {
      if (JSON.stringify(existing.user) === JSON.stringify(nextUser)) return { value: existing, changed: false };
      return { value: saveCustomer(store, records, { ...existing, user: nextUser }), changed: true };
    }
    const next: SupportConversation = { id: `user-${current.session}`, user: nextUser, status: "open", messages: [], userReadAt: 0, agentReadAt: 0, updatedAt: Date.now(), demo: false };
    return { value: saveCustomer(store, records, next), changed: true };
  });
}

function newMessage(sender: SupportMessage["sender"], text: string, image?: SupportImage): SupportMessage {
  return message({ id: crypto.randomUUID(), sender, text: str(text, MAX_SUPPORT_TEXT), ...(image === undefined ? {} : { image }), created: Date.now() });
}
function append(conversation: SupportConversation, next: SupportMessage): SupportConversation {
  if (conversation.messages.length >= MAX_SUPPORT_MESSAGES) throw new SupportStorageFull("This conversation has reached its message limit");
  // Strictly increasing times make same-millisecond messages and read receipts
  // deterministic without trusting delayed tab notifications.
  const last = conversation.messages.at(-1);
  next.created = Math.max(next.created, last ? last.created + 1 : 0);
  return { ...conversation, status: "open", messages: [...conversation.messages, next], updatedAt: next.created };
}

export async function sendUserMessage(session: string, text: string, image?: SupportImage): Promise<SupportConversation> {
  const next = newMessage("user", text, image);
  return transaction("readwrite", (store, records) => {
    const current = requireUser(records, session), conversation = customer(records, current);
    if (!conversation) return fail("Open the support conversation before sending");
    const saved = saveCustomer(store, records, append({ ...conversation, user: currentUser(current, conversation.user.locale) }, next));
    store.delete(`support.typing.user.${conversation.id}`);
    return { value: saved, changed: true };
  });
}

export async function markUserRead(session: string, throughCreated?: number): Promise<void> {
  const through = throughCreated === undefined ? MAX_DATE : num(throughCreated, MAX_DATE);
  return transaction("readwrite", (store, records) => {
    const current = requireUser(records, session), conversation = customer(records, current);
    const latest = conversation?.messages.filter(m => m.sender === "agent" && m.created <= through).at(-1)?.created ?? 0;
    if (!conversation || latest <= conversation.userReadAt) return { value: undefined, changed: false };
    saveCustomer(store, records, { ...conversation, userReadAt: latest });
    return { value: undefined, changed: true };
  });
}

export async function beginSupportSession(name: string, email: string): Promise<SupportAgent> {
  const next = agent({ session: crypto.randomUUID(), name: str(name, 100).trim(), email: str(email, 254).trim() })!;
  return transaction("readwrite", store => {
    store.delete(AVAILABILITY_KEY);
    store.put(next, AGENT_KEY);
    return { value: next, changed: true };
  });
}
export function readSupportSession(): Promise<SupportAgent | null> {
  return transaction("readonly", (_store, records) => ({ value: agent(records.agent), changed: false }));
}
export function endSupportSession(session: string): Promise<void> {
  return transaction("readwrite", (store, records) => {
    if (!records.agent || obj(records.agent).session !== session) return { value: undefined, changed: false };
    store.delete(AGENT_KEY);
    store.delete(AVAILABILITY_KEY);
    return { value: undefined, changed: true };
  });
}

function updateConversation<T>(agentSession: string, conversationId: string, change: (conversation: SupportConversation, store: IDBObjectStore) => Result<{ conversation: SupportConversation; value: T }>): Promise<T> {
  const cleanId = id(conversationId);
  return transaction("readwrite", (store, records) => {
    requireAgent(records, agentSession);
    const current = active(records.active), mine = current ? customer(records, current) : null;
    const demos = demoBoard(records.demos);
    const index = demos.findIndex(c => c.id === cleanId), selected = mine?.id === cleanId ? mine : demos[index];
    if (!selected) return fail("Support conversation is no longer available");
    const output = change(selected, store);
    if (!output.changed) return { value: output.value.value, changed: false };
    const clean = validateSupportConversation(output.value.conversation);
    if (mine?.id === cleanId) saveCustomer(store, records, clean);
    else { demos[index] = clean; saveDemos(store, records, demos); }
    return { value: output.value.value, changed: true };
  });
}

export async function sendAgentMessage(agentSession: string, conversationId: string, text: string, image?: SupportImage): Promise<SupportConversation> {
  const next = newMessage("agent", text, image);
  return updateConversation(agentSession, conversationId, (conversation, store) => {
    const updated = append(conversation, next);
    store.delete(`support.typing.agent.${conversation.id}`);
    return { value: { conversation: updated, value: updated }, changed: true };
  });
}
export async function markAgentRead(agentSession: string, conversationId: string, throughCreated?: number): Promise<void> {
  const through = throughCreated === undefined ? MAX_DATE : num(throughCreated, MAX_DATE);
  return updateConversation(agentSession, conversationId, conversation => {
    const latest = conversation.messages.filter(m => m.sender === "user" && m.created <= through).at(-1)?.created ?? 0;
    return { value: { conversation: { ...conversation, agentReadAt: Math.max(conversation.agentReadAt, latest) }, value: undefined }, changed: latest > conversation.agentReadAt };
  });
}
export async function setConversationStatus(agentSession: string, conversationId: string, status: "open" | "resolved"): Promise<void> {
  if (status !== "open" && status !== "resolved") return Promise.reject(new InvalidSupportData("Invalid conversation status"));
  return updateConversation(agentSession, conversationId, (conversation, store) => {
    if (status === "resolved") {
      store.delete(`support.typing.user.${conversation.id}`);
      store.delete(`support.typing.agent.${conversation.id}`);
    }
    return { value: { conversation: { ...conversation, status }, value: undefined }, changed: conversation.status !== status };
  });
}

export function seedSupportDemo(agentSession: string): Promise<void> {
  return transaction("readwrite", (store, records) => {
    requireAgent(records, agentSession);
    if (demoBoard(records.demos).length) return { value: undefined, changed: false };
    const now = Date.now();
    const examples = [
      { id: "demo-alex", name: "Alex Morgan", email: "alex@example.invalid", locale: "en", workspaceCount: 2, credits: 25, text: "How can I invite my team to a workspace?", ago: 8 * 60_000 },
      { id: "demo-lin", name: "林晓", email: "lin@example.invalid", locale: "zh", workspaceCount: 1, credits: 5, text: "你好，请问在哪里查看我的使用额度？", ago: 3 * 60_000 },
      { id: "demo-sam", name: "Sam Rivera", email: "sam@example.invalid", locale: "en", workspaceCount: 3, credits: 12, text: "Thanks, I found the workspace settings.", ago: 24 * 60_000 },
    ];
    const demos = examples.map((example, index): SupportConversation => ({
      id: example.id, user: { id: example.id, name: example.name, email: example.email, joined: now - (index + 2) * 86_400_000, locale: example.locale, workspaceCount: example.workspaceCount, credits: example.credits },
      status: index === 2 ? "resolved" : "open", messages: [{ id: `${example.id}-message`, sender: "user", text: example.text, created: now - example.ago }],
      userReadAt: 0, agentReadAt: index === 2 ? now - example.ago : 0, updatedAt: now - example.ago, demo: true,
    }));
    saveDemos(store, records, demos);
    return { value: undefined, changed: true };
  });
}

const TYPING_TTL = 5000;
type TypingLease = { session: string; sources: { id: string; expires: number }[] };
function typingLease(value: unknown): TypingLease | null {
  if (value === undefined) return null;
  const v = obj(value);
  if (!Array.isArray(v.sources) || v.sources.length > 16) fail("Invalid typing lease");
  const sources = Array.from(v.sources, value => { const source = obj(value); return { id: sessionId(source.id), expires: num(source.expires, MAX_DATE) }; });
  if (new Set(sources.map(source => source.id)).size !== sources.length) fail("Duplicate typing source");
  return { session: sessionId(v.session), sources };
}
function typingConversation(records: Records, viewer: "user" | "agent", session: string, conversationId: string): SupportConversation {
  if (viewer === "user") {
    const current = requireUser(records, session), conversation = customer(records, current);
    if (!conversation || conversation.id !== conversationId) fail("Open the customer conversation first");
    return conversation;
  }
  requireAgent(records, session);
  const current = active(records.active), mine = current ? customer(records, current) : null;
  const conversation = mine?.id === conversationId ? mine : demoBoard(records.demos).find(conversation => conversation.id === conversationId);
  if (!conversation) fail("Support conversation is no longer available");
  return conversation;
}
function readTyping(viewer: "user" | "agent", session: string, conversationId: string): Promise<boolean> {
  const key = `support.typing.${viewer === "user" ? "agent" : "user"}.${id(conversationId)}`;
  return transaction("readonly", (_store, records) => {
    const conversation = typingConversation(records, viewer, session, conversationId);
    const opposite = viewer === "user" ? agent(records.agent)?.session : active(records.active)?.session;
    const lease = typingLease(records.typing);
    return { value: conversation.status === "open" && Boolean(opposite && lease?.session === opposite && lease.sources.some(source => source.expires > Date.now())) && (viewer === "user" || conversation.user.id === opposite), changed: false };
  }, key);
}
function writeTyping(viewer: "user" | "agent", session: string, conversationId: string, typing: boolean, sourceId: string): Promise<void> {
  if (typeof typing !== "boolean") fail("Invalid typing state");
  const source = sessionId(sourceId), key = `support.typing.${viewer}.${id(conversationId)}`;
  return transaction("readwrite", (store, records) => {
    const conversation = typingConversation(records, viewer, session, conversationId);
    const existing = typingLease(records.typing);
    const sources = existing?.session === session ? existing.sources.filter(entry => entry.expires > Date.now() && entry.id !== source) : [];
    if (typing && conversation.status === "open") {
      if (sources.length >= 16) fail("Too many typing sources");
      sources.push({ id: source, expires: Date.now() + TYPING_TTL });
    }
    const next = sources.length ? { session, sources } : undefined;
    const changed = JSON.stringify(next) !== JSON.stringify(records.typing);
    if (changed) { if (next) store.put(next, key); else store.delete(key); }
    return { value: undefined, changed };
  }, key);
}
export const readUserTyping = (session: string) => readTyping("user", session, `user-${session}`);
export const setUserTyping = (session: string, typing: boolean, sourceId: string) => writeTyping("user", session, `user-${session}`, typing, sourceId);
export const readAgentTyping = (session: string, conversationId: string) => readTyping("agent", session, conversationId);
export const setAgentTyping = (session: string, conversationId: string, typing: boolean, sourceId: string) => writeTyping("agent", session, conversationId, typing, sourceId);

const AVAILABILITY_KEY = "support.availability.agent", AVAILABILITY_TTL = 45_000;
export function readSupportAvailability(customerPreviewSession: string): Promise<boolean> {
  return transaction("readonly", (_store, records) => {
    requireUser(records, customerPreviewSession);
    const operator = agent(records.agent), lease = typingLease(records.availability);
    return { value: Boolean(operator && lease?.session === operator.session && lease.sources.some(source => source.expires > Date.now())), changed: false };
  }, undefined, AVAILABILITY_KEY);
}
export function setAgentAvailability(agentSession: string, online: boolean, sourceId: string): Promise<void> {
  if (typeof online !== "boolean") fail("Invalid availability state");
  const source = sessionId(sourceId);
  return transaction("readwrite", (store, records) => {
    requireAgent(records, agentSession);
    const existing = typingLease(records.availability), now = Date.now();
    const sources = existing?.session === agentSession ? existing.sources.filter(entry => entry.expires > now && entry.id !== source) : [];
    if (online) {
      if (sources.length >= 16) fail("Too many availability sources");
      sources.push({ id: source, expires: now + AVAILABILITY_TTL });
    }
    const next = sources.length ? { session: agentSession, sources } : undefined;
    const changed = JSON.stringify(next) !== JSON.stringify(records.availability);
    if (changed) { if (next) store.put(next, AVAILABILITY_KEY); else store.delete(AVAILABILITY_KEY); }
    return { value: undefined, changed };
  }, undefined, AVAILABILITY_KEY);
}
