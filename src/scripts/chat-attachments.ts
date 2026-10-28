import { APIError } from "../lib/app-http";
import { attachmentFileKind, attachmentSupported, CHAT_ATTACHMENT_COUNT, chatAttachmentPath, deleteChatAttachment, inspectAttachmentFile, listChatAttachments, uploadChatAttachment, type ChatAttachment, type ChatAttachmentCapabilities, type ChatAttachmentIdentity } from "../lib/chat-attachments";
import { chatAttachmentWords } from "../i18n/chat-attachments";

const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
type Entry = { key: string; file?: File; attachment?: ChatAttachment; sha256?: string; kind: ChatAttachment["kind"]; state: "uploading" | "ready" | "failed" | "removing"; error?: "invalid" | "failed" | "removeFailed" };
type Draft = { entries: Entry[]; loaded: boolean; restoring: boolean; restoreFailed: boolean; error: string; restoreTask?: Promise<void> };
type Context = { chatID?: string; capabilities?: ChatAttachmentCapabilities; blocked: boolean; enabled: boolean; recover: boolean };
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
  const words = chatAttachmentWords(options.language), drafts = new Map<string, Draft>(), controller = new AbortController();
  let disposed = false, adding = false, notice = "", preview: HTMLDialogElement | null = null;
  const active = () => !disposed && options.active();
  const draft = (id: string) => {
    let value = drafts.get(id);
    if (!value) { value = { entries: [], loaded: false, restoring: false, restoreFailed: false, error: "" }; drafts.set(id, value); }
    return value;
  };
  const fail = (error: unknown) => { if (error instanceof APIError && error.status === 401) options.unauthorized(); };
  const blocked = (id: string | undefined, caps: ChatAttachmentCapabilities | undefined) => {
    const value = id && drafts.get(id);
    return adding || !!value && (value.restoring || value.restoreFailed || value.entries.length > CHAT_ATTACHMENT_COUNT || value.entries.some(entry => entry.state !== "ready" || !attachmentSupported(caps, entry.kind)));
  };
  const draw = () => {
    if (!active()) return;
    const context = options.current(), host = root.querySelector<HTMLElement>("[data-chat-files]");
    if (!host || !context.enabled) return;
    const value = context.chatID ? draft(context.chatID) : undefined;
    const message = notice || value?.error || (value?.restoring ? words.restoring : value?.restoreFailed ? words.failed : "");
    host.innerHTML = `<p class="chat-file-help" id="chat-files-help">${escape(words.help)}</p>${message ? `<p class="chat-file-notice" role="status">${escape(message)}</p>` : ""}${value?.restoreFailed ? `<button type="button" class="btn sm" data-file-restore ${context.blocked ? "disabled" : ""}>${escape(words.restore)}</button>` : ""}<div class="chat-file-list">${(value?.entries ?? []).map(entry => {
      const file = entry.attachment, name = file?.name ?? entry.file?.name ?? "", incompatible = !attachmentSupported(context.capabilities, entry.kind);
      const label = incompatible ? words.unsupported : entry.error ? words[entry.error] : entry.state === "ready" ? words.ready : entry.state === "removing" ? words.remove : words.uploading;
      return `<div class="chat-file" data-file-key="${escape(entry.key)}" data-file-state="${entry.state}" ${incompatible ? 'data-file-unsupported="true"' : ""} aria-busy="${["uploading", "removing"].includes(entry.state)}">${file?.kind === "image" ? `<button type="button" class="chat-file-thumb" data-file-preview="${escape(chatAttachmentPath(context.chatID!, file.id))}" data-file-name="${escape(name)}" aria-label="${escape(`${words.preview}: ${name}`)}"><img src="${escape(chatAttachmentPath(context.chatID!, file.id))}" alt="" decoding="async" referrerpolicy="no-referrer" /></button>` : `<span class="chat-file-symbol" aria-hidden="true">${entry.kind === "image" ? "▧" : "▤"}</span>`}<div class="chat-file-info"><b>${escape(name)}</b><small>${Math.ceil((file?.size ?? entry.file?.size ?? 0) / 1024)} KiB · ${escape(label)}</small></div><div class="chat-file-actions">${entry.state === "failed" ? `<button type="button" data-file-retry="${escape(entry.key)}" ${context.blocked ? "disabled" : ""}>${escape(words.retry)}</button>` : ""}<button type="button" data-file-remove="${escape(entry.key)}" aria-label="${escape(`${words.remove}: ${name}`)}" ${context.blocked || ["uploading", "removing"].includes(entry.state) ? "disabled" : ""}>×</button></div></div>`;
    }).join("")}</div>`;
    const button = root.querySelector<HTMLButtonElement>("[data-form=send] .send");
    if (button) button.disabled = button.dataset.baseDisabled === "true" || blocked(context.chatID, context.capabilities);
    root.querySelectorAll<HTMLButtonElement>("[data-file-pick]").forEach(button => {
      button.disabled = context.blocked || adding || !context.enabled || !["text", "image", "document"].some(kind => attachmentSupported(context.capabilities, kind as ChatAttachment["kind"])) || (value?.entries.length ?? 0) >= CHAT_ATTACHMENT_COUNT;
    });
  };
  function restore(chatID: string): Promise<void> {
    const value = draft(chatID);
    if (value.restoreTask) return value.restoreTask;
    if (!active()) return Promise.resolve();
    value.restoring = true; value.restoreFailed = false; draw();
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
    entry.state = "uploading"; entry.error = undefined; draw();
    try {
      const inspected = entry.sha256 ? { kind: entry.kind, sha256: entry.sha256 } : await inspectAttachmentFile(entry.file);
      entry.sha256 = inspected.sha256;
      if (!active()) return;
      // An upload can commit while its response is lost. Reconcile first; a
      // failed lookup must never turn into another blind upload.
      if (retry) {
        const existing = await listChatAttachments(options.identity, chatID, controller.signal);
        const file = existing.find(file => !file.message_id && !file.run_id && file.sha256 === entry.sha256 && file.name === entry.file!.name && file.size === entry.file!.size && !value.entries.some(other => other !== entry && other.attachment?.id === file.id));
        if (file) { entry.attachment = file; entry.kind = file.kind; entry.state = "ready"; return; }
      }
      const file = await uploadChatAttachment(options.identity, chatID, entry.file, controller.signal);
      if (!active()) return;
      if (file.sha256 !== entry.sha256 || file.name !== entry.file.name || file.size !== entry.file.size || file.kind !== entry.kind || file.message_id || file.run_id) throw new Error("Unconfirmed upload identity");
      entry.attachment = file; entry.state = "ready";
    } catch (error) { if (active()) { fail(error); entry.state = "failed"; entry.error = error instanceof Error && error.message === "invalid_file" ? "invalid" : "failed"; } }
    finally { if (value.entries.includes(entry)) draw(); }
  }
  async function add(files: File[]) {
    const context = options.current();
    const origin = root.querySelector("[data-form=send]");
    if (!active() || adding || context.blocked || !context.enabled || !files.length) return;
    notice = "";
    const existing = context.chatID ? draft(context.chatID).entries.length : 0;
    if (files.length + existing > CHAT_ATTACHMENT_COUNT) { notice = words.limit; draw(); return; }
    const kinds = files.map(attachmentFileKind);
    if (kinds.some(kind => !kind)) { notice = words.invalid; draw(); return; }
    if (kinds.some(kind => !attachmentSupported(context.capabilities, kind!))) { notice = words.unsupported; draw(); return; }
    adding = true; draw();
    try {
      // Validate actual image metadata before creating even an empty chat.
      const inspected = await Promise.all(files.map(inspectAttachmentFile));
      if (!active()) return;
      if (!context.chatID && (!origin || !root.contains(origin))) return;
      if (options.current().blocked || inspected.some(file => !attachmentSupported(options.current().capabilities, file.kind))) { notice = words.unsupported; return; }
      const chatID = context.chatID ?? await options.ensureChat();
      if (!chatID || !active()) return;
      const value = draft(chatID);
      if (!value.loaded) await restore(chatID);
      if (!active() || value.restoreFailed || files.length + value.entries.length > CHAT_ATTACHMENT_COUNT) { if (!value.restoreFailed) notice = words.limit; return; }
      const entries = files.map((file, index): Entry => ({ key: crypto.randomUUID(), file, sha256: inspected[index].sha256, kind: inspected[index].kind, state: "uploading" }));
      value.entries.push(...entries);
      // Bounded serial uploads avoid a slow mobile connection opening four
      // full-size multipart writes at once. Every completed file is usable.
      for (const entry of entries) { if (!active()) break; await upload(chatID, entry); }
    } catch (error) { if (active()) { fail(error); notice = error instanceof Error && error.message === "invalid_file" ? words.invalid : words.failed; } }
    finally { adding = false; draw(); }
  }
  async function remove(chatID: string, entry: Entry) {
    if (!active() || options.current().blocked || ["uploading", "removing"].includes(entry.state)) return;
    const uncertain = entry.error === "removeFailed" || !entry.attachment && entry.state === "failed" && entry.error !== "invalid";
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
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-file-pick],[data-file-retry],[data-file-remove],[data-file-restore],[data-file-preview]") : null;
    if (!target || !active()) return;
    event.preventDefault();
    if (target.dataset.filePreview) { showPreview(target.dataset.filePreview, target.dataset.fileName ?? ""); return; }
    const context = options.current();
    if (context.blocked) return;
    if (target.hasAttribute("data-file-pick")) { root.querySelector<HTMLInputElement>("[data-chat-file-input]")?.click(); return; }
    if (!context.chatID) return;
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
    if (files.length) { event.preventDefault(); void add(files); }
  }, { signal: controller.signal });
  root.addEventListener("dragover", event => {
    if (!(event.target instanceof Element) || !event.target.closest("[data-form=send]") || !event.dataTransfer?.types.includes("Files") || !options.current().enabled) return;
    event.preventDefault(); event.dataTransfer.dropEffect = options.current().blocked ? "none" : "copy";
    event.target.closest("[data-form=send]")?.classList.add("chat-file-dragover");
  }, { signal: controller.signal });
  root.addEventListener("dragleave", event => { if (event.target instanceof Element) event.target.closest("[data-form=send]")?.classList.remove("chat-file-dragover"); }, { signal: controller.signal });
  root.addEventListener("drop", event => {
    if (!(event.target instanceof Element) || !event.target.closest("[data-form=send]") || !options.current().enabled) return;
    event.preventDefault(); event.target.closest("[data-form=send]")?.classList.remove("chat-file-dragover"); void add([...event.dataTransfer?.files ?? []]);
  }, { signal: controller.signal });
  return {
    sync() { if (!active()) return; const context = options.current(); draw(); if (context.enabled && context.recover && context.chatID && !draft(context.chatID).loaded && !draft(context.chatID).restoring && !draft(context.chatID).restoreFailed) void restore(context.chatID); },
    ids(chatID: string, capabilities: ChatAttachmentCapabilities | undefined) { if (blocked(chatID, capabilities)) return null; return (drafts.get(chatID)?.entries ?? []).map(entry => entry.attachment!.id); },
    has(chatID?: string) { return !!chatID && !!drafts.get(chatID)?.entries.length; },
    blocked,
    consumed(chatID: string, ids: string[]) { const value = drafts.get(chatID); if (value) value.entries = value.entries.filter(entry => !entry.attachment || !ids.includes(entry.attachment.id)); draw(); },
    dispose() { disposed = true; controller.abort(); drafts.clear(); preview?.close(); preview?.remove(); preview = null; },
  };
}
