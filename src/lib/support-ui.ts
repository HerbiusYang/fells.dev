import { InvalidSupportData, SupportStorageFull, SupportSessionEnded, MAX_SUPPORT_IMAGE_BYTES, MAX_SUPPORT_IMAGE_PIXELS, validateSupportImage, type SupportImage, type SupportConversation } from "./support-service";
import type { SupportCopy } from "../i18n/support";

export const escapeSupport = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

export async function prepareSupportImage(file: File): Promise<SupportImage> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size === 0 || file.size > MAX_SUPPORT_IMAGE_BYTES) throw new InvalidSupportData("image");
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new InvalidSupportData("image"));
    reader.readAsDataURL(file);
  });
  // Bound declared dimensions before the browser allocates decoded pixels.
  const prepared = validateSupportImage({ name: file.name.slice(0, 255), type: file.type, size: file.size, dataUrl });
  // Header preflight cannot validate compressed pixels; keep the full decode.
  const image = new Image();
  image.src = dataUrl;
  try { await image.decode(); } catch { throw new InvalidSupportData("image"); }
  if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > MAX_SUPPORT_IMAGE_PIXELS) throw new InvalidSupportData("image");
  return prepared;
}

export function supportUnread(conversation: SupportConversation, viewer: "user" | "agent") {
  const read = viewer === "user" ? conversation.userReadAt : conversation.agentReadAt;
  return conversation.messages.filter(message => message.sender !== viewer && message.created > read).length;
}

export function renderSupportMessages(conversation: SupportConversation, copy: SupportCopy, lang: string, viewer?: "user" | "agent") {
  return conversation.messages.map(message => {
    const time = new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" }).format(message.created);
    const sender = message.sender === "agent" ? copy.agent : conversation.user.name;
    const read = message.created <= (viewer === "user" ? conversation.agentReadAt : conversation.userReadAt);
    const receipt = viewer === message.sender ? `<span class="support-receipt${read ? " is-read" : ""}" data-support-receipt data-read="${read}">${escapeSupport(read ? copy.read : copy.unread)}</span>` : "";
    return `<article class="support-message support-message--${message.sender}" data-support-message data-sender="${message.sender}" data-message-id="${escapeSupport(message.id)}" data-conversation-id="${escapeSupport(conversation.id)}"><div class="support-message-meta"><span>${escapeSupport(sender)}</span><time datetime="${new Date(message.created).toISOString()}">${escapeSupport(time)}</time></div><div class="support-message-body">${message.text ? `<p>${escapeSupport(message.text)}</p>` : ""}${message.image ? `<button type="button" class="support-message-image" data-support-image aria-label="${escapeSupport(copy.imageAlt)}"><img src="${escapeSupport(message.image.dataUrl)}" alt="${escapeSupport(message.image.name)}" loading="lazy" /><span>${escapeSupport(message.image.name)}</span></button>` : ""}</div>${receipt}</article>`;
  }).join("");
}

export function replaceSupportMessages(history: HTMLElement, markup: string) {
  const focused = document.activeElement instanceof HTMLElement && history.contains(document.activeElement)
    ? document.activeElement.closest<HTMLElement>("[data-support-image]") : null;
  const article = focused?.closest<HTMLElement>("[data-support-message]");
  const messageId = article?.dataset.messageId, conversationId = article?.dataset.conversationId;
  history.innerHTML = markup;
  if (!focused || !messageId || !conversationId || history.closest("[hidden], [inert]")) return;
  // Refreshes replace message buttons, including when a read receipt changes.
  // Restore only the same message in the same conversation, never a new chat.
  const matching = Array.from(history.querySelectorAll<HTMLElement>("[data-support-message]"))
    .find(message => message.dataset.messageId === messageId && message.dataset.conversationId === conversationId);
  matching?.querySelector<HTMLElement>("[data-support-image]")?.focus({ preventScroll: true });
}

export function installSupportHistoryKeyboard(history: HTMLElement) {
  const navigate = (event: KeyboardEvent) => {
    if (event.target !== history || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const page = Math.max(40, history.clientHeight - 40);
    const positions: Record<string, number> = {
      Home: 0, End: history.scrollHeight,
      PageUp: history.scrollTop - page, PageDown: history.scrollTop + page,
      ArrowUp: history.scrollTop - 40, ArrowDown: history.scrollTop + 40,
    };
    if (!Object.hasOwn(positions, event.key)) return;
    // Native keyboard scroll animations can keep running after a send sets
    // scrollTop, pulling the newest message back out of view in Chromium.
    // Apply each history navigation immediately so no old animation survives.
    event.preventDefault();
    history.scrollTo({ top: positions[event.key], behavior: "instant" });
  };
  history.addEventListener("keydown", navigate);
  return () => history.removeEventListener("keydown", navigate);
}

export function installSupportImageViewer(root: HTMLElement, copy: SupportCopy, onClose?: () => void) {
  let disposed = false;
  let openedFrom: { trigger: HTMLElement; messageId?: string; conversationId?: string } | undefined;
  const dialog = document.createElement("dialog");
  dialog.className = "support-image-viewer";
  dialog.setAttribute("aria-label", copy.imageAlt);
  const closeButton = document.createElement("button");
  closeButton.type = "button"; closeButton.textContent = "×";
  closeButton.setAttribute("aria-label", copy.close);
  const image = document.createElement("img");
  dialog.append(closeButton, image); document.body.append(dialog);
  const close = (restoreFocus = false) => {
    const wasOpen = dialog.open;
    dialog.close(); image.removeAttribute("src"); image.alt = "";
    const origin = openedFrom;
    openedFrom = undefined;
    if (wasOpen && restoreFocus && !disposed && origin) {
      // A refresh can replace the opening button while this dialog is modal.
      // Match its conversation as well as its message so a later selection
      // cannot receive focus meant for the previous customer's image.
      const articles = Array.from(root.querySelectorAll<HTMLElement>("[data-support-message]"));
      const matching = articles.find(article => article.dataset.messageId === origin.messageId && article.dataset.conversationId === origin.conversationId);
      const sameConversation = origin.conversationId && articles.some(article => article.dataset.conversationId === origin.conversationId);
      const trigger = matching?.querySelector<HTMLElement>("[data-support-image]") ?? (root.contains(origin.trigger) ? origin.trigger : undefined);
      const fallback = sameConversation ? root.querySelector<HTMLElement>("[data-support-messages]") : undefined;
      const target = trigger ?? fallback;
      if (target?.isConnected && !target.closest("[hidden]")) target.focus({ preventScroll: true });
    }
    if (wasOpen && !disposed) onClose?.();
  };
  closeButton.addEventListener("click", () => close(true));
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(true); });
  dialog.addEventListener("click", event => { if (event.target === dialog) close(true); });
  const open = (event: MouseEvent) => {
    const target = (event.target as Element).closest<HTMLElement>("[data-support-image]");
    const source = target?.querySelector("img");
    if (!target || !source || !root.contains(target)) return;
    const article = target.closest<HTMLElement>("[data-support-message]");
    openedFrom = { trigger: target, messageId: article?.dataset.messageId, conversationId: article?.dataset.conversationId };
    image.src = source.src; image.alt = source.alt;
    dialog.showModal();
  };
  root.addEventListener("click", open);
  const dispose = () => { disposed = true; close(); root.removeEventListener("click", open); dialog.remove(); };
  return { close, dispose, isOpen: () => dialog.open };
}

export function supportError(error: unknown, copy: SupportCopy) {
  if (error instanceof SupportSessionEnded) return copy.sessionEnded;
  if (error instanceof SupportStorageFull) return copy.storageFull;
  if (error instanceof InvalidSupportData) return /image|png|jpeg|webp/i.test(error.message) ? copy.imageInvalid : copy.saveFailed;
  return copy.saveFailed;
}
