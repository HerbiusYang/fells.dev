import {
  readSupportSession, endSupportSession, listSupportInbox, readOperatorThread, listOlderOperatorMessages,
  sendAgentMessage, markAgentRead, setConversationStatus, readAgentTyping, setAgentTyping, setAgentAvailability,
  SUPPORT_CHANNEL, SESSION_CHANNEL, openSupportEvents, SupportSessionEnded, type SupportAgent, type SupportConversation, type SupportImage,
} from "../lib/support-service.ts";
import { isBusinessBlocked, subscribeMaintenance } from "../lib/maintenance.ts";
import { APIError } from "../lib/app-http.ts";
import { maintenanceCopy } from "../i18n/maintenance.ts";
import { prepareSupportImage, escapeSupport, renderSupportMessages, supportError, supportRequestError, installSupportImageViewer } from "../lib/support-ui.ts";
import { installSupportPresence } from "../lib/support-presence.ts";
import { installSupportAvailabilityHeartbeat } from "../lib/support-availability.ts";
import type { SupportNetworkCopy } from "../lib/support-network-copy.ts";
import { installSupportOrders } from "./support-orders.ts";
import { installSupportCustomerProfile } from "./support-customer-profile.ts";
import { installSupportTopup } from "./support-topup.ts";
import { supportExperienceCopy } from "../i18n/support-experience.ts";
import { SUPPORT_INBOX_PAGE } from "../lib/support-workflow.ts";
import { pendingOperatorLogout, rememberOperatorLogout, operatorLogoutKey } from "../lib/operator-logout.ts";
import { supportHttp, type OperatorLogoutBinding, type SupportInboxEntry, type SupportInboxCounts, type SupportThread } from "../lib/support-http.ts";
import { appStartupWords } from "../i18n/app-startup.ts";

function showPendingLogout(root: HTMLElement, binding: OperatorLogoutBinding) {
  const copy = JSON.parse(root.dataset.supportCopy!) as SupportNetworkCopy;
  const words = appStartupWords(root.dataset.supportLang || "en");
  const status = document.createElement("p"), retry = document.createElement("button");
  status.dataset.supportSessionError = "";
  status.setAttribute("role", "status");
  status.textContent = words.locked;
  retry.type = "button";
  retry.dataset.supportLogout = "";
  retry.textContent = copy.logout;
  root.replaceChildren(status, retry);
  retry.focus();
  const finish = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (detail?.audience !== "operator") return;
    removeEventListener(SESSION_CHANNEL, finish);
    location.replace(detail.redirect === "/cdn-cgi/access/logout" ? detail.redirect : "/admin/");
  };
  addEventListener(SESSION_CHANNEL, finish);
  retry.onclick = async () => {
    retry.disabled = true;
    try { await supportHttp.resumeOperatorLogout(binding); }
    catch (failure) { status.textContent = failure instanceof APIError ? failure.message : words.locked; }
    finally { retry.disabled = false; }
  };
}

const consoleRoot = document.querySelector<HTMLElement>("[data-support-console]");
if (consoleRoot) {
  const unsubscribe = subscribeMaintenance(() => {
    if (!isBusinessBlocked() && consoleRoot.dataset.maintenanceInitPaused === "true") {
      delete consoleRoot.dataset.maintenanceInitPaused; void startConsole(consoleRoot);
    }
  });
  addEventListener("pagehide", () => unsubscribe(), { once: true });
  const pending = pendingOperatorLogout();
  if (pending) showPendingLogout(consoleRoot, pending);
  else void startConsole(consoleRoot);
}

async function startConsole(root: HTMLElement) {
  let unsubscribeMaintenance = () => {};
  const copy = JSON.parse(root.dataset.supportCopy!) as SupportNetworkCopy;
  const lang = root.dataset.supportLang || "en";
  const experience = supportExperienceCopy(lang);
  const maintenanceMessage = maintenanceCopy(lang).supportPaused;
  const find = <T extends HTMLElement = HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const error = find("[data-support-error]");
  const list = find("[data-support-list]");
  const chat = find("[data-support-chat]");
  const selectionEmpty = find("[data-support-selection-empty]");
  const messages = find("[data-support-messages]");
  const older = find<HTMLButtonElement>("[data-support-older]");
  const typingIndicator = find("[data-support-typing]");
  const latest = find<HTMLButtonElement>("[data-support-latest]");
  const composer = find<HTMLFormElement>("[data-support-composer]");
  const text = find<HTMLTextAreaElement>("[data-support-text]");
  const file = find<HTMLInputElement>("[data-support-file]");
  const send = find<HTMLButtonElement>("[data-support-send]");
  const sendLabel = find("[data-support-send-label]");
  const characterCount = find("[data-support-character-count]");
  const attach = find<HTMLButtonElement>("[data-support-attach]");
  const status = find<HTMLButtonElement>("[data-support-status]");
  const logout = find<HTMLButtonElement>("[data-support-logout]");
  const seed = find<HTMLButtonElement>("[data-support-seed]");
  seed.hidden = true;
  const search = find<HTMLInputElement>("[data-support-search]");
  const details = find("[data-support-detail-panel]");
  const imagePreview = find("[data-support-attachment]");
  const imageElement = find<HTMLImageElement>("[data-support-attachment-image]");
  const draftByConversation = new Map<string, { text: string; image?: SupportImage }>();
  let agent: SupportAgent | null = null;
  let conversations: SupportInboxEntry[] = [];
  let activeId = "";
  let filter: "open" | "resolved" | "unread" | "all" = "open";
  let listQuery = "";
  let inboxCounts: SupportInboxCounts | undefined;
  let listCursor: string | null = null;
  let listDepth = 1;
  let listLoaded = false;
  let listPending: "first" | "more" | undefined;
  let listFailure: { message: string; more: boolean } | undefined;
  let listGeneration = 0;
  let listRefreshQueued = false;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let thread: SupportThread | undefined;
  let threadPending = false;
  let threadRefreshQueued = false;
  let threadFailure = false;
  let olderPending = false;
  let markingRead = false;
  let busy = false;
  let loggingOut = false;
  let composerActivity: "sending" | "image" | undefined;
  let disposed = false;
  let renderedConversation = "";
  let renderedMessages = "";
  let imageViewer: ReturnType<typeof installSupportImageViewer> | undefined;
  let presence: ReturnType<typeof installSupportPresence> | undefined;
  let availabilityHeartbeat: ReturnType<typeof installSupportAvailabilityHeartbeat> | undefined;
  const inertBeforeDetails = new Map<HTMLElement, boolean>();
  let conversationGeneration = 0;
  const channels: BroadcastChannel[] = [];
  let interval: ReturnType<typeof setInterval> | undefined;
  let events: ReturnType<typeof openSupportEvents> | undefined;
  let workOrders: ReturnType<typeof installSupportOrders> | undefined;
  let cashTopup: ReturnType<typeof installSupportTopup> | undefined;
  let customerProfile: ReturnType<typeof installSupportCustomerProfile> | undefined;
  const lifecycle = new AbortController();
  // Subscribe before the first asynchronous restore so a logout in another
  // tab also reaches a desk whose initial session request is still pending.
  addEventListener(SESSION_CHANNEL, event => {
    const change = (event as CustomEvent).detail as { audience?: string; redirect?: string } | null;
    if (!change?.audience || change.audience === "operator") leave(change?.redirect === "/cdn-cgi/access/logout" ? change.redirect : "/admin/");
  }, { signal: lifecycle.signal });
  addEventListener("pagehide", stop, { once: true });
  addEventListener("storage", event => {
    if (event.key !== operatorLogoutKey || !event.newValue || disposed) return;
    const pending = pendingOperatorLogout();
    if (!pending || agent?.fingerprint && agent.fingerprint !== pending.fingerprint) return;
    delete root.dataset.maintenanceInitPaused;
    stop();
    showPendingLogout(root, pending);
  }, { signal: lifecycle.signal });

  function initial(name: string) {
    const words = name.trim().split(/\s+/);
    return (words.length > 1 ? words[0][0] + words[words.length - 1][0] : name.slice(0, 2)).toLocaleUpperCase(lang);
  }
  function languageLabel(locale: string) {
    try { return new Intl.DisplayNames([lang], { type: "language" }).of(locale) ?? locale; }
    catch { return copy.language; }
  }
  function selected(): SupportConversation | undefined {
    if (!thread) return;
    let position = -1;
    const timeline = thread.messages.map(message => {
      position = Math.max(message.created, position + 1);
      return { ...message, created: position };
    });
    const readAt = (id: string | null) => {
      if (id === null) return 0;
      const cursor = BigInt(id);
      for (let index = timeline.length - 1; index >= 0; index--) {
        if (BigInt(timeline[index].id) <= cursor) return timeline[index].created;
      }
      return 0;
    };
    return { ...thread, messages: timeline, userReadAt: readAt(thread.userReadId), agentReadAt: readAt(thread.agentReadId) };
  }
  function draft() {
    let value = draftByConversation.get(activeId);
    if (!value) { value = { text: "" }; draftByConversation.set(activeId, value); }
    return value;
  }
  function showError(failure: unknown) {
    if (disposed) return;
    if (failure instanceof SupportSessionEnded) { leave(); return; }
    error.textContent = isBusinessBlocked() ? maintenanceMessage : supportError(failure, copy);
  }
  function resetError() { error.textContent = ""; }
  function atLatest() { return messages.scrollHeight - messages.scrollTop - messages.clientHeight <= 48; }
  function updateLatest() {
    if (disposed) return;
    const unread = thread?.unreadCount ?? 0;
    latest.hidden = !thread || atLatest();
    latest.textContent = unread ? `${unread} ${copy.newMessages} ↓` : copy.latest;
  }
  function stop() {
    if (disposed) return;
    disposed = true;
    events?.close();
    unsubscribeMaintenance();
    lifecycle.abort();
    presence?.dispose();
    availabilityHeartbeat?.dispose();
    workOrders?.dispose();
    cashTopup?.dispose();
    customerProfile?.dispose();
    if (interval) clearInterval(interval);
    if (searchTimer) clearTimeout(searchTimer);
    channels.forEach(channel => channel.close());
    removeEventListener("focus", onFocus);
    removeEventListener("resize", updateLatest);
    removeEventListener("resize", syncDetails);
    document.removeEventListener("visibilitychange", onVisibility);
    imageViewer?.dispose();
    for (const [element, inert] of inertBeforeDetails) element.inert = inert;
    conversations = [];
    thread = undefined;
    activeId = "";
    draftByConversation.clear();
    inertBeforeDetails.clear();
    root.replaceChildren();
  }
  function leave(destination?: string) {
    if (disposed) return;
    // An expiry from our own revocation must not interrupt the DELETE or send
    // us back to the console before Cloudflare Access itself is signed out.
    if (loggingOut && !destination) return;
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
    location.replace(destination ?? "/admin/");
  }
  function controls() {
    if (disposed) return;
    const unavailable = isBusinessBlocked() || busy || loggingOut || disposed || !agent;
    composer.setAttribute("aria-busy", String(Boolean(composerActivity)));
    sendLabel.textContent = composerActivity === "sending" ? copy.sending : composerActivity === "image" ? copy.imageLoading : copy.send;
    characterCount.hidden = text.value.length < 3600;
    characterCount.textContent = copy.characterCount.replace("{count}", new Intl.NumberFormat(lang).format(text.value.length)).replace("{limit}", new Intl.NumberFormat(lang).format(text.maxLength));
    send.disabled = unavailable || !thread || !(text.value.trim() || draftByConversation.get(activeId)?.image);
    text.disabled = unavailable || !thread;
    file.disabled = unavailable || !thread;
    attach.disabled = unavailable || !thread;
    status.disabled = unavailable || !thread;
    older.disabled = unavailable || olderPending;
    find<HTMLButtonElement>("[data-support-ticket]").disabled = unavailable || !thread;
    find<HTMLButtonElement>("[data-support-new-order]").disabled = unavailable || !thread;
    find<HTMLButtonElement>("[data-support-cash-open]").disabled = unavailable;
    find<HTMLButtonElement>("[data-support-profile-open]").disabled = unavailable;
    logout.disabled = busy || disposed || !agent;
    seed.disabled = true;
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
    const focusedFooter = document.activeElement instanceof HTMLElement && list.contains(document.activeElement) && document.activeElement.closest(".support-list-footer");
    const focusedConversation = document.activeElement instanceof HTMLElement && list.contains(document.activeElement)
      ? document.activeElement.closest<HTMLElement>("[data-support-conversation]")?.dataset.supportConversation : undefined;
    const formatCount = new Intl.NumberFormat(lang);
    for (const key of ["all", "open", "unread", "resolved", "waiting"] as const) {
      const counter = root.querySelector<HTMLElement>(`[data-support-count="${key}"]`);
      if (counter) {
        counter.hidden = !inboxCounts;
        if (inboxCounts) counter.textContent = formatCount.format(inboxCounts[key]);
      }
    }
    find("[data-support-inbox-title]").textContent = filter === "open" ? copy.openFilter : filter === "resolved" ? experience.archive : filter === "unread" ? copy.unreadFilter : copy.all;
    find("[data-support-inbox-hint]").textContent = filter === "resolved" ? experience.archiveHint : filter === "open" ? experience.inboxHint : "";
    const count = find("[data-support-total]");
    count.hidden = !listLoaded;
    count.textContent = formatCount.format(conversations.length) + (listCursor ? "+" : "");
    list.setAttribute("aria-busy", String(Boolean(listPending || searchTimer)));
    const footer = `<div class="support-list-footer">${listFailure ? `<p role="status">${escapeSupport(listFailure.message)}</p><button type="button" class="support-secondary-button" data-support-list-retry>${escapeSupport(experience.retry)}</button>` : listCursor ? `<button type="button" class="support-secondary-button" data-support-more aria-disabled="${Boolean(listPending)}">${escapeSupport(listPending === "more" ? copy.loading : experience.more)}</button>` : ""}</div>`;
    let markup: string;
    if (!listLoaded && !listFailure) {
      markup = `<p class="support-loading" role="status">${escapeSupport(copy.loading)}</p>`;
    } else if (!conversations.length && listFailure) {
      markup = footer;
    } else if (!conversations.length) {
      const caughtUp = filter === "open" && !listQuery;
      const empty = filter === "all" && !listQuery;
      markup = `<div class="support-search-empty"><h2>${escapeSupport(caughtUp ? experience.activeEmpty : empty ? copy.emptyInbox : copy.noResults)}</h2>${caughtUp || empty ? `<p>${escapeSupport(caughtUp ? experience.activeEmptyHint : copy.emptyInboxBody)}</p>` : ""}${empty ? "" : `<button class="support-secondary-button" type="button" data-support-reset-search>${escapeSupport(copy.resetSearch)}</button>`}</div>`;
    } else {
      const formatTime = new Intl.DateTimeFormat(lang, { month: "short", day: "numeric" });
      markup = conversations.map(conversation => {
        const last = conversation.lastMessage;
        const unread = conversation.unreadCount;
        const statusKnown = filter === "open" || filter === "resolved";
        const timestamp = new Date(conversation.updatedAt);
        const time = formatTime.format(timestamp);
        return `<button class="support-conversation${conversation.id === activeId ? " is-active" : ""}" type="button" data-support-conversation="${escapeSupport(conversation.id)}" aria-pressed="${conversation.id === activeId}"><span class="support-avatar">${escapeSupport(initial(conversation.user.name))}</span><span class="support-conversation-content"><span class="support-conversation-name"><strong>${escapeSupport(conversation.user.name)}</strong><time datetime="${timestamp.toISOString()}">${escapeSupport(time)}</time></span><span class="support-conversation-email">${escapeSupport(conversation.user.email)}</span><span class="support-conversation-preview">${escapeSupport(last?.text || last?.orderTitle || (last?.hasImage ? copy.imageAlt : copy.noMessages))}</span><span class="support-conversation-bottom">${statusKnown ? "" : `<span class="support-conversation-state${conversation.status === "resolved" ? " is-resolved" : ""}">${escapeSupport(conversation.status === "resolved" ? copy.resolved : copy.openStatus)}</span>`}${unread ? `<span class="support-unread-badge" aria-label="${escapeSupport(copy.newMessages)} ${formatCount.format(unread)}">${formatCount.format(unread)}</span>` : ""}</span></span></button>`;
      }).join("") + (listCursor || listFailure || listPending === "more" ? footer : "");
    }
    if (list.innerHTML !== markup) {
      const scroll = list.scrollTop;
      list.innerHTML = markup;
      list.scrollTop = scroll;
      if (focusedConversation) {
        const focused = Array.from(list.querySelectorAll<HTMLButtonElement>("[data-support-conversation]")).find(button => button.dataset.supportConversation === focusedConversation);
        (focused || search).focus({ preventScroll: true });
      } else if (focusedFooter) {
        (list.querySelector<HTMLElement>(".support-list-footer button") || list.querySelector<HTMLElement>("[data-support-conversation]:last-of-type") || search).focus({ preventScroll: true });
      }
    }
  }
  function renderConversation(prepending = false) {
    const conversation = selected();
    cashTopup?.setContext(agent, conversation);
    customerProfile?.setContext(agent, thread);
    if (agent) workOrders?.setContext({ session: agent.session, conversationId: conversation?.id ?? "", userId: conversation?.user.id ?? "", userName: conversation?.user.name ?? "", operatorId: agent.id ?? "", messages: conversation?.messages ?? [] });
    chat.hidden = !conversation;
    selectionEmpty.hidden = Boolean(conversation);
    details.hidden = !conversation;
    if (!conversation) {
      const waiting = Boolean(activeId);
      find("[data-support-selection-intro]").hidden = waiting;
      find("[data-support-selection-loading]").hidden = !waiting || threadFailure;
      find("[data-support-selection-actions]").hidden = !waiting;
      find("[data-support-thread-retry]").hidden = !threadFailure;
      older.hidden = true;
      if (root.dataset.details === "true") {
        root.dataset.details = "false";
        find<HTMLButtonElement>("[data-support-details]").setAttribute("aria-expanded", "false");
        syncDetails();
      }
      typingIndicator.hidden = true;
      imageViewer?.close();
      renderedConversation = ""; renderedMessages = "";
      messages.replaceChildren();
      latest.hidden = true;
      text.value = "";
      imagePreview.hidden = true;
      imageElement.removeAttribute("src");
      find("[data-support-attachment-name]").textContent = "";
      find("[data-support-customer-initials]").textContent = "";
      find("[data-support-customer-name]").textContent = "";
      find("[data-support-customer-type]").textContent = "";
      ["initials", "name", "email", "id", "joined", "workspaces", "credits", "cash", "language", "status"].forEach(key => { find(`[data-support-detail-${key}]`).textContent = ""; });
      controls(); return;
    }
    older.hidden = !thread?.nextCursor;
    const customerType = conversation.demo ? copy.sample : copy.previewUser;
    find("[data-support-customer-initials]").textContent = initial(conversation.user.name);
    find("[data-support-customer-name]").textContent = conversation.user.name;
    find("[data-support-customer-type]").textContent = customerType;
    status.textContent = conversation.status === "resolved" ? copy.reopen : copy.resolve;
    status.dataset.nextStatus = conversation.status === "resolved" ? "open" : "resolved";
    status.classList.toggle("is-resolved", conversation.status === "resolved");
    find("[data-support-resolved-notice]").hidden = conversation.status !== "resolved";
    const values: Record<string, string> = {
      initials: initial(conversation.user.name), name: conversation.user.name, email: conversation.user.email, id: conversation.user.id,
      joined: new Intl.DateTimeFormat(lang, { year: "numeric", month: "short", day: "numeric" }).format(conversation.user.joined),
      workspaces: String(conversation.user.workspaceCount), credits: `USD ${new Intl.NumberFormat(lang, { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(conversation.user.credits)}`, language: languageLabel(conversation.user.locale),
      cash: `CNY ${new Intl.NumberFormat(lang, { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format((conversation.user.walletCashMicro ?? 0) / 1_000_000)}`,
      status: conversation.status === "resolved" ? copy.resolved : copy.openStatus,
    };
    Object.entries(values).forEach(([key, value]) => { find(`[data-support-detail-${key}]`).textContent = value; });
    const markup = renderSupportMessages(conversation, copy, lang, "agent") || `<p class="support-no-messages">${escapeSupport(copy.noMessages)}</p>`;
    if (renderedConversation !== conversation.id || renderedMessages !== markup) {
      const focusedMessage = document.activeElement instanceof HTMLElement && messages.contains(document.activeElement)
        ? document.activeElement.closest<HTMLElement>("[data-support-image]")?.closest<HTMLElement>("[data-support-message]")?.dataset.messageId : undefined;
      const atBottom = atLatest();
      const switching = renderedConversation !== conversation.id;
      messages.innerHTML = markup;
      renderedConversation = conversation.id;
      renderedMessages = markup;
      if (focusedMessage) {
        const next = Array.from(messages.querySelectorAll<HTMLElement>("[data-support-message]"))
          .find(message => message.dataset.messageId === focusedMessage)?.querySelector<HTMLElement>("[data-support-image]");
        (next ?? messages).focus({ preventScroll: true });
      }
      if (!prepending && (switching || atBottom)) requestAnimationFrame(() => {
        if (disposed || activeId !== conversation.id) return;
        messages.scrollTop = messages.scrollHeight;
        updateLatest();
      });
    }
    updateLatest();
    controls();
  }
  async function checkSession() {
    if (!agent || disposed || loggingOut || isBusinessBlocked()) return false;
    const current = await readSupportSession();
    if (disposed || loggingOut || isBusinessBlocked()) return false;
    if (!current || current.session !== agent.session) { leave(); return false; }
    return true;
  }
  async function refreshInbox(more = false) {
    if (!agent || disposed || loggingOut || isBusinessBlocked() || searchTimer || more && !listCursor) return;
    if (listPending) { if (!more) listRefreshQueued = true; return; }
    const generation = listGeneration;
    const cursor = more ? listCursor ?? undefined : undefined;
    listPending = more ? "more" : "first";
    listFailure = undefined;
    renderList();
    try {
      if (!await checkSession() || generation !== listGeneration) return;
      const query = { limit: SUPPORT_INBOX_PAGE, status: filter === "all" ? undefined : filter, search: listQuery };
      const first = await listSupportInbox(agent.session, { ...query, cursor });
      const rows = new Map((more ? conversations : []).map(entry => [entry.id, entry]));
      first.items.forEach(entry => rows.set(entry.id, entry));
      let nextCursor = first.nextCursor;
      // A refreshed cursor chain also refreshes statuses and ordering on
      // previously expanded pages, while respecting the requested depth.
      if (!more) {
        for (let depth = 1; depth < listDepth && nextCursor; depth++) {
          if (generation !== listGeneration || disposed || loggingOut || isBusinessBlocked()) return;
          const page = await listSupportInbox(agent.session, { ...query, cursor: nextCursor });
          page.items.forEach(entry => rows.set(entry.id, entry));
          nextCursor = page.nextCursor;
        }
      }
      if (!await checkSession() || generation !== listGeneration) return;
      if (first.counts) inboxCounts = first.counts;
      if (more) listDepth++;
      conversations = [...rows.values()];
      listCursor = nextCursor;
      listLoaded = true;
    } catch (failure) {
      if (failure instanceof SupportSessionEnded) showError(failure);
      else if (!disposed && generation === listGeneration) listFailure = { message: supportError(failure, copy), more };
    } finally {
      if (!disposed && generation === listGeneration) {
        listPending = undefined;
        renderList();
        if (listRefreshQueued) { listRefreshQueued = false; void refreshInbox(); }
      }
    }
  }
  function resetInbox(next: typeof filter, debounce = false) {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = undefined;
    listGeneration++;
    listPending = undefined;
    listRefreshQueued = false;
    listFailure = undefined;
    listLoaded = false;
    listDepth = 1;
    listCursor = null;
    conversations = [];
    list.scrollTop = 0;
    listQuery = search.value.trim();
    filter = next;
    root.querySelectorAll<HTMLButtonElement>("[data-support-filter]").forEach(control => control.setAttribute("aria-pressed", String(control.dataset.supportFilter === filter)));
    if (debounce) searchTimer = setTimeout(() => { searchTimer = undefined; void refreshInbox(); }, 250);
    renderList();
    if (!debounce) void refreshInbox();
  }
  async function maybeMarkRead() {
    if (!agent || !thread?.unreadCount || markingRead || disposed || loggingOut || isBusinessBlocked()) return;
    const id = activeId;
    const generation = conversationGeneration;
    const last = thread.messages.at(-1);
    if (!last || thread.agentReadId && BigInt(last.id) <= BigInt(thread.agentReadId)) return;
    markingRead = true;
    try {
      // Wait for rendering and automatic scrolling before marking the visible end.
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const detailsCoverChat = root.dataset.details === "true" && matchMedia("(max-width: 1350px)").matches;
      if (disposed || loggingOut || generation !== conversationGeneration || thread?.messages.at(-1)?.id !== last.id || document.visibilityState !== "visible" || !document.hasFocus() || detailsCoverChat || root.querySelector("dialog[open]") || imageViewer?.isOpen() || !atLatest()) return;
      await markAgentRead(agent.session, id, last.id);
      if (!disposed && generation === conversationGeneration && thread?.messages.at(-1)?.id === last.id) {
        thread = { ...thread, agentReadId: last.id, unreadCount: 0 };
        renderConversation();
        void refreshInbox();
      }
    } catch (failure) { showError(failure); }
    finally { markingRead = false; }
  }
  async function refreshThread(markRead = true) {
    if (disposed || loggingOut || !agent || !activeId || isBusinessBlocked()) return;
    if (threadPending) { threadRefreshQueued = true; return; }
    const generation = conversationGeneration, id = activeId;
    threadPending = true;
    try {
      if (!await checkSession() || generation !== conversationGeneration) return;
      const next = await readOperatorThread(agent.session, id);
      if (!await checkSession() || generation !== conversationGeneration) return;
      // Keep previously loaded history only when the recent page overlaps or
      // follows it without a server-indicated gap.
      const oldest = next.messages[0]?.id;
      if (thread && oldest && next.nextCursor && thread.messages.some(message => message.id === oldest)) {
        const earlier = thread.messages.filter(message => BigInt(message.id) < BigInt(oldest));
        if (earlier.length) {
          next.messages = earlier.concat(next.messages);
          next.nextCursor = thread.nextCursor;
        }
      }
      thread = next;
      threadFailure = false;
      renderConversation();
      if (markRead) void maybeMarkRead();
    } catch (failure) {
      if (failure instanceof SupportSessionEnded) showError(failure);
      else if (!disposed && generation === conversationGeneration) {
        threadFailure = true;
        showError(failure);
        renderConversation();
      }
    } finally {
      if (!disposed && generation === conversationGeneration) {
        threadPending = false;
        void presence?.refresh();
        if (threadRefreshQueued) { threadRefreshQueued = false; void refreshThread(); }
      }
    }
  }
  async function refresh(markRead = true) {
    await Promise.all([refreshInbox(), refreshThread(markRead)]);
  }
  function invalidateThreadRefresh() {
    conversationGeneration++;
    threadPending = false;
    threadRefreshQueued = false;
    olderPending = false;
  }
  function resetSelection() {
    invalidateThreadRefresh();
    thread = undefined;
    threadFailure = false;
  }
  async function selectConversation(id: string) {
    if (busy || disposed || isBusinessBlocked()) return;
    if (activeId === id && thread) { await refreshThread(); return; }
    if (activeId && thread) draft().text = text.value;
    presence?.clear();
    typingIndicator.hidden = true;
    imageViewer?.close();
    resetSelection();
    activeId = id;
    const generation = conversationGeneration;
    root.dataset.active = "true";
    root.dataset.details = "false";
    syncDetails();
    find<HTMLButtonElement>("[data-support-details]").setAttribute("aria-expanded", "false");
    resetError();
    renderList(); renderConversation();
    await refreshThread();
    if (disposed || generation !== conversationGeneration || !thread) return;
    renderDraft();
    (innerWidth > 760 && !matchMedia("(pointer: coarse)").matches ? text : messages).focus({ preventScroll: true });
  }
  async function loadOlder() {
    if (!agent || !thread?.nextCursor || olderPending || busy || disposed || isBusinessBlocked()) return;
    const generation = conversationGeneration, id = activeId, cursor = thread.nextCursor;
    olderPending = true;
    controls();
    resetError();
    try {
      const page = await listOlderOperatorMessages(agent.session, id, cursor);
      if (!await checkSession() || generation !== conversationGeneration || thread?.nextCursor !== cursor) return;
      const height = messages.scrollHeight, scroll = messages.scrollTop;
      thread = { ...thread, messages: page.items.concat(thread.messages), nextCursor: page.nextCursor };
      renderConversation(true);
      messages.scrollTop = messages.scrollHeight - height + scroll;
      if (older.hidden) messages.focus({ preventScroll: true });
    } catch (failure) {
      if (failure instanceof SupportSessionEnded || generation === conversationGeneration) showError(failure);
    } finally {
      if (generation === conversationGeneration) { olderPending = false; controls(); }
    }
  }
  function onFocus() { void refresh(); }
  function onVisibility() { if (document.visibilityState === "visible") void refresh(); }
  function rejectSession(message: string) {
    find("[data-support-session-error]").textContent = message;
    find("[data-support-session-notice]").hidden = false;
    find(".support-console-workspace").hidden = true;
    list.replaceChildren();
  }

  if (window.self !== window.top) {
    error.textContent = copy.frameBlocked;
    list.replaceChildren();
    return;
  }
  imageViewer = installSupportImageViewer(root, copy, () => { void refresh(); }, async (id, messageId) => {
    if (!agent || id !== activeId || disposed || loggingOut || isBusinessBlocked()) return;
    const generation = conversationGeneration;
    try {
      const image = await supportHttp.refreshOperatorMessageImage(agent.session, id, messageId);
      if (!await checkSession() || generation !== conversationGeneration || !thread) return;
      thread = { ...thread, messages: thread.messages.map(message => message.id === messageId ? { ...message, image } : message) };
      renderConversation();
      return image.dataUrl;
    } catch (failure) {
      if (failure instanceof SupportSessionEnded || generation === conversationGeneration) showError(failure);
    }
  });
  try {
    agent = await readSupportSession();
    if (disposed) return;
    if (!agent) { rejectSession(copy.accessNotice); return; }
    find("[data-support-session-notice]").hidden = true;
    find(".support-console-workspace").hidden = false;
    find("[data-support-agent-initials]").textContent = initial(agent.name);
    find("[data-support-agent-name]").textContent = agent.name;
    find("[data-support-agent-email]").textContent = agent.email;
    workOrders = installSupportOrders(root, lang, selectConversation, leave, () => { void refresh(); });
    cashTopup = installSupportTopup(root, lang, refresh, leave);
    customerProfile = installSupportCustomerProfile(root, lang, async () => {
      invalidateThreadRefresh();
      await refresh();
    }, leave);
    await refresh();
    controls();
  } catch (failure) {
    if (disposed) return;
    if (isBusinessBlocked()) { root.dataset.maintenanceInitPaused = "true"; imageViewer?.dispose(); }
    rejectSession(failure instanceof SupportSessionEnded ? copy.accessNotice : supportRequestError(failure, lang, copy.unavailable));
    return;
  }
  if (disposed) return;
  availabilityHeartbeat = installSupportAvailabilityHeartbeat({
    publish: (online, sourceId) => setAgentAvailability(agent!.session, online, sourceId),
    changed: state => {
      if (disposed) return;
      find("[data-support-agent-availability]").textContent = state === "online" ? copy.availabilityOnline : copy.availabilityUnknown;
      find("[data-support-agent-availability-dot]").dataset.state = state;
    },
    onError: failure => { if (failure instanceof SupportSessionEnded) leave(); },
  });
  presence = installSupportPresence({
    text,
    indicator: typingIndicator,
    getContext: () => agent && thread && !disposed ? { session: agent.session, conversationId: activeId } : null,
    canType: () => !busy && !disposed && document.hasFocus() && document.visibilityState === "visible"
      && !(root.dataset.details === "true" && matchMedia("(max-width: 1350px)").matches) && !root.querySelector("dialog[open]") && !imageViewer?.isOpen(),
    publish: (context, typing, sourceId) => setAgentTyping(context.session, context.conversationId!, typing, sourceId),
    read: context => readAgentTyping(context.session, context.conversationId!),
  });
  list.addEventListener("click", event => {
    const target = event.target as Element;
    if (target.closest("[data-support-more]")) { void refreshInbox(true); return; }
    if (target.closest("[data-support-list-retry]")) { void refreshInbox(listFailure?.more); return; }
    if (target.closest("[data-support-reset-search]")) { search.value = ""; resetInbox("all"); search.focus({ preventScroll: true }); return; }
    const button = target.closest<HTMLElement>("[data-support-conversation]");
    if (button) void selectConversation(button.dataset.supportConversation!);
  });
  search.addEventListener("input", () => { if (search.value.trim() !== listQuery) resetInbox(filter, true); });
  older.addEventListener("click", () => { void loadOlder(); });
  find("[data-support-thread-retry]").addEventListener("click", () => { void selectConversation(activeId); });
  messages.addEventListener("scroll", () => {
    updateLatest();
    if (atLatest()) void maybeMarkRead();
  }, { passive: true });
  latest.addEventListener("click", () => {
    messages.scrollTop = messages.scrollHeight;
    messages.focus({ preventScroll: true });
    updateLatest();
    void maybeMarkRead();
  });
  root.querySelectorAll<HTMLButtonElement>("[data-support-filter]").forEach(button => button.addEventListener("click", () => {
    const next = button.dataset.supportFilter as typeof filter;
    if (next !== filter) resetInbox(next);
  }));
  text.addEventListener("input", () => { if (activeId) draft().text = text.value; controls(); });
  text.addEventListener("keydown", event => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.isComposing) {
      event.preventDefault();
      if (!send.disabled) composer.requestSubmit();
    }
  });
  attach.addEventListener("click", () => { if (!file.disabled) file.click(); });
  file.addEventListener("change", async () => {
    const selectedFile = file.files?.[0];
    if (!selectedFile || busy || !activeId || disposed) return;
    busy = true; composerActivity = "image"; controls(); resetError();
    const id = activeId;
    try {
      const image = await prepareSupportImage(selectedFile);
      if (disposed || activeId !== id) return;
      draft().image = image;
      renderDraft();
    } catch (failure) { showError(failure); }
    finally { file.value = ""; busy = false; composerActivity = undefined; controls(); }
  });
  find("[data-support-remove-image]").addEventListener("click", () => { if (busy || !activeId) return; delete draft().image; renderDraft(); resetError(); });
  composer.addEventListener("submit", async event => {
    event.preventDefault();
    if (!agent || busy || !thread || disposed || isBusinessBlocked()) return;
    const id = activeId;
    const currentDraft = draft();
    currentDraft.text = text.value;
    if (!currentDraft.text.trim() && !currentDraft.image) { error.textContent = copy.emptyMessage; return; }
    invalidateThreadRefresh();
    busy = true; composerActivity = "sending"; controls(); resetError();
    try {
      await sendAgentMessage(agent.session, id, currentDraft.text, currentDraft.image);
      const sender = await readSupportSession();
      if (disposed) return;
      if (!sender || sender.session !== agent.session) { leave(); return; }
      presence?.clear();
      draftByConversation.set(id, { text: "" });
      await refresh(false);
      if (!disposed && activeId === id) {
        renderDraft();
        messages.scrollTop = messages.scrollHeight;
        updateLatest();
        void maybeMarkRead();
      }
    } catch (failure) { showError(failure); }
    finally { busy = false; composerActivity = undefined; controls(); if (!disposed) text.focus(); }
  });
  status.addEventListener("click", async () => {
    if (!agent || busy || !thread || disposed || isBusinessBlocked()) return;
    invalidateThreadRefresh();
    presence?.clear();
    busy = true; controls(); resetError();
    try { await setConversationStatus(agent.session, activeId, status.dataset.nextStatus as "open" | "resolved"); await refresh(false); }
    catch (failure) { showError(failure); }
    finally { busy = false; controls(); }
  });
  logout.addEventListener("click", async () => {
    if (!agent || busy || disposed) return;
    loggingOut = true;
    if (agent.id && agent.fingerprint) rememberOperatorLogout({
      id: agent.id, fingerprint: agent.fingerprint, authMethod: agent.authMethod ?? "password",
    });
    find("[data-support-console-return]").hidden = true;
    presence?.dispose(); availabilityHeartbeat?.dispose(); workOrders?.dispose(); cashTopup?.dispose(); customerProfile?.dispose(); imageViewer?.close();
    find(".support-console-workspace").hidden = true;
    conversations = []; activeId = ""; resetSelection(); draftByConversation.clear();
    list.replaceChildren(); messages.replaceChildren(); text.value = "";
    busy = true; controls(); resetError();
    try { await endSupportSession(agent.session); }
    catch {
      if (disposed) return;
      rejectSession(experience.logoutFailed);
      busy = false; controls();
    }
  });
  function goBack() {
    if (busy) return;
    if (activeId && thread) draft().text = text.value;
    presence?.clear();
    const previous = activeId;
    resetSelection();
    activeId = ""; root.dataset.active = "false"; root.dataset.details = "false"; syncDetails();
    renderList(); renderConversation();
    const button = Array.from(list.querySelectorAll<HTMLButtonElement>("[data-support-conversation]")).find(button => button.dataset.supportConversation === previous);
    (button || search).focus({ preventScroll: true });
  }
  find("[data-support-back]").addEventListener("click", goBack);
  find("[data-support-thread-back]").addEventListener("click", goBack);
  const detailsButton = find<HTMLButtonElement>("[data-support-details]");
  find<HTMLButtonElement>("[data-support-ticket]").addEventListener("click", event => {
    if (busy || !thread) return;
    presence?.clear();
    workOrders?.openOverview(event.currentTarget as HTMLElement);
  });
  find<HTMLButtonElement>("[data-support-new-order]").addEventListener("click", event => {
    if (busy || !thread) return;
    presence?.clear();
    workOrders?.openNewOrder(event.currentTarget as HTMLElement);
  });
  detailsButton.addEventListener("click", () => {
    const expanded = root.dataset.details !== "true";
    if (expanded) presence?.clear();
    root.dataset.details = String(expanded);
    detailsButton.setAttribute("aria-expanded", String(expanded));
    syncDetails();
    if (expanded && matchMedia("(max-width: 1350px)").matches) find("[data-support-details-close]").focus({ preventScroll: true });
    if (!expanded) void refresh();
  });
  const closeDetails = () => { root.dataset.details = "false"; syncDetails(); detailsButton.setAttribute("aria-expanded", "false"); detailsButton.focus({ preventScroll: true }); void refresh(); };
  find("[data-support-details-close]").addEventListener("click", closeDetails);
  root.addEventListener("keydown", event => {
    if (event.key === "Escape" && root.dataset.details === "true" && !root.querySelector("dialog[open]") && !imageViewer?.isOpen()) { event.preventDefault(); closeDetails(); }
    if (event.key === "Tab" && details.getAttribute("aria-modal") === "true" && !root.querySelector("dialog[open]")) {
      const buttons = Array.from(details.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,a[href],[tabindex='0']")).filter(element => element.getClientRects().length);
      const first = buttons[0], last = buttons.at(-1);
      if (!first) { event.preventDefault(); details.focus(); }
      else if (event.shiftKey && (document.activeElement === first || !details.contains(document.activeElement))) { event.preventDefault(); last!.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !details.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    }
  });
  function syncDetails() {
    const wasModal = details.getAttribute("aria-modal") === "true";
    const modal = root.dataset.details === "true" && matchMedia("(max-width: 1350px)").matches;
    if (modal) {
      details.setAttribute("role", "dialog"); details.setAttribute("aria-modal", "true"); details.tabIndex = -1;
      const siblings = [find(".support-topbar"), ...Array.from(find(".support-console-workspace").children)].filter(element => element !== details) as HTMLElement[];
      for (const element of siblings) { if (!inertBeforeDetails.has(element)) inertBeforeDetails.set(element, element.inert); element.inert = true; }
    } else {
      details.removeAttribute("role"); details.removeAttribute("aria-modal"); details.removeAttribute("tabindex");
      for (const [element, inert] of inertBeforeDetails) element.inert = inert;
      inertBeforeDetails.clear();
      if (wasModal && details.contains(document.activeElement) && !(document.activeElement as HTMLElement).getClientRects().length && !disposed) messages.focus({ preventScroll: true });
    }
  }
  addEventListener("resize", syncDetails);
  events = openSupportEvents("operator", agent!.session, event => {
    if (disposed) return;
    if (event.type === "session.expired") { leave(); return; }
    const conversationId = event.type === "conversation.updated" ? event.data.id : event.data.conversationId;
    if (event.type === "conversation.typing") {
      if (conversationId === activeId) void presence?.refresh();
      return;
    }
    void refreshInbox();
    if (conversationId === activeId) void refreshThread();
  });
  for (const name of [SUPPORT_CHANNEL]) {
    try {
      const channel = new BroadcastChannel(name);
      channel.onmessage = event => {
        void refreshInbox();
        if (!event.data?.conversationId || event.data.conversationId === activeId) void refreshThread();
      };
      channels.push(channel);
    }
    catch { /* Focus and polling also refresh when BroadcastChannel is unavailable. */ }
  }
  addEventListener("focus", onFocus);
  addEventListener("resize", updateLatest);
  document.addEventListener("visibilitychange", onVisibility);
  interval = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 15000);
  unsubscribeMaintenance = subscribeMaintenance(() => {
    controls();
    if (isBusinessBlocked()) { error.textContent = maintenanceMessage; void presence?.refresh(); }
    else { if (error.textContent === maintenanceMessage) error.textContent = ""; void refresh(); }
  });
  addEventListener("pageshow", event => { if (event.persisted) location.reload(); });
}
