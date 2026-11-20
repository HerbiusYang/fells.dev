import { InvalidSupportData, SupportStorageFull, SupportSessionEnded, MAX_SUPPORT_IMAGE_BYTES, MAX_SUPPORT_IMAGE_PIXELS, validateSupportImage, type SupportImage, type SupportConversation } from "./support-service.ts";
import { supportLifecycleCopy } from "../i18n/support-lifecycle.ts";
import { APIError } from "./app-http.ts";
import type { SupportCopy } from "../i18n/support.ts";
import { accountLanguage } from "../i18n/api-errors.ts";
import { supportErrorCopy } from "../i18n/support-errors.ts";

export const escapeSupport = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

function imageDataURL(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new InvalidSupportData("image"));
    reader.readAsDataURL(file);
  });
}

export async function prepareSupportImage(file: File): Promise<SupportImage> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || !file.size || file.size > MAX_SUPPORT_IMAGE_BYTES) throw new InvalidSupportData("image");
  const dataUrl = await imageDataURL(file);
  // Check dimensions before decoding untrusted compressed pixels.
  validateSupportImage({ name: "image", type: file.type, size: file.size, dataUrl });
  const image = new Image();
  image.src = dataUrl;
  try { await image.decode(); } catch { throw new InvalidSupportData("image"); }
  let width = image.naturalWidth, height = image.naturalHeight;
  if (!width || !height || width * height > MAX_SUPPORT_IMAGE_PIXELS) throw new InvalidSupportData("image");
  // Export only displayed pixels. Never fall back to the original on encoder failure.
  const canvas = document.createElement("canvas");
  try {
    for (;;) {
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new InvalidSupportData("image");
      context.drawImage(image, 0, 0, width, height);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, file.type, 0.9));
      if (!blob?.size) throw new InvalidSupportData("image");
      if (blob.size <= MAX_SUPPORT_IMAGE_BYTES) {
        const extension = blob.type === "image/jpeg" ? "jpg" : blob.type.split("/")[1];
        return validateSupportImage({ name: `image.${extension}`, type: blob.type, size: blob.size, dataUrl: await imageDataURL(blob) });
      }
      if (width === 1 && height === 1) throw new InvalidSupportData("image");
      const scale = Math.min(0.8, Math.sqrt(MAX_SUPPORT_IMAGE_BYTES / blob.size));
      width = Math.max(1, Math.floor(width * scale)); height = Math.max(1, Math.floor(height * scale));
    }
  } finally { canvas.width = canvas.height = 0; }
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
    return `<article class="support-message support-message--${message.sender}" data-support-message data-sender="${message.sender}" data-message-id="${escapeSupport(message.id)}" data-conversation-id="${escapeSupport(conversation.id)}"><div class="support-message-meta"><span>${escapeSupport(sender)}</span><time datetime="${new Date(message.created).toISOString()}">${escapeSupport(time)}</time></div><div class="support-message-body">${message.text ? `<p>${escapeSupport(message.text)}</p>` : ""}${message.orderId ? `<button type="button" class="support-order-message" data-support-order="${escapeSupport(message.orderId)}"><strong>${escapeSupport(message.orderTitle)}</strong><span>${escapeSupport(new Intl.NumberFormat(lang,{style:"currency",currency:"CNY"}).format((message.orderAmountMicro??0)/1_000_000))}</span><small>${escapeSupport(supportLifecycleCopy(lang).openOrder)} →</small></button>` : ""}${message.image ? `<button type="button" class="support-message-image" data-support-image aria-label="${escapeSupport(copy.imageAlt)}"><img src="${escapeSupport(message.image.dataUrl)}" alt="${escapeSupport(message.image.name)}" loading="lazy" /><span>${escapeSupport(message.image.name)}</span></button>` : ""}</div>${receipt}</article>`;
  }).join("");
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
  // This dialog has one interactive control. Keep keyboard focus on it when
  // wrapping, including browsers that otherwise move focus to the document.
  dialog.addEventListener("keydown", event => {
    if (event.key === "Tab") { event.preventDefault(); closeButton.focus(); }
  });
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
  if (error instanceof APIError) return supportRequestError(error, typeof document === "undefined" ? "en" : document.documentElement?.lang || "en", copy.saveFailed);
  if (error instanceof SupportSessionEnded) return copy.sessionEnded;
  if (error instanceof SupportStorageFull) return copy.storageFull;
  if (error instanceof InvalidSupportData) return /image|png|jpeg|webp/i.test(error.message) ? copy.imageInvalid : copy.saveFailed;
  return copy.saveFailed;
}

/** Backend codes carry business semantics; raw English diagnostics stay out of localized controls. */
export function supportRequestError(error: unknown, lang: string, fallback: string): string {
  if (!(error instanceof APIError)) return fallback;
  const locale = accountLanguage(lang);
  if (locale === "en" || !error.code) return error.message || fallback;
  const copy = supportErrorCopy(locale);
  if (error.code === "service_maintenance") return error.message || copy.unavailable;
  if (["operation_pending", "operation_in_progress", "operation_unconfirmed", "unknown_outcome", "operation_identity_mismatch"].includes(error.code)) return copy.pending;
  if (error.code === "seat_sold_out") return copy.capacity;
  if (error.code === "plan_unavailable") return copy.plan;
  if (["insufficient_balance", "insufficient_cash", "balance_short"].includes(error.code)) return copy.funds;
  if (["price_changed", "terms_changed", "quote_expired", "quote_expired_or_mismatch"].includes(error.code)) return copy.quote;
  if (error.status === 403) return copy.forbidden;
  if (error.status === 404) return copy.missing;
  if (error.status === 409) return copy.conflict;
  if (error.status === 429) return copy.limited;
  if (error.status >= 500 || error.status === 408) return copy.unavailable;
  return error.status === 400 || error.status === 422 ? copy.invalid : error.message || fallback;
}
