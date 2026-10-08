// Client for /app. Renders every signed-in view from the JSON blob in AppPage.astro.
// No backend yet. Validated preview data uses transactional browser storage; secrets stay in memory.
import { freshState, MAX_MESSAGE, StateTooLarge, type Ws, type Chat, type FileItem } from "../lib/preview-state";
import { readPreview, commitPreview, endPreview, removeLegacyStorage, PREVIEW_CHANNEL, StaleState, EndedSession } from "../lib/preview-store";
/* eslint-disable @typescript-eslint/no-explicit-any */

const root = document.getElementById("fx");
const blob = document.getElementById("fx-data");
if (root && blob) {
  const data = JSON.parse(blob.textContent || "{}");
  if (window.self !== window.top) root.textContent = data.security.frameBlocked;
  else start(root, data).catch(() => {
    root.replaceChildren();
    const message = document.createElement("p");
    message.textContent = data.security.storageUnavailable;
    const link = document.createElement("a");
    link.href = data.links.start;
    link.textContent = data.security.enter;
    root.append(message, link);
  });
}

async function start(root: HTMLElement, D: any) {
  const A = D.a;
  const security = D.security;

  // ---------- helpers ----------
  const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  const fmt = (s: string, vars: Record<string, unknown> = {}) => String(s).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  const uid = () => crypto.randomUUID();
  const money = (n: number) => "$" + (Math.round(n * 100) / 100).toFixed(n % 1 ? 2 : 0);
  const money2 = (n: number) => "$" + n.toFixed(2);
  const dfmt = (d: number | Date, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }) => new Intl.DateTimeFormat(D.lang, opts).format(new Date(d));
  const tfmt = (d: number) => new Intl.DateTimeFormat(D.lang, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(d));
  const agentById = (id: string) => D.agents.find((a: any) => a.id === id) ?? D.agents[0];
  const initials = (name: string) => (name.trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2) || "?").toUpperCase();
  const DAY = 864e5;
  const M = D.marks;
  const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const mk = (m: any, size = 18, cls = "") => (m ? `<span class="aimk ${cls}" style="--hue:${m.hue};--mk:${size}px" aria-hidden="true">${m.svg}</span>` : "");
  const agentMk = (id: string, size = 18, cls = "") => mk(M.agents[id], size, cls);

  const ICONS: Record<string, string> = {
    plus: "M12 5v14M5 12h14",
    file: "M4 6.5A1.5 1.5 0 0 1 5.5 5H10l2 2h6.5A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z",
    canvas: "M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z",
    users: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.5a3.5 3.5 0 0 1 0 6.5M21 20c0-2.6-1.6-4.8-4-5.6",
    plug: "M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4",
    more: "M5 12h.01M12 12h.01M19 12h.01",
    chev: "m6 9 6 6 6-6",
    chevR: "m9 6 6 6-6 6",
    chevL: "m15 6-6 6 6 6",
    gift: "M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7S10.5 3 8 3.5 7 7 12 7zM12 7s1.5-4 4-3.5S17 7 12 7z",
    bulb: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z",
    x: "M6 6l12 12M18 6 6 18",
    attach: "M20 11.5 12 19.5a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4L15 7",
    monitor: "M3 5h18v11H3zM8 20h8M12 16v4",
    cloud: "M7 18a4.5 4.5 0 0 1-.5-9 6 6 0 0 1 11.6 1.5A3.8 3.8 0 0 1 17.5 18z",
    up: "M12 19V5M5 12l7-7 7 7",
    grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
    list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
    upload: "M12 16V4M7 9l5-5 5 5M4 20h16",
    folderPlus: "M4 6.5A1.5 1.5 0 0 1 5.5 5H10l2 2h6.5A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5zM12 10v6M9 13h6",
    globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18",
    clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
    key: "M14 10a4 4 0 1 0-1.2 2.8L20 20M17 17l2-2M15 15l1.5-1.5",
    card: "M3 6h18v12H3zM3 10h18M7 15h3",
    book: "M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21V5M8 7h7",
    logout: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10",
    sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
    moon: "M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z",
    system: "M3 5h18v11H3zM8 20h8M12 16v4M12 5v11",
    menu: "M4 7h16M4 12h16M4 17h16",
    check: "m5 12 5 5 9-10",
    copy: "M8 8h11v12H8zM5 16V4h11",
    trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
    spark: "M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z",
    gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z",
    store: "M4 9l1.5-5h13L20 9M4 9v11h16V9M4 9h16M9 20v-6h6v6",
    lang: "M4 5h9M8.5 3v2M6 5c0 4 3 7 6 8M11 5c0 4-3 7-6 8M13 21l4-9 4 9M14.5 18h5",
    download: "M12 4v12M7 11l5 5 5-5M4 20h16",
    lock: "M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3",
    shield: "M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z",
    refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
    play: "M7 5v14l11-7z",
    pause: "M8 5v14M16 5v14",
    import: "M12 3v12M7 10l5 5 5-5M5 21h14",
    ext: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
    mail: "M3 6h18v12H3zM3 7l9 6 9-6",
  };
  const ic = (name: string, size = 18) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name] ?? ""}"/></svg>`;
  const AVATARS = [
    "linear-gradient(135deg,#d9b98a,#a97c50)", "linear-gradient(135deg,#f6a07a,#c4553b)", "linear-gradient(135deg,#9db4ff,#5865f2)", "linear-gradient(135deg,#86d6ad,#2d8a63)",
    "linear-gradient(135deg,#f5c76b,#d0892c)", "linear-gradient(135deg,#c9a6ff,#7c4dd8)", "linear-gradient(135deg,#7fd3e6,#2f7fa8)", "linear-gradient(135deg,#ef9fbc,#bf4a77)",
  ];

  // ---------- state ----------
  removeLegacyStorage();
  let committed = await readPreview();
  if (!committed) { location.replace(D.links.start); return; }
  let S = structuredClone(committed.state);
  // Never serialize these values, including on theme/profile saves.
  let environment: Record<string, [string, string][]> = Object.create(null);
  let saving = false;
  let refreshPending = false;
  let ended = false;
  let generation = 0;
  const clearView = () => {
    ended = true;
    environment = Object.create(null);
    S = freshState();
    committed = null;
    for (const key of Object.keys(V)) delete V[key];
    closeDlg(); closePop();
    root.replaceChildren();
    location.replace(D.links.start);
  };
  const adopt = (next: NonNullable<typeof committed>) => {
    committed = next;
    S = structuredClone(next.state);
    for (const id of Object.keys(environment)) if (!S.workspaces.some(w => w.id === id)) delete environment[id];
  };
  const showLatest = (next: Awaited<ReturnType<typeof readPreview>>) => {
    if (!next || next.session !== committed!.session) { clearView(); return; }
    if (next.revision > committed!.revision) {
      const draft = root.querySelector<HTMLTextAreaElement>("#fx-input")?.value;
      adopt(next); closeDlg(); closePop(); render();
      const input = root.querySelector<HTMLTextAreaElement>("#fx-input");
      if (input && draft) input.value = draft;
      toast(security.conflict);
    }
  };
  const refresh = async () => {
    if (ended) return;
    if (saving) { refreshPending = true; return; }
    refreshPending = false;
    const before = generation;
    try {
      const next = await readPreview();
      if (saving || ended || before !== generation) return;
      showLatest(next);
    } catch { toast(security.storageUnavailable); }
  };
  const save = async (): Promise<boolean> => {
    if (saving || ended) return false;
    saving = true; generation++;
    root.setAttribute("aria-busy", "true");
    try {
      adopt(await commitPreview(committed!, S));
      return true;
    } catch (error) {
      S = structuredClone(committed!.state);
      if (error instanceof EndedSession) clearView();
      else if (error instanceof StaleState) {
        // Keep other mutations blocked until the conflict has been resolved.
        try { showLatest(await readPreview()); }
        catch { toast(security.storageUnavailable); }
      } else toast(error instanceof StateTooLarge ? security.tooLarge : security.saveFailed);
      return false;
    } finally {
      saving = false;
      root.removeAttribute("aria-busy");
      if (refreshPending) void refresh();
    }
  };
  const displayName = () => S.profile.name || (S.email ? S.email.split("@")[0] : A.common.you);
  const avatarStyle = () => (typeof S.profile.avatar === "string" ? `--av:url(${JSON.stringify(S.profile.avatar)})` : `--av:${AVATARS[S.profile.avatar % AVATARS.length]}`);
  const avatar = (cls = "") => `<span class="av ${cls}" style='${esc(avatarStyle())}'>${typeof S.profile.avatar === "string" ? "" : esc(initials(displayName()))}</span>`;
  const balance = () => S.credits.bonus + S.credits.never + S.credits.period;
  const bonusExpiry = () => S.joined + 30 * DAY;

  // Recommended agent from onboarding answer 2 (which agents do you use).
  const pickedAgent = () => {
    const map = ["codex", "claude", "grok", "opencode", "kimi"];
    const a = (S.answers[1] || []).find((i) => i < map.length);
    return a === undefined ? "" : map[a];
  };
  const defaultAgent = () => S.prefs.agent || pickedAgent() || "codex";

  // ---------- view state (not persisted) ----------
  const V: any = {
    agent: defaultAgent(),
    model: {} as Record<string, string>,
    effort: 1,
    plan: false,
    computer: "cloud",
    draft: "",
    attach: [] as string[],
    folder: "",
    fileView: "grid",
    pluginCat: 0,
    pluginQ: "",
    marketTab: "all",
    marketQ: "",
    apiRange: 0,
    importAgent: "codex",
    moreOpen: false,
    quickTab: 0,
  };

  // ---------- workspace context ----------
  const isExample = () => S.current === "example";
  const ws = (): Ws | null => S.workspaces.find((w) => w.id === S.current) ?? null;
  const hasWs = () => isExample() || !!ws();
  const wsName = () => (isExample() ? A.example.name : ws()?.name ?? "");
  const exampleChats = (): Chat[] =>
    A.example.chats.map((c: any, i: number) => ({ id: "ex" + i, ws: "example", title: c.title, agent: c.agent, model: agentById(c.agent).model, created: Date.now() - (i + 1) * 3 * 3600e3, messages: c.messages }));
  const chats = (): Chat[] => (isExample() ? exampleChats() : S.chats.filter((c) => c.ws === S.current).sort((a, b) => b.created - a.created));
  const regionName = (r: string) => (A.newWs.regions[r] || [r])[0];

  // ---------- routing ----------
  const route = () => {
    const h = location.hash.replace(/^#\/?/, "");
    const [name, arg] = h.split("/");
    return { name: name || "", arg: arg || "" };
  };
  const go = (h: string) => {
    closeSb();
    if (location.hash.replace(/^#\/?/, "") === h) render();
    else location.hash = h ? "/" + h : "";
  };
  const needsWs = new Set(["files", "canvas", "members", "plugins", "sites", "schedules", "ws-settings", "chat", "import"]);

  // ---------- theme ----------
  const mq = matchMedia("(prefers-color-scheme: dark)");
  const applyTheme = () => {
    const dark = S.theme === "dark" || (S.theme === "system" && mq.matches);
    root.dataset.theme = dark ? "dark" : "light";
  };
  mq.addEventListener?.("change", applyTheme);

  // ---------- toast ----------
  let toastTimer = 0;
  const toast = (msg: string) => {
    root.querySelector(".toast")?.remove();
    const el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    el.textContent = msg;
    root.appendChild(el);
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => el.remove(), 2600);
  };
  const copy = async (text: string, msg: string) => {
    try { await navigator.clipboard.writeText(text); } catch {}
    toast(msg);
  };

  // ---------- sidebar ----------
  const navItem = (id: string, icon: string, label: string, end = "", current = false) => {
    const disabled = needsWs.has(id) && !hasWs();
    return `<li><button class="ni" data-go="${id}" ${current ? 'aria-current="page"' : ""} ${disabled ? 'aria-disabled="true" title="' + esc(A.nav.needWs) + '"' : ""}>${ic(icon)}<span>${esc(label)}</span>${end ? `<span class="end">${end}</span>` : ""}</button></li>`;
  };
  const sidebar = () => {
    const r = route();
    const w = wsName();
    const wsIcon = hasWs() ? `<span class="ws-ic">${esc(initials(w).slice(0, 1))}</span>` : `<span class="ws-ic none">${ic("plus", 14)}</span>`;
    const list = hasWs()
      ? chats().map((c) => `<button class="chat-i" data-go="chat/${esc(c.id)}" ${r.name === "chat" && r.arg === c.id ? 'aria-current="page"' : ""}>${agentMk(c.agent, 18)}<span>${esc(c.title)}</span></button>`).join("") || `<p class="empty-note">${esc(A.nav.noChats)}</p>`
      : `<p class="empty-note">${esc(A.nav.needWs)}</p>`;
    const memberCount = isExample() ? A.example.members.length : hasWs() ? 1 : 0;
    const moreIds = ["sites", "schedules", "ws-settings"];
    const moreOpen = V.moreOpen || moreIds.includes(r.name);
    const promo = S.promoClosed
      ? ""
      : `<div class="promo"><button class="icon-btn x" data-act="promo-close" aria-label="${esc(A.promo.close)}">${ic("x", 14)}</button><span class="pk">${esc(A.promo.kicker)}</span><b>${esc(A.promo.title)}</b><p>${esc(hasWs() ? A.promo.body : A.promo.noWs)}</p><button class="go" data-act="promo-go"><span>${esc(A.promo.cta)}</span>${ic("chevR", 14)}</button></div>`;
    return `
      <aside class="sb" aria-label="${esc(A.nav.menu)}">
        <button class="ws-btn" data-act="switcher" aria-haspopup="menu">${wsIcon}<span>${esc(w || A.nav.noWorkspace)}</span>${isExample() ? `<span class="tag">${esc(A.example.badge)}</span>` : ""}<span class="chev">${ic("chev", 16)}</span></button>
        <ul class="navlist">
          ${navItem("new", "plus", A.nav.newChat, `<kbd class="mono">${MAC ? "⇧⌘O" : "Ctrl+Shift+O"}</kbd>`, r.name === "new")}
          ${navItem("files", "file", A.nav.files, "", r.name === "files")}
          ${navItem("canvas", "canvas", A.nav.canvas, `<span class="tag">${esc(A.nav.beta)}</span>`, r.name === "canvas")}
          ${navItem("members", "users", A.nav.members, hasWs() ? `${memberCount}/32` : "", r.name === "members")}
          ${navItem("plugins", "plug", A.nav.plugins, "", r.name === "plugins")}
          <li><button class="ni" data-act="more" aria-expanded="${moreOpen}">${ic("more")}<span>${esc(A.nav.more)}</span><span class="end">${ic(moreOpen ? "chev" : "chevR", 14)}</span></button></li>
          ${moreOpen ? `<li><ul class="navlist sub-nav">${navItem("sites", "globe", A.nav.sites, "", r.name === "sites")}${navItem("schedules", "clock", A.nav.schedules, `<span class="tag">${esc(A.nav.beta)}</span>`, r.name === "schedules")}${navItem("ws-settings", "gear", A.nav.wsSettings, "", r.name === "ws-settings")}</ul></li>` : ""}
        </ul>
        <div class="sec-h"><span>${esc(A.nav.chats)}</span><button class="icon-btn" data-go="import" title="${esc(A.nav.importLocal)}" aria-label="${esc(A.nav.importLocal)}">${ic("import", 16)}</button></div>
        <div class="chats">${list}</div>
        ${promo}
        <div class="me">
          <button class="me-btn" data-act="account" aria-haspopup="menu" aria-label="${esc(A.account.openMenu)}">${avatar()}<span style="min-width:0"><b>${esc(displayName())}</b><small>${esc(A.account.credits)} ${money2(balance())}</small></span></button>
          <button class="icon-btn" data-act="invite" title="${esc(A.account.invite)}" aria-label="${esc(A.account.invite)}">${ic("gift")}</button>
          <button class="icon-btn" data-act="help" title="${esc(A.account.help)}" aria-label="${esc(A.account.help)}">${ic("bulb")}</button>
        </div>
      </aside>`;
  };

  // ---------- main bar ----------
  const bar = (title: string, sub = "", right = "", clean = false) =>
    `<header class="bar ${clean ? "clean" : ""}"><button class="icon-btn menu-btn" data-act="sb" aria-label="${esc(A.nav.menu)}">${ic("menu")}</button><div class="ttl"><h1>${esc(title)}</h1>${sub ? `<small>${esc(sub)}</small>` : ""}</div><div class="r">${right}</div></header>`;
  const strip = () =>
    isExample()
      ? `<div class="strip"><i></i><span>${esc(A.example.readOnly)}</span><span class="r"><a class="btn sm soft" href="#/billing/market">${esc(A.example.plans)}</a><button class="btn sm pri" data-act="new-ws">${esc(A.example.start)}</button></span></div>`
      : `<div class="strip"><i></i><span>${esc(security.notice)}</span></div>`;

  // ---------- views ----------
  const vHome = () => `
    ${bar("", "", "", true)}
    <div class="scroll"><div class="page narrow welcome">
      <div><h2 class="t">${esc(A.home.hello)}</h2><p class="muted" style="margin-top:6px">${esc(A.home.sub)}</p></div>
      <div class="grid2">
        <button class="wcard" data-act="open-example">
          <div class="art"><div class="art-win"><div class="side"><i></i><i></i><i></i><i></i></div><div>${["#7c8cff", "#e07a55", "#5f6b7a"].map((h, i) => `<div class="msg" style="--hue:${h}"><b></b><span><i style="width:${90 - i * 18}%"></i><i style="width:${60 + i * 10}%"></i></span></div>`).join("")}</div></div></div>
          <div class="body"><h3>${esc(A.home.exploreTitle)}</h3><p>${esc(A.home.exploreBody)}</p><span class="btn soft sm">${esc(A.home.explore)}</span></div>
        </button>
        <button class="wcard" data-act="new-ws">
          <div class="art"><div class="art-orbit"><span class="ring"></span><span class="core">F</span>${D.agents.slice(0, 5).map((a: any, i: number) => { const ang = (i / 5) * Math.PI * 2 - Math.PI / 2; return `<span class="sat" style="transform:translate(${Math.round(Math.cos(ang) * 110)}px,${Math.round(Math.sin(ang) * 62)}px)">${agentMk(a.id, 34)}</span>`; }).join("")}</div></div>
          <div class="body"><h3>${esc(A.home.startTitle)}</h3><p>${esc(A.home.startBody)}</p><span class="btn pri sm">${ic("plus", 14)}${esc(A.home.create)}</span></div>
        </button>
      </div>
      <div class="card sub empty" style="padding:28px"><div class="ico">${ic("file", 22)}</div><h3>${esc(A.home.emptyTitle)}</h3><p>${esc(A.home.emptyBody)}</p></div>
    </div></div>`;

  const meter = (n: number | null, hue: string) => (n === null ? "" : `<div class="meter" style="--hue:${hue}">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= n ? "on" : ""}"></i>`).join("")}</div>`);
  const modelsFor = (agent: any) => (agent.id === "media" ? D.imageModels.map((n: string) => ({ name: n, provider: "", input: 0, output: 0, tag: "" })) : D.models.filter((m: any) => agent.providers.includes(m.provider)));
  const currentModel = (agent: any) => V.model[agent.id] || agent.model;

  const composer = (opts: { chat?: Chat; disabled?: boolean } = {}) => {
    const agent = agentById(opts.chat ? opts.chat.agent : V.agent);
    const model = opts.chat ? opts.chat.model : currentModel(agent);
    const ph = agent.id === "media" ? A.newChat.mediaPlaceholder : fmt(A.newChat.placeholder, { agent: agent.name });
    const attach = V.attach.length ? `<div class="attach-list">${V.attach.map((n: string, i: number) => `<span>${ic("file", 13)}${esc(n)}<button class="icon-btn" style="width:18px;height:18px" data-act="unattach" data-i="${i}" aria-label="${esc(A.common.close)}">${ic("x", 12)}</button></span>`).join("")}</div>` : "";
    return `
      <form method="post" class="composer ${opts.disabled ? "off" : ""}" data-form="send" ${opts.chat ? `data-chat="${esc(opts.chat.id)}"` : ""}>
        <label class="sr" for="fx-input">${esc(ph)}</label>
        <textarea id="fx-input" name="text" maxlength="${MAX_MESSAGE}" rows="2" placeholder="${esc(opts.disabled ? A.example.composer : ph)}" ${opts.disabled ? "disabled" : ""}>${esc(opts.chat ? "" : V.draft)}</textarea>
        ${attach}
        <div class="tools">
          <button type="button" class="icon-btn" data-act="attach" title="${esc(A.newChat.attach)}" aria-label="${esc(A.newChat.attach)}" ${opts.disabled ? "disabled" : ""}>${ic("attach")}</button>
          ${agent.id === "media" ? "" : `<button type="button" class="icon-btn" data-act="computer" title="${esc(A.newChat.computer)}" aria-label="${esc(A.newChat.computer)}" ${opts.disabled ? "disabled" : ""}>${ic(V.computer === "cloud" ? "cloud" : "monitor")}</button>
          <button type="button" class="icon-btn" data-act="plan" aria-pressed="${V.plan}" title="${esc(A.newChat.plan)}" aria-label="${esc(A.newChat.plan)}" ${opts.disabled ? "disabled" : ""}>${ic("list")}</button>`}
          <div class="r">
            <button type="button" class="model-btn" data-act="model" data-agent="${esc(agent.id)}" ${opts.chat ? `data-chat="${esc(opts.chat.id)}"` : ""} aria-haspopup="menu" ${opts.disabled ? "disabled" : ""}>${agent.id === "media" ? mk(M.images[model] || M.agents.media, 18) : mk(M.providers[(D.models.find((x: any) => x.name === model) || {}).provider] || M.agents[agent.id], 18)}<span>${esc(model)}</span>${ic("chev", 14)}</button>
            <button class="send" type="submit" aria-label="${esc(A.newChat.send)}" ${opts.disabled ? "disabled" : ""}>${ic("up", 16)}</button>
          </div>
        </div>
      </form>
      ${V.plan && !opts.disabled ? `<p class="under">${esc(A.newChat.planOn)}</p>` : `<p class="under">${esc(A.newChat.attachHint)}</p>`}`;
  };

  const vNew = () => {
    const agent = agentById(V.agent);
    const ad = A.newChat.agents[agent.id];
    const ms = modelsFor(agent);
    const lv = A.newChat.levels;
    const picked = pickedAgent() === agent.id;
    const provs = agent.id === "media" ? D.imageModels : agent.providers;
    return `
      ${bar(A.nav.newChat, wsName(), `<button class="btn sm soft" data-go="import">${ic("import", 14)}<span class="hide-sm">${esc(A.nav.importLocal)}</span></button>`, true)}
      ${strip()}
      <div class="scroll"><div class="nc">
        <h2>${esc(A.newChat.title)}</h2>
        <div class="agent-tabs" role="tablist">${D.agents.map((a: any) => `<button role="tab" data-act="agent" data-id="${esc(a.id)}" aria-selected="${a.id === agent.id}">${agentMk(a.id, 20)}${esc(a.name)}</button>`).join("")}</div>
        <div class="agent-card">
          <div class="agent-art"><span class="blob" style="--hue:${M.agents[agent.id].hue}">${M.agents[agent.id].svg}</span></div>
          <div class="agent-info">
            <h3>${esc(agent.name)} <span class="pill">${esc(ad.tag)}</span>${picked ? `<span class="pill ok">${ic("check", 12)}${esc(A.newChat.picked)}</span>` : ""}</h3>
            <div class="by">${esc(agent.maker)}</div>
            <p>${esc(ad.desc)}</p>
            <div class="stack" style="gap:8px">
              <div class="stat"><span class="lbl">${esc(A.newChat.bestFor)}</span><div>${esc(ad.best)}</div></div>
              ${agent.capability === null ? "" : `<div class="grid3" style="gap:8px">${[["capability", agent.capability], ["value", agent.value], ["openness", agent.openness]].map(([k, n]) => `<div class="stat"><span class="lbl">${esc(A.newChat[k as string])}</span><b class="lv">${esc(lv[(n as number) - 1])}</b>${meter(n as number, agent.hue)}</div>`).join("")}</div>`}
              <div class="stat"><div class="between"><span class="lbl">${esc(A.newChat.available)}</span><span class="lbl">${esc(fmt(A.newChat.models, { n: ms.length }))}</span></div><div class="provs">${provs.map((p: string) => `<span>${mk(agent.id === "media" ? M.images[p] : M.providers[p], 14, "bare")}${esc(p)}</span>`).join("")}</div></div>
            </div>
          </div>
        </div>
      </div></div>
      <div class="dock">${composer({ disabled: isExample() })}</div>`;
  };

  const speaker = (chat: Chat, who: string) => {
    if (who === "you") return { name: A.chat.you, html: avatar("sm"), user: true };
    if (who === "agent" || D.agents.some((a: any) => a.id === who)) {
      const a = agentById(who === "agent" ? chat.agent : who);
      return { name: a.name, html: agentMk(a.id, 24), user: false };
    }
    return { name: who, html: `<span class="av sm" style="--av:${AVATARS[(who.length * 3) % AVATARS.length]}">${esc(initials(who))}</span>`, user: false };
  };
  const vChat = (id: string) => {
    const chat = chats().find((c) => c.id === id);
    if (!chat) return vNotFound();
    const agent = agentById(chat.agent);
    const msgs = chat.messages
      .map(([who, text]) => {
        if (who === "sys") return `<div class="sys">${esc(text)}</div>`;
        const s = speaker(chat, who);
        // In the example, the human who briefs the agent is shown as a regular speaker.
        return `<div class="msg ${s.user ? "user" : ""}"><div class="msg-who">${s.html}${esc(s.name)}</div><div class="msg-body">${esc(text)}</div></div>`;
      })
      .join("");
    const right = isExample() ? "" : `<button class="icon-btn" data-act="del-chat" data-id="${esc(chat.id)}" title="${esc(A.chat.delete)}" aria-label="${esc(A.chat.delete)}">${ic("trash", 16)}</button>`;
    return `
      ${bar(chat.title, `${agent.name} · ${chat.model}`, right)}
      ${isExample() ? strip() : ""}
      <div class="scroll" data-thread><div class="thread">${msgs}</div></div>
      <div class="dock">${composer({ chat, disabled: isExample() })}</div>`;
  };

  const vImport = () => {
    const agent = agentById(V.importAgent);
    const instr = fmt(A.importLocal.instruction, { agent: agent.name, ws: wsName() });
    return `
      ${bar(A.importLocal.title, wsName(), `<button class="btn sm soft" data-go="new">${ic("chevL", 14)}${esc(A.nav.newChat)}</button>`)}
      <div class="scroll"><div class="page narrow stack lg">
        <div><h2 class="t">${esc(A.importLocal.title)}</h2><p class="muted" style="margin-top:6px">${esc(A.importLocal.sub)}</p></div>
        <div class="stack"><h4>${esc(A.importLocal.which)}</h4>
          <div class="agent-tabs" style="justify-content:flex-start">${D.agents.filter((a: any) => !["lite", "media"].includes(a.id)).map((a: any) => `<button data-act="import-agent" data-id="${esc(a.id)}" aria-selected="${a.id === agent.id}">${agentMk(a.id, 20)}${esc(a.name)}</button>`).join("")}</div>
          <p class="note">${ic("lock", 14)} ${esc(A.importLocal.only)}</p>
        </div>
        <ol class="steps">${A.importLocal.steps.map((s: any, i: number) => `<li><div><h4>${esc(s.t)}</h4><p>${esc(s.b)}</p>${i === 0 ? `<div class="codebox" style="margin-top:10px"><pre class="code" style="white-space:pre-wrap">${esc(instr)}</pre><button class="btn sm" data-act="copy" data-text="${esc(instr)}" data-msg="${esc(A.importLocal.copied)}">${ic("copy", 13)}${esc(A.importLocal.copy)}</button></div>` : ""}</div></li>`).join("")}</ol>
      </div></div>`;
  };

  // Files
  const exampleFiles = (): FileItem[] => A.example.files.map((n: string, i: number) => ({ id: "exf" + i, ws: "example", parent: "", name: n, folder: !n.includes("."), size: n.includes(".") ? 2400 : 0, modified: Date.now() - (i + 2) * 3600e3 }));
  const files = () => (isExample() ? exampleFiles() : S.files.filter((f) => f.ws === S.current));
  const fsize = (n: number) => (n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(1) + " MB");
  const ext = (n: string) => (n.includes(".") ? n.split(".").pop()!.slice(0, 4) : "");
  const vFiles = () => {
    const all = files();
    const here = all.filter((f) => f.parent === V.folder).sort((a, b) => Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name));
    const trail: FileItem[] = [];
    let p = all.find((f) => f.id === V.folder);
    while (p) { trail.unshift(p); p = all.find((f) => f.id === p!.parent); }
    const crumbs = `<nav class="crumbs"><button data-act="folder" data-id="">${esc(A.files.root)}</button>${trail.map((f, i) => `<span>/</span>${i === trail.length - 1 ? `<b>${esc(f.name)}</b>` : `<button data-act="folder" data-id="${esc(f.id)}">${esc(f.name)}</button>`}`).join("")}</nav>`;
    const ro = isExample();
    const right = `<div class="seg" role="tablist"><button data-act="fview" data-v="grid" aria-selected="${V.fileView === "grid"}" aria-label="${esc(A.files.grid)}">${ic("grid", 15)}</button><button data-act="fview" data-v="list" aria-selected="${V.fileView === "list"}" aria-label="${esc(A.files.list)}">${ic("list", 15)}</button></div>${ro ? "" : `<button class="btn sm" data-act="new-folder">${ic("folderPlus", 14)}<span class="hide-sm">${esc(A.files.newFolder)}</span></button><button class="btn sm pri" data-act="upload">${ic("upload", 14)}<span class="hide-sm">${esc(A.files.upload)}</span></button>`}`;
    const body = !here.length
      ? `<div class="empty"><div class="ico">${ic("file", 22)}</div><h3>${esc(A.files.empty)}</h3><p>${esc(A.files.emptySub)}</p>${ro ? "" : `<button class="btn pri" data-act="upload">${ic("upload", 14)}${esc(A.files.upload)}</button>`}</div>`
      : V.fileView === "grid"
        ? `<div class="fgrid">${here.map((f) => `<button class="fitem" ${f.folder ? `data-act="folder" data-id="${esc(f.id)}"` : ""}>${f.folder ? `<span class="folder"></span>` : `<span class="doc">${esc(ext(f.name))}</span>`}<span>${esc(f.name)}</span></button>`).join("")}</div>`
        : `<table class="flist"><thead><tr><th>${esc(A.files.title)}</th><th>${esc(A.files.size)}</th><th>${esc(A.files.modified)}</th>${ro ? "" : "<th></th>"}</tr></thead><tbody>${here.map((f) => `<tr class="${f.folder ? "clk" : ""}" ${f.folder ? `data-act="folder" data-id="${esc(f.id)}"` : ""}><td><span class="nm">${f.folder ? `<span class="folder sm"></span>` : ic("file", 16)}${esc(f.name)}</span></td><td class="muted">${f.folder ? "—" : fsize(f.size)}</td><td class="muted">${tfmt(f.modified)}</td>${ro ? "" : `<td style="text-align:right"><button class="icon-btn" data-act="del-file" data-id="${esc(f.id)}" aria-label="${esc(A.common.close)}">${ic("trash", 15)}</button></td>`}</tr>`).join("")}</tbody></table>`;
    return `
      ${bar(A.files.title, wsName(), right)}
      ${strip()}
      <div class="scroll" data-drop><div class="page">${crumbs}${body}${ro ? "" : `<p class="hint" style="margin-top:12px">${esc(A.files.local)}</p>`}</div></div>`;
  };

  const vCanvas = () => {
    const widgets = 0;
    return `
      ${bar(A.canvas.title, fmt(A.canvas.counts, { c: chats().length, w: widgets }), `<span class="tag">${esc(A.nav.beta)}</span>`)}
      <div class="scroll"><div class="cv"><div class="cv-hero">
        <div class="cv-art" aria-hidden="true">
          <div class="w1"><i class="ln" style="width:50%"></i><div class="bars">${[30, 55, 40, 70, 62, 85].map((h, i) => `<i class="${i === 5 ? "on" : ""}" style="height:${h}%"></i>`).join("")}</div></div>
          <div class="w2"><i class="ln" style="width:60%"></i><div class="ring-chart"></div></div>
          <div class="w3"><i class="ln" style="width:40%"></i><div class="big">99.9%</div><i class="ln" style="width:80%;margin-top:8px"></i><i class="ln" style="width:60%"></i></div>
        </div>
        <h2>${esc(A.canvas.heroTitle)}</h2>
        <p>${esc(A.canvas.heroBody)}</p>
        <div class="row" style="margin-top:6px"><button class="btn pri" data-act="prompt" data-text="${esc(fmt(A.canvas.prompt, { x: A.canvas.tries[0] }))}">${ic("spark", 14)}${esc(A.canvas.build)}</button><button class="btn" data-go="new">${ic("plus", 14)}${esc(A.canvas.newChat)}</button></div>
        <div class="row wrap" style="justify-content:center;margin-top:8px"><span class="dim">${esc(A.canvas.try)}</span>${A.canvas.tries.map((x: string) => `<button class="btn sm soft" data-act="prompt" data-text="${esc(fmt(A.canvas.prompt, { x }))}">${esc(x)}</button>`).join("")}</div>
      </div></div></div>`;
  };

  const vMembers = () => {
    const ex = isExample();
    const people: Record<string, string[]> = { owner: [ex ? A.example.members[0] : displayName()], editor: ex ? A.example.members.slice(1) : [], viewer: [] };
    const total = people.owner.length + people.editor.length;
    const youMsgs = S.chats.filter((c) => c.ws === S.current).reduce((n, c) => n + c.messages.filter((m) => m[0] === "you").length, 0);
    const roleCard = (role: string) => {
      const [name, desc] = A.members.roles[role];
      const list = people[role];
      return `<div class="card"><div class="between" style="padding:14px 16px;border-bottom:1px solid var(--line)"><div><h4>${esc(name)}</h4><small class="muted">${esc(desc)}</small></div>${role === "owner" || ex ? "" : `<button class="btn sm" data-act="invite-link" data-role="${role}">${ic("plus", 13)}${esc(A.members.invite)}</button>`}</div>
        <div class="list">${list.length ? list.map((p, i) => `<div>${role === "owner" && !ex ? avatar("sm") : `<span class="av sm" style="--av:${AVATARS[(i + role.length) % AVATARS.length]}">${esc(initials(p))}</span>`}<span class="grow">${esc(p)}${role === "owner" && !ex ? ` <span class="tag">${esc(A.members.you)}</span>` : ""}</span>${role === "owner" && !ex ? `<button class="btn sm soft" data-act="soon">${esc(A.members.transfer)}</button>` : ""}</div>`).join("") : `<div><span class="grow muted">${esc(fmt(A.members.none, { role: name }))}<small>${esc(A.members.shareHint)}</small></span></div>`}</div></div>`;
    };
    return `
      ${bar(A.members.title, wsName())}
      <div class="scroll"><div class="page narrow stack lg">
        <div><h2 class="t">${esc(A.members.title)}</h2><p class="muted" style="margin-top:6px">${esc(fmt(A.members.seats, { n: total }))} · ${esc(fmt(A.members.left, { n: 32 - total }))}</p></div>
        ${["owner", "editor", "viewer"].map(roleCard).join("")}
        <div><div class="sec-title"><h3>${esc(A.members.contrib)}</h3></div><div class="card list">${ex ? A.example.members.map((m: string, i: number) => `<div><span class="av sm" style="--av:${AVATARS[(i + 5) % AVATARS.length]}">${esc(initials(m))}</span><span class="grow">${esc(m)}</span><span class="muted">${esc(fmt(A.members.instructions, { n: A.example.chats.reduce((n: number, c: any) => n + c.messages.filter((x: any) => x[0] === m.split(" ")[0]).length, 0) }))}</span></div>`).join("") : `<div>${avatar("sm")}<span class="grow">${esc(displayName())}</span><span class="muted">${esc(fmt(A.members.instructions, { n: youMsgs }))}</span></div>`}</div></div>
      </div></div>`;
  };

  const isInstalled = (p: any) => p.builtin || S.installed.includes(p.id);
  const plugCard = (p: any) => `
    <div class="plug">${mk(M.plugins[p.id], 44)}<div class="grow">
      <div class="between"><h4>${esc(p.name)}</h4>${p.builtin ? `<span class="tag">${esc(A.plugins.builtin)}</span>` : isExample() ? "" : `<button class="btn sm ${isInstalled(p) ? "" : "pri"}" data-act="plugin" data-id="${esc(p.id)}">${esc(isInstalled(p) ? A.plugins.remove : A.plugins.install)}</button>`}</div>
      <div class="by">${esc(p.by)}</div><p>${esc(A.plugins.desc[p.id])}</p>
      <div class="chips">${p.skills ? `<span>${esc(fmt(A.plugins.skills, { n: p.skills }))}</span>` : ""}${p.mcp ? `<span>${esc(fmt(A.plugins.mcp, { n: p.mcp }))}</span>` : ""}<span>${esc(A.plugins.cats[p.cat + 1])}</span></div>
    </div></div>`;
  const vPlugins = () => {
    const inst = D.plugins.filter(isInstalled);
    const q = V.pluginQ.trim().toLowerCase();
    const found = D.plugins.filter((p: any) => (V.pluginCat === 0 || p.cat === V.pluginCat - 1) && (!q || (p.name + " " + A.plugins.desc[p.id] + " " + A.plugins.cats[p.cat + 1]).toLowerCase().includes(q)));
    const skills = D.plugins.reduce((n: number, p: any) => n + p.skills, 0);
    return `
      ${bar(A.plugins.title, wsName())}
      <div class="scroll"><div class="page stack lg">
        <div class="dark-hero">
          <span class="k">${esc(A.plugins.kicker)}</span><h2>${esc(A.plugins.heroTitle)}</h2><p>${esc(A.plugins.heroBody)}</p>
          <ul>${A.plugins.points.map((x: string) => `<li>${esc(x)}</li>`).join("")}</ul>
          <p class="meta">${esc(fmt(A.plugins.counts, { p: D.plugins.length, s: skills }))}</p>
          <div class="tile-art" aria-hidden="true">${D.plugins.slice(4, 13).map((p: any) => `<span style="--hue:${p.hue === "#111111" || p.hue === "#000020" || p.hue === "#24292f" ? "#e7e6e1" : p.hue}">${M.plugins[p.id]?.svg ?? esc(p.name[0])}</span>`).join("")}</div>
        </div>
        <section><div class="sec-title"><h3>${esc(A.plugins.installed)} · ${inst.length}</h3></div><div class="grid2">${inst.map(plugCard).join("")}</div></section>
        <section>
          <div class="sec-title"><h3>${esc(A.plugins.discover)}</h3></div>
          <div class="row wrap" style="margin-bottom:14px"><div class="seg" role="tablist">${A.plugins.cats.map((c: string, i: number) => `<button data-act="pcat" data-i="${i}" aria-selected="${V.pluginCat === i}">${esc(c)}</button>`).join("")}</div>
          <input type="search" data-input="pluginQ" value="${esc(V.pluginQ)}" placeholder="${esc(A.plugins.search)}" aria-label="${esc(A.plugins.search)}" style="max-width:320px" /></div>
          <div class="grid2" data-plist>${found.map(plugCard).join("") || `<p class="muted">${esc(A.plugins.none)}</p>`}</div>
        </section>
      </div></div>`;
  };

  const vSites = () => `
    ${bar(A.sites.title, A.sites.sub)}
    <div class="scroll"><div class="page"><p class="muted">${esc(fmt(A.sites.count, { n: 0 }))}</p>
      <div class="empty"><div class="ico">${ic("globe", 22)}</div><h3>${esc(A.sites.empty)}</h3><p>${esc(A.sites.emptySub)}</p>${isExample() ? "" : `<button class="btn pri" data-act="prompt" data-text="${esc(A.sites.prompt)}">${ic("spark", 14)}${esc(A.sites.ask)}</button>`}</div>
    </div></div>`;

  const nextRun = (s: any) => {
    const [h, m] = String(s.time || "09:00").split(":").map(Number);
    const d = new Date();
    if (s.cadence === 0) { d.setMinutes(m, 0, 0); if (d.getTime() <= Date.now()) d.setHours(d.getHours() + 1); return d.getTime(); }
    d.setHours(h, m, 0, 0);
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
    if (s.cadence === 2) while ([0, 6].includes(d.getDay())) d.setDate(d.getDate() + 1);
    return d.getTime();
  };
  const vSchedules = () => {
    const list = S.schedules.filter((s) => s.ws === S.current);
    const ro = isExample();
    return `
      ${bar(A.schedules.title, wsName(), ro ? "" : `<button class="btn sm pri" data-act="new-schedule">${ic("plus", 14)}${esc(A.schedules.create)}</button>`)}
      <div class="scroll"><div class="page narrow">
        ${list.length ? `<div class="card list">${list.map((s) => { const a = agentById(s.agent); return `<div>${agentMk(a.id, 18)}<span class="grow"><b>${esc(s.name)}</b><small>${esc(A.schedules.cadences[s.cadence])} · ${esc(s.time)} · ${s.paused ? esc(A.schedules.paused) : esc(fmt(A.schedules.next, { date: tfmt(nextRun(s)) }))}</small></span><button class="btn sm soft" data-act="sched-pause" data-id="${esc(s.id)}">${ic(s.paused ? "play" : "pause", 13)}${esc(s.paused ? A.schedules.resume : A.schedules.pause)}</button><button class="icon-btn" data-act="sched-del" data-id="${esc(s.id)}" aria-label="${esc(A.schedules.remove)}">${ic("trash", 15)}</button></div>`; }).join("")}</div>`
        : `<div class="empty"><div class="ico">${ic("clock", 22)}</div><h3>${esc(A.schedules.empty)}</h3><p>${esc(A.schedules.emptySub)}</p>${ro ? "" : `<button class="btn pri" data-act="new-schedule">${ic("plus", 14)}${esc(A.schedules.create)}</button>`}</div>`}
      </div></div>`;
  };

  const tabsV = (tabs: string[], cur: number, base: string) => `<div class="tabs-v" role="tablist">${tabs.map((t, i) => `<button role="tab" data-go="${base}/${i}" aria-selected="${i === cur}">${esc(t)}</button>`).join("")}</div>`;
  const vWsSettings = (n: number) => {
    const W = A.wsSettings;
    const ro = isExample();
    const w = ws();
    const tz = w?.tz || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const region = w ? regionName(w.region) : regionName("us-west");
    let panel = "";
    if (n === 0) {
      panel = `<div class="card pad stack"><span class="k">${esc(W.overview.kicker)}</span>
        ${ro ? `<h2 class="t">${esc(wsName())}</h2>` : `<form method="post" class="row" data-form="rename"><input type="text" name="name" value="${esc(wsName())}" aria-label="${esc(A.newWs.name)}" maxlength="60" style="max-width:340px" /><button class="btn">${esc(W.overview.save)}</button></form>`}
        <p class="muted">${esc(W.overview.body)}</p>
        <div class="kv"><div><small>${esc(W.overview.role)}</small><b>${esc(ro ? A.common.readOnly : A.common.owner)}</b></div><div><small>${esc(W.overview.members)}</small><b>${ro ? A.example.members.length : 1}</b></div><div><small>${esc(W.overview.tz)}</small><b>${esc(tz)}</b></div><div><small>${esc(W.overview.location)}</small><b>${esc(region)}</b></div></div>
        <div class="between note"><span>${esc(W.overview.computer)}</span><span class="pill warn">${esc(W.computer.notConnected)}</span></div></div>`;
    } else if (n === 1) {
      const env = environment[S.current] || [];
      panel = `<div class="stack lg">
        <div class="card pad stack"><div class="between"><h3>${esc(W.tabs[1])}</h3><span class="pill warn">${esc(W.computer.notConnected)}</span></div><p class="muted">${esc(W.computer.body)}</p>
          <div class="row wrap">${W.computer.states.map((s: string) => `<span class="pill">${esc(s)}</span>`).join("")}</div></div>
        <div><div class="sec-title"><h3>${esc(W.computer.how)}</h3></div><div class="grid2">${W.computer.points.map(([t, b]: string[]) => `<div class="card pad"><h4>${esc(t)}</h4><p class="muted" style="margin-top:4px;font-size:13px">${esc(b)}</p></div>`).join("")}</div></div>
        <div class="card pad stack"><h3>${esc(W.computer.env)}</h3><p class="muted">${esc(security.envNotice)}</p>
          ${env.length ? `<div class="card list">${env.map(([k], i) => `<div><span class="mono grow">${esc(k)}</span><span class="mono dim">••••••••</span>${ro ? "" : `<button class="icon-btn" data-act="env-del" data-i="${i}" aria-label="${esc(A.common.close)}">${ic("trash", 15)}</button>`}</div>`).join("")}</div>` : `<p class="dim">${esc(W.computer.envEmpty)}</p>`}
          ${ro ? "" : `<form method="post" class="row wrap" data-form="env"><input type="text" name="k" maxlength="128" autocomplete="off" placeholder="${esc(W.computer.key)}" aria-label="${esc(W.computer.key)}" class="mono" pattern="[A-Za-z_][A-Za-z0-9_]*" required style="flex:1;min-width:140px" /><input type="password" data-env-value maxlength="4096" autocomplete="off" placeholder="${esc(W.computer.value)}" aria-label="${esc(W.computer.value)}" required style="flex:2;min-width:160px" /><button class="btn">${ic("plus", 14)}${esc(W.computer.add)}</button></form>`}</div>
        <div class="card pad between"><div><h4>${esc(W.computer.restart)}</h4><p class="muted" style="font-size:13px">${esc(W.computer.restartSub)}</p></div><button class="btn" data-act="restart" ${ro ? "disabled" : ""}>${ic("refresh", 14)}${esc(W.computer.restart)}</button></div></div>`;
    } else if (n === 2) {
      panel = `<div class="stack lg"><div class="dark-hero"><span class="k">${esc(W.security.kicker)}</span><h2>${esc(W.security.title)}</h2></div>
        <div class="grid2">${W.security.points.map(([t, b]: string[], i: number) => `<div class="card pad"><div class="row">${ic(["shield", "users", "key", "lock", "download"][i], 18)}<h4>${esc(t)}</h4></div><p class="muted" style="margin-top:6px;font-size:13px">${esc(b)}</p></div>`).join("")}</div>
        <div><div class="sec-title"><h3>${esc(W.security.who)}</h3></div><div class="card list">${["owner", "editor", "viewer"].map((r) => `<div><b style="width:90px;flex:none">${esc(A.members.roles[r][0])}</b><span class="grow muted">${esc(W.security.can[r])}</span></div>`).join("")}</div></div></div>`;
    } else if (n === 3) {
      const cs = chats();
      const userMsgs = cs.reduce((t, c) => t + c.messages.filter((m) => m[0] !== "sys" && m[0] !== "agent").length, 0);
      const days = Array.from({ length: 14 }, (_, i) => { const d0 = new Date(); d0.setHours(0, 0, 0, 0); const s = d0.getTime() - (13 - i) * DAY; return cs.filter((c) => c.created >= s && c.created < s + DAY).length; });
      const max = Math.max(1, ...days);
      panel = `<div class="stack lg">
        <div class="card pad stack"><div class="between"><h3>${esc(W.usage.tokens)}</h3><span class="muted">${esc(W.usage.range)}</span></div>
          <div class="bars">${days.map((n) => `<i class="${n ? "on" : ""}" style="height:${Math.max(3, (n / max) * 100)}%"></i>`).join("")}</div>
          <div class="row wrap">${W.usage.parts.map((p: string) => `<span class="pill">${esc(p)} · 0</span>`).join("")}</div>
          ${cs.length ? "" : `<p class="dim">${esc(W.usage.empty)}</p>`}</div>
        <div class="kv"><div><small>${esc(W.usage.tasks)}</small><b>${userMsgs}</b><span class="s">${esc(fmt(W.usage.completed, { n: 0 }))}</span></div><div><small>${esc(W.usage.tools)}</small><b>0</b><span class="s">${esc(W.usage.toolsSub)}</span></div><div><small>${esc(W.usage.active)}</small><b>${esc(fmt(W.usage.seconds, { n: 0 }))}</b><span class="s">${esc(fmt(W.usage.activeSub, { n: cs.length }))}</span></div><div><small>${esc(W.usage.agents)}</small><b>${new Set(cs.map((c) => c.agent)).size}</b></div></div>
        <div class="card pad"><h3>${esc(W.usage.agents)}</h3>${cs.length ? `<div class="list" style="margin-top:8px">${[...new Set(cs.map((c) => c.agent))].map((id) => { const a = agentById(id); return `<div>${agentMk(a.id, 18)}<span class="grow">${esc(a.name)}</span><span class="muted">${cs.filter((c) => c.agent === id).length}</span></div>`; }).join("")}</div>` : `<p class="dim" style="margin-top:6px">${esc(W.usage.noAgents)}</p>`}</div></div>`;
    } else {
      panel = `<div class="stack">
        <div class="card pad between"><div><h4>${esc(W.data.archived)}</h4><p class="muted" style="font-size:13px">${esc(W.data.archivedSub)}</p></div><button class="btn" data-act="soon">${esc(W.data.manage)}</button></div>
        <div class="card pad between"><div><h4>${esc(W.data.export)}</h4><p class="muted" style="font-size:13px">${esc(W.data.exportSub)}</p></div><button class="btn" data-act="export">${ic("download", 14)}${esc(W.data.exportBtn)}</button></div>
        ${ro ? "" : `<div class="card pad stack" style="border-color:color-mix(in srgb,var(--bad) 40%,var(--line))"><span class="k" style="color:var(--bad)">${esc(W.data.danger)}</span><div><h4>${esc(W.data.delete)}</h4><p class="muted" style="font-size:13px">${esc(W.data.deleteSub)}</p></div>
          <form method="post" class="row wrap" data-form="del-ws"><input type="text" name="name" placeholder="${esc(wsName())}" aria-label="${esc(W.data.confirm)}" style="flex:1;min-width:180px" /><button class="btn danger">${esc(W.data.deleteBtn)}</button></form><small class="hint">${esc(W.data.confirm)}</small></div>`}</div>`;
    }
    return `${bar(W.title, W.note)}<div class="scroll"><div class="page"><div class="settings">${tabsV(W.tabs, n, "ws-settings")}<div>${panel}</div></div></div></div>`;
  };

  const vUser = (n: number) => {
    const U = A.user;
    let panel = "";
    if (n === 0) {
      panel = `<form method="post" class="card pad stack" data-form="profile"><div><h3>${esc(U.profile)}</h3><p class="muted" style="font-size:13px">${esc(U.profileSub)}</p></div>
        <div class="row" style="gap:16px">${avatar("lg")}<div class="stack" style="gap:8px"><b>${esc(U.youIn)}</b><div class="row wrap"><button type="button" class="btn sm" data-act="avatar-shuffle">${esc(U.shuffle)}</button><button type="button" class="btn sm" data-act="avatar-upload">${ic("upload", 13)}${esc(U.upload)}</button>${typeof S.profile.avatar === "string" ? `<button type="button" class="btn sm soft" data-act="avatar-remove">${esc(U.remove)}</button>` : ""}</div><small class="hint">${esc(U.avatarHint)}</small></div></div>
        <div><h4 style="margin-bottom:8px">${esc(U.avatar)}</h4><div class="swatches" role="radiogroup" aria-label="${esc(U.avatar)}">${AVATARS.map((g, i) => `<button type="button" role="radio" data-act="avatar" data-i="${i}" aria-checked="${S.profile.avatar === i}" style="--av:${g}" aria-label="${i + 1}"></button>`).join("")}</div></div>
        <label class="f">${esc(U.name)}<input type="text" name="name" value="${esc(S.profile.name || displayName())}" maxlength="40" required /><small>${esc(U.nameHint)}</small></label>
        <div><button class="btn pri">${esc(U.save)}</button></div></form>`;
    } else if (n === 1) {
      panel = `<div class="card pad stack"><h3>${esc(U.prefs)}</h3>
        <label class="f">${esc(U.defaultAgent)}<select data-input="prefAgent">${D.agents.map((a: any) => `<option value="${esc(a.id)}" ${defaultAgent() === a.id ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select></label>
        <div class="f"><span>${esc(U.sendKey)}</span><div class="seg">${U.sendKeys.map((k: string, i: number) => `<button data-act="send-key" data-i="${i}" aria-pressed="${S.prefs.send === i}">${esc(k)}</button>`).join("")}</div></div>
        <div class="f"><span>${esc(A.account.theme)}</span><div class="seg">${(["system", "light", "dark"] as const).map((t) => `<button data-act="theme" data-v="${t}" aria-pressed="${S.theme === t}">${ic(t === "system" ? "system" : t === "light" ? "sun" : "moon", 14)}${esc(A.account.themes[t])}</button>`).join("")}</div></div>
        <div class="f"><span>${esc(A.account.language)}</span><div class="row wrap">${D.locales.map((l: any) => `<a class="btn sm ${l.current ? "pri" : "soft"}" href="${esc(l.href)}${esc(location.hash)}">${esc(l.label)}</a>`).join("")}</div></div></div>`;
    } else {
      panel = `<div class="card pad stack"><h3>${esc(U.notifTitle)}</h3>${S.email ? `<p class="muted">${esc(S.email)}</p>` : ""}<div class="list" style="margin:0 -16px">${U.notifs.map((t: string, i: number) => `<div><span class="grow">${esc(t)}</span><button class="switch" role="switch" data-act="notif" data-i="${i}" aria-checked="${!!S.notifs[i]}" aria-label="${esc(t)}"></button></div>`).join("")}</div></div>`;
    }
    return `${bar(U.title)}<div class="scroll"><div class="page"><div class="settings">${tabsV(U.tabs, n, "settings")}<div>${panel}</div></div></div></div>`;
  };

  const paid = () => S.credits.never + S.credits.period > 0;
  const vApi = () => {
    const P = A.api;
    const base = "https://api.fells.dev/v1";
    const snippets = [
      ["curl", `curl ${base}/chat/completions \\\n  -H "Authorization: Bearer $FELLS_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model": "claude-sonnet-5.5", "messages": [{"role": "user", "content": "Hello"}]}'`],
      ["OpenAI SDK", `from openai import OpenAI\n\nclient = OpenAI(base_url="${base}", api_key=os.environ["FELLS_API_KEY"])\nreply = client.chat.completions.create(\n    model="gpt-6.1-sol",\n    messages=[{"role": "user", "content": "Hello"}],\n)`],
      ["Claude Code", `export ANTHROPIC_BASE_URL="https://api.fells.dev"\nexport ANTHROPIC_AUTH_TOKEN="$FELLS_API_KEY"\nclaude`],
    ];
    const keys = S.keys;
    return `
      ${bar(P.title, P.sub, `<button class="btn sm pri" data-act="new-key">${ic("plus", 14)}${esc(P.create)}</button>`)}
      <div class="scroll"><div class="page stack lg">
        ${paid() ? "" : `<div class="card pad between" style="background:var(--sub)"><div><h3>${ic("lock", 16)} ${esc(P.gateTitle)}</h3><p class="muted" style="margin-top:4px;font-size:13px">${esc(P.gateBody)}</p></div><div class="row"><a class="btn" href="#/billing/market">${esc(P.market)}</a><button class="btn pri" data-act="topup">${esc(A.account.topUp)}</button></div></div>`}
        <section><div class="sec-title"><h3>${esc(P.usage)}</h3><div class="seg">${P.ranges.map((r: string, i: number) => `<button data-act="api-range" data-i="${i}" aria-selected="${V.apiRange === i}">${esc(r)}</button>`).join("")}</div></div>
          <div class="kv"><div><small>${esc(P.requests)}</small><b>0</b><span class="s">${esc(P.calls)}</span></div><div><small>${esc(P.tokens)}</small><b>0</b><span class="s">${esc(P.tokensSub)}</span></div><div><small>${esc(P.covered)}</small><b>0</b><span class="s">${esc(P.coveredSub)}</span></div><div><small>${esc(P.charges)}</small><b>$0.00</b><span class="s">${esc(P.chargesSub)}</span></div></div>
          <p class="hint" style="margin-top:8px">${esc(P.retention)}</p></section>
        <section><div class="sec-title"><h3>${esc(P.mine)}</h3></div>
          ${keys.length ? `<div class="card list">${keys.map((k: any) => `<div>${ic("key", 16)}<span class="grow"><b>${esc(k.name)}</b><small class="mono">fl-…${esc(k.last4)} · ${esc(dfmt(k.created))}${k.limit ? ` · ${money(k.limit)}/mo` : ""}</small></span><button class="btn sm soft" data-act="revoke" data-id="${esc(k.id)}">${esc(P.revoke)}</button></div>`).join("")}</div>` : `<div class="card empty" style="padding:36px"><div class="ico">${ic("key", 22)}</div><h3>${esc(P.empty)}</h3><p>${esc(P.emptySub)}</p></div>`}</section>
        <section><div class="sec-title"><h3>${esc(P.quick)}</h3><span class="muted">${esc(P.quickSub)}</span></div>
          <div class="card pad stack"><div class="between"><span class="muted">${esc(P.baseUrl)}</span><span class="row"><code class="mono">${base}</code><button class="icon-btn" data-act="copy" data-text="${base}" data-msg="${esc(A.common.copied)}" aria-label="${esc(A.common.copy)}">${ic("copy", 14)}</button></span></div>
          <div class="seg">${snippets.map(([n], i) => `<button data-act="quick" data-i="${i}" aria-selected="${V.quickTab === i}">${esc(n)}</button>`).join("")}</div>
          <div class="codebox"><pre class="code">${esc(snippets[V.quickTab][1])}</pre><button class="btn sm" data-act="copy" data-text="${esc(snippets[V.quickTab][1])}" data-msg="${esc(A.common.copied)}">${ic("copy", 13)}${esc(A.common.copy)}</button></div>
          <p class="hint">${esc(P.preview)}</p></div></section>
      </div></div>`;
  };

  // Billing
  const levelName = (n: number) => D.market.levels[["low", "mid", "high", "great"][Math.max(0, Math.min(3, n - 1))]];
  const chanCard = (c: any) => {
    const mc = D.market.channels[c.id];
    const name = mc?.name || c.name;
    const by = mc?.by || (c.style === "direct" ? fmt(D.market.directDesc, { name: c.name }) : fmt(D.market.providerDesc, { name: c.name }));
    const desc = mc?.desc || "";
    const isDef = S.defaultChannel === c.id;
    const extra = c.total - c.models.length;
    const product = c.id.startsWith("claude") ? "claude" : "codex";
    return `<div class="chan"><div class="row">${mk(M.channels[c.id], 38)}<div style="min-width:0"><h4>${esc(name)}</h4><small class="muted">${esc(mc?.by || c.name || "")}</small></div>${c.badge === "recommended" ? `<span class="tag" style="margin-left:auto">${esc(A.billing.recommended)}</span>` : ""}</div>
      <p>${esc(desc || by)}</p>
      <div class="chips">${c.models.map((m: string) => `<span>${esc(m)}</span>`).join("")}${extra > 0 ? `<span>${esc(fmt(D.market.more, { n: extra }))}</span>` : ""}</div>
      <div class="mets">${(["value", "privacy", "capability", "speed"] as const).map((k) => `<div>${esc(D.market.metrics[k])}<b>${esc(levelName(c.metrics[k]))}</b></div>`).join("")}</div>
      <div class="between"><span class="price">${c.kind === "sub" ? `<small>${esc(D.market.from)}</small> ${money(c.from)}<small>${esc(D.market.perMonth)}</small>` : `<small>${esc(D.market.inputFrom)}</small> ${money(c.from)}<small>${esc(D.market.perM)}</small>`}</span>
      ${c.kind === "sub" ? `<a class="btn sm pri" href="${esc(D.links.checkout)}?mode=subscription&product=${product}&tier=1x&period=monthly">${esc(A.billing.market.choose)}</a>` : isDef ? `<span class="pill ok">${ic("check", 12)}${esc(A.billing.market.isDefault)}</span>` : `<button class="btn sm" data-act="default-chan" data-id="${esc(c.id)}">${esc(A.billing.market.makeDefault)}</button>`}</div></div>`;
  };
  const vBilling = (tab: string) => {
    const B = A.billing;
    const t = tab === "credits" ? 1 : 0;
    const seg = `<div class="seg" role="tablist">${B.tabs.map((x: string, i: number) => `<button role="tab" data-go="billing/${i ? "credits" : "market"}" aria-selected="${t === i}">${esc(x)}</button>`).join("")}</div>`;
    let body = "";
    if (t === 0) {
      const M = B.market;
      const q = V.marketQ.trim().toLowerCase();
      const match = (c: any) => !q || [c.name, D.market.channels[c.id]?.name, ...c.models].join(" ").toLowerCase().includes(q);
      const subs = D.channels.filter((c: any) => c.kind === "sub" && match(c));
      const payg = D.channels.filter((c: any) => c.kind === "payg" && match(c));
      body = `
        <div class="dark-hero"><span class="k">${esc(M.kicker)}</span><h2>${esc(M.title)}</h2><ul>${M.trust.map((x: string) => `<li>${esc(x)}</li>`).join("")}</ul></div>
        <div class="row wrap"><div class="seg">${[["all", M.all], ["subs", M.subs], ["payg", M.payg]].map(([k, l]) => `<button data-act="mtab" data-v="${k}" aria-selected="${V.marketTab === k}">${esc(l)}</button>`).join("")}</div><input type="search" data-input="marketQ" value="${esc(V.marketQ)}" placeholder="${esc(M.search)}" aria-label="${esc(M.search)}" style="max-width:300px" /><a class="btn sm soft" href="${esc(D.links.market)}" style="margin-left:auto">${esc(M.pricing)}${ic("ext", 13)}</a></div>
        <div data-mlist class="stack lg">
        ${V.marketTab !== "payg" ? `<section><div class="sec-title"><h3>${esc(M.subsTitle)}</h3></div><p class="muted" style="margin:-6px 0 12px;font-size:13px">${esc(M.subsSub)}</p><div class="grid2">${subs.map(chanCard).join("") || `<p class="muted">${esc(M.none)}</p>`}</div></section>` : ""}
        ${V.marketTab !== "subs" ? `<section><div class="sec-title"><h3>${esc(M.paygTitle)}</h3></div><p class="muted" style="margin:-6px 0 12px;font-size:13px">${esc(M.paygSub)}</p><div class="grid3">${payg.map(chanCard).join("") || `<p class="muted">${esc(M.none)}</p>`}</div></section>` : ""}
        </div>`;
    } else {
      const spent = 0;
      body = `
        <div class="balance"><small>${esc(B.balance)}</small><div class="amt">${money2(balance())}</div><button class="btn top" data-act="topup">${ic("plus", 14)}${esc(B.topUp)}</button>
          <div class="parts"><div><small>${esc(B.period)}</small><b>${money2(S.credits.period)}</b></div><div><small>${esc(B.never)}</small><b>${money2(S.credits.never)}</b><small>${esc(B.neverSub)}</small></div><div><small>${esc(B.bonus)}</small><b>${money2(S.credits.bonus)}</b><small>${esc(fmt(B.bonusSub, { date: dfmt(bonusExpiry()) }))}</small></div></div>
          <p style="position:relative;z-index:1;margin-top:12px;color:#9a9aa0;font-size:12.5px">${esc(B.order)} <a href="${esc(D.links.checkout)}?mode=redeem" style="color:#f3a37f;white-space:nowrap">${esc(B.redeem)} →</a></p></div>
        <section><div class="sec-title"><h3>${esc(B.subTitle)}</h3></div><p class="muted" style="margin:-6px 0 18px;font-size:13px">${esc(B.subBody)}</p>
          <div class="grid4">${D.creditTiers.map((x: any, i: number) => `<div class="tier ${x.badge === "popular" ? "rec" : ""}">${x.badge === "popular" ? `<span class="flag">${esc(B.recommended)}</span>` : ""}<div class="p">${money(x.monthly)}<small>${esc(D.market.perMonth)}</small></div><p>${esc(fmt(B.tierCredits, { n: x.monthly }))}</p><p>${esc(fmt(B.worth, { n: x.apiValue }))}</p><button class="btn ${x.badge === "popular" ? "pri" : ""}" data-act="subscribe" data-i="${i}">${esc(B.subscribe)}</button></div>`).join("")}</div>
          <p class="hint" style="margin-top:12px">${esc(B.tierNote)}</p></section>
        <div class="grid2"><div class="card pad stack"><h4>${esc(B.fromTitle)}</h4>${B.from.map(([t2, b]: string[]) => `<div><b>${esc(t2)}</b><p class="muted" style="font-size:13px">${esc(b)}</p></div>`).join("")}</div><div class="card pad stack"><h4>${esc(B.forTitle)}</h4>${B.for.map(([t2, b]: string[]) => `<div><b>${esc(t2)}</b><p class="muted" style="font-size:13px">${esc(b)}</p></div>`).join("")}</div></div>
        <p class="note">${esc(B.flowNote)}</p>
        <form method="post" class="card pad stack" data-form="budget"><div class="between"><div><h3>${ic("shield", 16)} ${esc(B.budget)}</h3><p class="muted" style="font-size:13px;margin-top:4px">${esc(B.budgetSub)}</p></div><span class="pill">${esc(B.spent)} ${money2(spent)}</span></div>
          <div class="grid3"><label class="f">${esc(B.budgetLabel)}<input type="number" name="limit" min="0" step="5" value="${S.budget.limit || ""}" placeholder="—" /></label><label class="f">${esc(B.budgetAlert)}<select name="alert">${[50, 80, 90].map((p) => `<option value="${p}" ${S.budget.alert === p ? "selected" : ""}>${p}%</option>`).join("")}</select></label><div class="f"><span>${esc(B.budgetPause)}</span><button type="button" class="switch" role="switch" data-act="budget-pause" aria-checked="${S.budget.pause}" aria-label="${esc(B.budgetPause)}"></button></div></div>
          <div><button class="btn">${esc(B.budgetSave)}</button></div></form>
        <div class="grid2">
          <div class="card pad stack"><h4>${esc(B.plans)}</h4><p class="muted">${esc(A.account.noPlan)}</p><div><a class="btn sm" href="#/billing/market">${esc(B.browse)}</a></div></div>
          <div class="card pad stack"><h4>${esc(B.upcoming)}</h4><div class="between"><span class="muted">${esc(B.bonusExp)}</span><b>${money2(S.credits.bonus)} · ${esc(dfmt(bonusExpiry()))}</b></div></div>
        </div>
        <div class="card pad stack"><h4>${esc(B.payOrder)}</h4><label class="f">${esc(B.defaultChannel)}<select data-input="defaultChannel">${D.channels.filter((c: any) => c.kind === "payg").map((c: any) => `<option value="${esc(c.id)}" ${S.defaultChannel === c.id ? "selected" : ""}>${esc(D.market.channels[c.id]?.name || c.name)}</option>`).join("")}</select><small>${esc(B.defaultSub)}</small></label></div>
        <section><div class="sec-title"><h3>${esc(B.activity)}</h3></div><div class="card list"><div>${ic("gift", 16)}<span class="grow">${esc(B.signup)}<small>${esc(dfmt(S.joined))}</small></span><b style="color:var(--ok)">+${money2(D.signupBonus)}</b></div></div></section>`;
    }
    return `${bar(B.title, B.sub, seg)}<div class="scroll"><div class="page stack lg">${body}</div></div>`;
  };

  const vNotFound = () => `${bar("")}<div class="scroll"><div class="empty"><h3>404</h3><button class="btn" data-go="">${esc(A.nav.back)}</button></div></div>`;

  // ---------- render ----------
  const main = () => {
    const r = route();
    if (needsWs.has(r.name) && !hasWs()) return vHome();
    switch (r.name) {
      case "": return hasWs() ? vNew() : vHome();
      case "new": return hasWs() ? vNew() : vHome();
      case "chat": return vChat(r.arg);
      case "import": return vImport();
      case "files": return vFiles();
      case "canvas": return vCanvas();
      case "members": return vMembers();
      case "plugins": return vPlugins();
      case "sites": return vSites();
      case "schedules": return vSchedules();
      case "ws-settings": return vWsSettings(Math.min(4, Number(r.arg) || 0));
      case "settings": return vUser(Math.min(2, Number(r.arg) || 0));
      case "api": return vApi();
      case "billing": return vBilling(r.arg);
      default: return vNotFound();
    }
  };
  const render = () => {
    applyTheme();
    root.classList.toggle("sb-hidden", !!S.sbHidden);
    const scroll = root.querySelector<HTMLElement>(".main .scroll");
    const keep = scroll && root.dataset.route === location.hash ? scroll.scrollTop : 0;
    root.innerHTML = `${sidebar()}<main class="main" id="fx-main">${main()}</main>`;
    root.dataset.route = location.hash;
    const s2 = root.querySelector<HTMLElement>(".main .scroll");
    if (s2) s2.scrollTop = root.querySelector("[data-thread]") ? s2.scrollHeight : keep;
    document.title = A.metaTitle + (wsName() ? " · " + wsName() : "");
  };

  // ---------- popovers ----------
  let popEl: HTMLElement | null = null;
  const closePop = () => { popEl?.remove(); popEl = null; };
  const openPop = (anchor: HTMLElement, html: string, cls = "") => {
    closePop();
    const el = document.createElement("div");
    el.className = "pop " + cls;
    el.setAttribute("role", "menu");
    el.innerHTML = html;
    root.appendChild(el);
    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth, h = el.offsetHeight;
    let top = r.bottom + 6;
    if (top + h > innerHeight - 8) top = Math.max(8, r.top - h - 6);
    let left = Math.min(r.left, innerWidth - w - 8);
    left = Math.max(8, left);
    el.style.top = top + "px";
    el.style.left = left + "px";
    popEl = el;
    el.querySelector<HTMLElement>("input,button")?.focus();
    return el;
  };
  const switcherMenu = () => `
    <div class="ph">${esc(A.switcher.title)}</div>
    ${S.workspaces.length ? S.workspaces.map((w) => `<button class="mi" data-act="switch" data-id="${esc(w.id)}"><span class="ws-ic">${esc(initials(w.name).slice(0, 1))}</span><span class="grow">${esc(w.name)}<small>${esc(A.switcher.owner)} · ${esc(regionName(w.region))}</small></span>${S.current === w.id ? ic("check", 16) : ""}</button>`).join("") : `<p class="ph">${esc(A.switcher.none)}</p>`}
    <hr /><div class="ph">${esc(A.switcher.examples)}</div>
    <button class="mi" data-act="switch" data-id="example"><span class="ws-ic" style="background:#5865f2;color:#fff">L</span><span class="grow">${esc(A.example.name)}<small>${esc(A.example.body)}</small></span><span class="tag">${esc(A.switcher.readOnly)}</span>${isExample() ? ic("check", 16) : ""}</button>
    <hr /><button class="mi" data-act="new-ws">${ic("plus", 16)}${esc(A.switcher.newWs)}</button>`;
  const accountMenu = () => `
    <div class="acct-head"><div class="row">${avatar()}<div style="min-width:0"><b>${esc(displayName())}</b>${S.email ? `<small class="muted">${esc(S.email)}</small>` : ""}</div></div></div>
    <div class="credit-row"><div><small class="muted">${esc(A.account.credits)}</small><b style="display:block">${money2(balance())}</b><small class="dim">${esc(fmt(A.account.expires, { amount: money2(S.credits.bonus), date: dfmt(bonusExpiry()) }))}</small></div><button class="btn sm pri" data-act="topup">${esc(A.account.topUp)}</button></div>
    <button class="mi" data-go="billing/market">${ic("store", 16)}<span class="grow">${esc(A.account.market)}</span><span class="end">${esc(A.account.noPlan)}</span></button>
    <button class="invite-banner" data-act="invite">${ic("gift", 18)}<span><b>${esc(A.account.invite)}</b><small>${esc(A.account.inviteSub)}</small></span></button>
    <button class="mi" data-go="settings/0">${ic("gear", 16)}${esc(A.account.settings)}</button>
    <button class="mi" data-go="api">${ic("key", 16)}${esc(A.account.apiKey)}</button>
    <button class="mi" data-go="billing/credits">${ic("card", 16)}${esc(A.billing.tabs[1])}</button>
    <button class="mi" data-act="changelog">${ic("spark", 16)}${esc(A.account.changelog)}</button>
    <button class="mi" data-act="help">${ic("book", 16)}${esc(A.account.help)}</button>
    <a class="mi" href="${esc(D.links.home)}">${ic("globe", 16)}<span class="grow">${esc(A.account.website)}</span>${ic("ext", 13)}</a>
    <a class="mi" href="${esc(D.links.start)}#login" data-act="logout">${ic("logout", 16)}${esc(A.account.logout)}</a>
    <hr />
    <div class="foot-row"><div class="seg" aria-label="${esc(A.account.theme)}">${(["system", "light", "dark"] as const).map((t) => `<button data-act="theme" data-v="${t}" aria-pressed="${S.theme === t}" title="${esc(A.account.themes[t])}" aria-label="${esc(A.account.themes[t])}">${ic(t === "system" ? "system" : t === "light" ? "sun" : "moon", 14)}</button>`).join("")}</div>
    <button class="btn sm soft" data-act="lang">${ic("lang", 14)}${esc(D.locales.find((l: any) => l.current)?.label || "")}</button></div>`;
  const modelMenu = (agentId: string, q = "") => {
    const agent = agentById(agentId);
    const ms = modelsFor(agent).filter((m: any) => !q || (m.name + " " + m.provider).toLowerCase().includes(q.toLowerCase()));
    const cur = V.menuChat ? S.chats.find((c) => c.id === V.menuChat)?.model : currentModel(agent);
    const groups: Record<string, any[]> = {};
    for (const m of ms) (groups[m.provider || agent.maker] ||= []).push(m);
    const list = Object.entries(groups)
      .map(([p, arr]) => `<div class="grp">${mk(M.providers[p] || M.agents[agent.id], 14)}${esc(p)}</div>${arr.map((m) => `<button class="mi" data-act="pick-model" data-name="${esc(m.name)}"><span class="grow">${esc(m.name)}${m.tag === "new" ? ` <span class="tag">NEW</span>` : ""}${m.input ? `<small>${esc(fmt(A.newChat.perM, { in: m.input, out: m.output }))}</small>` : ""}${D.planCovers[m.name] ? `<span class="cov">${esc(fmt(A.newChat.covered, { plan: D.planCovers[m.name] }))}</span>` : ""}</span>${cur === m.name ? ic("check", 16) : ""}</button>`).join("")}`)
      .join("");
    return `<div class="search"><input type="search" data-input="modelQ" value="${esc(q)}" placeholder="${esc(A.newChat.modelSearch)}" aria-label="${esc(A.newChat.modelSearch)}" /></div><div data-mlist>${list || `<p class="ph">${esc(A.newChat.noModel)}</p>`}</div>
      ${agent.id === "media" ? "" : `<div class="mfoot"><div class="between"><span>${esc(A.newChat.payment)}</span><span>${esc(A.newChat.paymentVal)}</span></div><div class="between"><span>${esc(A.newChat.effort)}</span><div class="seg">${A.newChat.efforts.map((e: string, i: number) => `<button data-act="effort" data-i="${i}" aria-pressed="${V.effort === i}">${esc(e)}</button>`).join("")}</div></div></div>`}`;
  };
  const computerMenu = () => `
    <div class="ph">${esc(A.newChat.computer)}</div>
    <button class="mi" data-act="set-computer" data-v="cloud">${ic("cloud", 16)}<span class="grow">${esc(A.newChat.cloud)}<small>${esc(A.newChat.cloudSub)}</small></span>${V.computer === "cloud" ? ic("check", 16) : ""}</button>
    <button class="mi" data-act="set-computer" data-v="local">${ic("monitor", 16)}<span class="grow">${esc(A.newChat.local)}<small>${esc(A.newChat.localSub)}</small></span>${V.computer === "local" ? ic("check", 16) : ""}</button>`;
  const langMenu = () => D.locales.map((l: any) => `<a class="mi" href="${esc(l.href)}${esc(location.hash)}">${esc(l.label)}${l.current ? `<span class="end">${ic("check", 14)}</span>` : ""}</a>`).join("");

  // ---------- dialogs ----------
  let dlgEl: HTMLElement | null = null;
  let lastFocus: HTMLElement | null = null;
  const closeDlg = () => { dlgEl?.remove(); dlgEl = null; lastFocus?.focus?.(); lastFocus = null; };
  const openDlg = (html: string, cls = "", top = false) => {
    closePop();
    closeDlg();
    lastFocus = document.activeElement as HTMLElement;
    const el = document.createElement("div");
    el.className = "scrim" + (top ? " top" : "");
    el.innerHTML = `<div class="dlg ${cls}" role="dialog" aria-modal="true">${html}</div>`;
    root.appendChild(el);
    dlgEl = el;
    (el.querySelector<HTMLElement>("[autofocus]") || el.querySelector<HTMLElement>("input,button:not(.x)"))?.focus();
    return el;
  };
  const xBtn = () => `<button class="icon-btn x" data-act="close" aria-label="${esc(A.common.close)}">${ic("x", 16)}</button>`;

  // Onboarding
  let ob = { step: 0 };
  const onboardHtml = () => {
    const O = A.onboard;
    const q = O.questions[ob.step];
    const sel = S.answers[ob.step] || [];
    const last = ob.step === O.questions.length - 1;
    return `<div class="between"><span class="muted" style="font-size:12.5px">${esc(fmt(O.step, { n: ob.step + 1, total: O.questions.length }))}</span><button class="btn sm soft" data-act="ob-skip">${esc(O.skip)}</button></div>
      <div class="progress"><i style="width:${((ob.step + 1) / O.questions.length) * 100}%"></i></div>
      <h2 style="margin-top:18px;padding:0">${esc(ob.step === 0 ? O.title : q.q)}</h2>${ob.step === 0 ? `<p class="lead">${esc(q.q)}</p>` : ""}
      ${q.multi ? `<p class="hint" style="margin-top:6px">${esc(O.multi)}</p>` : ""}
      <div class="opts" style="margin-top:14px" role="${q.multi ? "group" : "radiogroup"}">${q.opts.map((o: string, i: number) => `<button class="opt" role="${q.multi ? "checkbox" : "radio"}" data-act="ob-opt" data-i="${i}" aria-checked="${sel.includes(i)}">${esc(o)}${sel.includes(i) ? `<span class="end">${ic("check", 16)}</span>` : ""}</button>`).join("")}</div>
      ${ob.step === 1 ? `<p class="hint" style="margin-top:10px">${esc(O.why)}</p>` : ""}
      <div class="foot between">${ob.step ? `<button class="btn" data-act="ob-back">${esc(O.back)}</button>` : "<span></span>"}<button class="btn pri" data-act="ob-next" ${sel.length ? "" : "disabled"}>${esc(last ? O.finish : O.next)}</button></div>`;
  };
  const openOnboard = () => { ob = { step: 0 }; openDlg(onboardHtml()); };
  const finishOnboard = async () => {
    S.onboarded = true;
    V.agent = defaultAgent();
    if (!await save()) return;
    closeDlg();
    render();
  };

  // New workspace
  const guessRegion = () => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    if (/^America\/(Los_Angeles|Vancouver|Phoenix|Denver|Tijuana|Boise)/.test(tz)) return "us-west";
    if (tz.startsWith("America/")) return "us-east";
    if (/^Europe\/(London|Dublin|Lisbon|Paris|Madrid|Amsterdam|Brussels)/.test(tz)) return "eu-west";
    if (tz.startsWith("Europe/") || tz.startsWith("Africa/")) return "eu-east";
    if (tz.startsWith("Asia/") || tz.startsWith("Australia/") || tz.startsWith("Pacific/")) return "ap";
    return "us-west";
  };
  const openNewWs = () => {
    const N = A.newWs;
    const rec = guessRegion();
    const here = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    let zones: string[] = [];
    try { zones = (Intl as any).supportedValuesOf("timeZone"); } catch {}
    if (!zones.includes(here)) zones.unshift(here);
    openDlg(`${xBtn()}<h2>${esc(N.title)}</h2><p class="lead">${esc(N.sub)}</p>
      <form method="post" class="body" data-form="new-ws" novalidate>
        <label class="f">${esc(N.name)}<input type="text" name="name" placeholder="${esc(N.namePh)}" maxlength="60" autofocus /><span class="err" data-err hidden>${esc(N.nameRequired)}</span></label>
        <div class="f"><span>${esc(N.region)}</span><div class="opts" role="radiogroup">${D.regions.map((r: string) => `<button type="button" class="opt" role="radio" data-act="region" data-v="${r}" aria-checked="${r === rec}"><span class="grow"><b>${esc(N.regions[r][0])}</b><small>${esc(N.regions[r][1])}</small></span>${r === rec ? `<span class="tag">${esc(N.recommended)}</span>` : ""}</button>`).join("")}</div><input type="hidden" name="region" value="${rec}" /><small>${esc(N.regionNote)}</small></div>
        <label class="f">${esc(N.tz)}<select name="tz">${zones.map((z) => `<option ${z === here ? "selected" : ""}>${esc(z)}</option>`).join("")}</select><small>${esc(N.tzNote)}</small></label>
        <div class="foot" style="margin-top:4px"><button type="button" class="btn" data-act="close">${esc(N.cancel)}</button><button class="btn pri">${esc(N.create)}</button></div>
      </form>`);
  };

  // Top-up
  const openTopup = (amount = 25) => {
    const T = A.topup;
    const html = (amt: number, custom: string, method: string) => `${xBtn()}<h2>${esc(T.title)}</h2><p class="lead">${esc(T.sub)}</p>
      <form method="post" class="body" data-form="topup">
        <div class="f"><span>${esc(T.amount)}</span><div class="opts four" role="radiogroup">${D.topups.map((n: number) => `<button type="button" class="opt center" role="radio" data-act="topup-amt" data-v="${n}" aria-checked="${!custom && amt === n}">${money(n)}</button>`).join("")}</div>
          <input type="number" name="custom" min="10" max="5000" step="5" value="${esc(custom)}" placeholder="${esc(T.amount)} (USD)" aria-label="${esc(T.amount)}" /><small>${esc(T.min)}</small></div>
        <div class="sumrow"><span class="muted">${esc(T.after)}</span><b data-after>${money2(balance() + amt)}</b></div>
        <label class="f">${esc(T.reward)}<input type="text" name="code" maxlength="9" pattern="[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}" placeholder="XXXX-XXXX" /><small>${esc(T.rewardNote)}</small></label>
        <div class="f"><span>${esc(T.method)}</span><div class="opts two" role="radiogroup">${[["alipay", T.alipay], ["card", T.card]].map(([k, l]) => `<button type="button" class="opt" role="radio" data-act="topup-method" data-v="${k}" aria-checked="${method === k}">${esc(l)}</button>`).join("")}</div></div>
        <button class="btn pri wide" data-pay>${esc(fmt(T.pay, { n: amt }))}</button>
        <small class="hint">${esc(T.refund)}</small>
      </form>`;
    V.topup = { amt: amount, custom: "", method: "alipay" };
    openDlg(html(amount, "", "alipay"));
  };
  const topupAmount = () => {
    const c = Number(V.topup.custom);
    return V.topup.custom && c >= 10 ? Math.min(5000, Math.round(c / 5) * 5) : V.topup.amt;
  };
  const refreshTopup = () => {
    if (!dlgEl) return;
    const amt = topupAmount();
    dlgEl.querySelectorAll<HTMLElement>("[data-act=topup-amt]").forEach((b) => b.setAttribute("aria-checked", String(!V.topup.custom && Number(b.dataset.v) === V.topup.amt)));
    dlgEl.querySelectorAll<HTMLElement>("[data-act=topup-method]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.v === V.topup.method)));
    dlgEl.querySelector("[data-after]")!.textContent = money2(balance() + amt);
    dlgEl.querySelector("[data-pay]")!.textContent = fmt(A.topup.pay, { n: amt });
  };

  // Subscribe (credit subscription tier)
  const openSubscribe = (i: number, step = 0) => {
    const T = D.creditTiers[i];
    const U = A.subscribe;
    V.sub = { i, method: V.sub?.method || "alipay" };
    openDlg(`${xBtn()}<h2>${esc(fmt(U.title, { n: T.monthly }))}</h2><p class="lead">${esc(fmt(U.each, { n: T.monthly }))}</p>
      <div class="body">
        ${step === 0 ? `<label class="f">${esc(A.topup.reward)}<input type="text" data-sub-code maxlength="9" placeholder="XXXX-XXXX" /><small>${esc(fmt(A.billing.reward, { n: Math.round(T.monthly * 0.1) || 1 }))}</small></label>
          <div class="stack" style="gap:8px"><button class="btn pri wide" data-act="sub-next" data-i="${i}">${esc(U.rewardApply)}</button><button class="btn wide" data-act="sub-next" data-i="${i}">${esc(U.rewardSkip)}</button></div>`
        : `<div class="f"><span>${esc(A.topup.method)}</span><div class="opts two" role="radiogroup">${[["alipay", A.topup.alipay], ["card", A.topup.card]].map(([k, l]) => `<button type="button" class="opt" role="radio" data-act="sub-method" data-v="${k}" aria-checked="${V.sub.method === k}">${esc(l)}</button>`).join("")}</div></div>
          <div class="sumrow"><span class="muted">${esc(A.billing.subTitle)}</span><b>${money(T.monthly)}${esc(D.market.perMonth)}</b></div>
          <button class="btn pri wide" data-act="sub-pay">${esc(fmt(U.pay, { n: T.monthly }))}</button>
          <button class="btn wide soft" data-act="sub-back" data-i="${i}">${esc(U.back)}</button>
          <small class="hint">${esc(U.terms)}</small>`}
        <p class="note">${esc(U.noCharge)}</p>
      </div>`);
  };

  const openInvite = () => {
    openDlg(`${xBtn()}<h2>${esc(A.invite.title)}</h2><p class="lead">${esc(security.inviteUnavailable)}</p>`);
  };
  const openChangelog = () => {
    const C = A.changelog;
    openDlg(`${xBtn()}<h2>${esc(C.title)}</h2><p class="lead">${esc(C.sub)}</p><div class="body">${C.entries.map((e: any, i: number) => `<article class="card pad stack" style="gap:6px"><div class="row wrap"><span class="muted" style="font-size:12.5px">${esc(e.date)}</span><span class="tag">${esc(e.tag)}</span>${i === 0 ? `<span class="pill ok">${esc(C.latest)}</span>` : ""}</div><h3>${esc(e.title)}</h3><ul style="margin:0;padding-left:18px;color:var(--muted)">${e.items.map((x: string) => `<li>${esc(x)}</li>`).join("")}</ul></article>`).join("")}</div>`, "wide");
  };
  const openHelp = () => {
    const H = A.help;
    openDlg(`${xBtn()}<h2>${esc(H.title)}</h2><p class="lead">${esc(H.sub)}</p><div class="body">
      <a class="card pad between" href="${esc(D.links.blog)}" target="_blank" rel="noopener"><span class="row">${ic("book", 18)}<b>${esc(H.guide)}</b></span><span class="muted row" style="font-size:12.5px">${esc(H.open)}${ic("ext", 13)}</span></a>
      <div class="card pad stack"><div class="row">${ic("mail", 18)}<b>${esc(H.contact)}</b></div><p class="muted" style="font-size:13px">${esc(H.contactSub)}</p><div class="row wrap"><a class="btn sm pri" href="mailto:${esc(D.contact)}">${esc(H.write)}</a><button class="btn sm" data-act="copy" data-text="${esc(D.contact)}" data-msg="${esc(H.copied)}">${ic("copy", 13)}${esc(D.contact)}</button></div></div>
      <div><h4 style="margin-bottom:8px">${esc(H.shortcuts)}</h4><div class="card list">${H.keys.map(([k, l]: string[]) => `<div><span class="grow">${esc(l)}</span><kbd class="tag mono">${esc(MAC ? k : k.replace("⇧ ⌘ ", "Ctrl+Shift+").replace("⌘ ", "Ctrl+"))}</kbd></div>`).join("")}</div></div>
    </div>`);
  };
  const openPrompt = (title: string, label: string, ph: string, onOk: (v: string) => void) => {
    openDlg(`${xBtn()}<h2>${esc(title)}</h2><form method="post" class="body" data-form="prompt"><label class="f">${esc(label)}<input type="text" name="v" placeholder="${esc(ph)}" maxlength="60" required autofocus /></label><div class="foot" style="margin:0"><button type="button" class="btn" data-act="close">${esc(A.common.cancel)}</button><button class="btn pri">${esc(A.common.save)}</button></div></form>`);
    V.promptOk = onOk;
  };
  const openSchedule = () => {
    const C = A.schedules;
    openDlg(`${xBtn()}<h2>${esc(C.create)}</h2><form method="post" class="body" data-form="schedule">
      <label class="f">${esc(C.name)}<input type="text" name="name" placeholder="${esc(C.namePh)}" required maxlength="60" autofocus /></label>
      <label class="f">${esc(C.prompt)}<textarea name="prompt" rows="3" maxlength="${MAX_MESSAGE}" placeholder="${esc(C.promptPh)}" required></textarea></label>
      <div class="grid3"><label class="f">${esc(C.agent)}<select name="agent">${D.agents.filter((a: any) => a.id !== "media").map((a: any) => `<option value="${esc(a.id)}" ${a.id === defaultAgent() ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select></label>
      <label class="f">${esc(C.cadence)}<select name="cadence">${C.cadences.map((c: string, i: number) => `<option value="${i}" ${i === 1 ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label>
      <label class="f">${esc(C.time)}<input type="time" name="time" value="09:00" required /></label></div>
      <div class="foot" style="margin:0"><button type="button" class="btn" data-act="close">${esc(C.cancel)}</button><button class="btn pri">${esc(C.save)}</button></div></form>`, "wide");
  };
  const openNewKey = () => {
    const P = A.api;
    openDlg(`${xBtn()}<h2>${esc(P.create)}</h2><form method="post" class="body" data-form="key">
      <label class="f">${esc(P.keyName)}<input type="text" name="name" placeholder="${esc(P.keyNamePh)}" required maxlength="40" autofocus /></label>
      <label class="f">${esc(P.limit)}<input type="number" name="limit" min="0" step="5" placeholder="${esc(P.limitPh)}" /></label>
      <p class="note">${esc(P.preview)}</p>
      <div class="foot" style="margin:0"><button type="button" class="btn" data-act="close">${esc(A.common.cancel)}</button><button class="btn pri">${esc(P.create)}</button></div></form>`);
  };

  // Command palette
  const palItems = () => {
    const items: { g: string; label: string; icon: string; run: () => void }[] = [];
    const goTo = (label: string, icon: string, h: string) => items.push({ g: A.palette.go, label, icon, run: () => go(h) });
    goTo(A.nav.newChat, "plus", "new");
    if (hasWs()) {
      goTo(A.nav.files, "file", "files"); goTo(A.nav.canvas, "canvas", "canvas"); goTo(A.nav.members, "users", "members"); goTo(A.nav.plugins, "plug", "plugins");
      goTo(A.nav.sites, "globe", "sites"); goTo(A.nav.schedules, "clock", "schedules"); goTo(A.nav.wsSettings, "gear", "ws-settings/0");
    }
    goTo(A.account.market, "store", "billing/market"); goTo(A.billing.tabs[1], "card", "billing/credits"); goTo(A.account.apiKey, "key", "api"); goTo(A.account.settings, "gear", "settings/0");
    const act = (label: string, icon: string, run: () => void) => items.push({ g: A.palette.actions, label, icon, run });
    if (hasWs()) D.agents.forEach((a: any) => act(fmt(A.palette.newWith, { agent: a.name }), "spark", () => { V.agent = a.id; go("new"); }));
    act(A.switcher.newWs, "plus", openNewWs);
    act(A.account.topUp, "card", () => openTopup());
    act(A.account.invite, "gift", openInvite);
    act(A.account.changelog, "spark", openChangelog);
    act(A.account.help, "book", openHelp);
    (["system", "light", "dark"] as const).forEach((t) => act(`${A.account.theme}: ${A.account.themes[t]}`, t === "dark" ? "moon" : t === "light" ? "sun" : "system", async () => { S.theme = t; if (!await save()) return; render(); }));
    chats().forEach((c) => items.push({ g: A.palette.chats, label: c.title, icon: "chevR", run: () => go("chat/" + c.id) }));
    return items;
  };
  let pal = { q: "", i: 0, list: [] as ReturnType<typeof palItems> };
  const palResults = () => {
    const q = pal.q.trim().toLowerCase();
    pal.list = palItems().filter((x) => !q || x.label.toLowerCase().includes(q));
    if (pal.i >= pal.list.length) pal.i = 0;
    let g = "";
    return pal.list.length
      ? pal.list.map((x, i) => { const head = x.g !== g ? `<div class="ph">${esc((g = x.g))}</div>` : ""; return `${head}<button class="mi ${i === pal.i ? "active" : ""}" data-act="pal-run" data-i="${i}">${ic(x.icon, 16)}<span>${esc(x.label)}</span></button>`; }).join("")
      : `<p class="ph">${esc(A.palette.empty)}</p>`;
  };
  const openPalette = () => {
    pal = { q: "", i: 0, list: [] };
    openDlg(`<input type="search" data-input="pal" placeholder="${esc(A.palette.placeholder)}" aria-label="${esc(A.palette.placeholder)}" autofocus /><div class="res" data-pal>${palResults()}</div>`, "pal", true);
  };
  const refreshPal = () => {
    const box = dlgEl?.querySelector("[data-pal]");
    if (box) box.innerHTML = palResults();
    dlgEl?.querySelector(".mi.active")?.scrollIntoView({ block: "nearest" });
  };

  // ---------- actions ----------
  const sbOpen = () => root.classList.contains("sb-open");
  const closeSb = () => { root.classList.remove("sb-open"); root.querySelector(".sb-scrim")?.remove(); };
  const toggleSb = async () => {
    if (innerWidth <= 860) {
      if (sbOpen()) return closeSb();
      root.classList.add("sb-open");
      const s = document.createElement("div");
      s.className = "sb-scrim";
      s.dataset.act = "sb-close";
      root.appendChild(s);
    } else {
      S.sbHidden = !S.sbHidden;
      if (!await save()) return;
      render();
    }
  };
  const fileInput = (multiple: boolean, accept: string, cb: (files: File[]) => void) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.multiple = multiple;
    if (accept) inp.accept = accept;
    inp.onchange = () => { if (!saving && !ended) cb([...(inp.files || [])]); };
    inp.click();
  };
  const addFiles = async (list: File[]) => {
    if (saving || ended || isExample() || !list.length) return;
    for (const f of list) S.files.push({ id: uid(), ws: S.current, parent: V.folder, name: f.name, folder: false, size: f.size, modified: Date.now() });
    if (!await save()) return;
    render();
  };
  const sendMessage = async (form: HTMLFormElement) => {
    if (saving || ended || isExample()) return;
    const ta = form.querySelector("textarea")!;
    const text = ta.value.trim();
    if (!text) { ta.focus(); return; }
    if (text.length > MAX_MESSAGE) { toast(security.tooLarge); return; }
    if (!hasWs()) { openNewWs(); return; }
    const chatId = form.dataset.chat;
    const note: [string, string][] = [["sys", A.chat.saved + (V.plan ? " " + A.chat.planNote : "")]];
    const body = text + (V.attach.length ? "\n\n📎 " + V.attach.join(", ") : "");
    if (body.length > MAX_MESSAGE) { toast(security.tooLarge); return; }
    if (chatId) {
      const chat = S.chats.find((c) => c.id === chatId);
      if (!chat) return;
      chat.messages = chat.messages.filter((m) => m[0] !== "sys").concat([["you", body]], note);
    } else {
      const agent = agentById(V.agent);
      const chat: Chat = { id: uid(), ws: S.current, title: text.split("\n")[0].slice(0, 48) || A.chat.untitled, agent: agent.id, model: currentModel(agent), created: Date.now(), messages: [["you", body], ...note] };
      S.chats.push(chat);
      if (!await save()) return;
      V.draft = "";
      V.attach = [];
      go("chat/" + chat.id);
      return;
    }
    if (!await save()) return;
    V.attach = [];
    render();
  };

  root.addEventListener("click", async (e) => {
    if (saving || ended) { e.preventDefault(); return; }
    const t = e.target as HTMLElement;
    // Close popover when clicking outside it.
    if (popEl && !popEl.contains(t) && !t.closest("[data-act=switcher],[data-act=account],[data-act=model],[data-act=computer],[data-act=lang]")) closePop();
    if (dlgEl && t === dlgEl) { closeDlg(); return; }
    const el = t.closest<HTMLElement>("[data-go],[data-act]");
    if (!el || !root.contains(el)) return;
    if (el.dataset.go !== undefined) {
      e.preventDefault();
      const target = el.dataset.go;
      const name = target.split("/")[0];
      closePop();
      if (dlgEl) closeDlg();
      if (needsWs.has(name) && !hasWs()) {
        // Upgrade over agent.space: say why instead of doing nothing.
        toast(A.nav.needWs);
        openNewWs();
        return;
      }
      if (name === "new" && !hasWs()) { openNewWs(); return; }
      go(target);
      return;
    }
    const act = el.dataset.act!;
    if (["del-chat", "del-file", "sched-del", "revoke"].includes(act) && !confirm(security.confirmDelete)) return;
    const id = el.dataset.id || "";
    const i = Number(el.dataset.i);
    switch (act) {
      case "sb": toggleSb(); break;
      case "sb-close": closeSb(); break;
      case "switcher": popEl ? closePop() : openPop(el, switcherMenu()); break;
      case "account": popEl ? closePop() : openPop(el, accountMenu()); break;
      case "lang": openPop(el, langMenu()); break;
      case "more": V.moreOpen = !V.moreOpen; render(); break;
      case "switch": S.current = id; V.folder = ""; if (!await save()) return; closePop(); closeSb(); go(""); break;
      case "open-example": S.current = "example"; if (!await save()) return; go(""); break;
      case "new-ws": closeSb(); openNewWs(); break;
      case "promo-close": S.promoClosed = true; if (!await save()) return; render(); break;
      case "promo-go":
        if (!hasWs()) { openNewWs(); break; }
        V.agent = "codex"; V.model.codex = "GPT-6.1 Sol"; go("new"); break;
      case "invite": closePop(); openInvite(); break;
      case "help": closePop(); openHelp(); break;
      case "changelog": closePop(); openChangelog(); break;
      case "topup": closePop(); openTopup(); break;
      case "logout": {
        e.preventDefault();
        saving = true; generation++;
        try { await endPreview(committed!.session); clearView(); }
        catch { toast(security.saveFailed); }
        finally { saving = false; }
        break;
      }
      case "theme": S.theme = el.dataset.v as any; if (!await save()) return; applyTheme(); el.parentElement?.querySelectorAll("[data-act=theme]").forEach((b) => b.setAttribute("aria-pressed", String(b === el))); if (!popEl) render(); break;
      case "close": closeDlg(); break;
      case "soon": toast(A.common.comingSoon); break;
      case "copy": copy(el.dataset.text || "", el.dataset.msg || A.common.copied); break;
      // New chat
      case "agent": V.agent = id; render(); break;
      case "model": V.menuChat = el.dataset.chat || ""; openPop(el, modelMenu(el.dataset.agent!), "mm"); V.menuAgent = el.dataset.agent; break;
      case "pick-model": {
        const name = el.dataset.name!;
        if (V.menuChat) { const c = S.chats.find((x) => x.id === V.menuChat); if (c) c.model = name; if (!await save()) return; }
        else V.model[V.menuAgent] = name;
        closePop(); render(); break;
      }
      case "effort": V.effort = i; popEl?.querySelectorAll("[data-act=effort]").forEach((b, j) => b.setAttribute("aria-pressed", String(j === i))); break;
      case "computer": openPop(el, computerMenu()); break;
      case "set-computer": V.computer = el.dataset.v; closePop(); render(); break;
      case "plan": V.plan = !V.plan; render(); break;
      case "attach": fileInput(true, "", (fs) => { V.attach.push(...fs.map((f) => f.name)); render(); }); break;
      case "unattach": V.attach.splice(i, 1); render(); break;
      case "prompt": V.draft = el.dataset.text || ""; go("new"); setTimeout(() => root.querySelector<HTMLTextAreaElement>("#fx-input")?.focus(), 0); break;
      case "import-agent": V.importAgent = id; render(); break;
      case "del-chat": S.chats = S.chats.filter((c) => c.id !== id); if (!await save()) return; go("new"); break;
      // Files
      case "folder": V.folder = id; render(); break;
      case "fview": V.fileView = el.dataset.v; render(); break;
      case "upload": fileInput(true, "", addFiles); break;
      case "new-folder": openPrompt(A.files.newFolder, A.files.folderName, A.files.newFolder, async (v) => { if (saving || ended) return; S.files.push({ id: uid(), ws: S.current, parent: V.folder, name: v, folder: true, size: 0, modified: Date.now() }); if (!await save()) return; closeDlg(); render(); }); break;
      case "del-file": {
        const drop = new Set([id]);
        let grew = true;
        while (grew) { grew = false; for (const f of S.files) if (drop.has(f.parent) && !drop.has(f.id)) { drop.add(f.id); grew = true; } }
        S.files = S.files.filter((f) => !drop.has(f.id)); if (!await save()) return; render(); break;
      }
      // Members, plugins, schedules
      case "invite-link": toast(security.inviteUnavailable); break;
      case "plugin": S.installed = S.installed.includes(id) ? S.installed.filter((x) => x !== id) : [...S.installed, id]; if (!await save()) return; render(); break;
      case "pcat": V.pluginCat = i; render(); break;
      case "new-schedule": openSchedule(); break;
      case "sched-pause": { const s = S.schedules.find((x) => x.id === id); if (s) s.paused = !s.paused; if (!await save()) return; render(); break; }
      case "sched-del": S.schedules = S.schedules.filter((x) => x.id !== id); if (!await save()) return; render(); break;
      // Workspace settings
      case "env-del": (environment[S.current] || []).splice(i, 1); render(); break;
      case "restart": toast(A.wsSettings.computer.notConnected); break;
      case "export": {
        const data = { workspace: isExample() ? { name: A.example.name } : ws(), chats: chats(), files: files().map(({ name, folder, size, modified, parent }) => ({ name, folder, size, modified, parent })), exported: new Date().toISOString() };
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
        a.download = (wsName() || "workspace").replace(/[^\w-]+/g, "-") + ".json";
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        break;
      }
      // User settings
      case "avatar": S.profile.avatar = i; if (!await save()) return; render(); break;
      case "avatar-shuffle": S.profile.avatar = (typeof S.profile.avatar === "number" ? S.profile.avatar + 1 + Math.floor(Math.random() * (AVATARS.length - 1)) : 0) % AVATARS.length; if (!await save()) return; render(); break;
      case "avatar-remove": S.profile.avatar = 0; if (!await save()) return; render(); break;
      case "avatar-upload": fileInput(false, "image/jpeg,image/png,image/webp,image/gif", ([f]) => {
        if (!f || f.size > 10 * 1048576) return;
        // Downscale so the avatar fits comfortably in preview storage.
        const img = new Image();
        img.onload = async () => { if (saving || ended) { URL.revokeObjectURL(img.src); return; } const c = document.createElement("canvas"); c.width = c.height = 128; const x = c.getContext("2d")!; const s = Math.min(img.width, img.height); x.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 128, 128); S.profile.avatar = c.toDataURL("image/jpeg", 0.85); URL.revokeObjectURL(img.src); if (!await save()) return; render(); };
        img.src = URL.createObjectURL(f);
      }); break;
      case "send-key": S.prefs.send = i; if (!await save()) return; render(); break;
      case "notif": S.notifs[i] = !S.notifs[i]; if (!await save()) return; el.setAttribute("aria-checked", String(S.notifs[i])); break;
      // API
      case "api-range": V.apiRange = i; render(); break;
      case "quick": V.quickTab = i; render(); break;
      case "new-key": openNewKey(); break;
      case "revoke": S.keys = S.keys.filter((k) => k.id !== id); if (!await save()) return; render(); break;
      // Billing
      case "mtab": V.marketTab = el.dataset.v; render(); break;
      case "default-chan": S.defaultChannel = id; if (!await save()) return; render(); break;
      case "budget-pause": S.budget.pause = !S.budget.pause; el.setAttribute("aria-checked", String(S.budget.pause)); break;
      case "subscribe": openSubscribe(i); break;
      case "sub-next": openSubscribe(i, 1); break;
      case "sub-back": openSubscribe(i, 0); break;
      case "sub-method": V.sub.method = el.dataset.v; dlgEl?.querySelectorAll("[data-act=sub-method]").forEach((b) => b.setAttribute("aria-checked", String(b === el))); break;
      case "sub-pay": toast(A.common.comingSoon); break;
      case "topup-amt": V.topup.amt = Number(el.dataset.v); V.topup.custom = ""; dlgEl!.querySelector<HTMLInputElement>("[name=custom]")!.value = ""; refreshTopup(); break;
      case "topup-method": V.topup.method = el.dataset.v; refreshTopup(); break;
      // Dialog internals
      case "region": dlgEl?.querySelectorAll("[data-act=region]").forEach((b) => b.setAttribute("aria-checked", String(b === el))); dlgEl!.querySelector<HTMLInputElement>("[name=region]")!.value = el.dataset.v!; break;
      case "ob-opt": {
        const q = A.onboard.questions[ob.step];
        const cur = S.answers[ob.step] || [];
        S.answers[ob.step] = q.multi ? (cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i]) : [i];
        dlgEl!.querySelector(".dlg")!.innerHTML = onboardHtml();
        dlgEl!.querySelector<HTMLElement>(`[data-act=ob-opt][data-i="${i}"]`)?.focus();
        break;
      }
      case "ob-next": if (ob.step < A.onboard.questions.length - 1) { ob.step++; dlgEl!.querySelector(".dlg")!.innerHTML = onboardHtml(); } else finishOnboard(); break;
      case "ob-back": ob.step = Math.max(0, ob.step - 1); dlgEl!.querySelector(".dlg")!.innerHTML = onboardHtml(); break;
      case "ob-skip": finishOnboard(); break;
      case "pal-run": { const it = pal.list[i]; closeDlg(); it?.run(); break; }
    }
  });

  root.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (saving || ended) return;
    const form = e.target as HTMLFormElement;
    const kind = form.dataset.form;
    if (!kind) return;
    e.preventDefault();
    const fd = new FormData(form);
    const val = (k: string) => String(fd.get(k) ?? "").trim();
    switch (kind) {
      case "send": sendMessage(form); break;
      case "new-ws": {
        const name = val("name");
        if (!name) { form.querySelector("[data-err]")?.removeAttribute("hidden"); form.querySelector<HTMLInputElement>("[name=name]")!.focus(); return; }
        const w: Ws = { id: uid(), name, region: val("region"), tz: val("tz"), created: Date.now() };
        S.workspaces.push(w);
        S.current = w.id;
        V.folder = "";
        if (!await save()) return;
        closeDlg();
        go("new");
        break;
      }
      case "rename": { const w = ws(); if (w && val("name")) { w.name = val("name"); if (!await save()) return; render(); toast(A.common.save + " ✓"); } break; }
      case "env": { if (!ws() || isExample()) return; (environment[S.current] ||= []).push([val("k").toUpperCase(), form.querySelector<HTMLInputElement>("[data-env-value]")!.value.trim()]); form.reset(); render(); toast(security.envSaved); break; }
      case "del-ws": {
        if (val("name") !== wsName()) { form.querySelector("input")!.focus(); return; }
        const idv = S.current;
        S.workspaces = S.workspaces.filter((w) => w.id !== idv);
        S.chats = S.chats.filter((c) => c.ws !== idv);
        S.files = S.files.filter((f) => f.ws !== idv);
        S.schedules = S.schedules.filter((s) => s.ws !== idv);
        S.current = S.workspaces[0]?.id || "";
        if (!await save()) return;
        go("");
        break;
      }
      case "profile": S.profile.name = val("name"); if (!await save()) return; render(); toast(A.user.saved); break;
      case "budget": S.budget.limit = Math.max(0, Number(val("limit")) || 0); S.budget.alert = Number(val("alert")) || 80; if (!await save()) return; toast(A.billing.budgetSaved); break;
      case "prompt": { const v = val("v"); if (!v) return; await V.promptOk?.(v); break; }
      case "schedule": {
        S.schedules.push({ id: uid(), ws: S.current, name: val("name"), prompt: val("prompt"), agent: val("agent"), cadence: Number(val("cadence")), time: val("time"), paused: false });
        if (!await save()) return; closeDlg(); render(); break;
      }
      case "key": {
        const secret = "fl-" + Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) => b.toString(16).padStart(2, "0")).join("");
        S.keys.push({ id: uid(), name: val("name"), limit: Number(val("limit")) || 0, created: Date.now(), last4: secret.slice(-4) });
        if (!await save()) return;
        render();
        const P = A.api;
        openDlg(`${xBtn()}<h2>${esc(P.create)}</h2><div class="body"><p class="note">${esc(P.created)}</p><div class="codebox"><pre class="code">${esc(secret)}</pre><button class="btn sm" data-act="copy" data-text="${esc(secret)}" data-msg="${esc(P.copied)}">${ic("copy", 13)}${esc(P.copy)}</button></div><p class="hint">${esc(P.preview)}</p><div class="foot" style="margin:0"><button class="btn pri" data-act="close">${esc(P.done)}</button></div></div>`);
        break;
      }
      case "topup": {
        const amt = topupAmount();
        const code = val("code");
        const q = new URLSearchParams({ mode: "credits", amount: String(amt), method: V.topup.method });
        if (code) q.set("code", code);
        location.href = `${D.links.checkout}?${q}`;
        break;
      }
    }
  });

  root.addEventListener("input", (e) => {
    if (saving || ended) return;
    const t = e.target as HTMLInputElement;
    const k = t.dataset.input;
    if (t.id === "fx-input" && !root.querySelector("[data-form=send][data-chat]")) V.draft = t.value;
    if (t.name === "custom" && V.topup && dlgEl?.contains(t)) { V.topup.custom = t.value; refreshTopup(); return; }
    if (!k) return;
    if (k === "pluginQ" || k === "marketQ") {
      V[k] = t.value;
      const pos = t.selectionStart;
      render();
      const n = root.querySelector<HTMLInputElement>(`[data-input=${k}]`);
      n?.focus();
      if (n && pos !== null) n.setSelectionRange(pos, pos);
    } else if (k === "modelQ" && popEl) {
      const box = popEl.querySelector("[data-mlist]");
      const tmp = document.createElement("div");
      tmp.innerHTML = modelMenu(V.menuAgent, t.value);
      if (box) box.innerHTML = tmp.querySelector("[data-mlist]")!.innerHTML;
    } else if (k === "pal") {
      pal.q = t.value;
      pal.i = 0;
      refreshPal();
    }
  });
  root.addEventListener("change", async (e) => {
    if (saving || ended) return;
    const t = e.target as HTMLSelectElement;
    if (t.dataset.input === "prefAgent") { S.prefs.agent = t.value; V.agent = t.value; if (!await save()) return; }
    if (t.dataset.input === "defaultChannel") { S.defaultChannel = t.value; if (!await save()) return; }
  });

  // Drag and drop files onto the Files view.
  root.addEventListener("dragover", (e) => {
    const z = (e.target as HTMLElement).closest("[data-drop]");
    if (!z || isExample()) return;
    e.preventDefault();
    z.classList.add("drop");
  });
  root.addEventListener("dragleave", (e) => (e.target as HTMLElement).closest("[data-drop]")?.classList.remove("drop"));
  root.addEventListener("drop", (e) => {
    if (saving || ended) { e.preventDefault(); return; }
    const z = (e.target as HTMLElement).closest("[data-drop]");
    if (!z) return;
    e.preventDefault();
    z.classList.remove("drop");
    addFiles([...(e.dataTransfer?.files || [])]);
  });

  document.addEventListener("keydown", (e) => {
    if (saving || ended) { e.preventDefault(); return; }
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); dlgEl ? closeDlg() : openPalette(); return; }
    if (mod && e.shiftKey && e.key.toLowerCase() === "o") { e.preventDefault(); hasWs() ? go("new") : openNewWs(); return; }
    if (mod && e.key === "/") { e.preventDefault(); toggleSb(); return; }
    if (e.key === "Escape") {
      if (popEl) { closePop(); return; }
      if (dlgEl) { closeDlg(); return; }
      if (sbOpen()) closeSb();
      return;
    }
    // Palette navigation
    if (dlgEl?.querySelector("[data-pal]") && ["ArrowDown", "ArrowUp", "Enter"].includes(e.key)) {
      e.preventDefault();
      if (e.key === "Enter") { const it = pal.list[pal.i]; closeDlg(); it?.run(); return; }
      pal.i = (pal.i + (e.key === "ArrowDown" ? 1 : -1) + pal.list.length) % Math.max(1, pal.list.length);
      refreshPal();
      return;
    }
    // Send from the composer
    const t = e.target as HTMLElement;
    if (t.id === "fx-input" && e.key === "Enter" && !e.isComposing) {
      const withMod = S.prefs.send === 1;
      if ((withMod && mod) || (!withMod && !e.shiftKey && !mod)) {
        e.preventDefault();
        sendMessage(t.closest("form") as HTMLFormElement);
      }
    }
  });

  addEventListener("hashchange", () => { if (!saving && !ended) { closePop(); render(); } });
  addEventListener("resize", () => { closePop(); if (innerWidth > 860) closeSb(); });

  // Notifications update views; the transaction protects writes even without them.
  try {
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(PREVIEW_CHANNEL);
    if (channel) channel.onmessage = () => { void refresh(); };
  } catch { /* Browser policy can disable cross-tab notifications. */ }
  addEventListener("focus", () => { void refresh(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void refresh(); });
  addEventListener("pageshow", (event) => { if (event.persisted) location.reload(); });
  addEventListener("pagehide", () => { environment = Object.create(null); root.replaceChildren(); });

  // Website links may preselect a view: /app#/billing/credits etc.
  render();
  if (!S.onboarded) openOnboard();
  void refresh();
}
