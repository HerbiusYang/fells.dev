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

export function renderSupportMessages(conversation: SupportConversation, copy: SupportCopy, lang: string) {
  return conversation.messages.map(message => {
    const time = new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" }).format(message.created);
    const sender = message.sender === "agent" ? copy.agent : conversation.user.name;
    return `<article class="support-message support-message--${message.sender}" data-support-message data-sender="${message.sender}"><div class="support-message-meta"><span>${escapeSupport(sender)}</span><time datetime="${new Date(message.created).toISOString()}">${escapeSupport(time)}</time></div><div class="support-message-body">${message.text ? `<p>${escapeSupport(message.text)}</p>` : ""}${message.image ? `<button type="button" class="support-message-image" data-support-image aria-label="${escapeSupport(copy.imageAlt)}"><img src="${escapeSupport(message.image.dataUrl)}" alt="${escapeSupport(message.image.name)}" loading="lazy" /><span>${escapeSupport(message.image.name)}</span></button>` : ""}</div></article>`;
  }).join("");
}

export function installSupportImageViewer(root: HTMLElement, copy: SupportCopy, onClose?: () => void) {
  let disposed = false;
  const dialog = document.createElement("dialog");
  dialog.className = "support-image-viewer";
  dialog.setAttribute("aria-label", copy.imageAlt);
  const closeButton = document.createElement("button");
  closeButton.type = "button"; closeButton.textContent = "×";
  closeButton.setAttribute("aria-label", copy.close);
  const image = document.createElement("img");
  dialog.append(closeButton, image); document.body.append(dialog);
  const close = () => {
    const wasOpen = dialog.open;
    dialog.close(); image.removeAttribute("src"); image.alt = "";
    if (wasOpen && !disposed) onClose?.();
  };
  closeButton.addEventListener("click", close);
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
  dialog.addEventListener("click", event => { if (event.target === dialog) close(); });
  const open = (event: MouseEvent) => {
    const target = (event.target as Element).closest<HTMLElement>("[data-support-image]");
    const source = target?.querySelector("img");
    if (!target || !source || !root.contains(target)) return;
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
