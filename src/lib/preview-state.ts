// A deliberately small, validated schema for the local preview. Secrets are never
// part of this schema. Read and write paths both reconstruct allowlisted fields.
export const MAX_MESSAGE = 32_768;
export const MAX_STATE_BYTES = 1_048_576;
export type Ws = { id: string; name: string; region: string; tz: string; created: number };
export type Chat = { id: string; ws: string; title: string; agent: string; model: string; created: number; messages: [string, string][] };
export type FileItem = { id: string; ws: string; parent: string; name: string; folder: boolean; size: number; modified: number };
export const freshState = (bonus = 0) => ({
  onboarded: false, answers: [[], [], [], []] as number[][],
  profile: { name: "", avatar: 0 as number | string }, email: "",
  theme: "system" as "system" | "light" | "dark", workspaces: [] as Ws[], current: "",
  chats: [] as Chat[], files: [] as FileItem[], installed: [] as string[],
  schedules: [] as { id: string; ws: string; name: string; prompt: string; agent: string; cadence: number; time: string; paused: boolean }[],
  keys: [] as { id: string; name: string; limit: number; created: number; last4: string }[],
  credits: { bonus, never: 0, period: 0 }, joined: Date.now(),
  budget: { limit: 0, alert: 80, pause: false }, defaultChannel: "official",
  promoClosed: false, prefs: { agent: "", send: 0 }, notifs: [true, true, true, false], sbHidden: false,
});
export type PreviewState = ReturnType<typeof freshState>;
export class InvalidState extends Error {}
export class StateTooLarge extends Error {}
function fail(): never { throw new InvalidState("Invalid preview state"); }
const obj = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : fail();
const str = (v: unknown, max = 200): string => typeof v === "string" && v.length <= max ? v : fail();
const bool = (v: unknown): boolean => typeof v === "boolean" ? v : fail();
const num = (v: unknown, max = Number.MAX_SAFE_INTEGER): number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? v : fail();
const int = (v: unknown, max = Number.MAX_SAFE_INTEGER): number => Number.isInteger(num(v, max)) ? v as number : fail();
const id = (v: unknown, empty = false): string => {
  const s = str(v, 64);
  return ((empty && s === "") || /^[a-zA-Z0-9_-]+$/.test(s)) && !["__proto__", "prototype", "constructor"].includes(s) ? s : fail();
};
const list = <T>(v: unknown, parse: (x: unknown) => T, max = 500): T[] => Array.isArray(v) && v.length <= max ? v.map(parse) : fail();
const unique = <T extends { id: string }>(v: T[]): T[] => new Set(v.map(x => x.id)).size === v.length ? v : fail();

export function validateState(value: unknown): PreviewState {
  const v = obj(value), p = obj(v.profile), c = obj(v.credits), b = obj(v.budget), prefs = obj(v.prefs);
  const workspaces = unique(list(v.workspaces, x => {
    const w = obj(x);
    const tz = str(w.tz, 100);
    try { new Intl.DateTimeFormat("en", { timeZone: tz }); } catch { fail(); }
    const wid = id(w.id);
    if (wid === "example") fail();
    return { id: wid, name: str(w.name, 60), region: id(w.region), tz, created: num(w.created, 8.64e15) };
  }, 50));
  const workspace = (x: unknown) => { const s = id(x); return workspaces.some(w => w.id === s) ? s : fail(); };
  const avatar = typeof p.avatar === "number" ? int(p.avatar, 7) : str(p.avatar, 100_000);
  if (typeof avatar === "string" && !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(avatar)) fail();
  const current = id(v.current, true);
  if (current && current !== "example") workspace(current);
  const answers = list(v.answers, a => list(a, n => int(n, 20), 20), 4);
  if (answers.length !== 4) fail();
  const files = unique(list(v.files, x => {
    const f = obj(x);
    return { id: id(f.id), ws: workspace(f.ws), parent: id(f.parent, true), name: str(f.name, 255), folder: bool(f.folder), size: num(f.size), modified: num(f.modified, 8.64e15) };
  }));
  for (const file of files) {
    const seen = new Set([file.id]);
    let parent = file.parent;
    while (parent) {
      if (seen.has(parent)) fail();
      seen.add(parent);
      const ancestor = files.find(f => f.id === parent && f.ws === file.ws && f.folder);
      if (!ancestor) fail();
      parent = ancestor.parent;
    }
  }
  if (!["system", "light", "dark"].includes(String(v.theme))) fail();
  const state: PreviewState = {
    onboarded: bool(v.onboarded), answers, profile: { name: str(p.name, 100), avatar }, email: str(v.email, 254),
    theme: v.theme as PreviewState["theme"], workspaces, current, files,
    chats: unique(list(v.chats, x => {
      const t = obj(x);
      return { id: id(t.id), ws: workspace(t.ws), title: str(t.title, 100), agent: id(t.agent), model: str(t.model), created: num(t.created, 8.64e15),
        messages: list(t.messages, m => { if (!Array.isArray(m) || m.length !== 2) fail(); return [str(m[0], 100), str(m[1], MAX_MESSAGE)] as [string, string]; }, 500) };
    })),
    installed: list(v.installed, x => id(x), 100),
    schedules: unique(list(v.schedules, x => { const s = obj(x); const time = str(s.time, 5); if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) fail(); return {
      id: id(s.id), ws: workspace(s.ws), name: str(s.name, 100), prompt: str(s.prompt, MAX_MESSAGE), agent: id(s.agent), cadence: int(s.cadence, 2), time, paused: bool(s.paused),
    }; })),
    keys: unique(list(v.keys, x => { const k = obj(x); return { id: id(k.id), name: str(k.name, 40), limit: num(k.limit), created: num(k.created, 8.64e15), last4: str(k.last4, 4) }; }, 100)),
    credits: { bonus: num(c.bonus), never: num(c.never), period: num(c.period) }, joined: num(v.joined, 8.64e15),
    budget: { limit: num(b.limit), alert: num(b.alert, 100), pause: bool(b.pause) }, defaultChannel: id(v.defaultChannel),
    promoClosed: bool(v.promoClosed), prefs: { agent: id(prefs.agent, true), send: int(prefs.send, 1) },
    notifs: list(v.notifs, bool, 4), sbHidden: bool(v.sbHidden),
  };
  if (state.notifs.length !== 4) fail();
  if (new TextEncoder().encode(JSON.stringify(state)).byteLength > MAX_STATE_BYTES) throw new StateTooLarge("Preview storage limit reached");
  return state;
}
