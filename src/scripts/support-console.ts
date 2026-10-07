import {
  beginSupportSession, readSupportSession, endSupportSession, readSupport,
  sendAgentMessage, markAgentRead, setConversationStatus, seedSupportDemo,
  SUPPORT_CHANNEL, SupportSessionEnded, type SupportAgent, type SupportConversation, type SupportImage,
} from "../lib/support-service";
import { PREVIEW_CHANNEL } from "../lib/preview-store";
import { prepareSupportImage, escapeSupport, renderSupportMessages, supportError, supportUnread, installSupportImageViewer } from "../lib/support-ui";
import type { SupportCopy } from "../i18n/support";

const login = document.querySelector<HTMLElement>("[data-support-login]");
if (login) {
  const copy = JSON.parse(login.dataset.supportCopy!) as SupportCopy;
  const form = login.querySelector<HTMLFormElement>("[data-support-login-form]")!;
  const error = login.querySelector<HTMLElement>("[data-support-login-error]")!;
  const submit = form.querySelector<HTMLButtonElement>("[type=submit]")!;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submit.disabled || window.self !== window.top) return;
    submit.disabled = true;
    error.textContent = "";
    try {
      const nameInput = form.querySelector<HTMLInputElement>("#support-name")!;
      const name = nameInput.value.trim();
      const email = form.querySelector<HTMLInputElement>("#support-email")!.value.trim();
      if (!name) nameInput.value = "";
      if (!name || !email) { form.reportValidity(); return; }
      await beginSupportSession(name, email);
      location.replace(login.dataset.supportNext!);
    } catch (failure) { error.textContent = supportError(failure, copy); }
    finally { submit.disabled = false; }
  });
  if (window.self !== window.top) error.textContent = copy.frameBlocked;
  else form.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input,button").forEach(control => { control.disabled = false; });
}

const consoleRoot = document.querySelector<HTMLElement>("[data-support-console]");
if (consoleRoot) void startConsole(consoleRoot);

async function startConsole(root: HTMLElement) {
  const copy = JSON.parse(root.dataset.supportCopy!) as SupportCopy;
  const lang = root.dataset.supportLang || "en";
  const find = <T extends HTMLElement = HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const error = find("[data-support-error]");
  const list = find("[data-support-list]");
  const chat = find("[data-support-chat]");
  const selectionEmpty = find("[data-support-selection-empty]");
  const messages = find("[data-support-messages]");
  const text = find<HTMLTextAreaElement>("[data-support-text]");
  const file = find<HTMLInputElement>("[data-support-file]");
  const send = find<HTMLButtonElement>("[data-support-send]");
  const attach = find<HTMLButtonElement>("[data-support-attach]");
  const status = find<HTMLButtonElement>("[data-support-status]");
  const logout = find<HTMLButtonElement>("[data-support-logout]");
  const seed = find<HTMLButtonElement>("[data-support-seed]");
  const search = find<HTMLInputElement>("[data-support-search]");
  const details = find("[data-support-detail-panel]");
  const imagePreview = find("[data-support-attachment]");
  const imageElement = find<HTMLImageElement>("[data-support-attachment-image]");
  const draftByConversation = new Map<string, { text: string; image?: SupportImage }>();
  let agent: SupportAgent | null = null;
  let conversations: SupportConversation[] = [];
  let activeId = "";
  let filter = "all";
  let busy = false;
  let disposed = false;
  let refreshing = false;
  let refreshAgain = false;
  let renderedConversation = "";
  let renderedMessages = "";
  let imageViewer: ReturnType<typeof installSupportImageViewer> | undefined;
  const channels: BroadcastChannel[] = [];
  let interval: ReturnType<typeof setInterval> | undefined;

  function initial(name: string) {
    const words = name.trim().split(/\s+/);
    return (words.length > 1 ? words[0][0] + words[words.length - 1][0] : name.slice(0, 2)).toLocaleUpperCase(lang);
  }
  function selected() { return conversations.find(conversation => conversation.id === activeId); }
  function draft() {
    let value = draftByConversation.get(activeId);
    if (!value) { value = { text: "" }; draftByConversation.set(activeId, value); }
    return value;
  }
  function showError(failure: unknown) {
    if (disposed) return;
    if (failure instanceof SupportSessionEnded) { leave(); return; }
    error.textContent = supportError(failure, copy);
  }
  function resetError() { error.textContent = ""; }
  function stop() {
    disposed = true;
    if (interval) clearInterval(interval);
    channels.forEach(channel => channel.close());
    removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVisibility);
    imageViewer?.dispose();
    conversations = [];
    activeId = "";
    draftByConversation.clear();
    root.replaceChildren();
  }
  function leave() {
    stop();
    // Remove customer information before navigating, including in a stale tab.
    conversations = [];
    activeId = "";
    draftByConversation.clear();
    list.replaceChildren();
    messages.replaceChildren();
    chat.hidden = true;
    details.hidden = true;
    text.value = "";
    root.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement>("button,input,textarea").forEach(control => { control.disabled = true; });
    location.replace(root.dataset.supportLoginUrl!);
  }
  function controls() {
    if (disposed) return;
    const unavailable = busy || disposed || !agent;
    send.disabled = unavailable || !selected() || !(text.value.trim() || draftByConversation.get(activeId)?.image);
    text.disabled = unavailable || !selected();
    file.disabled = unavailable || !selected();
    attach.disabled = unavailable || !selected();
    status.disabled = unavailable || !selected();
    logout.disabled = unavailable;
    seed.disabled = unavailable;
    search.disabled = unavailable;
    root.querySelectorAll<HTMLButtonElement>("[data-support-filter]").forEach(control => { control.disabled = unavailable; });
    find<HTMLButtonElement>("[data-support-remove-image]").disabled = unavailable;
  }
  function renderDraft() {
    const current = draft();
    text.value = current.text;
    imagePreview.hidden = !current.image;
    if (current.image) {
      imageElement.src = current.image.dataUrl;
      imageElement.alt = current.image.name;
      find("[data-support-attachment-name]").textContent = current.image.name;
    } else { imageElement.removeAttribute("src"); find("[data-support-attachment-name]").textContent = ""; }
    controls();
  }
  function renderList() {
    const counts = { all: conversations.length, open: conversations.filter(c => c.status === "open").length, unread: conversations.filter(c => supportUnread(c, "agent") > 0).length, resolved: conversations.filter(c => c.status === "resolved").length };
    Object.entries(counts).forEach(([key, value]) => { find(`[data-support-count="${key}"]`).textContent = String(value); });
    find("[data-support-total]").textContent = String(counts.all);
    find("[data-support-customers]").textContent = String(new Set(conversations.map(c => c.user.id)).size);
    find("[data-support-waiting]").textContent = String(conversations.filter(c => c.status === "open" && c.messages.at(-1)?.sender === "user").length);
    const query = search.value.trim().toLocaleLowerCase(lang);
    const filtered = conversations.filter(conversation => {
      if (filter === "open" && conversation.status !== "open") return false;
      if (filter === "resolved" && conversation.status !== "resolved") return false;
      if (filter === "unread" && !supportUnread(conversation, "agent")) return false;
      return !query || [conversation.user.name, conversation.user.email, conversation.user.id, ...conversation.messages.map(message => message.text)].some(value => value.toLocaleLowerCase(lang).includes(query));
    }).sort((left, right) => right.updatedAt - left.updatedAt);
    if (!conversations.length) {
      list.innerHTML = `<div class="support-inbox-empty"><span class="support-empty-symbol" aria-hidden="true">↗</span><h2>${escapeSupport(copy.emptyInbox)}</h2><p>${escapeSupport(copy.emptyInboxBody)}</p><button class="support-secondary-button" type="button" data-support-seed-empty>${escapeSupport(copy.seed)}</button></div>`;
      list.querySelector("[data-support-seed-empty]")?.addEventListener("click", () => { void seedConversations(); });
      return;
    }
    if (!filtered.length) { list.innerHTML = `<p class="support-no-results">${escapeSupport(copy.noResults)}</p>`; return; }
    const markup = filtered.map(conversation => {
      const last = conversation.messages.at(-1);
      const unread = supportUnread(conversation, "agent");
      const time = new Intl.DateTimeFormat(lang, { month: "short", day: "numeric" }).format(conversation.updatedAt);
      return `<button class="support-conversation${conversation.id === activeId ? " is-active" : ""}" type="button" data-support-conversation="${escapeSupport(conversation.id)}" aria-pressed="${conversation.id === activeId}"><span class="support-avatar">${escapeSupport(initial(conversation.user.name))}</span><span class="support-conversation-content"><span class="support-conversation-name"><strong>${escapeSupport(conversation.user.name)}</strong><time datetime="${new Date(conversation.updatedAt).toISOString()}">${escapeSupport(time)}</time></span><span class="support-conversation-email">${escapeSupport(conversation.user.email)}</span><span class="support-conversation-preview">${escapeSupport(last?.text || (last?.image ? copy.imageAlt : copy.noMessages))}</span><span class="support-conversation-bottom"><span class="support-conversation-state${conversation.status === "resolved" ? " is-resolved" : ""}">${escapeSupport(conversation.status === "resolved" ? copy.resolved : copy.openStatus)}</span>${unread ? `<span class="support-unread-badge" aria-label="${escapeSupport(copy.newMessages)}: ${unread}">${unread}</span>` : `<span class="support-conversation-sample">${escapeSupport(conversation.demo ? copy.sample : copy.previewUser)}</span>`}</span></span></button>`;
    }).join("");
    if (list.innerHTML !== markup) list.innerHTML = markup;
  }
  function renderConversation() {
    const conversation = selected();
    chat.hidden = !conversation;
    selectionEmpty.hidden = Boolean(conversation);
    details.hidden = !conversation;
    if (!conversation) {
      imageViewer?.close();
      renderedConversation = ""; renderedMessages = "";
      messages.replaceChildren();
      text.value = "";
      imagePreview.hidden = true;
      imageElement.removeAttribute("src");
      find("[data-support-attachment-name]").textContent = "";
      find("[data-support-customer-initials]").textContent = "";
      find("[data-support-customer-name]").textContent = "";
      find("[data-support-customer-type]").textContent = "";
      ["initials", "name", "email", "type", "id", "joined", "workspaces", "credits", "language", "status"].forEach(key => { find(`[data-support-detail-${key}]`).textContent = ""; });
      controls(); return;
    }
    const customerType = conversation.demo ? copy.sample : copy.previewUser;
    find("[data-support-customer-initials]").textContent = initial(conversation.user.name);
    find("[data-support-customer-name]").textContent = conversation.user.name;
    find("[data-support-customer-type]").textContent = customerType;
    status.textContent = conversation.status === "resolved" ? copy.reopen : copy.resolve;
    status.dataset.nextStatus = conversation.status === "resolved" ? "open" : "resolved";
    status.classList.toggle("is-resolved", conversation.status === "resolved");
    find("[data-support-resolved-notice]").hidden = conversation.status !== "resolved";
    const values: Record<string, string> = {
      initials: initial(conversation.user.name), name: conversation.user.name, email: conversation.user.email, type: customerType, id: conversation.user.id,
      joined: new Intl.DateTimeFormat(lang, { year: "numeric", month: "short", day: "numeric" }).format(conversation.user.joined),
      workspaces: String(conversation.user.workspaceCount), credits: new Intl.NumberFormat(lang, { maximumFractionDigits: 2 }).format(conversation.user.credits), language: conversation.user.locale,
      status: conversation.status === "resolved" ? copy.resolved : copy.openStatus,
    };
    Object.entries(values).forEach(([key, value]) => { find(`[data-support-detail-${key}]`).textContent = value; });
    const markup = renderSupportMessages(conversation, copy, lang) || `<p class="support-no-messages">${escapeSupport(copy.noMessages)}</p>`;
    if (renderedConversation !== conversation.id || renderedMessages !== markup) {
      const atBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 100;
      const switching = renderedConversation !== conversation.id;
      messages.innerHTML = markup;
      renderedConversation = conversation.id;
      renderedMessages = markup;
      if (switching || atBottom) requestAnimationFrame(() => { messages.scrollTop = messages.scrollHeight; });
    }
    controls();
  }
  async function refresh(markRead = true) {
    if (disposed || !agent) return;
    if (refreshing) { refreshAgain = true; return; }
    refreshing = true;
    try {
      const currentAgent = await readSupportSession();
      if (disposed) return;
      if (!currentAgent || currentAgent.session !== agent.session) { leave(); return; }
      const next = await readSupport(agent.session);
      if (disposed) return;
      const confirmedAgent = await readSupportSession();
      if (disposed) return;
      if (!confirmedAgent || confirmedAgent.session !== agent.session) { leave(); return; }
      conversations = next;
      for (const id of draftByConversation.keys()) {
        if (!conversations.some(conversation => conversation.id === id)) draftByConversation.delete(id);
      }
      if (activeId && !selected()) { activeId = ""; root.dataset.active = "false"; }
      const current = selected();
      const detailsCoverChat = root.dataset.details === "true" && matchMedia("(max-width: 1350px)").matches;
      if (markRead && current && supportUnread(current, "agent") && document.visibilityState === "visible" && document.hasFocus() && !detailsCoverChat && !imageViewer?.isOpen()) {
        await markAgentRead(agent.session, current.id, current.messages.at(-1)?.created ?? 0);
        conversations = await readSupport(agent.session);
        if (disposed) return;
      }
      renderList();
      renderConversation();
    } catch (failure) { showError(failure); }
    finally {
      refreshing = false;
      if (refreshAgain && !disposed) { refreshAgain = false; void refresh(); }
    }
  }
  async function selectConversation(id: string) {
    if (busy || disposed || !conversations.some(c => c.id === id)) return;
    if (activeId) draft().text = text.value;
    imageViewer?.close();
    activeId = id;
    root.dataset.active = "true";
    root.dataset.details = "false";
    find<HTMLButtonElement>("[data-support-details]").setAttribute("aria-expanded", "false");
    resetError();
    renderList(); renderConversation(); renderDraft();
    await refresh();
    if (innerWidth > 760 && !disposed) text.focus();
  }
  async function seedConversations() {
    if (!agent || busy || disposed) return;
    busy = true; controls(); resetError();
    try { await seedSupportDemo(agent.session); await refresh(false); }
    catch (failure) { showError(failure); }
    finally { busy = false; controls(); }
  }
  function onFocus() { void refresh(); }
  function onVisibility() { if (document.visibilityState === "visible") void refresh(); }

  if (window.self !== window.top) {
    error.textContent = copy.frameBlocked;
    list.replaceChildren();
    return;
  }
  imageViewer = installSupportImageViewer(root, copy, () => { void refresh(); });
  try {
    agent = await readSupportSession();
    if (!agent) { leave(); return; }
    find("[data-support-agent-initials]").textContent = initial(agent.name);
    find("[data-support-agent-name]").textContent = agent.name;
    find("[data-support-agent-email]").textContent = agent.email;
    await refresh();
    controls();
  } catch {
    error.textContent = copy.unavailable;
    list.replaceChildren();
    return;
  }
  if (disposed) return;
  list.addEventListener("click", event => {
    const button = (event.target as Element).closest<HTMLElement>("[data-support-conversation]");
    if (button) void selectConversation(button.dataset.supportConversation!);
  });
  search.addEventListener("input", renderList);
  root.querySelectorAll<HTMLButtonElement>("[data-support-filter]").forEach(button => button.addEventListener("click", () => {
    filter = button.dataset.supportFilter!;
    root.querySelectorAll("[data-support-filter]").forEach(control => control.setAttribute("aria-pressed", String(control === button)));
    renderList();
  }));
  text.addEventListener("input", () => { if (activeId) draft().text = text.value; controls(); });
  text.addEventListener("keydown", event => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.isComposing) {
      event.preventDefault();
      if (!send.disabled) find<HTMLFormElement>("[data-support-composer]").requestSubmit();
    }
  });
  attach.addEventListener("click", () => { if (!file.disabled) file.click(); });
  file.addEventListener("change", async () => {
    const selectedFile = file.files?.[0];
    if (!selectedFile || busy || !activeId || disposed) return;
    busy = true; controls(); resetError();
    const id = activeId;
    try {
      const image = await prepareSupportImage(selectedFile);
      if (disposed || activeId !== id) return;
      draft().image = image;
      renderDraft();
    } catch (failure) { showError(failure); }
    finally { file.value = ""; busy = false; controls(); }
  });
  find("[data-support-remove-image]").addEventListener("click", () => { if (busy || !activeId) return; delete draft().image; renderDraft(); resetError(); });
  find<HTMLFormElement>("[data-support-composer]").addEventListener("submit", async event => {
    event.preventDefault();
    if (!agent || busy || !selected() || disposed) return;
    const id = activeId;
    const currentDraft = draft();
    currentDraft.text = text.value;
    if (!currentDraft.text.trim() && !currentDraft.image) { error.textContent = copy.emptyMessage; return; }
    busy = true; controls(); resetError();
    try {
      await sendAgentMessage(agent.session, id, currentDraft.text, currentDraft.image);
      draftByConversation.set(id, { text: "" });
      await refresh();
      if (!disposed && activeId === id) { renderDraft(); requestAnimationFrame(() => { messages.scrollTop = messages.scrollHeight; }); }
    } catch (failure) { showError(failure); }
    finally { busy = false; controls(); if (!disposed) text.focus(); }
  });
  status.addEventListener("click", async () => {
    if (!agent || busy || !selected() || disposed) return;
    busy = true; controls(); resetError();
    try { await setConversationStatus(agent.session, activeId, status.dataset.nextStatus as "open" | "resolved"); await refresh(false); }
    catch (failure) { showError(failure); }
    finally { busy = false; controls(); }
  });
  logout.addEventListener("click", async () => {
    if (!agent || busy || disposed) return;
    busy = true; controls(); resetError();
    try { await endSupportSession(agent.session); leave(); }
    catch (failure) { showError(failure); busy = false; controls(); }
  });
  seed.addEventListener("click", () => { void seedConversations(); });
  find("[data-support-back]").addEventListener("click", () => {
    if (busy) return;
    if (activeId) draft().text = text.value;
    activeId = ""; root.dataset.active = "false"; root.dataset.details = "false";
    renderList(); renderConversation();
  });
  const detailsButton = find<HTMLButtonElement>("[data-support-details]");
  detailsButton.addEventListener("click", () => {
    const expanded = root.dataset.details !== "true";
    root.dataset.details = String(expanded);
    detailsButton.setAttribute("aria-expanded", String(expanded));
    if (!expanded) void refresh();
  });
  const closeDetails = () => { root.dataset.details = "false"; detailsButton.setAttribute("aria-expanded", "false"); detailsButton.focus(); void refresh(); };
  find("[data-support-details-close]").addEventListener("click", closeDetails);
  root.addEventListener("keydown", event => { if (event.key === "Escape" && root.dataset.details === "true") closeDetails(); });
  for (const name of [SUPPORT_CHANNEL, PREVIEW_CHANNEL]) {
    try { const channel = new BroadcastChannel(name); channel.onmessage = () => { void refresh(); }; channels.push(channel); }
    catch { /* Focus and polling also refresh when BroadcastChannel is unavailable. */ }
  }
  addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisibility);
  interval = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 3000);
  addEventListener("pageshow", event => { if (event.persisted) location.reload(); });
  addEventListener("pagehide", stop, { once: true });
}
