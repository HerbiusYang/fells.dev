import { APIError } from "../lib/app-http";
import { attachmentFileKind, attachmentSupported, CHAT_ATTACHMENT_COUNT, chatAttachmentPath, deleteChatAttachment, inspectAttachmentFile, listChatAttachments, uploadChatAttachment, type ChatAttachment, type ChatAttachmentCapabilities, type ChatAttachmentIdentity } from "../lib/chat-attachments";
import { chatAttachmentWords } from "../i18n/chat-attachments";

const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
type Entry = { key: string; file?: File; attachment?: ChatAttachment; sha256?: string; attempted?: boolean; kind: ChatAttachment["kind"]; state: "checking" | "uploading" | "ready" | "failed" | "removing"; error?: "invalid" | "failed" | "removeFailed" | "restoreFailed" | "limit" };
type Draft = { entries: Entry[]; loaded: boolean; restoring: boolean; restoreFailed: boolean; textOnly: boolean; restoreTask?: Promise<void> };
type Context = { draftKey: string; chatID?: string; capabilities?: ChatAttachmentCapabilities; blocked: boolean; enabled: boolean; recover: boolean };
export function messageAttachments(chatID: string, attachments: ChatAttachment[] | undefined, language: string): string {
  const words = chatAttachmentWords(language);
  return !attachments?.length ? "" : `<div class="chat-message-files">${attachments.map(file => {
    const path = chatAttachmentPath(chatID, file.id);
    return `<div class="chat-message-file">${file.kind === "image" ? `<button type="button" class="chat-image-preview" data-file-preview="${escape(path)}" data-file-name="${escape(file.name)}" aria-label="${escape(`${words.preview}: ${file.name}`)}"><img src="${escape(path)}" alt="${escape(file.name)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" /></button>` : ""}<a href="${escape(path)}" download="${escape(file.name)}" rel="noopener noreferrer">${escape(file.name)}</a><small>${Math.ceil(file.size / 1024)} KiB</small></div>`;
  }).join("")}</div>`;
}

/** Owns transient upload state, never model requests or account data. */
export function createChatAttachments(root: HTMLElement, options: {
  language: string; identity: ChatAttachmentIdentity; current: () => Context; active: () => boolean;
  ensureChat: () => Promise<string | undefined>; unauthorized: () => void;
}) {
  const words = chatAttachmentWords(options.language), drafts = new Map<string, Draft>(), adding = new Map<string, symbol>(), notices = new Map<string, string>(), controller = new AbortController();
  let disposed = false, preview: HTMLDialogElement | null = null;
  const active = () => !disposed && options.active();
  const draft = (id: string) => {
    let value = drafts.get(id);
    if (!value) { value = { entries: [], loaded: false, restoring: false, restoreFailed: false, textOnly: false }; drafts.set(id, value); }
    return value;
  };
  const fail = (error: unknown) => { if (error instanceof APIError && error.status === 401) options.unauthorized(); };
  const chatKey = (id: string) => `chat:${id}`;
  const busyEntry = (entry: Entry) => ["checking", "uploading", "removing"].includes(entry.state);
  const addingBlocked = (context: Context) => context.blocked || adding.has(context.draftKey) || !!context.chatID && draft(context.chatID).entries.some(busyEntry);
  const blocked = (id: string | undefined, caps: ChatAttachmentCapabilities | undefined, scopeKey?: string) => {
    const value = id && drafts.get(id);
    return adding.has(id ? chatKey(id) : scopeKey ?? options.current().draftKey) || !!value && ((!value.textOnly && (value.restoring || value.restoreFailed)) || value.entries.length > CHAT_ATTACHMENT_COUNT || value.entries.some(entry => entry.state !== "ready" || !attachmentSupported(caps, entry.kind)));
  };
  const draw = () => {
    if (!active()) return;
    const context = options.current(), host = root.querySelector<HTMLElement>("[data-chat-files]");
    if (!host || !context.enabled) return;
    const value = context.chatID ? draft(context.chatID) : undefined;
    const busy = adding.has(context.draftKey) || !!value?.entries.some(busyEntry);
    const message = notices.get(context.draftKey) || (value?.restoring ? words.restoring : value?.textOnly ? words.textOnly : value?.restoreFailed ? words.restoreFailed : "");
    host.innerHTML = `<p class="chat-file-help" id="chat-files-help">${escape(words.help)}</p>${message ? `<p class="chat-file-notice" role="status">${escape(message)}</p>` : ""}${value?.restoreFailed ? `<button type="button" class="btn sm" data-file-restore ${context.blocked || busy ? "disabled" : ""}>${escape(words.restore)}</button>${!value.textOnly && !value.entries.length && !busy ? `<button type="button" class="btn sm" data-file-skip ${context.blocked ? "disabled" : ""}>${escape(words.skip)}</button>` : ""}` : ""}<div class="chat-file-list">${(value?.entries ?? []).map(entry => {
      const file = entry.attachment, name = file?.name ?? entry.file?.name ?? "", incompatible = !attachmentSupported(context.capabilities, entry.kind);
      const label = incompatible ? words.unsupported : entry.error ? words[entry.error] : entry.state === "ready" ? words.ready : entry.state === "checking" ? words.restoring : entry.state === "removing" ? words.remove : words.uploading;
      return `<div class="chat-file" data-file-key="${escape(entry.key)}" data-file-state="${entry.state}" ${incompatible ? 'data-file-unsupported="true"' : ""} aria-busy="${busyEntry(entry)}">${file?.kind === "image" ? `<button type="button" class="chat-file-thumb" data-file-preview="${escape(chatAttachmentPath(context.chatID!, file.id))}" data-file-name="${escape(name)}" aria-label="${escape(`${words.preview}: ${name}`)}"><img src="${escape(chatAttachmentPath(context.chatID!, file.id))}" alt="" decoding="async" referrerpolicy="no-referrer" /></button>` : `<span class="chat-file-symbol" aria-hidden="true">${entry.kind === "image" ? "▧" : "▤"}</span>`}<div class="chat-file-info"><b>${escape(name)}</b><small>${Math.ceil((file?.size ?? entry.file?.size ?? 0) / 1024)} KiB · ${escape(label)}</small></div><div class="chat-file-actions">${entry.state === "failed" ? `<button type="button" data-file-retry="${escape(entry.key)}" ${context.blocked || busy ? "disabled" : ""}>${escape(words.retry)}</button>` : ""}<button type="button" data-file-remove="${escape(entry.key)}" aria-label="${escape(`${words.remove}: ${name}`)}" ${context.blocked || busy ? "disabled" : ""}>×</button></div></div>`;
    }).join("")}</div>`;
    const button = root.querySelector<HTMLButtonElement>("[data-form=send] .send");
    if (button) button.disabled = button.dataset.baseDisabled === "true" || context.blocked || blocked(context.chatID, context.capabilities);
    root.querySelectorAll<HTMLButtonElement>("[data-file-pick]").forEach(button => {
      button.disabled = context.blocked || busy || !context.enabled || !["text", "image", "document"].some(kind => attachmentSupported(context.capabilities, kind as ChatAttachment["kind"])) || (value?.entries.length ?? 0) >= CHAT_ATTACHMENT_COUNT;
    });
  };
  function restore(chatID: string): Promise<void> {
    const value = draft(chatID);
    if (value.restoreTask) return value.restoreTask;
    if (!active()) return Promise.resolve();
    value.restoring = true; value.restoreFailed = false; value.textOnly = false; draw();
    value.restoreTask = (async () => {
    try {
      const attachments = await listChatAttachments(options.identity, chatID, controller.signal);
      if (!active()) return;
      const pending = attachments.filter(file => !file.message_id && !file.run_id), ids = new Set(pending.map(file => file.id));
      value.entries = value.entries.filter(entry => !entry.attachment || ids.has(entry.attachment.id));
      for (const file of pending) if (!value.entries.some(entry => entry.attachment?.id === file.id)) {
        const ambiguous = value.entries.find(entry => !entry.attachment && entry.sha256 === file.sha256 && entry.file?.name === file.name && entry.file.size === file.size);
        if (ambiguous) { ambiguous.attachment = file; ambiguous.state = "ready"; ambiguous.error = undefined; }
        else value.entries.push({ key: file.id, attachment: file, kind: file.kind, state: "ready" });
      }
      value.loaded = true;
    } catch (error) { if (active()) { fail(error); value.restoreFailed = true; } }
    finally { value.restoring = false; value.restoreTask = undefined; draw(); }
    })();
    return value.restoreTask;
  }
  async function upload(chatID: string, entry: Entry, retry = false) {
    const value = draft(chatID);
    if (!active() || !entry.file) return;
    entry.state = retry ? "checking" : "uploading"; entry.error = undefined; draw();
    try {
      const inspected = entry.sha256 ? { kind: entry.kind, sha256: entry.sha256 } : await inspectAttachmentFile(entry.file);
      entry.sha256 = inspected.sha256;
      if (!active()) return;
      // An upload can commit while its response is lost. Reconcile first; a
      // failed lookup must never turn into another blind upload.
      if (retry) {
        await restore(chatID);
        if (!active() || !value.entries.includes(entry)) return;
        if (value.restoreFailed) throw new Error("restore_failed");
        if (entry.attachment) { entry.state = "ready"; return; }
        if (value.entries.length > CHAT_ATTACHMENT_COUNT) throw new Error("attachment_limit");
      }
      entry.state = "uploading"; entry.attempted = true; draw();
      const file = await uploadChatAttachment(options.identity, chatID, entry.file, controller.signal);
      if (!active()) return;
      if (file.sha256 !== entry.sha256 || file.name !== entry.file.name || file.size !== entry.file.size || file.kind !== entry.kind || file.message_id || file.run_id) throw new Error("Unconfirmed upload identity");
      entry.attachment = file; entry.state = "ready";
    } catch (error) { if (active()) { fail(error); entry.state = "failed"; entry.error = error instanceof Error && error.message === "invalid_file" ? "invalid" : error instanceof Error && error.message === "restore_failed" ? "restoreFailed" : error instanceof Error && error.message === "attachment_limit" ? "limit" : "failed"; } }
    finally { if (value.entries.includes(entry)) draw(); }
  }
  async function add(files: File[]) {
    const context = options.current();
    if (!active() || !context.enabled || !files.length) return;
    if (addingBlocked(context)) { notices.set(context.draftKey, words.busy); draw(); return; }
    notices.delete(context.draftKey);
    const existing = context.chatID ? draft(context.chatID).entries.length : 0;
    if (files.length + existing > CHAT_ATTACHMENT_COUNT) { notices.set(context.draftKey, words.limit); draw(); return; }
    const kinds = files.map(attachmentFileKind);
    if (kinds.some(kind => !kind)) { notices.set(context.draftKey, words.invalid); draw(); return; }
    if (kinds.some(kind => !attachmentSupported(context.capabilities, kind!))) { notices.set(context.draftKey, words.unsupported); draw(); return; }
    const operation = Symbol(); let operationKey = context.draftKey;
    adding.set(operationKey, operation); draw();
    try {
      // Validate actual image metadata before creating even an empty chat.
      const inspected = await Promise.all(files.map(inspectAttachmentFile));
      if (!active()) return;
      const current = options.current();
      // Account reads may redraw this same draft while SHA validation waits.
      // Keep that selection by its identity/scope, not an obsolete form node;
      // navigating to a different draft must still prevent chat creation.
      if (!context.chatID && (current.draftKey !== context.draftKey || !current.enabled)) return;
      if (current.draftKey === context.draftKey && (current.blocked || inspected.some(file => !attachmentSupported(current.capabilities, file.kind)))) { notices.set(operationKey, words.unsupported); return; }
      const chatID = context.chatID ?? await options.ensureChat();
      if (!chatID || !active()) return;
      if (operationKey !== chatKey(chatID)) {
        if (adding.get(operationKey) === operation) adding.delete(operationKey);
        operationKey = chatKey(chatID); adding.set(operationKey, operation);
      }
      const value = draft(chatID);
      const entries = files.map((file, index): Entry => ({ key: crypto.randomUUID(), file, sha256: inspected[index].sha256, kind: inspected[index].kind, state: "checking" }));
      value.entries.push(...entries);
      if (!value.loaded || value.textOnly || value.restoreFailed) await restore(chatID);
      if (!active()) return;
      if (value.restoreFailed || value.entries.length > CHAT_ATTACHMENT_COUNT) {
        for (const entry of entries) if (!entry.attachment) { entry.state = "failed"; entry.error = value.restoreFailed ? "restoreFailed" : "limit"; }
        return;
      }
      // Bounded serial uploads avoid a slow mobile connection opening four
      // full-size multipart writes at once. Every completed file is usable.
      for (const entry of entries) { if (!active()) break; if (!entry.attachment) await upload(chatID, entry); }
    } catch (error) { if (active()) { fail(error); notices.set(operationKey, error instanceof Error && error.message === "invalid_file" ? words.invalid : words.failed); } }
    finally { if (adding.get(operationKey) === operation) adding.delete(operationKey); draw(); }
  }
  async function remove(chatID: string, entry: Entry) {
    if (!active() || options.current().blocked || draft(chatID).entries.some(busyEntry) || adding.has(chatKey(chatID))) return;
    const uncertain = entry.error === "removeFailed" || !entry.attachment && entry.attempted === true;
    entry.state = "removing"; draw();
    try {
      // Removal never creates an upload. A lost upload/delete response is
      // resolved by a read; failure to read keeps the entry blocked.
      if (uncertain) {
        const existing = await listChatAttachments(options.identity, chatID, controller.signal);
        const file = entry.attachment ? existing.find(file => file.id === entry.attachment!.id) : existing.find(file => !file.message_id && !file.run_id && file.sha256 === entry.sha256 && file.name === entry.file?.name && file.size === entry.file?.size && !draft(chatID).entries.some(other => other !== entry && other.attachment?.id === file.id));
        if (file?.message_id || file?.run_id) throw new Error("Attachment is already bound");
        entry.attachment = file;
      }
      if (entry.attachment) await deleteChatAttachment(options.identity, chatID, entry.attachment.id, controller.signal);
      if (active()) draft(chatID).entries = draft(chatID).entries.filter(value => value !== entry);
    } catch (error) { if (active()) { fail(error); entry.state = "failed"; entry.error = "removeFailed"; } }
    finally { draw(); }
  }
  function showPreview(path: string, name: string) {
    if (!/^\/api\/app\/chats\/[a-zA-Z0-9_-]{1,64}\/attachments\/[a-zA-Z0-9_-]{1,64}$/.test(path)) return;
    preview?.close(); preview?.remove();
    const dialog = document.createElement("dialog"); preview = dialog; dialog.className = "chat-file-dialog";
    const title = document.createElement("h2"); title.textContent = name; title.id = "chat-file-preview-title";
    const image = document.createElement("img"); image.src = path; image.alt = name; image.referrerPolicy = "no-referrer";
    const close = document.createElement("button"); close.type = "button"; close.textContent = words.close; close.className = "chat-file-dialog-close"; close.onclick = () => preview?.close();
    preview.setAttribute("aria-labelledby", title.id); preview.append(close, title, image); document.body.append(preview);
    preview.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
    preview.addEventListener("close", () => { dialog.remove(); if (preview === dialog) preview = null; }, { once: true });
    preview.showModal(); close.focus();
  }
  root.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-file-pick],[data-file-retry],[data-file-remove],[data-file-restore],[data-file-skip],[data-file-preview]") : null;
    if (!target || !active()) return;
    event.preventDefault();
    if (target.dataset.filePreview) { showPreview(target.dataset.filePreview, target.dataset.fileName ?? ""); return; }
    const context = options.current();
    if (context.blocked) return;
    if (target.hasAttribute("data-file-pick")) { root.querySelector<HTMLInputElement>("[data-chat-file-input]")?.click(); return; }
    if (!context.chatID) return;
    const value = draft(context.chatID);
    if (target.hasAttribute("data-file-skip")) {
      if (value.restoreFailed && !value.restoring && !value.entries.length && !adding.has(context.draftKey)) { value.textOnly = true; draw(); }
      return;
    }
    if (adding.has(context.draftKey) || value.entries.some(busyEntry)) return;
    if (target.hasAttribute("data-file-restore")) { void restore(context.chatID); return; }
    const entry = draft(context.chatID).entries.find(value => value.key === (target.dataset.fileRetry ?? target.dataset.fileRemove));
    if (!entry) return;
    if (target.hasAttribute("data-file-remove")) void remove(context.chatID, entry);
    else if (entry.error === "removeFailed") void remove(context.chatID, entry);
    else if (entry.state === "failed") void upload(context.chatID, entry, true);
  }, { signal: controller.signal });
  root.addEventListener("change", event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.matches("[data-chat-file-input]")) return;
    const files = [...input.files ?? []]; input.value = ""; void add(files);
  }, { signal: controller.signal });
  root.addEventListener("paste", event => {
    if (!(event.target instanceof Element) || !event.target.closest("[data-form=send]") || !options.current().enabled) return;
    const files = [...event.clipboardData?.files ?? []].filter(file => file.type.startsWith("image/"));
    // A mixed clipboard also carries useful text. Keep the textarea's native
    // text insertion even when its image cannot be accepted right now.
    if (files.length) { if (!event.clipboardData?.getData("text/plain")) event.preventDefault(); void add(files); }
  }, { signal: controller.signal });
  root.addEventListener("dragover", event => {
    if (!(event.target instanceof Element) || !event.target.closest("[data-form=send]") || !event.dataTransfer?.types.includes("Files") || !options.current().enabled) return;
    event.preventDefault(); event.dataTransfer.dropEffect = addingBlocked(options.current()) ? "none" : "copy";
    event.target.closest("[data-form=send]")?.classList.add("chat-file-dragover");
  }, { signal: controller.signal });
  root.addEventListener("dragleave", event => { if (event.target instanceof Element) event.target.closest("[data-form=send]")?.classList.remove("chat-file-dragover"); }, { signal: controller.signal });
  root.addEventListener("drop", event => {
    if (!(event.target instanceof Element) || !event.target.closest("[data-form=send]") || !event.dataTransfer?.types.includes("Files") || !options.current().enabled) return;
    event.preventDefault(); event.target.closest("[data-form=send]")?.classList.remove("chat-file-dragover"); void add([...event.dataTransfer?.files ?? []]);
  }, { signal: controller.signal });
  return {
    sync() { if (!active()) return; const context = options.current(); draw(); if (context.enabled && context.recover && context.chatID && !draft(context.chatID).loaded && !draft(context.chatID).restoring && !draft(context.chatID).restoreFailed) void restore(context.chatID); },
    ids(chatID: string, capabilities: ChatAttachmentCapabilities | undefined) { if (blocked(chatID, capabilities)) return null; return (drafts.get(chatID)?.entries ?? []).map(entry => entry.attachment!.id); },
    has(chatID?: string) { return !!chatID && !!drafts.get(chatID)?.entries.length; },
    blocked,
    beginSend(chatID: string) { const value = drafts.get(chatID); if (value) value.textOnly = false; },
    consumed(chatID: string, ids: string[]) { const value = drafts.get(chatID); if (value) value.entries = value.entries.filter(entry => !entry.attachment || !ids.includes(entry.attachment.id)); draw(); },
    dispose() { disposed = true; controller.abort(); drafts.clear(); adding.clear(); notices.clear(); preview?.close(); preview?.remove(); preview = null; },
  };
}
