import { api, APIError, type APIOptions } from "./app-http.ts";
import { readSupportImageDimensions } from "./support-image.ts";

const CHAT_ATTACHMENT_BYTES = 2 * 1024 * 1024;
const ATTACHMENT_MUTATION_TIMEOUT_MS = 60_000;
export const CHAT_ATTACHMENT_COUNT = 4;
export type ChatAttachment = { id: string; name: string; mime_type: string; kind: "image" | "text" | "document"; size: number; sha256: string; created: number; message_id?: string; run_id?: string };
export type ChatAttachmentCapabilities = { attachments?: boolean; vision?: boolean; documents?: boolean };
export type ChatAttachmentIdentity = { userId: number; sessionId: string };
const formats: Record<string, [ChatAttachment["kind"], string]> = {
  png: ["image", "image/png"], jpg: ["image", "image/jpeg"], jpeg: ["image", "image/jpeg"], webp: ["image", "image/webp"],
  txt: ["text", "text/plain"], md: ["text", "text/markdown"], csv: ["text", "text/csv"], json: ["text", "application/json"],
  docx: ["text", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"], pdf: ["document", "application/pdf"],
};
const validID = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
export function chatAttachmentPath(chatID: string, attachmentID?: string): string {
  if (!validID(chatID) || attachmentID !== undefined && !validID(attachmentID)) throw new Error("Invalid private attachment path");
  return `/api/app/chats/${encodeURIComponent(chatID)}/attachments${attachmentID === undefined ? "" : `/${encodeURIComponent(attachmentID)}`}`;
}
export function parseChatAttachment(value: unknown): ChatAttachment {
  const v = value as Record<string, unknown> | null;
  const format = Object.values(formats).find(([kind, mime]) => kind === v?.kind && mime === v?.mime_type);
  if (!v || typeof v !== "object" || !validID(v.id) || typeof v.name !== "string" || !v.name || v.name.length > 300 || /[\u0000-\u001f\u007f]/.test(v.name) || !format || !Number.isSafeInteger(v.size) || Number(v.size) <= 0 || Number(v.size) > CHAT_ATTACHMENT_BYTES || typeof v.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(v.sha256) || !Number.isSafeInteger(v.created) || Number(v.created) <= 0 || v.message_id !== undefined && !validID(v.message_id) || v.run_id !== undefined && !validID(v.run_id)) throw new Error("Invalid private attachment metadata");
  return { id: v.id, name: v.name, mime_type: format[1], kind: format[0], size: Number(v.size), sha256: v.sha256, created: Number(v.created), ...(v.message_id === undefined ? {} : { message_id: v.message_id as string }), ...(v.run_id === undefined ? {} : { run_id: v.run_id as string }) };
}
export function attachmentSupported(capabilities: ChatAttachmentCapabilities | undefined, kind: ChatAttachment["kind"]): boolean {
  return kind === "image" ? capabilities?.vision === true : kind === "document" ? capabilities?.documents === true : capabilities?.attachments === true;
}
export function attachmentFileKind(file: Pick<File, "name" | "type" | "size">): ChatAttachment["kind"] | null {
  const format = formats[file.name.split(".").at(-1)?.toLowerCase() ?? ""];
  if (!format || !file.name.trim() || file.name.length > 255 || /[\u0000-\u001f\u007f/\\]/.test(file.name) || file.name !== file.name.trim() || file.size <= 0 || file.size > CHAT_ATTACHMENT_BYTES || file.type && file.type !== "application/octet-stream" && file.type !== format[1] && !(format[0] === "text" && file.type === "text/plain")) return null;
  return format[0];
}
export async function inspectAttachmentFile(file: File): Promise<{ kind: ChatAttachment["kind"]; sha256: string }> {
  const kind = attachmentFileKind(file);
  if (!kind) throw new Error("invalid_file");
  const data = await file.arrayBuffer();
  if (kind === "image") {
    const mime = formats[file.name.split(".").at(-1)!.toLowerCase()][1], bytes = new Uint8Array(data), chunks = [];
    for (let index = 0; index < bytes.length; index += 2048) chunks.push(String.fromCharCode(...bytes.subarray(index, index + 2048)));
    if (!readSupportImageDimensions(chunks.join(""), mime)) throw new Error("invalid_file");
  }
  const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))].map(byte => byte.toString(16).padStart(2, "0")).join("");
  return { kind, sha256 };
}
function headers(identity: ChatAttachmentIdentity) {
  if (!Number.isSafeInteger(identity.userId) || identity.userId <= 0 || !/^[a-f0-9]{64}$/.test(identity.sessionId)) throw new Error("Invalid attachment identity");
  return { "X-Fells-Expected-User": String(identity.userId), "X-Fells-Expected-Session": identity.sessionId };
}
export async function listChatAttachments(identity: ChatAttachmentIdentity, chatID: string, signal?: AbortSignal): Promise<ChatAttachment[]> {
  const result = await api<{ attachments: unknown[] }>(chatAttachmentPath(chatID), { headers: headers(identity), signal });
  if (!Array.isArray(result.attachments) || result.attachments.length > 2000) throw new Error("Invalid attachment list");
  const list = result.attachments.map(parseChatAttachment);
  if (new Set(list.map(item => item.id)).size !== list.length) throw new Error("Duplicate attachment ID");
  return list;
}
// Metadata writes can outlive their replies. Bound the wait, but leave outcome
// reconciliation to the controller; this helper never retries a mutation.
async function mutateAttachment<T>(path: string, options: Omit<APIOptions, "signal">, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined, abort: (() => void) | undefined;
  const deadline = new Promise<never>((_, reject) => {
    abort = () => { controller.abort(signal?.reason); reject(signal?.reason ?? new DOMException("Attachment request cancelled", "AbortError")); };
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => {
      const error = new APIError(408, "Attachment response was not confirmed. Check existing files before retrying.", "attachment_timeout");
      controller.abort(error); reject(error);
    }, ATTACHMENT_MUTATION_TIMEOUT_MS);
  });
  try {
    if (signal?.aborted) return await deadline;
    return await Promise.race([api<T>(path, { ...options, signal: controller.signal }), deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (abort) signal?.removeEventListener("abort", abort);
  }
}
export async function uploadChatAttachment(identity: ChatAttachmentIdentity, chatID: string, file: File, signal?: AbortSignal): Promise<ChatAttachment> {
  const form = new FormData(); form.set("file", file, file.name);
  const result = await mutateAttachment<{ attachment: unknown }>(chatAttachmentPath(chatID), { method: "POST", body: form, headers: headers(identity), expectedStatus: 201 }, signal);
  return parseChatAttachment(result.attachment);
}
export async function deleteChatAttachment(identity: ChatAttachmentIdentity, chatID: string, attachmentID: string, signal?: AbortSignal): Promise<void> {
  const result = await mutateAttachment<{ deleted: boolean }>(chatAttachmentPath(chatID, attachmentID), { method: "DELETE", headers: headers(identity) }, signal);
  if (result.deleted !== true) throw new Error("Attachment removal was not confirmed");
}
