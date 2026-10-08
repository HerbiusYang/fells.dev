import { readPreview, PREVIEW_CHANNEL, type Snapshot } from "../lib/preview-store";
import { ensureUserConversation, sendUserMessage, markUserRead, readUserTyping, setUserTyping, SUPPORT_CHANNEL, SupportSessionEnded, type SupportConversation, type SupportImage } from "../lib/support-service";
import { escapeSupport, prepareSupportImage, renderSupportMessages, supportError, supportUnread, installSupportImageViewer } from "../lib/support-ui";
import type { SupportCopy } from "../i18n/support";
import { installSupportPresence } from "../lib/support-presence";

const widget = document.querySelector<HTMLElement>("#support-widget");
const config = document.getElementById("support-widget-data");
if (widget && config && window.self === window.top) {
  const data = JSON.parse(config.textContent || "{}") as { copy: SupportCopy; lang: string };
  void startWidget(widget, data.copy, data.lang).catch(() => { widget.hidden = true; });
}

async function startWidget(root: HTMLElement, copy: SupportCopy, lang: string) {
  const snapshot = await readPreview();
  if (!snapshot) return;
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
  const badge = root.querySelector<HTMLElement>("[data-support-unread]")!;
  const send = root.querySelector<HTMLButtonElement>("[data-support-send]")!;
  const sendLabel = root.querySelector<HTMLElement>("[data-support-send-label]")!;
  const latest = root.querySelector<HTMLButtonElement>("[data-support-latest]")!;
  const characterCount = root.querySelector<HTMLElement>("[data-support-character-count]")!;
  let current: SupportConversation | undefined;
  let image: SupportImage | undefined;
  let busy = false, loadingImage = false, ended = false, refreshing = false, reading = false;
  let imageGeneration = 0, lastHistory = "";
  const channels: BroadcastChannel[] = [];
  let timer: number | undefined;
  const presence = installSupportPresence({
    text, indicator: root.querySelector<HTMLElement>("[data-support-typing]")!,
    getContext: () => !ended && current && !panel.hidden ? { session } : null,
    canType: () => !busy && !loadingImage && !ended && !panel.hidden && document.hasFocus() && !imageViewer.isOpen() && getComputedStyle(root).visibility !== "hidden",
    publish: (context, typing, sourceId) => setUserTyping(context.session, typing, sourceId),
    read: context => readUserTyping(context.session),
  });
  const stop = () => {
    presence.dispose();
    ended = true; imageGeneration++; image = undefined; text.value = ""; file.value = "";
    history.replaceChildren(); preview.querySelector("img")!.removeAttribute("src");
    root.hidden = true; channels.forEach(channel => channel.close()); clearInterval(timer);
    imageViewer.dispose();
    observer.disconnect();
  };
  const observer = new MutationObserver(() => { root.dataset.theme = document.getElementById("fx")?.dataset.theme ?? "light"; });
  const app = document.getElementById("fx");
  if (app) observer.observe(app, { attributes: true, attributeFilter: ["data-theme"] });
  root.dataset.theme = app?.dataset.theme ?? "light";
  const setBusy = () => {
    form.setAttribute("aria-busy", String(busy || loadingImage));
    send.disabled = busy || loadingImage || !(text.value.trim() || image);
    sendLabel.textContent = busy ? copy.sending : loadingImage ? copy.imageLoading : copy.send;
    text.disabled = busy;
    file.disabled = busy || loadingImage;
    root.querySelector<HTMLButtonElement>("[data-support-remove]")!.disabled = busy || loadingImage;
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
  const paint = () => {
    if (!current || ended) return;
    const count = supportUnread(current, "user");
    badge.textContent = String(count); badge.hidden = !count;
    launch.setAttribute("aria-label", count ? `${copy.open} · ${count} ${copy.newMessages}` : copy.open);
    const markup = current.messages.length ? renderSupportMessages(current, copy, lang, "user") : `<div class="support-greeting"><div aria-hidden="true">✦</div><h3>${escapeSupport(copy.greeting)}</h3><p>${escapeSupport(copy.greetingBody)}</p></div>`;
    if (markup !== lastHistory) {
      const nearEnd = atEnd();
      history.innerHTML = markup; lastHistory = markup;
      if (nearEnd) history.scrollTop = history.scrollHeight;
    }
    updateLatest();
  };
  const read = async () => {
    if (!current || panel.hidden || ended || reading || document.hidden || !document.hasFocus() || !atEnd() || imageViewer.isOpen() || getComputedStyle(root).visibility === "hidden" || !supportUnread(current, "user")) return;
    const throughCreated = current.messages.at(-1)?.created ?? 0;
    reading = true;
    try { await markUserRead(session, throughCreated); if (!ended && current) { current.userReadAt = Math.max(current.userReadAt, throughCreated); paint(); } }
    catch (failure) { if (failure instanceof SupportSessionEnded) stop(); else error.textContent = supportError(failure, copy); }
    finally { reading = false; }
  };
  const refresh = async (first?: Snapshot) => {
    if (ended || refreshing || busy) return;
    refreshing = true;
    try {
      const active = first ?? await readPreview();
      if (!active || active.session !== session) { stop(); return; }
      current = await ensureUserConversation(active, lang);
      if (!ended) { root.hidden = false; paint(); await read(); }
    } catch (failure) {
      if (failure instanceof SupportSessionEnded) stop();
      else { root.hidden = false; error.textContent = supportError(failure, copy); }
    } finally { refreshing = false; void presence.refresh(); }
  };
  const close = () => { presence.clear(); panel.hidden = true; launch.hidden = false; launch.setAttribute("aria-expanded", "false"); launch.focus(); void presence.refresh(); };
  launch.addEventListener("click", () => {
    panel.hidden = false; launch.hidden = true; launch.setAttribute("aria-expanded", "true");
    history.scrollTop = history.scrollHeight;
    (matchMedia("(pointer: coarse)").matches ? history : text).focus({ preventScroll: true });
    updateLatest(); void read(); void presence.refresh();
  });
  latest.addEventListener("click", () => {
    history.scrollTop = history.scrollHeight;
    history.focus({ preventScroll: true });
    updateLatest(); void read();
  });
  history.addEventListener("scroll", () => { updateLatest(); void read(); }, { passive: true });
  root.querySelector("[data-support-close]")!.addEventListener("click", close);
  root.addEventListener("keydown", event => {
    if (event.key === "Escape" && !panel.hidden) { event.stopPropagation(); close(); }
  });
  file.addEventListener("change", async () => {
    const selected = file.files?.[0]; if (!selected || busy || ended) return;
    const generation = ++imageGeneration; loadingImage = true; setBusy(); error.textContent = copy.imageLoading;
    try { const prepared = await prepareSupportImage(selected); if (generation === imageGeneration && !ended) { image = prepared; showAttachment(); error.textContent = ""; } }
    catch { if (generation === imageGeneration && !ended) error.textContent = copy.imageInvalid; }
    finally { if (generation === imageGeneration) { loadingImage = false; file.value = ""; setBusy(); } }
  });
  root.querySelector("[data-support-remove]")!.addEventListener("click", () => { imageGeneration++; image = undefined; loadingImage = false; showAttachment(); setBusy(); error.textContent = ""; });
  form.addEventListener("submit", async event => {
    event.preventDefault(); if (busy || loadingImage || ended) return;
    const body = text.value.trim();
    if (!body && !image) { error.textContent = copy.emptyMessage; return; }
    busy = true; setBusy(); error.textContent = "";
    try {
      current = await sendUserMessage(session, body, image);
      if (ended) return;
      presence.clear();
      text.value = ""; image = undefined; showAttachment(); paint(); history.scrollTop = history.scrollHeight;
    } catch (failure) { if (failure instanceof SupportSessionEnded) stop(); else error.textContent = supportError(failure, copy); }
    finally {
      busy = false;
      if (!ended) {
        setBusy();
        (matchMedia("(pointer: coarse)").matches && !body ? history : text).focus({ preventScroll: true });
        void refresh();
      }
    }
  });
  text.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); event.stopPropagation(); if (!send.disabled) form.requestSubmit(); }
  });
  text.addEventListener("input", setBusy);
  for (const name of [SUPPORT_CHANNEL, PREVIEW_CHANNEL]) {
    try { const channel = new BroadcastChannel(name); channel.onmessage = () => { void refresh(); }; channels.push(channel); } catch { /* Polling and focus refresh work without broadcasts. */ }
  }
  addEventListener("focus", () => { void refresh(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void refresh(); });
  addEventListener("pagehide", stop, { once: true });
  addEventListener("pageshow", event => { if (event.persisted) location.reload(); });
  timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 3000);
  setBusy();
  await refresh(snapshot);
}
