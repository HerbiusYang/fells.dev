import { readCustomerSession, openSupportEvents, SESSION_CHANNEL, ensureUserConversation, sendUserMessage, endUserConversation, markUserRead, readUserTyping, setUserTyping, readSupportAvailability, SUPPORT_CHANNEL, SupportSessionEnded, type CustomerSupportSession, type SupportConversation, type SupportImage } from "../lib/support-service.ts";
import { APIError } from "../lib/app-http.ts";
import { escapeSupport, prepareSupportImage, renderSupportMessages, supportError, supportUnread, installSupportImageViewer } from "../lib/support-ui.ts";
import type { SupportCopy } from "../i18n/support.ts";
import { liveSupportCopy } from "../lib/support-network-copy.ts";
import { installSupportPresence } from "../lib/support-presence.ts";
import { installSupportAvailabilityReader, type SupportAvailabilityState } from "../lib/support-availability.ts";
import { installCustomerOrders } from "./support-orders.ts";
import { supportOrdersCopy } from "../i18n/support-orders.ts";
import { saveSupportIntent, readSupportIntent, clearSupportIntent, supportSignInHref } from "../lib/support-intent.ts";
import { isBusinessBlocked, subscribeMaintenance } from "../lib/maintenance";
import { maintenanceCopy } from "../i18n/maintenance";

const widget = document.querySelector<HTMLElement>("#support-widget");
const config = document.getElementById("support-widget-data");
if (widget && config && window.self === window.top) {
  let pendingOpen = new URLSearchParams(location.search).get("support") === "1";
  const openIfReady = () => {
    const launcher = widget.querySelector<HTMLButtonElement>("[data-support-open]");
    if (!pendingOpen || widget.hidden || !launcher || launcher.hidden) return;
    pendingOpen = false;
    launcher.click();
  };
  document.addEventListener("fells:support-open", event => {
    if (event instanceof CustomEvent) saveSupportIntent(event.detail);
    pendingOpen = true;
    openIfReady();
  });
  document.addEventListener("click", event => {
    const trigger = event.target instanceof Element ? event.target.closest("[data-open-customer-support]") : null;
    if (!trigger) return;
    saveSupportIntent({ title: trigger.getAttribute("data-support-title") ?? "", product: trigger.getAttribute("data-support-product") ?? "", poolId: Number(trigger.getAttribute("data-support-pool")), amountMicro: Number(trigger.getAttribute("data-support-amount")) });
    pendingOpen = true;
    openIfReady();
  });
  const data = JSON.parse(config.textContent || "{}") as { copy: SupportCopy; lang: string };
  const copy = liveSupportCopy(data.lang);
  let dispose = () => {};
  let generation = 0;
  let initializationPaused = false;
  const initialize = async () => {
    if (isBusinessBlocked()) { initializationPaused = true; return; }
    initializationPaused = false;
    const expected = ++generation;
    dispose();
    try {
      const next = await startWidget(widget, copy, data.lang, () => expected === generation, () => { void initialize(); }, openIfReady);
      if (expected !== generation) next(); else { dispose = next; openIfReady(); }
    } catch { if (expected === generation) {
      initializationPaused = isBusinessBlocked();
      const unavailableCopy = initializationPaused ? { ...copy, unavailable: maintenanceCopy(data.lang).supportPaused } : copy;
      dispose = unavailableWidget(widget, unavailableCopy, data.lang, () => { pendingOpen = true; void initialize(); }); openIfReady();
    } }
  };
  const changed = (detail: unknown) => {
    const audience = (detail as { audience?: string } | null)?.audience;
    if (!audience || audience === "customer") {
      // Revocation must clear private content even while business APIs pause.
      if (isBusinessBlocked()) { generation++; dispose(); }
      void initialize();
    }
  };
  addEventListener(SESSION_CHANNEL, event => changed((event as CustomEvent).detail));
  const unsubscribe = subscribeMaintenance(() => { if (!isBusinessBlocked() && initializationPaused) void initialize(); });
  addEventListener("pagehide", () => unsubscribe(), { once: true });
  void initialize();
}

function unavailableWidget(root: HTMLElement, copy: ReturnType<typeof liveSupportCopy>, lang: string, retry: () => void) {
  const controller = new AbortController(), panel = root.querySelector<HTMLElement>("#support-panel")!, launch = root.querySelector<HTMLButtonElement>("[data-support-open]")!, history = root.querySelector<HTMLElement>("[data-support-messages]")!;
  root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>("form input,form textarea,form button").forEach(control => control.disabled = true);
  root.querySelector<HTMLElement>("[data-support-session-controls]")!.hidden = true;
  history.innerHTML = `<div class="support-greeting"><p>${escapeSupport(copy.unavailable)}</p><button type="button" class="support-primary-button" data-support-retry>${escapeSupport(supportOrdersCopy(lang).retry)}</button></div>`;
  panel.hidden = true; launch.hidden = false; root.hidden = false;
  launch.addEventListener("click", () => { panel.hidden = false; launch.hidden = true; launch.setAttribute("aria-expanded", "true"); history.querySelector<HTMLButtonElement>("button")!.focus(); }, { signal: controller.signal });
  root.querySelector("[data-support-close]")!.addEventListener("click", () => { panel.hidden = true; launch.hidden = false; launch.setAttribute("aria-expanded", "false"); launch.focus(); }, { signal: controller.signal });
  history.querySelector("[data-support-retry]")!.addEventListener("click", () => { if (!isBusinessBlocked()) retry(); }, { signal: controller.signal });
  return () => { controller.abort(); history.replaceChildren(); root.hidden = true; };
}

function signedOutWidget(root: HTMLElement, copy: ReturnType<typeof liveSupportCopy>, lang: string, onReady: () => void) {
  const lifecycle = new AbortController();
  const panel = root.querySelector<HTMLElement>("#support-panel")!;
  const launch = root.querySelector<HTMLButtonElement>("[data-support-open]")!;
  const history = root.querySelector<HTMLElement>("[data-support-messages]")!;
  history.innerHTML = `<div class="support-greeting"><div aria-hidden="true">✦</div><h3>${escapeSupport(copy.greeting)}</h3><p>${escapeSupport(copy.signInRequired)}</p><a class="support-primary-button" href="${escapeSupport(supportSignInHref(lang))}">${escapeSupport(copy.signIn)}</a></div>`;
  root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>("form input,form textarea,form button").forEach(control => { control.disabled = true; });
  root.querySelector<HTMLElement>("[data-support-preview]")!.hidden = true;
  root.querySelector<HTMLImageElement>("[data-support-preview] img")!.removeAttribute("src");
  root.querySelector<HTMLElement>("[data-support-error]")!.textContent = "";
  root.querySelector<HTMLElement>("[data-support-unread]")!.hidden = true;
  root.querySelector<HTMLElement>("[data-support-typing]")!.hidden = true;
  root.querySelector<HTMLElement>("[data-support-latest]")!.hidden = true;
  root.querySelector<HTMLElement>("[data-support-session-controls]")!.hidden = true;
  root.dataset.theme = document.getElementById("fx")?.dataset.theme ?? "light";
  const close = () => { panel.hidden = true; launch.hidden = false; launch.setAttribute("aria-expanded", "false"); };
  close();
  launch.addEventListener("click", () => { panel.hidden = false; launch.hidden = true; launch.setAttribute("aria-expanded", "true"); history.querySelector<HTMLElement>("a")!.focus(); }, { signal: lifecycle.signal });
  root.querySelector("[data-support-close]")!.addEventListener("click", close, { signal: lifecycle.signal });
  root.addEventListener("keydown", event => { if (event.key === "Escape") close(); }, { signal: lifecycle.signal });
  root.querySelector("form")!.addEventListener("submit", event => event.preventDefault(), { signal: lifecycle.signal });
  root.hidden = false;
  onReady();
  return () => { lifecycle.abort(); history.replaceChildren(); root.hidden = true; };
}

async function startWidget(root: HTMLElement, copy: ReturnType<typeof liveSupportCopy>, lang: string, isCurrent: () => boolean, restart: () => void, onReady: () => void): Promise<() => void> {
  const snapshot = await readCustomerSession();
  if (!isCurrent()) return () => {};
  if (!snapshot) return signedOutWidget(root, copy, lang, onReady);
  const lifecycle = new AbortController();
  const session = snapshot.session;
  const imageViewer = installSupportImageViewer(root, copy, () => { void refresh(); });
  const panel = root.querySelector<HTMLElement>("#support-panel")!;
  const launch = root.querySelector<HTMLButtonElement>("[data-support-open]")!;
  const history = root.querySelector<HTMLElement>("[data-support-messages]")!;
  const form = root.querySelector<HTMLFormElement>("form")!;
  const text = root.querySelector<HTMLTextAreaElement>("[data-support-text]")!;
  const file = root.querySelector<HTMLInputElement>("[data-support-file]")!;
  const preview = root.querySelector<HTMLElement>("[data-support-preview]")!;
  const error = root.querySelector<HTMLElement>("[data-support-error]")!;
  const maintenanceMessage = maintenanceCopy(lang).supportPaused;
  const failureMessage = (failure: unknown) => isBusinessBlocked() ? maintenanceMessage : supportError(failure, copy);
  const badge = root.querySelector<HTMLElement>("[data-support-unread]")!;
  const send = root.querySelector<HTMLButtonElement>("[data-support-send]")!;
  const sendLabel = root.querySelector<HTMLElement>("[data-support-send-label]")!;
  const latest = root.querySelector<HTMLButtonElement>("[data-support-latest]")!;
  const characterCount = root.querySelector<HTMLElement>("[data-support-character-count]")!;
  const sessionControls = root.querySelector<HTMLElement>("[data-support-session-controls]")!;
  const endButton = root.querySelector<HTMLButtonElement>("[data-support-end]")!;
  const sessionNotice = root.querySelector<HTMLElement>("[data-support-session-notice]")!;
  let current: SupportConversation | undefined;
  let image: SupportImage | undefined;
  let busy = false, loadingImage = false, ended = false, refreshing = false, reading = false;
  let endingConsultation = false;
  let refreshAgain = false, conversationGeneration = 0;
  let imageGeneration = 0, lastHistory = "";
  const channels: BroadcastChannel[] = [];
  let timer: number | undefined;
  let events: ReturnType<typeof openSupportEvents> | undefined;
  let availability: SupportAvailabilityState = "unknown";
  let availabilityMonitor: ReturnType<typeof installSupportAvailabilityReader> | undefined;
  const presence = installSupportPresence({
    text, indicator: root.querySelector<HTMLElement>("[data-support-typing]")!,
    getContext: () => !ended && current && !panel.hidden ? { session } : null,
    canType: () => !isBusinessBlocked() && !busy && !loadingImage && !ended && !panel.hidden && document.hasFocus() && !imageViewer.isOpen() && getComputedStyle(root).visibility !== "hidden",
    publish: (context, typing, sourceId) => setUserTyping(context.session, typing, sourceId),
    read: context => readUserTyping(context.session),
  });
  const stop = () => {
    if (ended) return;
    ended = true;
    events?.close();
    unsubscribeMaintenance();
    lifecycle.abort();
    presence.dispose();
    customerOrders.dispose();
    availabilityMonitor?.dispose(); imageGeneration++; image = undefined; text.value = ""; file.value = "";
    history.replaceChildren(); preview.querySelector("img")!.removeAttribute("src");
    root.hidden = true; channels.forEach(channel => channel.close()); clearInterval(timer);
    imageViewer.dispose();
    observer.disconnect();
  };
  const expire = () => { stop(); if (isCurrent()) restart(); };
  const customerOrders = installCustomerOrders(root, lang, expire, async id => {
    if(ended||busy||isBusinessBlocked())throw new Error("Support is busy");
    conversationGeneration++;busy=true;setBusy();error.textContent="";
    try{const sent=await sendUserMessage(session,"",undefined,id);const active=await readCustomerSession();if(ended||active?.session!==session){expire();throw new SupportSessionEnded("Support session changed");}current=sent;paint();history.scrollTop=history.scrollHeight;}
    finally{busy=false;if(!ended)setBusy();}
  });
  const observer = new MutationObserver(() => { root.dataset.theme = document.getElementById("fx")?.dataset.theme ?? "light"; });
  const app = document.getElementById("fx");
  if (app) observer.observe(app, { attributes: true, attributeFilter: ["data-theme"] });
  root.dataset.theme = app?.dataset.theme ?? "light";
  const setBusy = () => {
    if (isBusinessBlocked()) error.textContent = maintenanceMessage;
    form.setAttribute("aria-busy", String(busy || loadingImage));
    send.disabled = isBusinessBlocked() || busy || loadingImage || !current || !(text.value.trim() || image);
    sendLabel.textContent = busy ? copy.sending : loadingImage ? copy.imageLoading : copy.send;
    text.disabled = busy;
    file.disabled = isBusinessBlocked() || busy || loadingImage;
    root.querySelector<HTMLButtonElement>("[data-support-remove]")!.disabled = busy || loadingImage;
    sessionControls.hidden = !current?.messages.length;
    endButton.hidden = current?.status === "resolved";
    endButton.disabled = isBusinessBlocked() || busy || loadingImage || !current || current.status === "resolved";
    endButton.textContent = endingConsultation ? copy.endingConsultation : copy.endConsultation;
    sessionNotice.hidden = current?.status !== "resolved";
    characterCount.hidden = text.value.length < 3600;
    characterCount.textContent = copy.characterCount.replace("{count}", new Intl.NumberFormat(lang).format(text.value.length)).replace("{limit}", new Intl.NumberFormat(lang).format(text.maxLength));
  };
  const showAttachment = () => {
    preview.hidden = !image;
    const img = preview.querySelector("img")!;
    if (image) { img.src = image.dataUrl; img.alt = image.name; preview.querySelector("span")!.textContent = image.name; }
    else img.removeAttribute("src");
  };
  const atEnd = () => history.scrollHeight - history.scrollTop - history.clientHeight <= 48;
  const updateLatest = () => {
    const count = current ? supportUnread(current, "user") : 0;
    latest.hidden = panel.hidden || !current?.messages.length || atEnd();
    latest.textContent = `${count ? `${count} ${copy.newMessages}` : copy.latest} ↓`;
  };
  function paintAvailability() {
    const label = availability === "online" ? copy.availabilityOnline : availability === "offline" ? copy.availabilityOffline : copy.availabilityUnknown;
    root.querySelectorAll<HTMLElement>("[data-support-availability-text]").forEach(element => { element.textContent = label; });
    root.querySelectorAll<HTMLElement>("[data-support-availability-dot]").forEach(element => { element.dataset.state = availability; });
    const count = current ? supportUnread(current, "user") : 0;
    launch.setAttribute("aria-label", `${copy.open} · ${label}${count ? ` · ${count} ${copy.newMessages}` : ""}`);
    launch.title = label;
  }
  function watchAvailability() {
    if (availabilityMonitor || ended) return;
    availabilityMonitor = installSupportAvailabilityReader({
      read: () => readSupportAvailability(session),
      changed: state => { if (!ended) { availability = state; paintAvailability(); } },
      onError: failure => { if (failure instanceof SupportSessionEnded) expire(); },
    });
  }
  const paint = () => {
    if (!current || ended) return;
    const count = supportUnread(current, "user");
    badge.textContent = String(count); badge.hidden = !count;
    paintAvailability();
    const markup = current.messages.length ? renderSupportMessages(current, copy, lang, "user") : `<div class="support-greeting"><div aria-hidden="true">✦</div><h3>${escapeSupport(copy.greeting)}</h3><p>${escapeSupport(copy.greetingBody)}</p></div>`;
    if (markup !== lastHistory) {
      const focusedMessage = document.activeElement instanceof HTMLElement && history.contains(document.activeElement)
        ? document.activeElement.closest<HTMLElement>("[data-support-image]")?.closest<HTMLElement>("[data-support-message]")?.dataset.messageId : undefined;
      const nearEnd = atEnd();
      history.innerHTML = markup; lastHistory = markup;
      if (focusedMessage) {
        const next = Array.from(history.querySelectorAll<HTMLElement>("[data-support-message]"))
          .find(message => message.dataset.messageId === focusedMessage)?.querySelector<HTMLElement>("[data-support-image]");
        (next ?? history).focus({ preventScroll: true });
      }
      if (nearEnd) history.scrollTop = history.scrollHeight;
    }
    updateLatest();
    setBusy();
  };
  const read = async () => {
    if (isBusinessBlocked() || !current || panel.hidden || ended || reading || document.hidden || !document.hasFocus() || !atEnd() || imageViewer.isOpen() || getComputedStyle(root).visibility === "hidden" || !supportUnread(current, "user")) return;
    const throughCreated = current.messages.at(-1)?.created ?? 0;
    reading = true;
    try { await markUserRead(session, throughCreated); if (!ended && current) { current.userReadAt = Math.max(current.userReadAt, throughCreated); paint(); } }
    catch (failure) { if (!ended) { if (failure instanceof SupportSessionEnded) expire(); else error.textContent = failureMessage(failure); } }
    finally { reading = false; }
  };
  const refresh = async (first?: CustomerSupportSession) => {
    if (ended || isBusinessBlocked()) return;
    if (refreshing || busy) { refreshAgain = true; return; }
    refreshing = true;
    const expectedGeneration = conversationGeneration;
    try {
      const active = first ?? await readCustomerSession();
      if (!active || active.session !== session) { expire(); return; }
      const next = await ensureUserConversation(active, lang);
      if (ended) return;
      if (expectedGeneration !== conversationGeneration) { refreshAgain = true; return; }
      current = next;
      if (!ended) { root.hidden = false; watchAvailability(); customerOrders.refresh(session, next.id); paint(); setBusy(); onReady(); await read(); }
    } catch (failure) {
      if (ended) return;
      if (failure instanceof SupportSessionEnded) expire();
      else { root.hidden = false; error.textContent = failureMessage(failure); onReady(); }
    } finally {
      refreshing = false; void presence.refresh();
      if (refreshAgain && !ended && !busy) { refreshAgain = false; void refresh(); }
    }
  };
  const close = () => { presence.clear(); panel.hidden = true; launch.hidden = false; launch.setAttribute("aria-expanded", "false"); launch.focus(); void presence.refresh(); };
  panel.hidden = true; launch.hidden = false; launch.setAttribute("aria-expanded", "false");
  root.querySelector<HTMLElement>("[data-support-error]")!.textContent = "";
  launch.addEventListener("click", () => {
    panel.hidden = false; launch.hidden = true; launch.setAttribute("aria-expanded", "true");
    history.scrollTop = history.scrollHeight;
    const intent = readSupportIntent();
    if (intent && !text.value && intent.title) { text.value = `${supportOrdersCopy(lang).intent}: ${intent.title}${intent.amountMicro ? ` · CNY ${intent.amountMicro / 1_000_000}` : ""}`; setBusy(); }
    (matchMedia("(pointer: coarse)").matches ? history : text).focus({ preventScroll: true });
    updateLatest(); void read(); void presence.refresh();
    if (!current) void refresh();
  }, { signal: lifecycle.signal });
  latest.addEventListener("click", () => {
    history.scrollTop = history.scrollHeight;
    history.focus({ preventScroll: true });
    updateLatest(); void read();
  }, { signal: lifecycle.signal });
  history.addEventListener("scroll", () => { updateLatest(); void read(); }, { passive: true, signal: lifecycle.signal });
  root.querySelector("[data-support-close]")!.addEventListener("click", close, { signal: lifecycle.signal });
  endButton.addEventListener("click", async () => {
    if (busy || loadingImage || ended || !current || current.status === "resolved" || isBusinessBlocked()) return;
    const visible = current;
    conversationGeneration++;
    busy = true; endingConsultation = true; setBusy(); error.textContent = "";
    try {
      const result = await endUserConversation(session, visible);
      const active = await readCustomerSession();
      if (ended) return;
      if (!active || active.session !== session) { expire(); return; }
      current = result; presence.clear(); paint();
      sessionNotice.focus({ preventScroll: true });
    } catch (failure) {
      if (!ended) {
        if (failure instanceof SupportSessionEnded) expire();
        else error.textContent = failure instanceof APIError && failure.status === 409 ? copy.endConflict : failureMessage(failure);
      }
    } finally {
      busy = false; endingConsultation = false;
      if (!ended) { setBusy(); void refresh(); }
    }
  }, { signal: lifecycle.signal });
  root.addEventListener("keydown", event => {
    if (event.key === "Escape" && !panel.hidden) { event.stopPropagation(); close(); }
  }, { signal: lifecycle.signal });
  file.addEventListener("change", async () => {
    const selected = file.files?.[0]; if (!selected || busy || ended) return;
    const generation = ++imageGeneration; loadingImage = true; setBusy(); error.textContent = copy.imageLoading;
    try { const prepared = await prepareSupportImage(selected); if (generation === imageGeneration && !ended) { image = prepared; showAttachment(); error.textContent = ""; } }
    catch { if (generation === imageGeneration && !ended) error.textContent = copy.imageInvalid; }
    finally { if (generation === imageGeneration && !ended) { loadingImage = false; file.value = ""; setBusy(); } }
  }, { signal: lifecycle.signal });
  root.querySelector("[data-support-remove]")!.addEventListener("click", () => { imageGeneration++; image = undefined; loadingImage = false; showAttachment(); setBusy(); error.textContent = ""; }, { signal: lifecycle.signal });
  form.addEventListener("submit", async event => {
    event.preventDefault(); if (busy || loadingImage || ended || isBusinessBlocked()) return;
    const body = text.value.trim();
    if (!body && !image) { error.textContent = copy.emptyMessage; return; }
    conversationGeneration++;
    busy = true; setBusy(); error.textContent = "";
    try {
      const sent = await sendUserMessage(session, body, image);
      const active = await readCustomerSession();
      if (ended) return;
      if (!active || active.session !== session) { expire(); return; }
      current = sent;
      presence.clear();
      text.value = ""; image = undefined; showAttachment(); paint(); history.scrollTop = history.scrollHeight;
      clearSupportIntent();
    } catch (failure) { if (!ended) { if (failure instanceof SupportSessionEnded) expire(); else error.textContent = failureMessage(failure); } }
    finally {
      busy = false;
      if (!ended) {
        setBusy();
        (matchMedia("(pointer: coarse)").matches && !body ? history : text).focus({ preventScroll: true });
        void refresh();
      }
    }
  }, { signal: lifecycle.signal });
  text.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); event.stopPropagation(); if (!send.disabled) form.requestSubmit(); }
  }, { signal: lifecycle.signal });
  text.addEventListener("input", setBusy, { signal: lifecycle.signal });
  for (const name of [SUPPORT_CHANNEL]) {
    try { const channel = new BroadcastChannel(name); channel.onmessage = () => { void refresh(); }; channels.push(channel); } catch { /* Polling and focus refresh work without broadcasts. */ }
  }
  events = openSupportEvents("customer", session, event => {
    if (ended) return;
    if (event.type === "session.expired") { expire(); return; }
    if (event.type === "conversation.typing") { void presence.refresh(); return; }
    void refresh();
  });
  addEventListener("focus", () => { void refresh(); }, { signal: lifecycle.signal });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void refresh(); }, { signal: lifecycle.signal });
  addEventListener("pagehide", stop, { once: true, signal: lifecycle.signal });
  addEventListener("pageshow", event => { if (event.persisted) location.reload(); }, { signal: lifecycle.signal });
  timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 15000);
  const unsubscribeMaintenance = subscribeMaintenance(() => {
    setBusy();
    if (isBusinessBlocked()) { availability = "unknown"; paintAvailability(); error.textContent = maintenanceMessage; void presence.refresh(); }
    else { if (error.textContent === maintenanceMessage) error.textContent = ""; void refresh(); }
  });
  showAttachment();
  setBusy();
  await refresh(snapshot);
  return stop;
}
