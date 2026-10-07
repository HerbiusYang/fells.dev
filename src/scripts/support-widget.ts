import { readPreview, PREVIEW_CHANNEL, type Snapshot } from "../lib/preview-store";
import { ensureUserConversation, sendUserMessage, markUserRead, SUPPORT_CHANNEL, SupportSessionEnded, type SupportConversation, type SupportImage } from "../lib/support-service";
import { escapeSupport, prepareSupportImage, renderSupportMessages, supportError, supportUnread, installSupportImageViewer } from "../lib/support-ui";
import type { SupportCopy } from "../i18n/support";

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
  let current: SupportConversation | undefined;
  let image: SupportImage | undefined;
  let busy = false, loadingImage = false, ended = false, refreshing = false;
  let imageGeneration = 0, lastHistory = "";
  const channels: BroadcastChannel[] = [];
  let timer: number | undefined;
  const stop = () => {
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
    form.querySelector<HTMLButtonElement>("[data-support-send]")!.disabled = busy || loadingImage;
    text.disabled = busy;
    file.disabled = busy || loadingImage;
    root.querySelector<HTMLButtonElement>("[data-support-remove]")!.disabled = busy || loadingImage;
  };
  const showAttachment = () => {
    preview.hidden = !image;
    const img = preview.querySelector("img")!;
    if (image) { img.src = image.dataUrl; img.alt = image.name; preview.querySelector("span")!.textContent = image.name; }
    else img.removeAttribute("src");
  };
  const paint = () => {
    if (!current || ended) return;
    const count = supportUnread(current, "user");
    badge.textContent = String(count); badge.hidden = !count;
    launch.setAttribute("aria-label", count ? `${copy.open} · ${count} ${copy.newMessages}` : copy.open);
    const markup = current.messages.length ? renderSupportMessages(current, copy, lang) : `<div class="support-greeting"><div aria-hidden="true">✦</div><h3>${escapeSupport(copy.greeting)}</h3><p>${escapeSupport(copy.greetingBody)}</p></div>`;
    if (markup !== lastHistory) {
      const nearEnd = history.scrollHeight - history.scrollTop - history.clientHeight < 64;
      history.innerHTML = markup; lastHistory = markup;
      if (nearEnd) history.scrollTop = history.scrollHeight;
    }
  };
  const read = async () => {
    if (!current || panel.hidden || ended || document.hidden || imageViewer.isOpen() || getComputedStyle(root).visibility === "hidden" || !supportUnread(current, "user")) return;
    const throughCreated = current.messages.at(-1)?.created ?? 0;
    try { await markUserRead(session, throughCreated); if (!ended && current) { current.userReadAt = throughCreated; paint(); } }
    catch (failure) { if (failure instanceof SupportSessionEnded) stop(); else error.textContent = supportError(failure, copy); }
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
    } finally { refreshing = false; }
  };
  const close = () => { panel.hidden = true; launch.hidden = false; launch.setAttribute("aria-expanded", "false"); launch.focus(); };
  launch.addEventListener("click", () => {
    panel.hidden = false; launch.hidden = true; launch.setAttribute("aria-expanded", "true");
    history.scrollTop = history.scrollHeight; text.focus(); void read();
  });
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
      text.value = ""; image = undefined; showAttachment(); paint(); history.scrollTop = history.scrollHeight;
    } catch (failure) { if (failure instanceof SupportSessionEnded) stop(); else error.textContent = supportError(failure, copy); }
    finally { busy = false; if (!ended) { setBusy(); text.focus(); void refresh(); } }
  });
  text.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); event.stopPropagation(); form.requestSubmit(); }
  });
  for (const name of [SUPPORT_CHANNEL, PREVIEW_CHANNEL]) {
    try { const channel = new BroadcastChannel(name); channel.onmessage = () => { void refresh(); }; channels.push(channel); } catch { /* Polling and focus refresh work without broadcasts. */ }
  }
  addEventListener("focus", () => { void refresh(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void refresh(); });
  addEventListener("pagehide", stop, { once: true });
  addEventListener("pageshow", event => { if (event.persisted) location.reload(); });
  timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 3000);
  await refresh(snapshot);
}
