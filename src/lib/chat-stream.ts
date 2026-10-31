import { MAX_MESSAGE, InvalidState } from "./preview-state.ts";

export const MAX_CHAT_STREAM_SEQ = 2_147_483_647;
export type ChatStreamProgress = "queued" | "connecting" | "generating" | "searching" | "finalizing" | "stopping";
export type ChatStreamFrame =
  | { type: "snapshot"; seq: number; text: string; progress: ChatStreamProgress; run: unknown; live: boolean; cancel_available: boolean }
  | { type: "delta"; seq: number; text: string }
  | { type: "progress"; seq: number; progress: ChatStreamProgress }
  | { type: "terminal"; seq: number; run: unknown };
const progress = new Set(["queued", "connecting", "generating", "searching", "finalizing", "stopping"]);
// JSON escaping can use six bytes per text unit; leave bounded room for the
// run receipt. The decoded cumulative text has its own stricter message bound.
const MAX_EVENT = 262_144;
const invalid = (): never => { throw new InvalidState("Invalid conversation stream"); };
function parseFrame(type: string, data: string): ChatStreamFrame {
  let v;
  try { v = JSON.parse(data); } catch { return invalid(); }
  if (!v || typeof v !== "object" || Array.isArray(v) || !Number.isSafeInteger(v.seq) || v.seq < 0 || v.seq > MAX_CHAT_STREAM_SEQ) invalid();
  const text = () => { const value = v.text === undefined ? "" : v.text; return typeof value === "string" && value.length <= MAX_MESSAGE ? value : invalid(); };
  const phase = () => progress.has(v.progress) ? v.progress as ChatStreamProgress : invalid();
  switch (type) {
    case "snapshot":
      if (typeof v.text !== "string" || typeof v.live !== "boolean" || typeof v.cancel_available !== "boolean") invalid();
      return { type, seq: v.seq, text: text(), progress: phase(), run: v.run, live: v.live, cancel_available: v.cancel_available };
    case "delta": return { type, seq: v.seq, text: text() };
    case "progress": return { type, seq: v.seq, progress: phase() };
    case "terminal": return { type, seq: v.seq, run: v.run };
    default: return invalid();
  }
}

/** Incremental UTF-8/SSE decoding. EOF is never a completion receipt. */
export async function readChatStream(response: Response, receive: (event: ChatStreamFrame) => void, signal?: AbortSignal, activity?: () => void): Promise<void> {
  if (response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "text/event-stream" || !response.body) invalid();
  const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  const abort = () => { void reader.cancel(signal?.reason).catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true });
  let buffer = "", type = "", data: string[] = [], dataLength = 0, first = true, terminal = false;
  const line = (value: string) => {
    if (!value) {
      if (!data.length) { type = ""; return; }
      const event = parseFrame(type, data.join("\n"));
      if (first && event.type !== "snapshot") invalid();
      first = false; type = ""; data = []; dataLength = 0;
      signal?.throwIfAborted(); receive(event);
      if (event.type === "terminal") terminal = true;
      return;
    }
    if (value.startsWith(":")) return;
    const colon = value.indexOf(":"), field = colon < 0 ? value : value.slice(0, colon);
    const body = colon < 0 ? "" : value.slice(colon + 1).replace(/^ /, "");
    if (field === "event") { if (type || body.length > 32) invalid(); type = body; }
    if (field === "data") { dataLength += body.length + 1; if (dataLength > MAX_EVENT) invalid(); data.push(body); }
  };
  try {
    while (!terminal) {
      signal?.throwIfAborted();
      const next = await reader.read(); signal?.throwIfAborted();
      if (next.value && next.value.byteLength > MAX_EVENT * 4) invalid();
      if (next.value?.byteLength) activity?.();
      buffer += decoder.decode(next.value, { stream: !next.done });
      let at: number;
      while (!terminal && (at = buffer.indexOf("\n")) >= 0) {
        const value = buffer.slice(0, at).replace(/\r$/, ""); buffer = buffer.slice(at + 1);
        if (value.length > MAX_EVENT) invalid(); line(value);
      }
      if (buffer.length > MAX_EVENT) invalid();
      if (next.done) { if (first || buffer || data.length) invalid(); break; }
    }
  } finally { signal?.removeEventListener("abort", abort); void reader.cancel().catch(() => {}); reader.releaseLock(); }
}
