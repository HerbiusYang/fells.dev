import { bindAppViewport } from "../lib/app-viewport";
// Client for /app. Renders every signed-in view from the JSON blob in AppPage.astro.
// Business state is read from the same-origin API; transient drafts stay in memory.
import { freshState, MAX_MESSAGE, type Ws, type Chat } from "../lib/preview-state";
import { readApp, readAppStartup, commitApp, endApp, getAppBootstrap, getAppKeys, getAppWorkspaceRole, getAppMessageMetadata, listAppMembers, listAppPendingInvitations, listAppReceivedInvitations, setAppMember, revokeAppInvitation, acceptAppInvitation, declineAppInvitation, leaveAppWorkspace, updateAppMemberRole, removeAppMember, importAppChat, generateAppChat, readAppChatRun, type AppChatRun, type AppChatResult } from "../lib/app-service";
import { removeLegacyStorage, StaleState, EndedSession } from "../lib/preview-store";
import { accountApi, agreementText, passwordIsValid, announceSessionChange, setExpectedUser, usageTokens, compactTokenCount } from "../lib/account-api";
import { APIError, operationKey } from "../lib/app-http";
import { isBusinessBlocked, subscribeMaintenance } from "../lib/maintenance";
import { businessRulesOf } from "../i18n/business-rules";
import { tokenPlanWordsOf } from "../i18n/token-plan";
import { marketWordsOf } from "../i18n/market";
import { monthlySoldOut, subscriptionWords, offeredModel } from "../lib/subscription-info";
import { ledgerKind } from "../i18n/wallet-ledger";
import { manualSalesWords } from "../i18n/manual-sales";
import { parsePurchaseOperation, purchaseOperationStatus, type PurchaseOperation } from "../lib/purchase-recovery";
import { currencyFlowCopy } from "../i18n/currency-flow";
import { parseCashMicro, microText } from "../lib/currency-flow";
import { parseChatModels, conversationKey, modelFormat, type ChatModel, type ChatModelCatalog } from "../lib/model-chat";
import { claudeSettings, claudeInstall, claudeSettingsPath, type ClaudePlatform } from "../lib/claude-setup";
import { claudeSetupWordsOf } from "../i18n/claude-setup";
import { parseExchangeHistory, type ExchangeHistory } from "../lib/exchange-history";
import { exchangeHistoryWordsOf } from "../i18n/exchange-history";
import { chatFundingWordsOf } from "../i18n/chat-funding";
import { accountFunding } from "../lib/account-funding";
import { inspectRequestTokens, inspectRequestLatency } from "../lib/request-inspection";
import { requestInspectionWordsOf } from "../i18n/request-inspection";
import { renderChatMarkdown } from "../lib/chat-markdown";
import { chatProgressWords, chatElapsed, chatRunElapsed } from "../i18n/chat-progress";
import { chatSearchWords } from "../i18n/chat-search";
import { chatAttachmentWords } from "../i18n/chat-attachments";
import { createChatAttachments, messageAttachments } from "./chat-attachments";
import { containDialogFocus } from "../lib/dialog-focus";
import { workBuddyGuideBody } from "../lib/workbuddy-guide";
import { workBuddyWordsOf } from "../i18n/workbuddy-guide";
import { keyUXWords } from "../i18n/key-ux";
import { authUXWords } from "../i18n/auth-ux";
import { accountUXWords } from "../i18n/account-ux";
import { retainChatDraft, readChatDraft, clearChatDraft } from "../lib/chat-draft";
/* eslint-disable @typescript-eslint/no-explicit-any */

const root = document.getElementById("fx");
const blob = document.getElementById("fx-data");
if (root && blob) {
  bindAppViewport(root);
  const data = JSON.parse(blob.textContent || "{}");
  if (window.self !== window.top) { root.textContent = data.security.frameBlocked; root.removeAttribute("aria-busy"); }
  else {
    let started = false, starting = false;
    const initialize = () => {
      if (started || starting || isBusinessBlocked()) return;
      starting = true;
      void start(root, data).then(() => { started = true; }).catch((error) => {
        // The layout's skip link targets #fx-main, so the error state is a <main> too.
        const main = document.createElement("main");
        main.id = "fx-main";
        main.className = "main boot-failure";
        const content = document.createElement("div");
        content.className = "boot-content";
        const heading = document.createElement("h1");
        heading.textContent = data.startup.error;
        const message = document.createElement("p");
        message.setAttribute("role", "alert");
        message.textContent = error instanceof APIError && error.code === "account_read_timeout" ? data.startup.timeout : error instanceof Error ? error.message : "Unable to connect to the service";
        const reload = document.createElement("button");
        reload.type = "button";
        reload.className = "btn pri";
        reload.textContent = data.startup.reload;
        reload.addEventListener("click", () => location.reload());
        const link = document.createElement("a");
        link.href = data.links.start;
        link.textContent = data.startup.entry;
        content.append(heading, message, reload, link);
        main.append(content);
        root.replaceChildren(main);
        root.removeAttribute("aria-busy");
      }).finally(() => { starting = false; });
    };
    const unsubscribe = subscribeMaintenance(() => { if (!isBusinessBlocked()) initialize(); });
    addEventListener("pagehide", () => unsubscribe(), { once: true });
    initialize();
  }
}

async function start(root: HTMLElement, D: any) {
  const A = D.a;
  const security = D.security;
  const zh = D.lang.startsWith("zh");
  const billingRules = businessRulesOf(D.lang);
  const planWords = tokenPlanWordsOf(D.lang);
  const marketWords = marketWordsOf(D.lang);
  const fx = currencyFlowCopy(D.lang);
  const claudeWords = claudeSetupWordsOf(D.lang);
  const historyWords = exchangeHistoryWordsOf(D.lang);
  const chatFunding = chatFundingWordsOf(D.lang);
  const progressWords = chatProgressWords(D.lang);
  const searchWords = chatSearchWords(D.lang);
  const attachmentWords = chatAttachmentWords(D.lang);
  const workBuddyWords = workBuddyWordsOf(D.lang);
  const keyWords = keyUXWords(D.lang);
  const markdownCache = new Map<string, string>();
  const feedbackWords: Record<string, { copySelected: string; copyManual: string; accountRefresh: string; accountConflict: string; accountReloaded: string; cliTitle: string; cliGuide: string }> = {
    "zh-CN": { copySelected: "复制失败，文本已选中，请手动复制。", copyManual: "无法自动复制，请选中文本后手动复制。", accountRefresh: "账户信息刷新失败，请稍后重试。", accountConflict: "账户信息已变化，请刷新页面并核对后再操作。", accountReloaded: "已载入最新账户信息，请核对后再继续。", cliTitle: "在线对话尚未启用", cliGuide: "配置 Claude Code" },
    "zh-TW": { copySelected: "複製失敗，文字已選取，請手動複製。", copyManual: "無法自動複製，請選取文字後手動複製。", accountRefresh: "帳戶資訊重新整理失敗，請稍後再試。", accountConflict: "帳戶資訊已變更，請重新整理頁面並核對後再操作。", accountReloaded: "已載入最新帳戶資訊，請核對後再繼續。", cliTitle: "線上對話尚未啟用", cliGuide: "設定 Claude Code" },
    ja: { copySelected: "コピーに失敗しました。選択したテキストを手動でコピーしてください。", copyManual: "自動コピーできません。テキストを選択して手動でコピーしてください。", accountRefresh: "アカウント情報を更新できませんでした。もう一度お試しください。", accountConflict: "アカウント情報が変更されました。ページを更新して内容を確認してください。", accountReloaded: "最新のアカウント情報を読み込みました。確認してから続けてください。", cliTitle: "ブラウザーでの会話は未有効です", cliGuide: "Claude Code を設定" },
    ko: { copySelected: "복사하지 못했습니다. 선택된 텍스트를 직접 복사해 주세요.", copyManual: "자동 복사를 사용할 수 없습니다. 텍스트를 선택하여 직접 복사해 주세요.", accountRefresh: "계정 정보를 새로 고치지 못했습니다. 다시 시도해 주세요.", accountConflict: "계정 정보가 변경되었습니다. 페이지를 새로 고친 뒤 확인하세요.", accountReloaded: "최신 계정 정보를 불러왔습니다. 확인 후 계속하세요.", cliTitle: "브라우저 대화가 활성화되지 않았습니다", cliGuide: "Claude Code 설정" },
    es: { copySelected: "No se pudo copiar. Copia manualmente el texto seleccionado.", copyManual: "La copia automática no está disponible. Selecciona el texto y cópialo manualmente.", accountRefresh: "No se pudo actualizar la cuenta. Inténtalo de nuevo.", accountConflict: "La información de la cuenta cambió. Actualiza la página y revisa los valores antes de continuar.", accountReloaded: "Se cargó la información más reciente de la cuenta. Revísala antes de continuar.", cliTitle: "Las conversaciones web no están habilitadas", cliGuide: "Configurar Claude Code" },
    en: { copySelected: "Copy failed. Copy the selected text manually.", copyManual: "Automatic copying is unavailable. Select the text and copy it manually.", accountRefresh: "Account information could not be refreshed. Try again.", accountConflict: "Account information changed. Refresh the page and review the latest values before continuing.", accountReloaded: "The latest account information has been loaded. Review it before continuing.", cliTitle: "Browser conversations are not enabled", cliGuide: "Set up Claude Code" },
  };
  const feedback = feedbackWords[D.lang] ?? feedbackWords.en;
  const accountFailure = (error: unknown, fallback = security.saveFailed) => error instanceof StaleState ? feedback.accountConflict : error instanceof Error ? error.message : fallback;
  const usageRefreshLabels: Record<string, string> = { "zh-CN": "刷新用量", "zh-TW": "重新整理用量", ja: "使用量を更新", ko: "사용량 새로 고침", es: "Actualizar consumo", en: "Refresh usage" };
  const usageRefreshLabel = usageRefreshLabels[D.lang] ?? usageRefreshLabels.en;
  const contactPurchase = fx.fund;
  const requestSupport = (intent: Record<string, unknown> = {}) => document.dispatchEvent(new CustomEvent("fells:support-open", { detail: intent }));
  const keyLimitRule: Record<string, string> = { "zh-CN": "按该 Key 的美元 API 额度消耗计量；0 表示跟随默认限额。", "zh-TW": "按此 Key 的美元 API 額度消耗計量；0 表示使用預設上限。", ja: "このキーの USD API 利用枠で計測します。0 は既定上限を使用します。", ko: "이 키의 USD API 이용 한도로 계산합니다. 0은 기본 한도를 따릅니다.", es: "Se mide por el saldo API en USD de esta clave; 0 usa el límite predeterminado.", en: "Measured by this key’s USD API allowance consumption; 0 follows the default limit." };
  const keyDefaultLabel: Record<string, string> = { "zh-CN": "跟随默认限额", "zh-TW": "使用預設上限", ja: "既定上限", ko: "기본 한도", es: "Límite predeterminado", en: "Default limit" };
  const keyUnlimitedLabel: Record<string, string> = { "zh-CN": "不限额（运营设置）", "zh-TW": "不限額（營運設定）", ja: "上限なし（運営設定）", ko: "무제한 (운영자 설정)", es: "Sin límite (configurado por operaciones)", en: "Unlimited (set by operations)" };
  const keyUnlimitedHint: Record<string, string> = { "zh-CN": "留空可保留当前不限额设置；填写0改为默认限额，填写正数设置自己的上限。", "zh-TW": "留空可保留目前不限額設定；填寫0改為預設上限，填寫正數設定自己的上限。", ja: "空欄で現在の上限なし設定を維持します。0は既定上限、正の数は独自の上限に変更します。", ko: "비워 두면 현재 무제한 설정을 유지합니다. 0은 기본 한도, 양수는 직접 설정한 한도로 변경합니다.", es: "Déjalo vacío para conservar la configuración sin límite. Usa 0 para el límite predeterminado o un valor positivo para fijar tu límite.", en: "Leave blank to keep the current unlimited setting. Enter 0 for the default limit or a positive value for your own cap." };
  const words = {
    ...accountUXWords(D.lang),
    allowanceTerms: billingRules.expiry,
    manualBillingMode: billingRules.modes,
    contactPurchase,
    pendingTopup: contactPurchase,
    addMember: A.members.invite,
  };
  A.account.credits = words.allowance;
  A.billing.sub = billingRules.funding;

  // ---------- helpers ----------
  const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  const fmt = (s: string, vars: Record<string, unknown> = {}) => String(s).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  const uid = () => crypto.randomUUID();
  const money = (n: number) => "$" + (Math.round(n * 100) / 100).toFixed(n % 1 ? 2 : 0);
  const money2 = (n: number) => "$" + n.toFixed(2);
  const dfmt = (d: number | Date, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }) => new Intl.DateTimeFormat(D.lang, opts).format(new Date(d));
  const tfmt = (d: number) => new Intl.DateTimeFormat(D.lang, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(d));
  const agentById = (id: string) => D.agents.find((a: any) => a.id === id) ?? D.agents[0];
  const memberName = (name: string) => { const match = /^Member #(\d+)$/.exec(name); return match ? fmt(A.members.anonymous, { id: match[1] }) : name; };
  const retryWait = (seconds: number) => new Intl.NumberFormat(D.lang, { style: "unit", unit: seconds >= 120 ? "minute" : "second", unitDisplay: "long" }).format(seconds >= 120 ? Math.ceil(seconds / 60) : seconds);
  const initials = (name: string) => (name.trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2) || "?").toUpperCase();
  const M = D.marks;
  const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const mk = (m: any, size = 18, cls = "") => (m ? `<span class="aimk ${cls}" style="--hue:${m.hue};--mk:${size}px" aria-hidden="true">${m.svg}</span>` : "");
  const agentMk = (id: string, size = 18, cls = "") => mk(M.agents[id], size, cls);

  const ICONS: Record<string, string> = {
    layers: "m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5",
    box: "m12 3 9 5v8l-9 5-9-5V8l9-5ZM3 8l9 5 9-5M12 13v8",
    info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 11v6M12 7h.01",
    plus: "M12 5v14M5 12h14",
    file: "M4 6.5A1.5 1.5 0 0 1 5.5 5H10l2 2h6.5A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z",
    users: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.5a3.5 3.5 0 0 1 0 6.5M21 20c0-2.6-1.6-4.8-4-5.6",
    plug: "M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4",
    more: "M5 12h.01M12 12h.01M19 12h.01",
    chev: "m6 9 6 6 6-6",
    chevR: "m9 6 6 6-6 6",
    chevL: "m15 6-6 6 6 6",
    gift: "M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7S10.5 3 8 3.5 7 7 12 7zM12 7s1.5-4 4-3.5S17 7 12 7z",
    bulb: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z",
    search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
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
    chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
    refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
    play: "M7 5v14l11-7z",
    pause: "M8 5v14M16 5v14",
    import: "M12 3v12M7 10l5 5 5-5M5 21h14",
    ext: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
    mail: "M3 6h18v12H3zM3 7l9 6 9-6",
    sidebar: "M4 4h16v16H4zM9 4v16",
  };
  const ic = (name: string, size = 18) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name] ?? ""}"/></svg>`;
  const AVATARS = [
    "linear-gradient(135deg,#d9b98a,#a97c50)", "linear-gradient(135deg,#f6a07a,#c4553b)", "linear-gradient(135deg,#9db4ff,#5865f2)", "linear-gradient(135deg,#86d6ad,#2d8a63)",
    "linear-gradient(135deg,#f5c76b,#d0892c)", "linear-gradient(135deg,#c9a6ff,#7c4dd8)", "linear-gradient(135deg,#7fd3e6,#2f7fa8)", "linear-gradient(135deg,#ef9fbc,#bf4a77)",
  ];

  // ---------- state ----------
  try { removeLegacyStorage(); } catch { /* Storage is optional; the server owns business data. */ }
  let committed = await readAppStartup();
  if (!committed) { location.replace(`${D.links.start}?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`); return; }
  let S = structuredClone(committed.state);
  let accountSnapshot = JSON.stringify(getAppBootstrap());
  let marketComposing = false;
  const bindIdentity = () => { const b = getAppBootstrap(); if (b) setExpectedUser({ userId: b.user.id, sessionId: b.session_id }); };
  bindIdentity();
  const fxIdentity = getAppBootstrap()!;
  let recoveredDraft = readChatDraft(fxIdentity.user.id);
  const editingForm = () => document.activeElement instanceof HTMLElement && root.contains(document.activeElement) && (!!document.activeElement.closest('[data-form]') || (marketComposing && document.activeElement.dataset.input === "marketQ"));
  // Never serialize these values, including on theme/profile saves.
  let saving = false;
  let refreshPending = false;
  let ended = false;
  let attachments: ReturnType<typeof createChatAttachments> | null = null;
  let generation = 0;
  const clearView = (preserveDraft = true) => {
    if (ended) return; // One navigation: a local logout also announces itself.
    const draft = root.querySelector<HTMLTextAreaElement>('[data-form=send] #fx-input');
    if (preserveDraft && draft) retainChatDraft(fxIdentity.user.id, location.hash, S.current, draft.value);
    else if (!preserveDraft) clearChatDraft();
    ended = true;
    stopApiUsage();
    stopChatPolling();
    stopChatProgress();
    attachments?.dispose();
    markdownCache.clear();
    apiCatalogAbort?.abort();
    setExpectedUser(null);
    S = freshState();
    committed = null;
    for (const key of Object.keys(V)) delete V[key];
    closeDlg(); closePop();
    root.replaceChildren();
    location.replace(`${D.links.start}?session=changed&next=${encodeURIComponent(location.pathname + location.search + location.hash)}`);
  };
  const adopt = (next: NonNullable<typeof committed>) => {
    committed = next;
    S = structuredClone(next.state);
    accountSnapshot = JSON.stringify(getAppBootstrap());
    bindIdentity();
    const signature = apiKeySignature();
    if (V.apiKeySignature !== signature) {
      V.apiKeySignature = signature;
      V.apiKeysChanged = true;
      if (!saving) refreshApiKeys();
    }
    const cash = root.querySelector<HTMLElement>("[data-exchange-cash]");
    if (cash) cash.textContent = `CNY ${microText(getAppBootstrap()!.wallet.cash_micro)}`;
    return reconcileChatHistory();
  };
  const showLatest = (next: Awaited<ReturnType<typeof readApp>>) => {
    if (!next || next.session !== committed!.session) { clearView(); return; }
    if (next.revision > committed!.revision) {
      adopt(next); closeDlg(); closePop(); render();
      toast(feedback.accountReloaded);
    } else {
      const unchanged = next.revision === committed!.revision && accountSnapshot === JSON.stringify(getAppBootstrap());
      const historyRecovered = adopt(next);
      if ((!unchanged && !editingForm() || historyRecovered) && !dlgEl && !popEl) render();
    }
  };
  const refresh = async () => {
    if (ended || isBusinessBlocked()) return;
    if (saving) { refreshPending = true; return; }
    refreshPending = false;
    const before = generation;
    try {
      const next = await readApp();
      if (saving || ended || before !== generation) return;
      showLatest(next);
    } catch (error) {
      if (error instanceof EndedSession || (error instanceof APIError && error.status === 401)) { clearView(); return; }
      toast(accountFailure(error));
    }
  };
  const save = async (): Promise<boolean> => {
    if (saving || ended || isBusinessBlocked()) return false;
    saving = true; generation++;
    root.setAttribute("aria-busy", "true");
    try {
      adopt(await commitApp(committed!, S));
      return true;
    } catch (error) {
      S = structuredClone(committed!.state);
      if (error instanceof EndedSession) clearView();
      else if (error instanceof StaleState) {
        // Keep other mutations blocked until the conflict has been resolved.
        try { showLatest(await readApp()); }
        catch { toast(security.storageUnavailable); }
      } else {
        const message = error instanceof Error ? error.message : security.saveFailed;
        const draft = root.querySelector<HTMLTextAreaElement>("#fx-input")?.value;
        try {
          const next = await readApp();
          if (!next || next.session !== committed?.session) { clearView(); return false; }
          adopt(next); render();
          const input = root.querySelector<HTMLTextAreaElement>("#fx-input");
          if (input && draft) input.value = draft;
        } catch { /* Keep the known snapshot until a later reload succeeds. */ }
        toast(message);
      }
      return false;
    } finally {
      saving = false;
      root.removeAttribute("aria-busy");
      if (refreshPending) void refresh();
    }
  };
  const displayName = () => S.profile.name || getAppBootstrap()?.user.username || (S.email ? S.email.split("@")[0] : A.common.you);
  const avatarStyle = () => (typeof S.profile.avatar === "string" ? `--av:url(${JSON.stringify(S.profile.avatar)})` : `--av:${AVATARS[S.profile.avatar % AVATARS.length]}`);
  const avatar = (cls = "") => `<span class="av ${cls}" style='${esc(avatarStyle())}'>${typeof S.profile.avatar === "string" ? "" : esc(initials(displayName()))}</span>`;
  const funding = () => accountFunding(getAppBootstrap()?.api_allowance.balance);
  // Sidebar USD excludes Token Plan capacity and includes compensation, using
  // the server's spendable snapshot when available. Explicit zero stays zero.
  const balance = () => funding().nonPlan / 1_000_000;
  const balanceLabel = () => funding().explicit ? chatFunding.availableAllowance : A.account.credits;
  const occupiedFunding = () => {
    const funds = funding();
    return funds.reserved || funds.pending ? `<p class="wallet-summary-caption" data-funding-reserved>${esc(chatFunding.reserved)} · ${money2(funds.reserved / 1_000_000)}</p><p class="wallet-summary-caption" data-funding-pending>${esc(chatFunding.pending)} · ${money2(funds.pending / 1_000_000)}</p>` : "";
  };
  const cashBalance = () => (getAppBootstrap()?.wallet.cash_micro ?? 0) / 1_000_000;
  const cny = (n: number) => (n < 0 ? "-¥" : "¥") + Math.abs(n).toFixed(2);
  const bonusExpiry = () => (getAppBootstrap()?.api_allowance.balance.expires_at ?? 0) * 1000;
  const usageSince = (range: number) => range === 2
    ? Math.floor(new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime() / 1000)
    : Math.floor(Date.now() / 1000) - [7, 30][range] * 86400;

  // Recommended agent from onboarding answer 2 (which agents do you use).
  const pickedAgent = () => {
    const map = ["codex", "claude", "grok", "opencode", "kimi"];
    const a = (S.answers[1] || []).find((i) => i < map.length);
    return a === undefined ? "" : map[a];
  };
  const defaultAgent = () => S.prefs.agent || pickedAgent() || "codex";

  // ---------- view state (not persisted) ----------
  const apiKeySignature = () => JSON.stringify(getAppKeys().map(key => [key.id, key.kind, key.revoked, key.expires_at, key.monthly_allow_limit_micro, conversationKey(key)]));
  const V: any = {
    agent: defaultAgent(),
    model: {} as Record<string, string>,
    effort: 1,
    draft: "",
    marketTab: "all",
    marketQ: "",
    apiRange: 0,
    moreOpen: false,
    quickTab: 0,
    quickChosen: false,
    apiKey: 0, nextApiKey: 0, apiKeySignature: apiKeySignature(), apiKeysChanged: false, catalogEpoch: 0,
    walletTab: "plans", history: null as ExchangeHistory | null, historyRange: 30, historyLoadedRange: 0, historyLoading: false, historyError: "", historyRequest: 0,
    logsRange: 0, logsLoading: false, logsError: "", logsRequest: 0, logsHasMore: false,
    claudePlatform: (/Win/.test(navigator.platform || navigator.userAgent) ? "windows" : MAC ? "macos" : "linux") as ClaudePlatform,
    claudeModel: "",
    usage: null, logs: null, catalog: null, subscriptions: null, tokenPlans: null, ledger: null, unconfirmed: null, ledgerPage: 1,
    members: [], membersWorkspace: "", invitations: null, pendingInvitations: null, pendingWorkspace: "", dataError: "", dataLoading: false,
    apiCatalog: null, catalogStatus: "loading", catalogError: "", catalogKeyLoaded: -1, catalogLoading: false, chatCatalog: null as ChatModelCatalog | null, chatCatalogStatus: "loading", chatCatalogError: "", chatCatalogLoading: false, webSearch: false,
  };
  const modelChatEnabled = () => getAppBootstrap()?.capabilities.model_chat === true;
  let apiUsageTimer: ReturnType<typeof setTimeout> | null = null;
  let apiUsageAbort: AbortController | null = null;
  let apiUsageRequest = 0, apiUsageActive = false, apiUsagePageGone = false;
  const apiUsageVisible = () => !ended && !apiUsagePageGone && !!committed && !document.hidden && route().name === "api";
  const patchApiUsage = () => {
    const metrics = root.querySelector<HTMLElement>("[data-api-usage-metrics]");
    if (metrics) metrics.innerHTML = apiUsageMetrics();
    const button = root.querySelector<HTMLButtonElement>('[data-act="api-usage-refresh"]');
    if (button) { button.disabled = saving || !!apiUsageAbort; button.setAttribute("aria-busy", String(!!apiUsageAbort)); }
  };
  const stopApiUsage = () => {
    if (apiUsageTimer !== null) clearTimeout(apiUsageTimer);
    apiUsageTimer = null; apiUsageActive = false; apiUsageRequest++;
    apiUsageAbort?.abort(); apiUsageAbort = null;
  };
  const scheduleApiUsage = () => {
    if (apiUsageTimer !== null) clearTimeout(apiUsageTimer);
    apiUsageTimer = null;
    if (apiUsageVisible()) apiUsageTimer = setTimeout(() => { apiUsageTimer = null; void loadApiUsage(); }, 10_000);
  };
  const loadApiUsage = async (manual = false) => {
    if (!apiUsageVisible() || apiUsageAbort) return;
    if (saving) { scheduleApiUsage(); return; }
    const identity = committed!.session, range = V.apiRange, request = ++apiUsageRequest;
    const controller = new AbortController(); apiUsageAbort = controller;
    const deadline = setTimeout(() => controller.abort(), 15_000);
    patchApiUsage();
    try {
      const result = await accountApi.usage({ since: usageSince(range) }, controller.signal);
      if (!apiUsageVisible() || committed?.session !== identity || V.apiRange !== range || apiUsageRequest !== request) return;
      if (!result || !Array.isArray(result.usage) || result.usage.some(row => !row || typeof row !== "object" || Array.isArray(row))) throw new Error("Invalid usage response");
      const fields = ["requests", "tokens_in", "tokens_out", "tokens_cache_r", "tokens_cache_w", "allow_micro", "list_micro"];
      const totals: Record<string, number> = Object.fromEntries(fields.map(field => [field, 0]));
      for (const row of result.usage) for (const field of fields) {
        const value = row[field];
        if (value === undefined) continue; // Omitted optional counters mean zero.
        const count = typeof value === "number" || typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
        if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(totals[field] + count)) throw new Error("Invalid usage counter");
        totals[field] += count;
      }
      if (!Number.isSafeInteger(result.usage.reduce((total, row) => total + usageTokens(row), 0))) throw new Error("Invalid token total");
      V.usage = result;
      // Update only the four metrics. Controls, code, dialogs and focused drafts
      // retain their actual DOM nodes during background refreshes.
      patchApiUsage();
    } catch (error) {
      if (controller.signal.aborted || apiUsageRequest !== request || !apiUsageVisible() || committed?.session !== identity) return;
      if (error instanceof APIError && error.status === 401) { clearView(); return; }
      if (manual) toast(feedback.accountRefresh);
      // Keep the last successful values during transient background failures.
    } finally {
      clearTimeout(deadline);
      if (apiUsageAbort === controller) {
        apiUsageAbort = null;
        if (!ended) patchApiUsage();
        scheduleApiUsage();
      }
    }
  };
  const syncApiUsage = () => {
    if (!apiUsageVisible()) { stopApiUsage(); return; }
    if (!apiUsageActive) { apiUsageActive = true; void loadApiUsage(); }
    else if (apiUsageTimer === null && !apiUsageAbort) scheduleApiUsage();
  };
  type LocalChatRun = AppChatRun & { chat_id: string; server_unknown?: boolean; history_pending?: boolean; started_at?: number; web_search?: boolean; attachment_ids?: string[]; refusal?: AppChatResult["refusal"] };
  const runStorageKey = `fells.chat-run.v1:${fxIdentity.user.id}:${fxIdentity.session_id}`;
  const chatRuns = new Map<string, LocalChatRun>();
  const chatRequests = new Set<string>();
  const chatChecks = new Set<string>();
  // Only fresh, identity-checked server receipts establish completion. A stored
  // marker may block sending after reload, but cannot prove a reply exists.
  const completedChatReceipts = new Map<string, AppChatRun>();
  const verifiedChatRunIDs = new Map<string, { request_id: string; id: string }>();
  const chatDrafts = new Map<string, string>();
  const chatSubmissions = new Map<string, { body: string; after: number }>();
  const submissionRecorded = (chatID: string, chat = S.chats.find(value => value.id === chatID)) => {
    const submission = chatSubmissions.get(chatID), message = submission && chat?.messages[submission.after];
    return !!submission && message?.[0] === "you" && message[1] === submission.body;
  };
  const chatPollAttempts = new Map<string, number>();
  const chatHistoryAttempts = new Map<string, number>();
  const chatRunSettled = (run: LocalChatRun) => run.status === "failed" || run.status === "completed" && !run.history_pending;
  const canPollChat = (run: LocalChatRun) => !run.server_unknown && (run.history_pending ? (chatHistoryAttempts.get(run.request_id) ?? 0) < 3 : (chatPollAttempts.get(run.request_id) ?? 0) < (run.status === "unknown" ? 3 : 110));
  let chatPollTimer: ReturnType<typeof setTimeout> | null = null;
  let chatProgressTimer: ReturnType<typeof setInterval> | null = null;
  const stopChatProgress = () => { if (chatProgressTimer !== null) clearInterval(chatProgressTimer); chatProgressTimer = null; };
  const patchChatElapsed = () => {
    root.querySelectorAll<HTMLElement>("[data-chat-elapsed]").forEach(element => {
      element.textContent = `${progressWords.elapsed} ${chatElapsed(Number(element.dataset.startedAt))}`;
    });
  };
  const syncChatProgress = () => {
    stopChatProgress();
    patchChatElapsed();
    if (!ended && !document.hidden && root.querySelector("[data-chat-elapsed]")) chatProgressTimer = setInterval(patchChatElapsed, 1000);
  };
  const stopChatPolling = () => { if (chatPollTimer !== null) clearTimeout(chatPollTimer); chatPollTimer = null; };
  const syncChatPolling = () => {
    const view = route(), run = chatRuns.get(view.arg);
    if (ended || document.hidden || isBusinessBlocked() || view.name !== "chat" || !run || chatRunSettled(run) || !canPollChat(run)) { stopChatPolling(); return; }
    if (chatRequests.has(view.arg) || chatChecks.has(view.arg) || chatPollTimer !== null) return;
    const delays = run.history_pending ? [2_000, 4_000, 10_000] : run.status === "unknown" ? [3_000, 10_000, 30_000] : [2_000, 4_000, 5_000];
    const attempts = run.history_pending ? chatHistoryAttempts : chatPollAttempts;
    chatPollTimer = setTimeout(() => { chatPollTimer = null; void checkChatRun(view.arg, true); }, delays[Math.min(attempts.get(run.request_id) ?? 0, delays.length - 1)]);
  };
  try {
    const stored = JSON.parse(sessionStorage.getItem(runStorageKey) ?? "[]");
    if (Array.isArray(stored) && stored.length <= 100) for (const run of stored) {
      if (run && typeof run === "object" && typeof run.chat_id === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(run.chat_id) && /^[0-9a-f-]{36}$/i.test(run.request_id) && (["pending", "running", "unknown"].includes(run.status) || run.status === "completed" && run.history_pending === true)) chatRuns.set(run.chat_id, run);
    }
  } catch { /* A fresh request still requires a readable marker before dispatch. */ }
  const persistChatRuns = () => {
    const value = JSON.stringify([...chatRuns.values()].filter(run => !chatRunSettled(run)));
    sessionStorage.setItem(runStorageKey, value);
    if (sessionStorage.getItem(runStorageKey) !== value) throw new Error(words.chatStorage);
  };
  function reconcileChatHistory() {
    let changed = false;
    for (const [chatID, run] of chatRuns) {
      const proof = completedChatReceipts.get(chatID);
      if (run.status !== "completed" || !run.history_pending || !proof?.id || proof.id !== run.id || proof.chat_id !== chatID || proof.request_id !== run.request_id || !proof.message_id || !proof.assistant_message_id || proof.message_id !== run.message_id || proof.assistant_message_id !== run.assistant_message_id) continue;
      const chat = S.chats.find(value => value.id === chatID), metadata = getAppMessageMetadata(chatID);
      const userIndex = metadata.findIndex(message => message.id === proof.message_id && !message.imported);
      const assistantIndex = metadata.findIndex(message => message.id === proof.assistant_message_id && !message.imported);
      if (!chat || userIndex < 0 || assistantIndex <= userIndex || chat.messages[userIndex]?.[0] !== "you" || chat.messages[assistantIndex]?.[0] !== "assistant") continue;
      chatRuns.set(chatID, { ...run, history_pending: false });
      chatSubmissions.delete(chatID);
      changed = true;
    }
    if (changed) try { persistChatRuns(); } catch { /* Reload will verify the retained marker by GET. */ }
    return changed;
  }
  let apiCatalogAbort: AbortController | null = null;
  const availableApiKeys = () => getAppKeys().filter(key => conversationKey(key));
  const selectedApiKey = () => availableApiKeys().find(key => key.id === V.apiKey) ?? availableApiKeys()[0];
  function refreshApiKeys() {
    V.apiKeysChanged = false;
    apiCatalogAbort?.abort();
    const keys = availableApiKeys();
    const next = keys.find(key => key.id === V.nextApiKey) ?? keys.find(key => key.id === V.apiKey) ?? keys[0];
    V.apiKey = next?.id ?? 0;
    if (next?.id === V.nextApiKey) V.nextApiKey = 0;
    V.catalogEpoch++; V.claudeModel = ""; V.quickChosen = false;
    V.apiCatalog = null; V.catalogKeyLoaded = -1; V.catalogError = "";
    V.catalogStatus = modelChatEnabled() && !next ? "no-key" : "loading";
    void loadApiCatalog();
  }
  const loadApiCatalog = async () => {
    if (ended || !committed || V.catalogLoading) return;
    const keyID = selectedApiKey()?.id ?? 0, epoch = V.catalogEpoch;
    if (modelChatEnabled() && !keyID) { V.apiCatalog = null; V.catalogStatus = "no-key"; if (!saving && !dlgEl && !popEl) render(); return; }
    const identity = committed.session;
    const controller = new AbortController(); apiCatalogAbort = controller;
    V.catalogLoading = true; V.catalogStatus = "loading"; V.catalogError = ""; V.apiCatalog = null;
    if (!saving && !dlgEl && !popEl) render();
    try {
      const catalog = await accountApi.catalog(keyID || undefined, controller.signal);
      if (ended || committed?.session !== identity || (selectedApiKey()?.id ?? 0) !== keyID || V.catalogEpoch !== epoch) return;
      if (!catalog || !Array.isArray(catalog.models) || catalog.models.some((model: any) => !model || typeof model.model !== "string" || !model.model)) throw new Error(words.modelError);
      V.apiCatalog = catalog; V.catalogStatus = "ready"; V.catalogKeyLoaded = keyID;
    } catch (error) {
      if (ended || committed?.session !== identity || (selectedApiKey()?.id ?? 0) !== keyID || V.catalogEpoch !== epoch) return;
      if (error instanceof APIError && error.status === 401) { clearView(); return; }
      V.apiCatalog = null; V.catalogStatus = "error"; V.catalogError = error instanceof Error ? error.message : words.modelError;
    } finally {
      if (apiCatalogAbort === controller) apiCatalogAbort = null;
      V.catalogLoading = false;
      if (!ended && ((selectedApiKey()?.id ?? 0) !== keyID || V.catalogEpoch !== epoch)) void loadApiCatalog();
      else if (!ended && !saving && !dlgEl && !popEl) render();
    }
  };
  const loadChatModels = async () => {
    if (!modelChatEnabled() || ended || !committed || V.chatCatalogLoading) return;
    const identity = committed.session;
    V.chatCatalogLoading = true; V.chatCatalogStatus = "loading"; V.chatCatalogError = "";
    if (!saving && !dlgEl && !popEl) render();
    try {
      const catalog = parseChatModels(await accountApi.chatModels());
      if (ended || committed?.session !== identity) return;
      V.chatCatalog = catalog; V.chatCatalogStatus = catalog.models.length ? "ready" : "empty";
      if (!catalog.web_search?.available) V.webSearch = false;
    } catch (error) {
      if (ended || committed?.session !== identity) return;
      if (error instanceof APIError && error.status === 401) { clearView(); return; }
      V.chatCatalog = null; V.chatCatalogStatus = "error"; V.chatCatalogError = error instanceof Error ? error.message : words.modelError;
    } finally {
      V.chatCatalogLoading = false;
      if (!ended && !saving && !dlgEl && !popEl) render();
    }
  };

  const accountAction = async <T>(run: () => Promise<T>): Promise<T | undefined> => {
    if (saving || ended || !committed) return;
    const identity = committed.session;
    let result: T | undefined;
    const dialogControls = Array.from(dlgEl?.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("button,input,select,textarea") ?? []).map(control => ({ control, disabled: control.disabled }));
    dialogControls.forEach(({ control }) => { control.disabled = true; });
    saving = true; generation++;
    root.setAttribute("aria-busy", "true");
    try {
      result = await run();
      const next = await readApp();
      if (!next || next.session !== identity) { clearView(); return; }
      adopt(next);
      render();
      return result;
    } catch (error) {
      if (error instanceof EndedSession || (error instanceof APIError && error.status === 401)) clearView();
      else {
        const message = accountFailure(error);
        try { const next = await readApp(); if (!next || next.session !== identity) { clearView(); return; } adopt(next); render(); } catch { /* One-time issuance secrets still need to be exposed below. */ }
        toast(message);
      }
      // A completed key issuance must still expose its one-time secret when a
      // later refresh fails. A replaced/ended identity discards it instead.
      if (!ended && committed?.session === identity && getAppBootstrap()?.session_id === identity) return result;
      return;
    } finally {
      saving = false; root.removeAttribute("aria-busy");
      dialogControls.forEach(({ control, disabled }) => { if (control.isConnected) control.disabled = disabled; });
      if (!ended && V.apiKeysChanged) refreshApiKeys();
      if (!ended) render();
      if (refreshPending) void refresh();
    }
  };
  const loadExchangeHistory = async (force = false) => {
    if (ended || !committed || route().name !== "billing" || route().arg !== "credits"
      || !force && (V.historyLoading || V.historyLoadedRange === V.historyRange)) return;
    const identity = committed.session, range = V.historyRange, request = ++V.historyRequest;
    V.historyLoading = true; V.historyError = ""; V.history = null;
    if (!saving && !dlgEl && !popEl) render();
    try {
      const history = parseExchangeHistory(await accountApi.exchangeRates(range), range);
      if (ended || committed?.session !== identity || V.historyRequest !== request || V.historyRange !== range) return;
      V.history = history;
    } catch (failure) {
      if (ended || committed?.session !== identity || V.historyRequest !== request) return;
      if (failure instanceof APIError && failure.status === 401) { clearView(); return; }
      V.historyError = historyWords.error;
    } finally {
      if (!ended && V.historyRequest === request) {
        V.historyLoading = false; V.historyLoadedRange = range;
        if (!saving && !dlgEl && !popEl) render();
      }
    }
  };
  const loadAccountViews = async () => {
    if (ended || !committed) return;
    if (V.dataLoading) { V.dataReload = true; return; }
    const identity = committed.session, epoch = generation, range = V.apiRange, workspaceID = S.current;
    const current = () => !ended && committed?.session === identity && generation === epoch && V.apiRange === range && S.current === workspaceID;
    V.dataLoading = true; V.dataError = "";
    if (!V.apiCatalog || V.catalogKeyLoaded !== (selectedApiKey()?.id ?? 0)) void loadApiCatalog();
    const tasks = [accountApi.catalog(), accountApi.subscriptions(), accountApi.tokenPlans(), accountApi.walletLedger(V.ledgerPage), accountApi.coupons(), accountApi.invoices(), accountApi.unconfirmedPurchases()];
    const members = S.current && S.current !== "example" ? listAppMembers(S.current) : Promise.resolve([]);
    const invitations = listAppReceivedInvitations();
    const pending = S.current && S.current !== "example" && getAppWorkspaceRole(S.current) === "owner"
      ? listAppPendingInvitations(S.current) : Promise.resolve([]);
    const names = ["catalog", "subscriptions", "tokenPlans", "ledger", "coupons", "invoices", "unconfirmed", "members", "invitations", "pendingInvitations"];
    // Publish independent reads when they finish. A slow invoice response must
    // not hide a model catalog or a plan that is already available.
    const publish = (name: string, result: PromiseSettledResult<any>) => {
      if (!current()) return;
      if (name === "catalog" && result.status === "fulfilled" && (!result.value || !Array.isArray(result.value.models) || result.value.models.some((model: any) => !model || typeof model.model !== "string" || !model.model))) {
        V.catalog = null; V.dataError ||= words.modelError;
      } else if (result.status === "fulfilled") V[name] = result.value;
      else { V[name] = null; V.dataError ||= accountFailure(result.reason); }
      if (name === "members") V.membersWorkspace = workspaceID;
      if (name === "pendingInvitations") V.pendingWorkspace = workspaceID;
      if (!popEl && !dlgEl && !editingForm()) render();
    };
    await Promise.allSettled([...tasks, members, invitations, pending].map((task, i) => task.then(value => {
      publish(names[i], { status: "fulfilled", value });
    }, error => {
      if (error instanceof EndedSession || error instanceof APIError && error.status === 401) clearView();
      else publish(names[i], { status: "rejected", reason: error });
      throw error;
    })));
    if (ended || !committed) return;
    V.dataLoading = false;
    if (!current()) { void loadAccountViews(); return; }
    if (!popEl && !dlgEl && !editingForm()) render();
    // Preserve a reported catalog failure until the user explicitly reloads.
    // Unrelated account reads must not turn that stable error back to loading.
    if (modelChatEnabled() && V.chatCatalogStatus === "loading" && !V.chatCatalogLoading) void loadChatModels();
    void loadExchangeHistory();
    if (V.dataReload) { V.dataReload = false; void loadAccountViews(); }
  };
  // ---------- workspace context ----------
  const isExample = () => S.current === "example";
  const ws = (): Ws | null => S.workspaces.find((w) => w.id === S.current) ?? null;
  const hasWs = () => isExample() || !!ws();
  const wsName = () => (isExample() ? A.example.name : ws()?.name ?? "");
  const exampleChats = (): Chat[] =>
    A.example.chats.map((c: any, i: number) => ({ id: "ex" + i, ws: "example", title: c.title, agent: c.agent, model: agentById(c.agent).model, created: Date.now() - (i + 1) * 3 * 3600e3, messages: c.messages }));
  const chats = (): Chat[] => (isExample() ? exampleChats() : S.chats.filter((c) => c.ws === S.current).sort((a, b) => b.created - a.created));

  // ---------- routing ----------
  const route = () => {
    const h = location.hash.replace(/^#\/?/, "");
    const [name, arg] = h.split("/");
    return { name: name || "", arg: arg || "" };
  };
  const go = (h: string) => {
    closeDlg(); closePop(); closeSb();
    if (location.hash.replace(/^#\/?/, "") === h) render();
    else { location.hash = h ? "/" + h : ""; render(); }
  };
  const needsWs = new Set(["members", "ws-settings", "chat", "import"]);

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
  const copy = async (text: string, msg: string, source?: HTMLElement) => {
    try {
      await navigator.clipboard.writeText(text);
      if (!ended) toast(msg);
      return true;
    } catch {
      if (ended) return false;
      const code = source?.isConnected ? source.closest(".codebox")?.querySelector("pre,code") : null;
      let selected = false;
      if (code) {
        try {
          const selection = window.getSelection(), range = document.createRange();
          range.selectNodeContents(code);
          if (selection) { selection.removeAllRanges(); selection.addRange(range); selected = true; }
        } catch { /* The visible text remains available for manual selection. */ }
      }
      toast(selected ? feedback.copySelected : feedback.copyManual);
      return false;
    }
  };

  // ---------- sidebar ----------
  const canDeleteChats = () => !isExample() && ["owner", "editor"].includes(getAppWorkspaceRole(S.current) || "");
  const navItem = (id: string, icon: string, label: string, end = "", current = false) => {
    const disabled = needsWs.has(id) && !hasWs();
    return `<li><button class="ni" data-go="${id}" ${current ? 'aria-current="page"' : ""} ${disabled ? 'aria-disabled="true" title="' + esc(A.nav.needWs) + '"' : ""}>${ic(icon)}<span>${esc(label)}</span>${end ? `<span class="end">${end}</span>` : ""}</button></li>`;
  };
  const sidebar = () => {
    const r = route();
    const w = wsName();
    const wsIcon = hasWs() ? `<span class="ws-ic">${esc(initials(w).slice(0, 1))}</span>` : `<span class="ws-ic none">${ic("plus", 14)}</span>`;
    const list = hasWs()
      ? chats().map((c) => `<div class="chat-row"><button class="chat-i" data-go="chat/${esc(c.id)}" ${r.name === "chat" && r.arg === c.id ? 'aria-current="page"' : ""}>${agentMk(c.agent, 18)}<span>${esc(c.title)}</span></button>${!canDeleteChats() ? "" : `<button class="icon-btn chat-delete" data-act="del-chat" data-id="${esc(c.id)}" title="${esc(A.chat.delete)}" aria-label="${esc(A.chat.delete)}: ${esc(c.title)}">${ic("trash", 15)}</button>`}</div>`).join("") || `<p class="empty-note">${esc(A.nav.noChats)}</p>`
      : `<p class="empty-note">${esc(A.nav.needWs)}</p>`;
    const memberCount = isExample() ? A.example.members.length : V.membersWorkspace === S.current && Array.isArray(V.members) ? V.members.length : "—";
    const moreIds = ["ws-settings"];
    const moreOpen = V.moreOpen || moreIds.includes(r.name);
    const promo = S.promoClosed
      ? ""
      : `<div class="promo"><button class="icon-btn x" data-act="promo-close" aria-label="${esc(A.promo.close)}">${ic("x", 14)}</button><span class="pk">${esc(A.promo.kicker)}</span><b>${esc(A.promo.title)}</b><p>${esc(hasWs() ? A.promo.body : A.promo.noWs)}</p><button class="go" data-act="promo-go"><span>${esc(A.promo.cta)}</span>${ic("chevR", 14)}</button></div>`;
    return `
      <aside class="sb" aria-label="${esc(A.nav.menu)}">
        <button class="ws-btn" data-act="switcher" aria-haspopup="menu">${wsIcon}<span>${esc(w || A.nav.noWorkspace)}</span>${isExample() ? `<span class="tag">${esc(A.example.badge)}</span>` : ""}<span class="chev">${ic("chev", 16)}</span></button>
        <ul class="navlist">
          ${navItem("new", "plus", A.nav.newChat, `<kbd class="mono">${MAC ? "⇧⌘O" : "Ctrl+Shift+O"}</kbd>`, r.name === "new")}
          <li><button type="button" class="ni" data-act="workbuddy-guide" aria-haspopup="dialog">${ic("ext")}<span>WorkBuddy</span></button></li>
          ${navItem("members", "users", A.nav.members, hasWs() ? `${memberCount}/32` : "", r.name === "members")}
          ${navItem("invitations", "users", A.members.inboxTitle, Array.isArray(V.invitations) && V.invitations.length ? String(V.invitations.length) : "", r.name === "invitations")}
          <li><button class="ni" data-act="more" aria-expanded="${moreOpen}">${ic("more")}<span>${esc(A.nav.more)}</span><span class="end">${ic(moreOpen ? "chev" : "chevR", 14)}</span></button></li>
          ${moreOpen ? `<li><ul class="navlist sub-nav">${navItem("ws-settings", "gear", A.nav.wsSettings, "", r.name === "ws-settings")}</ul></li>` : ""}
        </ul>
        <ul class="navlist">
          ${navItem("billing/market", "store", A.account.market, "", r.name === "billing" && r.arg !== "credits")}
          ${navItem("billing/credits", "card", words.wallet, "", r.name === "billing" && r.arg === "credits")}
          ${navItem("api", "key", A.account.apiKey, "", r.name === "api")}
        </ul>
        <div class="sec-h"><span>${esc(A.nav.chats)}</span><button class="icon-btn" data-go="import" title="${esc(A.nav.importLocal)}" aria-label="${esc(A.nav.importLocal)}">${ic("import", 16)}</button></div>
        <div class="chats">${list}</div>
        ${promo}
        <div class="me">
          <button class="me-btn" data-act="account" aria-haspopup="menu" aria-label="${esc(A.account.openMenu)}">${avatar()}<span style="min-width:0"><b>${esc(displayName())}</b><small>${esc(balanceLabel())} ${money2(balance())}</small></span></button>
          <button class="icon-btn" data-act="invite" title="${esc(A.account.invite)}" aria-label="${esc(A.account.invite)}">${ic("gift")}</button>
          <button class="icon-btn" data-act="help" title="${esc(A.account.help)}" aria-label="${esc(A.account.help)}">${ic("bulb")}</button>
        </div>
      </aside>`;
  };

  // ---------- main bar ----------
  const bar = (title: string, sub = "", right = "", clean = false) =>
    `<header class="bar ${clean ? "clean" : ""}"><button class="icon-btn menu-btn" data-act="sb" aria-label="${esc(A.nav.menu)}">${ic("menu")}</button><div class="ttl"><h1>${esc(title)}</h1>${sub ? `<small>${esc(sub)}</small>` : ""}</div><div class="r">${right}</div></header>`;
  const chatSupportButton = () => `<button type="button" class="icon-btn" data-open-customer-support data-chat-support aria-label="${esc(A.nav.help)}" title="${esc(A.nav.help)}"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 12a8 8 0 0 1 16 0v5a3 3 0 0 1-3 3h-3M4 11h3v6H4zM17 11h3v6h-3zM10 19h4v2h-4z" /></svg></button>`;
  const strip = () =>
    isExample()
      ? `<div class="strip"><i></i><span>${esc(A.example.readOnly)}</span><span class="r"><a class="btn sm soft" href="#/billing/market">${esc(A.example.plans)}</a><button class="btn sm pri" data-act="new-ws">${esc(A.example.start)}</button></span></div>`
      : `<div class="strip"><i></i><span>${esc(words.saved)}</span></div>`;

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
  const modelsFor = (agent: any) => modelChatEnabled() && !isExample()
    ? (V.chatCatalog?.models ?? []).map((m: ChatModel) => ({ ...m, name: m.model, provider: m.format, input: 0, output: 0, tag: "" }))
    : (agent.id === "media" ? D.imageModels.map((n: string) => ({ name: n, provider: "", input: 0, output: 0, tag: "" })) : D.models.filter((m: any) => agent.providers.includes(m.provider)));
  const currentModel = (agent: any) => modelChatEnabled() && !isExample() ? (modelsFor(agent).find((m: any) => m.name === V.model[agent.id])?.name ?? modelsFor(agent)[0]?.name ?? "") : V.model[agent.id] || agent.model;
  const chatModelState = () => {
    if (V.chatCatalogStatus === "ready") return "";
    if (V.chatCatalogStatus === "empty") {
      const reason = (V.chatCatalog as ChatModelCatalog | null)?.diagnostics?.reason;
      return reason && reason !== "available" ? words.modelDiagnostics[reason] : words.modelEmpty;
    }
    return V.chatCatalogStatus === "error" ? V.chatCatalogError || words.modelError : words.modelLoading;
  };
  const chatModelLabel = () => V.chatCatalogStatus === "empty" ? words.modelEmptyLabel : V.chatCatalogStatus === "error" ? words.modelErrorLabel : words.modelLoading;
  const chatRunNotice = (chatID: string) => {
    const run = chatRuns.get(chatID);
    if (!run || run.status === "completed" && !run.history_pending) return "";
    const active = run.status === "pending" || run.status === "running";
    const timing = chatRunElapsed(run);
    const label = run.history_pending ? progressWords.restoring : run.web_search === true && active ? searchWords[run.status as "pending" | "running"] : progressWords[run.status];
    const message = run.history_pending ? progressWords.restoringDetail : run.status === "failed" ? run.error_code === "model_refused" ? attachmentWords.refused : run.error_code === "output_limit_reached" ? attachmentWords.outputLimit : run.error_code === "billing_unresolved" ? progressWords.billingUnresolved : run.error_code === "billing_in_flight" ? progressWords.billingInFlight : progressWords.failedDetail : run.status === "unknown" ? progressWords.uncertain : progressWords.working;
    const refusal = run.status === "failed" && run.error_code === "model_refused" ? run.refusal : undefined;
    return `<section class="chat-run-status" data-chat-run="${esc(run.request_id)}" data-run-status="${run.history_pending ? "restoring" : esc(run.status)}"><div class="chat-run-head"><span class="chat-run-indicator ${active ? "is-active" : ""}" aria-hidden="true"><i></i><i></i><i></i></span><strong role="status" aria-live="polite" aria-atomic="true">${esc(label)}</strong>${timing ? `<span class="chat-run-elapsed" ${timing.live ? `data-chat-elapsed data-started-at="${timing.startedAt}"` : "data-chat-duration"} aria-live="off">${esc(timing.live ? progressWords.elapsed : progressWords.duration)} ${esc(timing.text)}</span>` : ""}</div><p>${esc(message)}${run.error_code ? ` ${esc(run.error_code)}` : ""}</p>${refusal && (refusal.category || refusal.explanation) ? `<div class="chat-refusal-details" data-chat-refusal>${refusal.category ? `<p><code>${esc(refusal.category)}</code></p>` : ""}${refusal.explanation ? `<p>${esc(refusal.explanation)}</p>` : ""}</div>` : ""}${run.status !== "failed" ? `<button class="btn sm" data-act="chat-check" data-chat="${esc(chatID)}" ${chatRequests.has(chatID) || chatChecks.has(chatID) ? "disabled" : ""}>${esc(chatChecks.has(chatID) ? progressWords.checking : progressWords.check)}</button>` : ""}</section>`;
  };

  const chatBillingNote = (reload = true) => `<div class="chat-billing-note"><a href="#/billing/credits">${esc(funding().explicit ? chatFunding.availableBalance : chatFunding.balance)} · ${money2(funding().total / 1_000_000)}</a><button class="chat-funding-help" data-act="chat-funding" aria-haspopup="dialog">${esc(chatFunding.details)}</button>${reload ? `<button class="icon-btn" data-act="chat-models" aria-label="${esc(words.chatReloadModels)}" title="${esc(words.chatReloadModels)}" ${V.chatCatalogLoading || saving ? "disabled" : ""}>${ic("refresh", 14)}</button>` : ""}</div>`;
  const chatSearchState = (model?: ChatModel): "loading" | "error" | "readOnly" | "busy" | "serviceUnavailable" | "available" | "modelUnavailable" => {
    if (V.chatCatalogStatus === "loading") return "loading";
    if (V.chatCatalogStatus === "error") return "error";
    if (getAppWorkspaceRole(S.current) === "viewer") return "readOnly";
    if (V.chatStarting) return "busy";
    if (V.chatCatalogStatus !== "ready" || V.chatCatalog?.web_search?.available !== true) return "serviceUnavailable";
    return model?.web_search === true ? "available" : "modelUnavailable";
  };
  const composer = (opts: { chat?: Chat; disabled?: boolean } = {}) => {
    const agent = agentById(opts.chat ? opts.chat.agent : V.agent);
    const real = modelChatEnabled() && !isExample();
    const requested = opts.chat ? V.chatModel?.[opts.chat.id] ?? opts.chat.model : currentModel(agent);
    const choice: ChatModel | undefined = real ? V.chatCatalog?.models.find((m: ChatModel) => m.model === requested) ?? V.chatCatalog?.models[0] : undefined;
    const webState = chatSearchState(choice), webAvailable = webState === "available";
    if (real && !webAvailable) V.webSearch = false;
    const model = real ? choice?.model ?? "" : requested;
    const pending = opts.chat && chatRuns.get(opts.chat.id);
    const cannotEdit = opts.disabled || (!isExample() && getAppWorkspaceRole(S.current) === "viewer") || real && (V.chatCatalogStatus !== "ready" || !choice || V.chatStarting);
    const disabled = cannotEdit || real && (saving || !!pending && !chatRunSettled(pending));
    const ph = real ? words.chatPlaceholder : agent.id === "media" ? A.newChat.mediaPlaceholder : fmt(A.newChat.placeholder, { agent: agent.name });
    const modelLabel = real ? V.chatCatalogStatus === "ready" && choice ? choice.label : chatModelLabel() : model;
    return `
      ${real ? `<div class="chat-model-state" data-model-state="${esc(V.chatCatalogStatus)}"><p class="chat-model-message" role="status" ${chatModelState() ? "" : "hidden"}>${esc(chatModelState())}</p></div>` : ""}
      ${real && webAvailable ? `<p class="chat-search-note" id="chat-search-charges">${esc(searchWords.charges)}</p>` : ""}
      <form class="composer ${cannotEdit ? "off" : ""}" data-form="send" data-model="${esc(model)}" aria-busy="${!!V.chatStarting || !!opts.chat && chatRequests.has(opts.chat.id)}" ${opts.chat ? `data-chat="${esc(opts.chat.id)}"` : ""}>
        ${real ? `<div data-chat-files></div><input type="file" data-chat-file-input accept=".png,.jpg,.jpeg,.webp,.pdf,.txt,.md,.csv,.json,.docx" multiple tabindex="-1" aria-label="${esc(attachmentWords.add)}" />` : ""}
        <label class="sr" for="fx-input">${esc(ph)}</label>
        <textarea id="fx-input" name="text" maxlength="${MAX_MESSAGE}" rows="2" placeholder="${esc(opts.disabled ? A.example.composer : ph)}" ${cannotEdit ? "disabled" : ""}>${esc(opts.chat ? chatDrafts.get(opts.chat.id) ?? "" : V.draft)}</textarea>
        <div class="tools">
          ${real ? `<button type="button" class="chat-file-picker" data-file-pick aria-describedby="chat-files-help" title="${esc(choice?.attachments || choice?.vision || choice?.documents ? attachmentWords.help : attachmentWords.unavailable)}" ${disabled || !choice?.attachments && !choice?.vision && !choice?.documents ? "disabled" : ""}>${ic("attach", 15)}<span>${esc(attachmentWords.add)}</span></button>` : ""}
          ${real ? `<button type="button" class="chat-web-search" data-act="chat-web-search" data-web-state="${webState}" aria-pressed="${V.webSearch && webAvailable}" ${webAvailable ? 'aria-describedby="chat-search-charges"' : `aria-haspopup="dialog" aria-label="${esc(`${searchWords.label}: ${searchWords.details}`)}"`} title="${esc(webAvailable ? `${searchWords.consent} ${searchWords.charges}` : searchWords.details)}">${ic("globe", 15)}<span>${esc(searchWords.label)}</span>${!webAvailable ? ic("chev", 12) : ""}</button>` : ""}
          <div class="r">
            <button type="button" class="model-btn" data-act="model" data-agent="${esc(agent.id)}" ${opts.chat ? `data-chat="${esc(opts.chat.id)}"` : ""} title="${esc(real && V.chatCatalogStatus === "ready" ? model : modelLabel)}" aria-haspopup="menu" ${cannotEdit ? "disabled" : ""}>${real ? ic("box", 18) : agent.id === "media" ? mk(M.images[model] || M.agents.media, 18) : mk(M.providers[(D.models.find((x: any) => x.name === model) || {}).provider] || M.agents[agent.id], 18)}<span>${esc(modelLabel)}</span>${real && V.chatCatalogStatus === "ready" && choice?.label !== model ? `<small>${esc(model)}</small>` : ""}${!real || V.chatCatalogStatus === "ready" ? ic("chev", 14) : ""}</button>
            <button class="send" type="submit" data-base-disabled="${!!disabled}" aria-label="${esc(A.newChat.send)}" ${disabled || real && attachments?.blocked(opts.chat?.id, choice, `new:${S.current}`) ? "disabled" : ""}>${real && (V.chatStarting || !!pending && (["pending", "running"].includes(pending.status) || (pending.status === "unknown" || pending.history_pending) && canPollChat(pending))) ? `<span class="chat-wait" aria-hidden="true"></span>` : ic("up", 16)}</button>
          </div>
        </div>
      </form>
      ${real && V.chatStarting ? `<p class="hint" role="status" data-chat-starting>${esc(words.chatPending)}</p>` : ""}${real ? chatBillingNote() : ""}
      `;
  };

  const vNew = () => {
    if (modelChatEnabled() && !isExample()) {
      const cliOnly = V.chatCatalogStatus === "empty" && (V.chatCatalog as ChatModelCatalog | null)?.diagnostics?.reason === "claude_code_only";
      const content = cliOnly
        ? `<section class="chat-availability-card card pad" data-chat-availability="claude_code_only"><div class="chat-model-state" data-model-state="empty"><h2>${esc(feedback.cliTitle)}</h2><p class="chat-model-message" role="status">${esc(chatModelState())}</p></div><div class="chat-availability-actions"><button class="btn pri" data-act="claude-guide">${esc(feedback.cliGuide)}${ic("chevR", 14)}</button><button class="btn" data-act="chat-models" ${saving ? "disabled" : ""}>${ic("refresh", 14)}${esc(words.chatReloadModels)}</button></div>${chatBillingNote(false)}</section>`
        : `<div class="model-chat-intro"><h2>${esc(words.chatWelcome)}</h2><p>${esc(words.chatWelcomeNote)}</p></div>`;
      return `${bar(words.modelChat, wsName(), `<button class="btn sm soft" data-go="import">${ic("import", 14)}${esc(A.nav.importLocal)}</button>${chatSupportButton()}`, true)}<div class="scroll"><div class="model-chat-empty">${content}</div></div>${cliOnly ? "" : `<div class="dock model-chat-compose">${composer()}</div>`}`;
    }
    const agent = agentById(V.agent);
    const ad = A.newChat.agents[agent.id];
    const ms = modelsFor(agent);
    const lv = A.newChat.levels;
    const picked = pickedAgent() === agent.id;
    const provs = agent.id === "media" ? D.imageModels : agent.providers;
    return `
      ${bar(A.nav.newChat, wsName(), `<button class="btn sm soft" data-go="import">${ic("import", 14)}<span class="hide-sm">${esc(A.nav.importLocal)}</span></button>${chatSupportButton()}`, true)}
      ${strip()}
      <div class="scroll"><div class="nc">
        <h2>${esc(A.newChat.title)}</h2>
        <p class="note">${esc(A.newChat.executionNote)}</p>
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
    if (who === "assistant") return { name: words.modelChat, html: ic("box", 24), user: false };
    if (who === "agent" || D.agents.some((a: any) => a.id === who)) {
      if (modelChatEnabled() && !isExample()) return { name: words.modelChat, html: ic("box", 24), user: false };
      const a = agentById(who === "agent" ? chat.agent : who);
      return { name: a.name, html: agentMk(a.id, 24), user: false };
    }
    return { name: who, html: `<span class="av sm" style="--av:${AVATARS[(who.length * 3) % AVATARS.length]}">${esc(initials(who))}</span>`, user: false };
  };
  const vChat = (id: string) => {
    const chat = chats().find((c) => c.id === id);
    if (!chat) return vNotFound();
    const agent = agentById(chat.agent);
    const metadata = getAppMessageMetadata(chat.id);
    const msgs = chat.messages
      .map(([who, text], index) => {
        if (who === "sys") return `<div class="sys">${esc(text)}</div>`;
        const author = metadata[index];
        const otherUser = who === "you" && author?.author_user_id && author.author_user_id !== getAppBootstrap()?.user.id;
        const s = otherUser
          ? { name: memberName(author.author_name || `Member #${author.author_user_id}`), html: `<span class="av sm" style="--av:${AVATARS[0]}">${esc(initials(memberName(author.author_name || "?")))}</span>`, user: true }
          : speaker(chat, who);
        // In the example, the human who briefs the agent is shown as a regular speaker.
        const rich = who === "assistant" || who === "agent";
        let body = rich ? markdownCache.get(text) : undefined;
        if (rich && body === undefined) {
          body = renderChatMarkdown(text);
          if (markdownCache.size >= 100) markdownCache.delete(markdownCache.keys().next().value!);
          markdownCache.set(text, body);
        }
        return `<div class="msg ${s.user ? "user" : ""}"><div class="msg-who">${s.html}${esc(s.name)}${author?.imported ? `<span class="tag">${esc(zh ? "导入历史" : "Imported history")}</span>` : ""}</div><div class="msg-body ${rich ? "chat-markdown" : ""}">${rich ? body : esc(text)}</div>${messageAttachments(chat.id, author?.attachments, D.lang)}</div>`;
      })
      .join("");
    const right = (!canDeleteChats() ? "" : `<button class="icon-btn" data-act="del-chat" data-id="${esc(chat.id)}" title="${esc(A.chat.delete)}" aria-label="${esc(A.chat.delete)}">${ic("trash", 16)}</button>`) + chatSupportButton();
    return `
      ${bar(chat.title, `${agent.name} · ${chat.model}`, right)}
      ${modelChatEnabled() && !isExample() ? "" : `${strip()}<p class="note chat-execution-note">${esc(A.newChat.executionNote)}</p>`}
      <div class="scroll" data-thread tabindex="0" aria-label="${esc(chat.title)}"><div class="thread" ${chatRuns.get(id)?.status === "completed" && !chatRuns.get(id)?.history_pending ? 'data-run-status="completed"' : ""}>${msgs}${chatSubmissions.has(id) && !submissionRecorded(id, chat) ? `<div class="msg user" data-chat-submission><div class="msg-who">${avatar("sm")}${esc(A.chat.you)}</div><div class="msg-body">${esc(chatSubmissions.get(id)!.body)}</div></div>` : ""}${modelChatEnabled() && !isExample() ? chatRunNotice(chat.id) : ""}</div></div>
      <div class="chat-latest-row"><button type="button" class="btn sm" data-chat-latest hidden>${esc(progressWords.latest)} ↓</button></div>
      <div class="dock">${composer({ chat, disabled: isExample() })}</div>`;
  };

  const vImport = () => {
    return `
      ${bar(A.importLocal.title, wsName(), `<button class="btn sm soft" data-go="new">${ic("chevL", 14)}${esc(A.nav.newChat)}</button>`)}
      <div class="scroll"><div class="page narrow stack lg">
        <div><h2 class="t">${esc(A.importLocal.title)}</h2><p class="muted" style="margin-top:6px">${esc(A.importLocal.sub)}</p></div>
        <div class="card pad stack"><h3>${esc(words.history)}</h3><p class="muted">${esc(words.historyHint)}</p><button class="btn pri" data-act="import-history" ${isExample() ? "disabled" : ""}>${ic("upload", 14)}${esc(words.history)}</button></div>
      </div></div>`;
  };

  const vMembers = () => {
    const ex = isExample(), own = getAppWorkspaceRole(S.current) === "owner";
    const currentUser = getAppBootstrap()?.user.id;
    const membersLoaded = ex || (V.membersWorkspace === S.current && Array.isArray(V.members));
    const members = ex ? A.example.members.map((name: string, i: number) => ({ user_id: -(i + 1), name, role: i ? "editor" : "owner" })) : membersLoaded ? V.members : [];
    const roleCard = (role: string) => {
      const [name, desc] = A.members.roles[role], list = members.filter((m: any) => m.role === role);
      return `<div class="card"><div class="between" style="padding:14px 16px;border-bottom:1px solid var(--line)"><div><h4>${esc(name)}</h4><small class="muted">${esc(desc)}</small></div>${role === "owner" || ex || !own ? "" : `<button class="btn sm" data-act="invite-link" data-role="${role}">${ic("plus", 13)}${esc(A.members.invite)}</button>`}</div>
        <div class="list">${list.map((m: any, i: number) => `<div><span class="av sm" style="--av:${AVATARS[(i + role.length) % AVATARS.length]}">${esc(initials(memberName(m.name)))}</span><span class="grow">${esc(memberName(m.name))}${m.user_id === currentUser ? ` <span class="tag">${esc(A.members.you)}</span>` : ""}</span>${own && m.role !== "owner" ? `<button class="btn sm soft" data-act="member-role" data-id="${m.user_id}" data-role="${m.role === "viewer" ? "editor" : "viewer"}">${esc(words.memberRoleChange)} ${esc(A.members.roles[m.role === "viewer" ? "editor" : "viewer"][0])}</button><button class="btn sm soft" data-act="remove-member" data-id="${m.user_id}">${esc(A.common.close)}</button>` : ""}</div>`).join("") || `<div class="muted">${esc(fmt(A.members.none, { role: name }))}</div>`}</div></div>`;
    };
    const pending = V.pendingWorkspace === S.current && Array.isArray(V.pendingInvitations) ? V.pendingInvitations : null;
    const pendingCard = !ex && own ? `<div class="card"><div style="padding:14px 16px;border-bottom:1px solid var(--line)"><h4>${esc(A.members.pendingTitle)}</h4></div><div class="list">${pending === null ? `<div class="muted">${esc(V.dataError || words.loading)}</div>` : pending.length ? pending.map((inv: any) => `<div><span class="grow">${esc(inv.label)} <span class="tag">${esc(A.members.roles[inv.role][0])}</span><small>${esc(fmt(A.members.expires, { date: dfmt(inv.expires) }))}</small></span><button class="btn sm soft" data-act="revoke-invitation" data-id="${esc(inv.id)}">${esc(A.members.revoke)}</button></div>`).join("") : `<div class="muted">${esc(A.members.pendingEmpty)}</div>`}</div></div>` : "";
    return `${bar(A.members.title, wsName())}<div class="scroll"><div class="page narrow stack lg"><div><h2 class="t">${esc(A.members.title)}</h2><p class="muted">${membersLoaded ? `${esc(fmt(A.members.seats, { n: members.length }))} · ${esc(fmt(A.members.left, { n: 32 - members.length }))}` : esc(V.dataError || words.loading)}</p>${!ex && own ? `<p class="note">${esc(A.members.inviteNote)}</p>` : ""}</div>${["owner", "editor", "viewer"].map(roleCard).join("")}${pendingCard}${!ex && !own ? `<div class="card pad stack"><h3>${esc(A.members.leave)}</h3><button class="btn danger" data-act="leave-workspace">${esc(A.members.leave)}</button></div>` : ""}</div></div>`;
  };

  const vInvitations = () => {
    const inbox = Array.isArray(V.invitations) ? V.invitations : null;
    return `${bar(A.members.inboxTitle)}<div class="scroll"><div class="page narrow stack lg"><div><h2 class="t">${esc(A.members.inboxTitle)}</h2><p class="muted">${esc(A.members.inboxHint)}</p></div><div class="card list">${inbox === null ? `<div class="muted">${esc(V.dataError || words.loading)}</div>` : inbox.length ? inbox.map((inv: any) => `<div><span class="grow"><b>${esc(inv.workspace_name)}</b> <span class="tag">${esc(A.members.roles[inv.role][0])}</span><small>${esc(fmt(A.members.invitedBy, { name: memberName(inv.inviter_name) }))} · ${esc(fmt(A.members.expires, { date: dfmt(inv.expires) }))}</small></span><button class="btn sm pri" data-act="accept-invitation" data-id="${esc(inv.id)}" data-workspace="${esc(inv.workspace_id)}">${esc(A.members.accept)}</button><button class="btn sm soft" data-act="decline-invitation" data-id="${esc(inv.id)}">${esc(A.members.decline)}</button></div>`).join("") : `<div class="muted">${esc(A.members.inboxEmpty)}</div>`}</div></div></div>`;
  };

  const tabsV = (tabs: string[], cur: number, base: string) => `<div class="tabs-v" role="tablist">${tabs.map((t, i) => `<button role="tab" data-go="${base}/${i}" aria-selected="${i === cur}">${esc(t)}</button>`).join("")}</div>`;
  const vWsSettings = () => {
    const W = A.wsSettings;
    const role = getAppWorkspaceRole(S.current) || "viewer";
    const owner = role === "owner" && !isExample();
    const count = isExample() ? A.example.members.length : V.membersWorkspace === S.current && Array.isArray(V.members) ? V.members.length : "—";
    return `${bar(W.title, W.note)}<div class="scroll"><div class="page narrow stack lg">
      <div class="card pad stack"><span class="k">${esc(zh ? "工作区" : "Workspace")}</span>
        ${owner ? `<form class="row" data-form="rename"><input type="text" name="name" value="${esc(wsName())}" aria-label="${esc(A.newWs.name)}" maxlength="60" style="max-width:340px" /><button class="btn">${esc(A.common.save)}</button></form>` : `<h2 class="t">${esc(wsName())}</h2>`}
        <p class="muted">${esc(words.workspaceSummary)}</p>
        <div class="kv"><div><small>${esc(W.overview.role)}</small><b>${esc(isExample() ? A.common.readOnly : A.members.roles[role][0])}</b></div><div><small>${esc(W.overview.members)}</small><b>${count}</b></div></div>
      </div>
      ${owner ? `<div class="card pad stack" style="border-color:color-mix(in srgb,var(--bad) 40%,var(--line))"><span class="k" style="color:var(--bad)">${esc(zh ? "危险操作" : "Danger zone")}</span><div><h4>${esc(words.workspaceDelete)}</h4><p class="muted" style="font-size:13px">${esc(words.workspaceDeleteSub)}</p></div>
        <form class="row wrap" data-form="del-ws"><input type="text" name="name" placeholder="${esc(wsName())}" aria-label="${esc(words.workspaceDeleteConfirm)}" style="flex:1;min-width:180px" /><button class="btn danger">${esc(words.workspaceDelete)}</button></form><small class="hint">${esc(words.workspaceDeleteConfirm)}</small></div>` : ""}
    </div></div>`;
  };

  const vUser = (n: number) => {
    const U = A.user;
    let panel = "";
    if (n === 0) {
      panel = `<form class="card pad stack" data-form="profile"><div><h3>${esc(U.profile)}</h3><p class="muted" style="font-size:13px">${esc(U.profileSub)}</p></div>
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
      if (n === 2) panel = `<div class="card pad stack"><h3>${esc(U.notifTitle)}</h3>${S.email ? `<p class="muted">${esc(S.email)}</p>` : ""}<p class="note">${esc(U.notifDeliveryNote)}</p><div class="list" style="margin:0 -16px">${U.notifs.map((t: string, i: number) => `<div><span class="grow">${esc(t)}</span><button class="switch" role="switch" data-act="notif" data-i="${i}" aria-checked="${!!S.notifs[i]}" aria-label="${esc(t)}"></button></div>`).join("")}</div></div>`;
      else panel = `<form class="card pad stack" data-form="password"><div><h3>${esc(U.passwordTitle)}</h3><p class="muted" style="font-size:13px">${esc(U.passwordSub)}</p></div>
        <label class="f">${esc(U.currentPassword)}<input type="password" name="current_password" autocomplete="current-password" minlength="1" maxlength="72" required /></label>
        <label class="f">${esc(U.newPassword)}<input type="password" name="new_password" autocomplete="new-password" minlength="8" maxlength="72" required /><small>${esc(U.passwordHint)}</small></label>
        <label class="f">${esc(U.confirmPassword)}<input type="password" name="confirm_password" autocomplete="new-password" minlength="8" maxlength="72" required /></label>
        <div><button class="btn pri">${esc(U.changePassword)}</button></div></form>`;
    }
    return `${bar(U.title)}<div class="scroll"><div class="page"><div class="settings">${tabsV(U.tabs, n, "settings")}<div>${panel}</div></div></div></div>`;
  };

  const paid = () => getAppBootstrap()?.capabilities.api_keys === true;
  const apiUsageMetrics = () => {
    const P = A.api;
    const stats = (V.usage?.usage ?? []).reduce((out: any, row: any) => ({
      requests: out.requests + Number(row.requests ?? 0), tokens: out.tokens + usageTokens(row),
      charged: out.charged + Number(row.allow_micro ?? 0), covered: out.covered + Number(row.list_micro ?? 0),
    }), { requests: 0, tokens: 0, charged: 0, covered: 0 });
    const usageStat = (label: string, value: string, hint: string, exact = value) => `<div title="${esc(`${label}: ${exact}. ${hint}`)}"><small>${esc(label)}</small><b aria-label="${esc(`${label}: ${exact}. ${hint}`)}">${esc(value)}</b></div>`;
    const compactTokens = V.usage ? compactTokenCount(stats.tokens) : "—";
    return `${usageStat(P.requests, V.usage ? stats.requests.toLocaleString() : "—", P.calls)}${usageStat(P.tokens, compactTokens, P.tokensSub, compactTokens === "—" ? "—" : stats.tokens.toLocaleString(D.lang))}${usageStat(words.listValue, V.usage ? money2(stats.covered / 1_000_000) : "—", words.listValueHint)}${usageStat(P.charges, V.usage ? money2(stats.charged / 1_000_000) : "—", P.chargesSub)}`;
  };
  const vApi = () => {
    const P = A.api;
    const apiOrigin = location.hostname === "fells.dev" || location.hostname.endsWith(".fells.dev")
      ? "https://api.fells.dev" : location.origin;
    const base = `${apiOrigin}/v1`;
    const catalogModels = Array.isArray(V.apiCatalog?.models) ? V.apiCatalog.models.filter((model: any) => model?.routable !== false) : [];
    const chatFormats = ["anthropic-messages", "openai-completions", "openai-responses", "gemini-generatecontent"];
    const curlModel = catalogModels.find((m: any) => modelFormat(m, chatFormats, "api") && typeof m.model === "string");
    const curlFormat = curlModel ? modelFormat(curlModel, chatFormats, "api") : undefined;
    // Keep dynamic model IDs inside the shell's single-quoted JSON argument.
    const curlModelJSON = curlModel ? JSON.stringify(curlModel.model).replace(/'/g, "\\u0027") : "";
    const catalogUnavailable = V.catalogStatus === "loading" ? (zh ? "# 正在读取模型目录，请稍候。" : "# Loading the model catalog. Please wait.") : V.catalogStatus === "error" ? (zh ? "# 模型目录读取失败，请刷新后重试。" : "# The model catalog could not be loaded. Reload before trying again.") : V.catalogStatus === "no-key" ? `# ${words.noChatKey}` : "";
    const noChatModel = catalogUnavailable || (zh
      ? "# 当前模型目录没有可用的聊天端点路由。请确认 API 访问权限和模型目录。"
      : "# No chat endpoint is currently available in the model catalog for this account.");
    const curlSnippet = !curlModel ? noChatModel
      : curlFormat === "anthropic-messages" ? `curl ${apiOrigin}/v1/messages \\\n  -H "x-api-key: $FELLS_API_KEY" \\\n  -H "anthropic-version: 2023-06-01" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model": ${curlModelJSON}, "max_tokens": 256, "messages": [{"role": "user", "content": "Hello"}]}'`
      : curlFormat === "openai-completions" ? `curl ${base}/chat/completions \\\n  -H "Authorization: Bearer $FELLS_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model": ${curlModelJSON}, "messages": [{"role": "user", "content": "Hello"}]}'`
      : curlFormat === "openai-responses" ? `curl ${base}/responses \\\n  -H "Authorization: Bearer $FELLS_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model": ${curlModelJSON}, "input": "Hello"}'`
      : `curl "${apiOrigin}/v1beta/models/${encodeURIComponent(curlModel.model)}:generateContent" \\\n  -H "x-goog-api-key: $FELLS_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"contents": [{"parts": [{"text": "Hello"}]}]}'`;
    const openAIFormats = ["openai-completions", "openai-responses"];
    const openAIModel = catalogModels.find((m: any) => modelFormat(m, openAIFormats, "api") && typeof m.model === "string");
    const openAIFormat = openAIModel ? modelFormat(openAIModel, openAIFormats, "api") : undefined;
    const openAIModelJSON = openAIModel ? JSON.stringify(openAIModel.model) : "";
    const noOpenAIModel = catalogUnavailable || (zh
      ? "# 当前模型目录没有可用的 OpenAI 兼容端点路由。请确认 API 访问权限和模型目录。"
      : "# No OpenAI-compatible endpoint is currently available in the model catalog for this account.");
    const openAISnippet = !openAIModel ? noOpenAIModel
      : openAIFormat === "openai-completions" ? `import os\nfrom openai import OpenAI\n\nclient = OpenAI(base_url="${base}", api_key=os.environ["FELLS_API_KEY"])\nreply = client.chat.completions.create(\n    model=${openAIModelJSON},\n    messages=[{"role": "user", "content": "Hello"}],\n)`
      : `import os\nfrom openai import OpenAI\n\nclient = OpenAI(base_url="${base}", api_key=os.environ["FELLS_API_KEY"])\nreply = client.responses.create(\n    model=${openAIModelJSON},\n    input="Hello",\n)`;
    const claudeModels = catalogModels.filter(offeredModel).filter((m: any) => modelFormat(m, ["anthropic-messages"], "claude_code") && typeof m.model === "string" && m.model.trim().length > 0);
    const claudeModel = claudeModels.find((m: any) => m.model === V.claudeModel) ?? claudeModels[0];
    const claudeBackgroundModel = claudeModels.find((m: any) => /^claude-sonnet-[0-9]/.test(m.model)) ?? claudeModel;
    if (!V.quickChosen && V.catalogStatus === "ready") V.quickTab = curlModel ? 0 : openAIModel ? 1 : claudeModel ? 2 : 0;
    const claudeSnippet = !claudeModel ? catalogUnavailable || (zh ? "# 当前暂无适用于 Claude Code 的模型。" : "# No Claude Code-compatible model is currently available for this account.")
      : claudeSettings(apiOrigin, claudeModel.model, claudeBackgroundModel.model);
    const quickFormat = V.quickTab === 1 ? openAIFormat : V.quickTab === 2 ? claudeModel ? "anthropic-messages" : undefined : curlFormat;
    const quickBase = V.quickTab === 2 || quickFormat === "anthropic-messages" || quickFormat === "gemini-generatecontent" ? apiOrigin : base;
    const quickEndpoint = quickFormat === "anthropic-messages" ? "/v1/messages" : quickFormat === "openai-completions" ? "/v1/chat/completions" : quickFormat === "openai-responses" ? "/v1/responses" : quickFormat === "gemini-generatecontent" ? "/v1beta/models/{model}:generateContent" : "";
    const snippets = [
      ["curl", curlSnippet],
      ["OpenAI SDK", openAISnippet],
      ["Claude Code", claudeSnippet],
    ];
    const primarySnippet = `<div class="codebox api-code-area" data-catalog-state="${esc(V.catalogStatus)}" ${V.quickTab === 2 ? 'data-claude-mode="saved"' : ""}><pre class="code" tabindex="0" role="region" aria-label="${esc(P.quick)} · ${esc(snippets[V.quickTab][0])}">${esc(snippets[V.quickTab][1])}</pre><button class="btn sm" data-act="copy" data-text="${esc(snippets[V.quickTab][1])}" data-msg="${esc(A.common.copied)}">${ic("copy", 13)}${esc(V.quickTab === 2 && claudeModel ? claudeWords.copyConfig : A.common.copy)}</button></div>`;
    const guideCode = (code: string) => `<div class="setup-code"><pre class="code" tabindex="0" aria-label="${esc(claudeWords.installTitle)}">${esc(code)}</pre><button class="btn sm" data-act="copy" data-text="${esc(code)}" data-msg="${esc(A.common.copied)}">${ic("copy", 13)}${esc(claudeWords.copyCommand)}</button></div>`;
    const claudeGuide = V.quickTab !== 2 ? primarySnippet : !claudeModel
      ? `${primarySnippet}<p class="hint">${esc(claudeWords.noModelHint)}</p>`
      : `<section class="claude-guide" aria-labelledby="claude-setup-title" data-claude-guide>
        <h3 class="sr" id="claude-setup-title">${esc(claudeWords.title)}</h3>
        <p class="hint" data-claude-web-note>${esc(claudeWords.webKeyNote)}</p>
        <div class="claude-guide-controls"><label class="f">${esc(claudeWords.platform)}<select data-input="claudePlatform">${([ ["macos", "macOS · Zsh"], ["linux", "Linux / Bash"], ["windows", "Windows · PowerShell"] ] as const).map(([value, label]) => `<option value="${value}" ${V.claudePlatform === value ? "selected" : ""}>${label}</option>`).join("")}</select></label><label class="f" title="${esc(claudeWords.modelHint)}">${esc(claudeWords.model)}<select data-input="claudeModel">${claudeModels.map((m: any) => `<option value="${esc(m.model)}" ${claudeModel.model === m.model ? "selected" : ""}>${esc(m.display_name || m.model)}</option>`).join("")}</select></label></div>
        <ol class="claude-guide-steps">
          <li data-claude-install><div class="stack"><h4>${esc(claudeWords.installTitle)}</h4><p class="hint">${esc(claudeWords.simpleInstall)}</p>${guideCode(claudeInstall(V.claudePlatform))}</div></li>
          <li data-claude-settings><div class="stack"><h4>${esc(claudeWords.settingsTitle)}</h4><div class="claude-settings-path" title="${esc(claudeWords.pathLabel)}"><code>${esc(claudeSettingsPath(V.claudePlatform))}</code><button class="icon-btn" data-act="copy" data-text="${esc(claudeSettingsPath(V.claudePlatform))}" aria-label="${esc(claudeWords.pathLabel)} · ${esc(A.common.copy)}">${ic("copy", 14)}</button></div>${primarySnippet}<p class="hint" data-claude-copy-help>${esc(claudeWords.configFileNote)} ${esc(claudeWords.replaceKey)}</p><p class="hint">${esc(claudeWords.simpleMerge)}</p><p class="hint" data-claude-background>${esc(claudeBackgroundModel.model === claudeModel.model ? claudeWords.backgroundSame : claudeWords.background.replace("{model}", claudeBackgroundModel.display_name || claudeBackgroundModel.model))}</p></div></li>
          <li data-claude-run><div class="stack"><h4>${esc(claudeWords.runTitle)}</h4><p class="api-guide-launch"><code>claude</code><button class="btn sm" data-act="copy" data-text="claude" data-msg="${esc(A.common.copied)}">${ic("copy", 13)}${esc(claudeWords.copyCommand)}</button></p><p class="hint">${esc(claudeWords.simpleRun)}</p></div></li>
        </ol>
        <details class="claude-guide-details" data-claude-help><summary>${esc(claudeWords.helpTitle)}</summary><div class="stack" data-claude-prerequisites><p>${esc(claudeWords.installBody)}</p><a href="https://code.claude.com/docs/en/setup#install-claude-code" target="_blank" rel="noopener noreferrer">${esc(claudeWords.installLink)}${ic("ext", 12)}</a><p>${esc(claudeWords.keyBody)}</p><p>${esc(claudeWords.secretNote)}</p><h4>${esc(claudeWords.verifyTitle)}</h4><p>${esc(claudeWords.verifyBody)}</p><p class="hint">${esc(claudeWords.statusExpected)}</p></div><dl>${claudeWords.help.map(item => `<div><dt>${esc(item.title)}</dt><dd>${esc(item.body)}</dd></div>`).join("")}</dl><footer class="claude-guide-footer"><p class="hint">${esc(claudeWords.permissionNote)}</p><a href="https://code.claude.com/docs/en/llm-gateway-connect" target="_blank" rel="noopener noreferrer">${esc(claudeWords.docs)}${ic("ext", 12)}</a></footer></details>
      </section>`;
    const keys = S.keys;
    const apiKeys = availableApiKeys();
    const apiKey = selectedApiKey();
    const apiKeyControl = `<div class="chat-key-toolbar quick-key-control"><label class="chat-key-control"><span class="sr">API Key</span><select data-input="apiKey" aria-label="API Key" ${saving || !apiKeys.length ? "disabled" : ""}>${apiKeys.map(key => `<option value="${key.id}" ${apiKey?.id === key.id ? "selected" : ""}>${esc(key.name)} · ${esc(key.prefix)}</option>`).join("") || `<option value="">${esc(words.noChatKeyLabel)}</option>`}</select></label><button class="icon-btn" data-act="api-models" aria-label="${esc(words.chatReloadModels)}" title="${esc(words.chatReloadModels)}" ${V.catalogLoading || !apiKey || saving ? "disabled" : ""}>${ic("refresh", 15)}</button></div>`;
    return `
      ${bar(P.title, P.sub, `<button class="btn sm pri" data-act="new-key" ${paid() ? "" : "disabled"}>${ic("plus", 14)}${esc(P.create)}</button><button type="button" class="icon-btn" data-open-customer-support aria-label="${esc(A.nav.help)}" title="${esc(A.nav.help)}"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 12a8 8 0 0 1 16 0v5a3 3 0 0 1-3 3h-3M4 11h3v6H4zM17 11h3v6h-3zM10 19h4v2h-4z" /></svg></button>`)}
      <div class="scroll"><div class="page api-page">
        ${paid() ? "" : `<div class="card pad between api-access-note" style="background:var(--sub)"><div><h3>${ic("lock", 16)} ${esc(P.gateTitle)}</h3><p class="muted" style="margin-top:4px;font-size:13px">${esc(P.gateBody)}</p></div><div class="row"><a class="btn" href="#/billing/market">${esc(P.market)}</a><button class="btn pri" data-act="contact-purchase">${esc(contactPurchase)}</button></div></div>`}
        <section class="api-overview" aria-labelledby="api-usage-title"><div class="api-overview-head"><h2 id="api-usage-title">${esc(P.usage)}</h2><div class="api-actions"><div class="seg" role="group" aria-label="${esc(P.usage)}">${P.ranges.map((r: string, i: number) => `<button data-act="api-range" data-i="${i}" aria-selected="${V.apiRange === i}">${esc(r)}</button>`).join("")}</div><button type="button" class="icon-btn" data-act="api-usage-refresh" aria-label="${esc(usageRefreshLabel)}" title="${esc(usageRefreshLabel)}" aria-busy="${!!apiUsageAbort}" ${apiUsageAbort || saving ? "disabled" : ""}>${ic("refresh", 14)}</button><button class="btn sm" data-act="api-logs">${ic("list", 14)}${esc(words.logs)}</button></div></div><div class="api-stats" data-api-usage-metrics>${apiUsageMetrics()}</div></section>
        <div class="api-workspace"><section class="api-keys-panel" aria-labelledby="api-keys-title"><header class="api-panel-head"><h3 id="api-keys-title">${esc(P.mine)}</h3><span class="pill">${keys.length}</span></header><div class="api-panel-body">${keys.length ? `<div class="list api-key-list" tabindex="0" role="region" aria-label="${esc(P.mine)}">${keys.map((k: any) => `<div class="api-key-row ${apiKey?.id === Number(k.id) ? "is-selected" : ""}">${ic("key", 16)}<span class="grow api-key-copy"><b>${esc(k.name)}</b><small class="mono">${esc(k.prefix || ("…" + k.last4))}</small><small>${esc(dfmt(k.created))} · ${esc(k.limit === -1 ? keyUnlimitedLabel[D.lang] ?? keyUnlimitedLabel.en : k.limit === 0 ? keyDefaultLabel[D.lang] ?? keyDefaultLabel.en : money(k.limit) + "/mo")}</small></span><div class="api-key-actions"><button class="btn sm soft" data-act="key-limit" data-id="${esc(k.id)}">${esc(P.limit)}</button><button class="btn sm danger" data-act="revoke" data-id="${esc(k.id)}">${esc(P.revoke)}</button></div></div>`).join("")}</div>` : `<div class="empty api-key-empty"><div class="ico">${ic("key", 22)}</div><h3>${esc(P.empty)}</h3><p>${esc(P.emptySub)}</p><button class="btn pri" data-act="new-key" ${paid() ? "" : "disabled"}>${ic("plus", 14)}${esc(P.create)}</button></div>`}<p class="hint api-key-note">${esc(paid() ? claudeWords.keyBody : keyWords.restricted)}</p></div></section>
        <section class="api-quick-panel" aria-labelledby="api-quick-title"><header class="api-panel-head"><div><h3 id="api-quick-title">${esc(P.quick)}</h3><button class="api-url-copy" data-act="copy" data-text="${esc(quickBase)}" data-msg="${esc(A.common.copied)}" aria-label="${esc(P.baseUrl)} · ${esc(A.common.copy)}"><code>${esc(quickBase)}</code>${ic("copy", 12)}</button></div>${apiKeyControl}</header><div class="api-panel-body"><div class="seg api-client-tabs" role="group" aria-label="${esc(P.quick)}">${snippets.map(([n], i) => `<button data-act="quick" data-i="${i}" aria-selected="${V.quickTab === i}">${esc(n)}</button>`).join("")}</div>${claudeGuide}${quickEndpoint ? `<p class="hint quick-endpoint">${esc(zh ? "端点：" : "Endpoint: ")}${esc(quickEndpoint)}</p>` : ""}<p class="hint api-allowance-note">${esc(words.allowance)}</p></div></section></div>
        ${V.dataError ? `<p class="note" role="status">${esc(V.dataError)}</p>` : ""}
      </div></div>`;
  };

  const salesWords = manualSalesWords(D.lang);
  let couponIntent: { code: string; key: string } | null = null;
  const monthlyWords = subscriptionWords(D.lang);
  const monthlyFacts = (p: any) => `<p class="hint" data-monthly-share>${esc(monthlyWords.share)} · 1/${esc(p.tier)}${Number.isSafeInteger(p.multiplier) && p.multiplier > 0 ? ` · ${esc(p.multiplier)}×` : ""} · ${esc(fmt(marketWords.perPeriod, {days: p.period_days || 30}))}</p><p class="hint" data-monthly-stock>${esc(monthlySoldOut(p) ? monthlyWords.soldOut : p.held || p.current ? salesWords.renew : monthlyWords.available)} · ${esc(monthlyWords.noRenewal)}</p>`;
  const monthlyActions = (p: any, cls: string) => `<button class="btn ${cls}" data-act="contact-purchase" data-support-product="subscription" data-support-pool="${esc(p.pool_id)}" data-support-title="${esc(p.name)} · ${esc(monthlyWords.share)} 1/${esc(p.tier)}" data-support-amount="${esc(p.price_micro)}" data-support-days="${esc(p.period_days || 30)}" ${monthlySoldOut(p) ? "disabled" : ""}>${esc(monthlySoldOut(p) ? monthlyWords.soldOut : p.held || p.current ? salesWords.renew : salesWords.activate)}${ic("chevR", 14)}</button>`;

  const vMarket = () => {
    const W = marketWords;
    const q = V.marketQ.trim().toLocaleLowerCase(D.lang);
    const matches = (...values: unknown[]) => !q || values.join(" ").toLocaleLowerCase(D.lang).includes(q);
    const visible = (category: string) => V.marketTab === "all" || V.marketTab === category;
    const amount = (value: number, currency: string) => currency + new Intl.NumberFormat(D.lang, { maximumFractionDigits: 2 }).format(Math.max(0, Number(value) || 0) / 1_000_000);
    const period = (days: number) => fmt(W.perPeriod, { days });
    // Products, eligibility and prices remain server-owned; never populate a fallback catalog.
    const allPlans = (V.tokenPlans?.plans ?? []).filter((p: any) => p.enabled);
    const regularPlans = allPlans.filter((p: any) => !p.new_user_only).sort((a: any, b: any) => a.quota_usd_micro - b.quota_usd_micro);
    // Compare only plans with the same duration; trial prices are intentionally excluded.
    const comparable = regularPlans.filter((p: any) => p.quota_usd_micro > 0 && p.price_micro > 0);
    const samePeriod = comparable.length > 1 && comparable.every((p: any) => p.period_days === comparable[0].period_days);
    const best = samePeriod ? comparable.reduce((a: any, b: any) => a.price_micro / a.quota_usd_micro <= b.price_micro / b.quota_usd_micro ? a : b) : null;
    const tokenPlans = allPlans.filter((p: any) => matches(p.name, p.code, W.tokens));
    const trials = tokenPlans.filter((p: any) => p.new_user_only);
    const standard = regularPlans.filter((p: any) => tokenPlans.includes(p));
    const monthly = (V.subscriptions?.plans ?? []).filter((p: any) => matches(p.name, p.blurb, W.subscriptions));
    const models = (V.catalog?.models ?? []).filter(offeredModel).filter((m: any) => matches(m.display_name, m.model, (m.protocols || []).join(" "), W.models));
    const count = (visible("tokens") ? tokenPlans.length : 0) + (visible("subscriptions") ? monthly.length : 0) + (visible("models") ? models.length : 0);
    const ready = (!visible("tokens") || V.tokenPlans) && (!visible("subscriptions") || V.subscriptions) && (!visible("models") || V.catalog);
    const empty = (loaded: unknown) => `<div class="market-empty"><p>${esc(loaded ? words.notOffered : V.dataLoading ? words.loading : W.unavailable)}</p></div>`;
    const purchase = (p: any, cls: string) => `<button class="btn ${cls}" data-act="contact-purchase" data-support-product="token_plan" data-support-title="${esc(p.name)}" data-support-code="${esc(p.code)}" data-support-amount="${esc(p.price_micro)}" data-support-days="${esc(p.period_days)}">${esc(salesWords.activate)}${ic("chevR", 14)}</button>`;
    const trialCards = trials.map((p: any) => `<article class="market-trial">${ic("spark", 24)}<div class="market-trial-copy"><h3>${esc(p.name || W.trial)}</h3><p>${esc(planWords.guaranteedTotal)} ${amount(p.quota_usd_micro, "$")} · ${esc(p.period_days)} ${esc(planWords.period)}<br />${esc(planWords.newUser)}</p></div><div class="market-trial-price"><strong>${amount(p.price_micro, "¥")}</strong></div>${purchase(p, "market-trial-action")}</article>`).join("");
    const cards = standard.map((p: any) => `<article class="market-plan${p === best ? " is-featured" : ""}"><div class="market-plan-top"><span class="market-plan-icon">${ic("layers", 23)}</span><div><h3>${esc(p.name)}</h3><p>${esc(W.tokens)}</p></div>${p === best ? `<span class="market-plan-badge">${esc(W.bestValue)}</span>` : ""}</div><div class="market-plan-price"><strong>${amount(p.price_micro, "¥")}</strong><small>${esc(period(p.period_days))}</small></div><div class="market-plan-quota"><span>${esc(planWords.guaranteedTotal)}</span><strong>${amount(p.quota_usd_micro, "$")}</strong></div>${p.burst_usd_micro > p.quota_usd_micro ? `<div class="market-plan-burst"><span>${esc(planWords.burstMax)}</span><strong>${amount(p.burst_usd_micro, "$")}</strong></div>` : ""}<div class="market-plan-foot"><p>${esc(p.burst_usd_micro > p.quota_usd_micro ? W.capacity : W.noRenewal)}</p>${purchase(p, "market-plan-action")}</div></article>`).join("");
    const tokenSection = visible("tokens") && (!q || tokenPlans.length) ? `<section class="market-section" data-token-plan-catalog aria-labelledby="market-token-title">${trialCards}<div class="market-section-head"><div class="market-section-copy"><h2 id="market-token-title">${esc(W.tokens)}</h2><p>${esc(W.tokenIntro)}</p></div><span>${esc(W.noRenewal)}</span></div>${cards ? `<div class="market-plans-grid">${cards}</div>` : !trials.length ? empty(V.tokenPlans) : ""}<p class="market-rules">${ic("info", 15)}<span>${esc(W.rules)}</span></p><p class="market-note">${esc(salesWords.rule)}</p></section>` : "";
    const monthlySection = visible("subscriptions") && (!q || monthly.length) ? `<section class="market-section" data-market-subscriptions aria-labelledby="market-monthly-title"><div class="market-section-head"><div class="market-section-copy"><h2 id="market-monthly-title">${esc(W.subscriptions)}</h2><p>${esc(W.subscriptionIntro)}</p></div></div>${monthly.length ? `<div class="market-subscriptions-grid">${monthly.map((p: any) => `<article class="market-subscription"><span class="market-subscription-icon">${ic("users", 22)}</span><div class="market-subscription-copy"><h3>${esc(p.name)}</h3><p>${esc(p.blurb || "")}</p>${monthlyFacts(p)}</div><div class="market-subscription-price"><strong>${amount(p.price_micro, "¥")}</strong><small>${esc(p.period_days > 0 ? period(p.period_days) : words.monthly)}</small></div><div class="stack">${monthlyActions(p,"market-subscription-action")}</div></article>`).join("")}</div>` : empty(V.subscriptions)}<p class="market-note">${esc(salesWords.rule)}</p></section>` : "";
    const modelPrice = (m: any, field: string) => m.list_priced && typeof m[field] === "number" && Number.isFinite(m[field]) && m[field] >= 0 ? money2(m[field] / 1_000_000) : "—";
    const modelSection = visible("models") && (!q || models.length) ? `<section class="market-section" data-market-models aria-labelledby="market-model-title"><div class="market-section-head"><div class="market-section-copy"><h2 id="market-model-title">${esc(W.models)}</h2><p>${esc(W.modelIntro)}</p></div><a class="btn sm" href="#/api">${esc(A.account.apiKey)}${ic("ext", 13)}</a></div>${models.length ? `<div class="market-model-table-wrap" tabindex="0" role="region" aria-labelledby="market-model-title"><table class="market-model-table"><thead><tr><th scope="col">${esc(W.model)}</th><th scope="col">${esc(W.input)}</th><th scope="col">${esc(W.output)}</th><th scope="col">${esc(W.protocol)}</th></tr></thead><tbody>${models.map((m: any) => `<tr><th scope="row"><div class="market-model-name">${ic("box", 18)}<span>${esc(m.display_name || m.model)}<small class="market-model-provider">${esc(m.model)}</small></span></div></th><td>${modelPrice(m, "usd_in")}</td><td>${modelPrice(m, "usd_out")}</td><td>${esc([["web_chat", monthlyWords.web], ["claude_code", monthlyWords.cli], ["api", monthlyWords.api]].filter(([client]) => Array.isArray(m.client_formats?.[client]) && m.client_formats[client].length > 0).map(([, label]) => label).join(" · ") || "—")}</td></tr>`).join("")}</tbody></table></div>` : empty(V.catalog)}</section>` : "";
    const filters = [["all", W.all], ["tokens", W.tokens], ["subscriptions", W.subscriptions], ["models", W.models]];
    return `<header class="market-heading"><div><p class="market-eyebrow">FELLS MARKET</p><h1>${esc(W.title)}</h1><p class="market-intro">${esc(W.intro)}</p></div><a class="market-account-link" href="#/billing/credits">${ic("layers", 22)}<span><strong>${esc(W.manage)}</strong><small>${esc(W.manageHint)}</small></span>${ic("chevR", 16)}</a></header>
      <div class="market-toolbar"><div class="market-tabs" role="group" aria-label="${esc(W.categories)}">${filters.map(([id, label]) => `<button type="button" data-act="mtab" data-v="${id}" aria-pressed="${V.marketTab === id}">${esc(label)}</button>`).join("")}</div><label class="market-search">${ic("search", 17)}<input type="search" data-input="marketQ" value="${esc(V.marketQ)}" placeholder="${esc(W.search)}" aria-label="${esc(W.search)}" /></label></div>
      ${q ? `<p class="market-result-count" role="status">${esc(ready ? fmt(W.count, { n: count }) : V.dataLoading ? words.loading : W.unavailable)}</p>` : ""}
      ${q && !count && ready ? `<div class="market-empty">${ic("search", 28)}<h2>${esc(W.noMatch)}</h2><p>${esc(W.noMatchHint)}</p><button class="btn" data-act="market-clear">${esc(W.clear)}</button></div>` : tokenSection + monthlySection + modelSection}${!ready && q && !count ? empty(null) : ""}`;
  };

  // Wallet currencies and subscriptions are separate server-owned products.
  const exchangeHistoryPanel = () => {
    const history: ExchangeHistory | null = V.history;
    const controls = `<div class="exchange-history-head"><h4>${esc(historyWords.title)}</h4><button class="btn sm" data-act="history-retry" data-history-retry ${V.historyLoading ? "disabled" : ""}>${ic("refresh", 13)}${esc(historyWords.refresh)}</button></div><div class="seg" role="group" aria-label="${esc(historyWords.title)}">${[7, 30, 90].map(days => `<button data-act="history-range" data-history-range="${days}" aria-pressed="${V.historyRange === days}">${esc(fmt(historyWords.days, { n: days }))}</button>`).join("")}</div>`;
    if (!history) return `<section class="exchange-history" data-exchange-history>${controls}<p role="status" data-history-error ${V.historyLoading ? "hidden" : ""}>${esc(V.historyLoading ? words.loading : V.historyError || historyWords.error)}</p>${V.historyLoading ? `<p role="status">${esc(words.loading)}</p>` : ""}</section>`;
    const latest = history.points.at(-1)!;
    const values = history.points.flatMap(point => [Number(point.reference_rate), Number(point.exchange_rate)]);
    const low = Math.min(...values), high = Math.max(...values), span = high - low || .01;
    const firstDate = Date.parse(history.points[0].date), dateSpan = Date.parse(latest.date) - firstDate || 1;
    const line = (field: "reference_rate" | "exchange_rate") => history.points.map(point => `${(8 + (Date.parse(point.date) - firstDate) / dateSpan * 344).toFixed(2)},${(72 - (Number(point[field]) - low) / span * 56).toFixed(2)}`).join(" ");
    return `<section class="exchange-history" data-exchange-history>${controls}
      <div class="exchange-history-values"><div><small>${esc(historyWords.reference)}</small><strong>${esc(latest.reference_rate)}</strong></div><div><small>${esc(historyWords.exchange)}</small><strong>${esc(latest.exchange_rate)}</strong></div></div>
      ${history.stale ? `<p class="note" role="status" data-history-stale>${esc(historyWords.stale)}</p>` : ""}
      <svg class="exchange-history-chart" data-history-chart viewBox="0 0 360 84" role="img" aria-label="${esc(historyWords.title)} · ${esc(history.points[0].date)} – ${esc(latest.date)}"><title>${esc(historyWords.reference)} / ${esc(historyWords.exchange)} · CNY / USD</title><polyline class="reference" points="${line("reference_rate")}"/><polyline class="exchange" points="${line("exchange_rate")}"/>${history.points.map(point => `<circle cx="${(8 + (Date.parse(point.date) - firstDate) / dateSpan * 344).toFixed(2)}" cy="${(72 - (Number(point.reference_rate) - low) / span * 56).toFixed(2)}" r="2"><title>${esc(point.date)} · ${esc(point.reference_rate)} / ${esc(point.exchange_rate)}</title></circle>`).join("")}</svg>
      <div class="exchange-history-axis"><small>${esc(history.points[0].date)}</small><small>${esc(latest.date)}</small></div>
      <p class="hint">${esc(historyWords.published)} ${esc(history.as_of)} · ${esc(historyWords.updated)} ${esc(tfmt(Date.parse(history.fetched_at)))}</p><p class="hint">CNY / 1 USD · ECB × 1.001 <a href="${esc(history.source_url)}" target="_blank" rel="noopener noreferrer">ECB${ic("ext", 11)}</a></p>
      <details data-history-table><summary>${esc(historyWords.details)}</summary><p class="hint">${esc(historyWords.note)}</p><div class="exchange-history-table" tabindex="0" role="region" aria-label="${esc(historyWords.details)}"><table><thead><tr><th scope="col">${esc(historyWords.published)}</th><th scope="col">${esc(historyWords.reference)}</th><th scope="col">${esc(historyWords.exchange)}</th></tr></thead><tbody>${[...history.points].reverse().map(point => `<tr><th scope="row">${esc(point.date)}</th><td>${esc(point.reference_rate)}</td><td>${esc(point.exchange_rate)}</td></tr>`).join("")}</tbody></table></div></details></section>`;
  };
  let inspectedPurchase: PurchaseOperation | null = null;
  const recoveryItems = (): PurchaseOperation[] => {
    const value = V.unconfirmed;
    if (!value || !Array.isArray(value.operations)) return [];
    return value.operations.flatMap((row: unknown) => { try { return [parsePurchaseOperation(row)]; } catch { return []; } });
  };
  const purchaseRecoveryPanel = () => {
    const rows = recoveryItems();
    return rows.length ? `<section class="card pad" data-purchase-operations><h3>${esc(salesWords.operations)}</h3><p class="hint">${esc(salesWords.pollOnly)}</p><div class="list">${rows.map(row => `<div><span class="grow"><b>${esc(purchaseOperationStatus(row, D.lang))}</b><small>${esc(tfmt(Date.parse(row.created_at)))}</small></span><button class="btn sm" data-act="operation-get" data-id="${esc(row.operation_id)}">${esc(salesWords.verify)}</button></div>`).join("")}</div>${V.unconfirmed.has_more && typeof V.unconfirmed.next_cursor === "string" ? `<button class="btn sm" data-act="operation-next" data-cursor="${esc(V.unconfirmed.next_cursor)}">${esc(salesWords.next)}</button>` : ""}</section>` : "";
  };
  const showPurchaseReceipt = (operation: PurchaseOperation) => {
    inspectedPurchase = operation;
    const evidence = operation.evidence;
    const rows: [string, string][] = [];
    if (Number.isSafeInteger(evidence.cash_micro) && Number(evidence.cash_micro) >= 0) rows.push([fx.cash, `CNY ${microText(Number(evidence.cash_micro))}`]);
    if (Number.isSafeInteger(evidence.allowance_micro) && Number(evidence.allowance_micro) >= 0) rows.push([words.allowance, `USD ${microText(Number(evidence.allowance_micro))}`]);
    if (Number.isSafeInteger(evidence.period_end) && Number(evidence.period_end) > 0) rows.push([planWords.to, new Date(Number(evidence.period_end) * 1000).toLocaleString(D.lang)]);
    openDlg(`${xBtn()}<h2>${esc(salesWords.operations)}</h2><div class="body stack" data-operation-receipt data-status="${esc(operation.status)}"><h3>${esc(purchaseOperationStatus(operation, D.lang))}</h3><p>${esc(salesWords.pollOnly)}</p><dl class="currency-quote">${rows.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl>${operation.status === "pending" ? `<p>${esc(salesWords.reconcile)}</p><button class="btn" data-act="operation-get" data-id="${esc(operation.operation_id)}">${esc(salesWords.verify)}</button><button class="btn" data-act="contact-purchase" data-support-title="${esc(salesWords.operations + " · " + operation.operation_id)}">${esc(contactPurchase)}</button>` : `<button class="btn pri" data-act="operation-ack" data-id="${esc(operation.operation_id)}">${esc(salesWords.ack)}</button>`}</div>`);
  };
  const openPurchaseList = async (cursor?: string) => {
    const value = await accountAction(() => accountApi.unconfirmedPurchases(cursor));
    if (!value || ended) return;
    V.unconfirmed = value;
    const rows = recoveryItems();
    if (rows.length === 1) showPurchaseReceipt(rows[0]);
    else openDlg(`${xBtn()}<h2>${esc(salesWords.operations)}</h2><div class="body stack">${purchaseRecoveryPanel() || `<p>${esc(words.empty)}</p>`}</div>`);
  };
  const inspectPurchase = async (id: string) => {
    const result = await accountAction(() => accountApi.purchaseOperation(id));
    if (!result || ended) return;
    try { showPurchaseReceipt(parsePurchaseOperation(result)); } catch { toast(salesWords.reconcile); }
  };
  const vBilling = (tab: string) => {
    const B = A.billing, t = tab === "credits" ? 1 : 0;
    const seg = `<div class="seg" role="tablist">${B.tabs.map((x: string, i: number) => `<button role="tab" data-go="billing/${i ? "credits" : "market"}" aria-selected="${t === i}">${esc(i ? words.wallet : x)}</button>`).join("")}</div>`;
    const b = getAppBootstrap()!;
    const usdMicro = (value: number) => money2(Math.max(0, Number(value) || 0) / 1_000_000);
    const currentPlan = V.tokenPlans?.current;
    const queuedPlan = currentPlan?.queued;
    const tokenPlanStatus = `<section data-token-plan><div class="sec-title"><h3>${esc(planWords.title)}</h3></div><p class="note">${esc(billingRules.tokenPlan)}</p><div class="card list">${currentPlan ? `<div><span class="grow"><b>${esc(currentPlan.name || currentPlan.plan_code)} · ${esc(planWords.current)}</b><small>${esc(planWords.until)} ${esc(dfmt(currentPlan.period_end * 1000))}</small></span></div><div><span class="grow"><b>${esc(planWords.guaranteed)}</b><small>${usdMicro(currentPlan.remaining_guaranteed_usd_micro)} ${esc(planWords.of)} ${usdMicro(currentPlan.quota_usd_micro)}</small></span></div>${currentPlan.burst_usd_micro > currentPlan.quota_usd_micro ? `<div><span class="grow"><b>${esc(planWords.burst)}</b><small>${usdMicro(currentPlan.remaining_burst_usd_micro)} · ${esc(currentPlan.burst_allowed ? planWords.burstOpen : planWords.burstClosed)} ${esc(planWords.burstNote)}</small></span></div>` : ""}${queuedPlan ? `<div><span class="grow"><b>${esc(planWords.next)} · ${esc(queuedPlan.plan_code)}</b><small>${esc(planWords.from)} ${esc(dfmt(queuedPlan.period_start * 1000))} · ${esc(planWords.to)} ${esc(dfmt(queuedPlan.period_end * 1000))}</small></span></div>` : ""}` : `<div class="muted">${esc(V.tokenPlans ? planWords.noActive : V.dataLoading ? words.loading : planWords.noData)}</div>`}</div></section>`;
    const plans = V.subscriptions?.plans ?? [];
    const planCards = plans.map((p: any) => `<div class="chan"><h4>${esc(p.name)}</h4><p>${esc(p.blurb ?? "")}</p>${monthlyFacts(p)}<div class="between"><span class="price">${cny(p.price_micro / 1_000_000)}<small>${esc(fmt(marketWords.perPeriod, {days: p.period_days || 30}))}</small></span><div class="stack">${monthlyActions(p,"sm pri")}</div></div></div>`).join("");
    const subscriptions = `<section><div class="sec-title"><h3>${esc(B.plans)}</h3></div><div class="grid2">${planCards || `<p class="muted">${esc(V.subscriptions ? words.notOffered : words.loading)}</p>`}</div></section>`;
    const rides = V.subscriptions?.rides ?? [];
    const rideMode = V.subscriptions?.preferred_ride_mode;
    const rideModeControl = V.subscriptions ? `<div class="row wrap" style="margin:0 0 12px"><span class="muted">${esc(zh ? "使用方式" : "Usage mode")}</span><button class="btn sm ${rideMode === "monthly" ? "pri" : "soft"}" data-act="set-ride-mode" data-mode="monthly" ${rideMode === "monthly" ? "aria-pressed=true" : "aria-pressed=false"}>${esc(words.monthlyRideMode)}</button><button class="btn sm ${rideMode === "allowance" ? "pri" : "soft"}" data-act="set-ride-mode" data-mode="allowance" ${rideMode === "allowance" ? "aria-pressed=true" : "aria-pressed=false"}>${esc(words.allowanceRideMode)}</button></div>` : "";
    const mySubscriptions = `<section><div class="sec-title"><h3>${esc(words.mySubscriptions)}</h3></div><p class="note">${esc(words.manualBillingMode)}</p>${rideModeControl}<div class="card list">${rides.map((ride: any) => `<div><span class="grow"><b>${esc(ride.pool_name)} · ${esc(monthlyWords.share)} 1/${esc(ride.tier)}${Number.isSafeInteger(ride.multiplier) && ride.multiplier > 0 ? ` · ${esc(ride.multiplier)}×` : ""}${ride.current ? ` · ${esc(words.currentRide)}` : ""}</b><small>${esc(words.expires)} ${esc(dfmt(Number(ride.expires_at) * 1000))} · ${esc(ride.seated ? monthlyWords.allocated : monthlyWords.pending)}</small></span>${!ride.current && Number.isSafeInteger(Number(ride.pool_id)) && Number(ride.pool_id) > 0 ? `<button class="btn sm" data-act="set-current-ride" data-id="${esc(ride.pool_id)}">${esc(words.makeCurrentRide)}</button>` : ""}</div>`).join("") || `<div class="muted">${esc(V.subscriptions ? words.notOffered : words.loading)}</div>`}</div></section>`;
    const coupons = V.coupons?.coupons ?? [];
    const couponWallet = `<section><div class="sec-title"><h3>${esc(words.couponWallet)}</h3></div><form class="row wrap" data-form="coupon-claim"><label class="f">${esc(salesWords.couponCode)}<input name="code" maxlength="120" required value="${esc(couponIntent?.code ?? "")}" ${couponIntent ? "readonly" : ""} /></label><button class="btn">${esc(salesWords.claim)}</button></form><div class="card list">${coupons.map((coupon: any) => `<div><span class="grow"><b>${esc(coupon.name || coupon.terms || (zh ? "优惠券" : "Coupon"))}</b><small>${esc(coupon.terms || "")} · ${esc(words.couponStatus)}: ${esc(words.couponStates[coupon.state as keyof typeof words.couponStates] || coupon.state)}${coupon.expires_at ? ` · ${esc(words.expires)} ${esc(dfmt(Number(coupon.expires_at) * 1000))}` : ""}</small></span><button class="btn sm" data-act="contact-purchase">${esc(contactPurchase)}</button></div>`).join("") || `<div class="muted">${esc(V.coupons ? words.empty : words.loading)}</div>`}</div></section>`;
    const invoiceFiles = V.invoices?.files ?? [];
    const invoiceList = `<section><div class="sec-title"><h3>${esc(words.invoices)}</h3></div><div class="card list">${invoiceFiles.map((file: any) => `<div><span class="grow"><b>${esc(file.filename)}</b><small>#${esc(file.topup_id)} · ${esc(dfmt(Number(file.uploaded_at) * 1000))} · ${(Number(file.size_bytes) / 1024).toFixed(0)} KB</small></span><a class="btn sm" href="/api/app/invoices/${encodeURIComponent(String(file.id))}" target="_blank" rel="noopener">${esc(words.download)}</a></div>`).join("") || `<div class="muted">${esc(V.invoices ? salesWords.invoice : words.loading)}</div>`}</div></section>`;
    let body: string;
    if (t === 0) {
      body = vMarket();
    } else {
      const entries = V.ledger?.entries ?? V.ledger?.items ?? [];
      const walletTabs = [["plans", B.plans], ["ledger", words.ledger], ["coupons", words.couponWallet], ["invoices", words.invoices]];
      const walletTab = walletTabs.some(([id]) => id === V.walletTab) ? V.walletTab : "plans";
      const ledger = `<section><div class="sec-title"><h3>${esc(words.ledger)}</h3></div><div class="card list">${entries.map((e: any) => `<div><span class="grow">${esc(ledgerKind(e.kind, D.lang))}${e.memo ? `<small>${esc(e.memo)}</small>` : ""}<small>${esc(dfmt(Number(e.created_at) * 1000))}</small></span><b>${cny(Number(e.delta_micro) / 1_000_000)}</b></div>`).join("") || `<div class="muted">${esc(V.ledger ? words.empty : words.loading)}</div>`}</div><div class="row wrap" data-ledger-pagination><button class="btn sm" data-act="ledger-page" data-page="${V.ledgerPage - 1}" ${V.ledgerPage <= 1 ? "disabled" : ""}>${esc(salesWords.previous)}</button><span>${V.ledgerPage}</span><button class="btn sm" data-act="ledger-page" data-page="${V.ledgerPage + 1}" ${!(Number(V.ledger?.total) > V.ledgerPage * Number(V.ledger?.size || 15)) ? "disabled" : ""}>${esc(salesWords.next)}</button></div></section>`;
      const walletDetails = walletTab === "ledger" ? ledger : walletTab === "coupons" ? couponWallet : walletTab === "invoices" ? invoiceList : `${tokenPlanStatus}${mySubscriptions}${subscriptions}`;
      body = `<div class="wallet-summary-grid"><section class="wallet-summary-card is-primary"><small>${esc(words.cash)}</small><strong class="wallet-summary-value">${cny(cashBalance())}</strong><button class="btn sm" data-act="contact-purchase">${ic("plus", 14)}${esc(fx.fund)}</button></section><section class="wallet-summary-card"><small>${esc(words.grant)}</small><strong class="wallet-summary-value">${cny(b.wallet.grant_micro / 1_000_000)}</strong></section><section class="wallet-summary-card" data-api-available-credit><small>${esc(funding().explicit ? chatFunding.availableAllowance : words.allowance)}</small><strong class="wallet-summary-value">${money2(balance())}</strong><p class="wallet-summary-caption">${esc(words.expires)} ${bonusExpiry() ? esc(dfmt(bonusExpiry())) : "—"}</p>${occupiedFunding()}</section></div>
        ${purchaseRecoveryPanel()}
        <div class="wallet-workspace"><section class="wallet-exchange-panel" data-currency-exchange aria-labelledby="wallet-exchange-title"><header class="wallet-panel-head"><h3 id="wallet-exchange-title">${esc(words.allowance)}</h3>${ic("card", 19)}</header><div class="wallet-panel-body"><p>${esc(salesWords.rule)}</p><button class="btn pri wide" data-act="contact-purchase" data-support-product="allowance" data-support-title="${esc(salesWords.allowance)}">${esc(salesWords.allowance)}${ic("chevR", 15)}</button><button class="btn" data-act="operation-list">${esc(salesWords.operations)}</button><details class="wallet-exchange-terms"><summary>${esc(historyWords.terms)}</summary><p class="hint">${esc(words.allowanceTerms)}</p></details>${exchangeHistoryPanel()}</div></section>
        <section class="wallet-details-panel" aria-labelledby="wallet-details-title"><header class="wallet-panel-head"><h3 id="wallet-details-title">${esc(B.tabs[1])}</h3><a class="btn sm" href="#/billing/market">${esc(B.browse)}${ic("chevR", 13)}</a></header><div class="wallet-panel-body"><div class="wallet-tabs" role="tablist" aria-label="${esc(B.tabs[1])}">${walletTabs.map(([id, label]) => `<button id="wallet-tab-${id}" role="tab" aria-selected="${walletTab === id}" aria-controls="wallet-panel-${walletTab}" data-act="wallet-tab" data-v="${id}">${esc(label)}</button>`).join("")}</div><div class="wallet-detail-content" id="wallet-panel-${walletTab}" role="tabpanel" aria-labelledby="wallet-tab-${walletTab}" tabindex="0">${walletDetails}</div></div></section></div>`;
    }
    if (V.dataError) body += `<p class="note" role="status">${esc(V.dataError)}</p>`;
    return `${bar(t === 0 ? B.title : B.tabs[1], B.sub, seg + (t === 1 ? `<button type="button" class="icon-btn" data-open-customer-support aria-label="${esc(A.nav.help)}" title="${esc(A.nav.help)}"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 12a8 8 0 0 1 16 0v5a3 3 0 0 1-3 3h-3M4 11h3v6H4zM17 11h3v6h-3zM10 19h4v2h-4z" /></svg></button>` : ""))}<div class="scroll"><div class="${t === 0 ? "page market-page" : "page wallet-page"}">${body}</div></div>`;
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
      case "members": return vMembers();
      case "invitations": return vInvitations();
      case "ws-settings": return vWsSettings();
      case "settings": return vUser(Math.min(3, Number(r.arg) || 0));
      case "api": return vApi();
      case "billing": return vBilling(r.arg);
      default: return vNotFound();
    }
  };
  let renderedSidebar = "", renderedMain = "";
  const render = () => {
    applyTheme();
    const sameView = root.dataset.route === location.hash && root.dataset.workspace === S.current;
    const oldMarketSearch = sameView ? root.querySelector<HTMLInputElement>('[data-input="marketQ"]') : null;
    // A pending account refresh is rendered when compositionend commits the query.
    if (marketComposing && oldMarketSearch && document.activeElement === oldMarketSearch) return;
    // A route/workspace change can remove the input before compositionend bubbles.
    marketComposing = false;
    const search = oldMarketSearch && document.activeElement === oldMarketSearch ? { value: oldMarketSearch.value, start: oldMarketSearch.selectionStart, end: oldMarketSearch.selectionEnd } : null;
    const oldInput = sameView ? root.querySelector<HTMLTextAreaElement>('[data-form=send][data-chat] #fx-input') : null;
    const oldChatID = oldInput?.closest<HTMLFormElement>("[data-form=send]")?.dataset.chat;
    const draft = oldInput ? { value: oldChatID ? chatDrafts.get(oldChatID) ?? oldInput.value : oldInput.value, start: oldInput.selectionStart, end: oldInput.selectionEnd, focused: document.activeElement === oldInput } : null;
    const currentIdentity = getAppBootstrap();
    const sameIdentity = !ended && committed?.session === fxIdentity.session_id && currentIdentity?.user.id === fxIdentity.user.id && currentIdentity?.session_id === fxIdentity.session_id;
    const oldFileForm = sameView && sameIdentity ? root.querySelector<HTMLFormElement>('[data-form=send]') : null;
    const oldFileInput = oldFileForm?.querySelector<HTMLInputElement>('[data-chat-file-input]');
    const oldFileChat = oldFileForm?.dataset.chat;
    const status = root.querySelector<HTMLElement>(".toast");
    const dialog = dlgEl;
    const dialogFocus = dialog?.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    const sidebarScrim = root.querySelector<HTMLElement>(".sb-scrim");
    root.classList.toggle("sb-hidden", !!S.sbHidden);
    const scroll = root.querySelector<HTMLElement>(".main .scroll");
    const keep = scroll && root.dataset.route === location.hash ? scroll.scrollTop : 0;
    const followThread = !sameView || !scroll || !scroll.matches("[data-thread]") || scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight <= 64;
    const sidebarHTML = sidebar(), mainHTML = main();
    const oldSidebar = root.querySelector<HTMLElement>(":scope > .sb"), oldMain = root.querySelector<HTMLElement>(":scope > .main");
    if (!oldSidebar || !oldMain) root.innerHTML = `${sidebarHTML}<main class="main" id="fx-main">${mainHTML}</main>`;
    else {
      if (sidebarHTML !== renderedSidebar) oldSidebar.outerHTML = sidebarHTML;
      if (mainHTML !== renderedMain) {
        // Park the original hidden input outside the subtree being replaced.
        if (oldFileInput) root.appendChild(oldFileInput);
        oldMain.innerHTML = mainHTML;
      }
    }
    renderedSidebar = sidebarHTML; renderedMain = mainHTML;
    const nextFileForm = root.querySelector<HTMLFormElement>('[data-form=send]');
    const nextFileInput = nextFileForm?.querySelector<HTMLInputElement>('[data-chat-file-input]');
    // A live file chooser targets its original input. Preserve that node only
    // within this exact account/draft; a different chat or workspace gets a new one.
    if (oldFileInput && nextFileInput && oldFileInput !== nextFileInput && nextFileForm?.dataset.chat === oldFileChat) {
      oldFileInput.accept = nextFileInput.accept;
      oldFileInput.multiple = nextFileInput.multiple;
      oldFileInput.disabled = nextFileInput.disabled;
      nextFileInput.replaceWith(oldFileInput);
    } else if (oldFileInput?.parentElement === root) oldFileInput.remove();
    if (status) root.appendChild(status);
    if (dialog) { root.appendChild(dialog); dialogFocus?.focus({ preventScroll: true }); }
    if (sidebarScrim) root.appendChild(sidebarScrim);
    root.dataset.route = location.hash;
    root.dataset.workspace = S.current;
    const input = root.querySelector<HTMLTextAreaElement>('[data-form=send][data-chat] #fx-input');
    if (draft && input) {
      input.value = draft.value;
      input.setSelectionRange(draft.start, draft.end);
      if (draft.focused) input.focus({ preventScroll: true });
    }
    if (!draft && input && !input.value && recoveredDraft?.route === location.hash && recoveredDraft.workspace === S.current) {
      input.value = recoveredDraft.text; recoveredDraft = null; clearChatDraft();
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    const marketSearch = root.querySelector<HTMLInputElement>('[data-input="marketQ"]');
    if (search && marketSearch) {
      marketSearch.value = search.value;
      marketSearch.focus({ preventScroll: true });
      if (search.start !== null && search.end !== null) marketSearch.setSelectionRange(search.start, search.end);
    }
    const s2 = root.querySelector<HTMLElement>(".main .scroll");
    if (s2) s2.scrollTop = s2.matches("[data-thread]") && followThread ? s2.scrollHeight : keep;
    syncLatestMessageButton();
    document.title = A.metaTitle + (wsName() ? " · " + wsName() : "");
    syncApiUsage();
    syncChatPolling();
    syncChatProgress();
    attachments?.sync();
  };

  function syncLatestMessageButton() {
    const thread = root.querySelector<HTMLElement>("[data-thread]"), button = root.querySelector<HTMLButtonElement>("[data-chat-latest]");
    if (thread && button) button.hidden = thread.scrollHeight - thread.scrollTop - thread.clientHeight <= 64;
  }
  root.addEventListener("scroll", event => { if ((event.target as HTMLElement).matches?.("[data-thread]")) syncLatestMessageButton(); }, true);
  root.addEventListener("click", event => {
    if (!(event.target as HTMLElement).closest?.("[data-chat-latest]")) return;
    const thread = root.querySelector<HTMLElement>("[data-thread]");
    if (thread) thread.scrollTop = thread.scrollHeight;
    syncLatestMessageButton();
  });

  // ---------- popovers ----------
  let popEl: HTMLElement | null = null;
  let popAnchor: HTMLElement | null = null;
  const closePop = () => { popEl?.remove(); popEl = null; popAnchor = null; };
  const openPop = (anchor: HTMLElement, html: string, cls = "") => {
    // Nested menus replace their parent, so measure the trigger while it is still attached.
    const r = anchor.getBoundingClientRect();
    closePop();
    popAnchor = anchor;
    const el = document.createElement("div");
    el.className = "pop " + cls;
    el.setAttribute("role", "menu");
    el.innerHTML = html;
    root.appendChild(el);
    const w = el.offsetWidth, h = el.offsetHeight;
    let top = r.bottom + 6;
    if (top + h > innerHeight - 8) top = Math.max(8, r.top - h - 6);
    let left = Math.min(r.left, innerWidth - w - 8);
    left = Math.max(8, left);
    el.style.top = top + "px";
    el.style.left = left + "px";
    popEl = el;
    el.querySelector<HTMLElement>("input,button,a[href]")?.focus({ preventScroll: true });
    return el;
  };
  const switcherMenu = () => `
    <div class="ph">${esc(A.switcher.title)}</div>
    ${S.workspaces.length ? S.workspaces.map((w) => `<button class="mi" data-act="switch" data-id="${esc(w.id)}"><span class="ws-ic">${esc(initials(w.name).slice(0, 1))}</span><span class="grow">${esc(w.name)}<small>${esc(A.members.roles[getAppWorkspaceRole(w.id) || "viewer"][0])}</small></span>${S.current === w.id ? ic("check", 16) : ""}</button>`).join("") : `<p class="ph">${esc(A.switcher.none)}</p>`}
    <hr /><div class="ph">${esc(A.switcher.examples)}</div>
    <button class="mi" data-act="switch" data-id="example"><span class="ws-ic" style="background:#5865f2;color:#fff">L</span><span class="grow">${esc(A.example.name)}<small>${esc(A.example.body)}</small></span><span class="tag">${esc(A.switcher.readOnly)}</span>${isExample() ? ic("check", 16) : ""}</button>
    <hr /><button class="mi" data-act="new-ws">${ic("plus", 16)}${esc(A.switcher.newWs)}</button>`;
  const accountMenu = () => `
    <div class="acct-head"><div class="row">${avatar()}<div style="min-width:0"><b>${esc(displayName())}</b>${S.email ? `<small class="muted">${esc(S.email)}</small>` : ""}</div></div></div>
    <div class="credit-row"><div><small class="muted">${esc(balanceLabel())}</small><b style="display:block">${money2(balance())}</b><small class="dim">${bonusExpiry() ? esc(dfmt(bonusExpiry())) : "—"}</small></div><button class="btn sm pri" data-go="billing/credits">${esc(contactPurchase)}</button></div>
    <div class="account-links"><button class="mi wide" data-go="billing/market">${ic("store", 16)}<span class="grow">${esc(A.account.market)}</span><span class="end">${esc(A.account.noPlan)}</span></button></div>
    <button class="invite-banner" data-act="invite">${ic("gift", 18)}<span><b>${esc(A.account.invite)}</b><small>${esc(zh ? "查看当前推荐奖励规则" : "View current referral terms")}</small></span></button>
    <div class="account-links">
      <button class="mi" data-go="settings/0">${ic("gear", 16)}${esc(A.account.settings)}</button>
      <button class="mi" data-go="api">${ic("key", 16)}${esc(A.account.apiKey)}</button>
      <button class="mi" data-go="billing/credits">${ic("card", 16)}${esc(words.wallet)}</button>
      <button class="mi" data-act="agreement">${ic("book", 16)}${esc(words.accept)}</button>
      <button class="mi" data-act="changelog">${ic("spark", 16)}${esc(A.account.changelog)}</button>
      <button class="mi" data-act="help">${ic("book", 16)}${esc(A.account.help)}</button>
      <a class="mi" href="${esc(D.links.home)}">${ic("globe", 16)}<span class="grow">${esc(A.account.website)}</span>${ic("ext", 13)}</a>
      <a class="mi" href="${esc(D.links.start)}#login" data-act="logout">${ic("logout", 16)}${esc(A.account.logout)}</a>
    </div>
    <hr />
    <div class="foot-row"><div class="seg" aria-label="${esc(A.account.theme)}">${(["system", "light", "dark"] as const).map((t) => `<button data-act="theme" data-v="${t}" aria-pressed="${S.theme === t}" title="${esc(A.account.themes[t])}" aria-label="${esc(A.account.themes[t])}">${ic(t === "system" ? "system" : t === "light" ? "sun" : "moon", 14)}</button>`).join("")}</div>
    <button class="btn sm soft" data-act="lang">${ic("lang", 14)}${esc(D.locales.find((l: any) => l.current)?.label || "")}</button></div>`;
  const modelMenu = (agentId: string, q = "") => {
    const agent = agentById(agentId);
    const ms = modelsFor(agent).filter((m: any) => !q || (m.name + " " + (m.label || "") + " " + m.provider).toLowerCase().includes(q.toLowerCase()));
    const cur = V.menuChat ? V.chatModel?.[V.menuChat] ?? S.chats.find((c) => c.id === V.menuChat)?.model : currentModel(agent);
    if (modelChatEnabled() && !isExample()) return `<div class="search"><input type="search" data-input="modelQ" value="${esc(q)}" placeholder="${esc(A.newChat.modelSearch)}" aria-label="${esc(A.newChat.modelSearch)}" /></div><div data-mlist>${ms.map((m: any) => `<button class="mi" data-act="pick-model" data-name="${esc(m.name)}"><span class="grow">${esc(m.label)}${V.chatCatalog?.web_search?.available === true && m.web_search === true ? ` <span class="chat-search-badge" data-web-supported>${ic("globe", 12)}${esc(searchWords.label)}</span>` : ""}<small>${esc(m.name)} · ${esc(m.formats.join(" · "))}</small></span>${cur === m.name ? ic("check", 16) : ""}</button>`).join("") || `<p class="ph">${esc(A.newChat.noModel)}</p>`}</div>`;
    const groups: Record<string, any[]> = {};
    for (const m of ms) (groups[m.provider || agent.maker] ||= []).push(m);
    const list = Object.entries(groups)
      .map(([p, arr]) => `<div class="grp">${mk(M.providers[p] || M.agents[agent.id], 14)}${esc(p)}</div>${arr.map((m) => `<button class="mi" data-act="pick-model" data-name="${esc(m.name)}"><span class="grow">${esc(m.name)}${m.tag === "new" ? ` <span class="tag">NEW</span>` : ""}${m.input ? `<small>${esc(fmt(A.newChat.perM, { in: m.input, out: m.output }))}</small>` : ""}${D.planCovers[m.name] ? `<span class="cov">${esc(fmt(A.newChat.covered, { plan: D.planCovers[m.name] }))}</span>` : ""}</span>${cur === m.name ? ic("check", 16) : ""}</button>`).join("")}`)
      .join("");
    return `<div class="search"><input type="search" data-input="modelQ" value="${esc(q)}" placeholder="${esc(A.newChat.modelSearch)}" aria-label="${esc(A.newChat.modelSearch)}" /></div><div data-mlist>${list || `<p class="ph">${esc(A.newChat.noModel)}</p>`}</div>
      ${agent.id === "media" ? "" : `<div class="mfoot"><div class="between"><span>${esc(A.newChat.payment)}</span><span>${esc(A.newChat.paymentVal)}</span></div><div class="between"><span>${esc(A.newChat.effort)}</span><div class="seg">${A.newChat.efforts.map((e: string, i: number) => `<button data-act="effort" data-i="${i}" aria-pressed="${V.effort === i}">${esc(e)}</button>`).join("")}</div></div></div>`}`;
  };
  const langMenu = () => D.locales.map((l: any) => `<a class="mi" href="${esc(l.href)}${esc(location.hash)}">${esc(l.label)}${l.current ? `<span class="end">${ic("check", 14)}</span>` : ""}</a>`).join("");

  // ---------- dialogs ----------
  let dlgEl: HTMLElement | null = null;
  let keySecretCopied = false;
  let workBuddyAbort: AbortController | null = null;
  let dialogFocus: ReturnType<typeof containDialogFocus> | null = null;
  const closeDlg = (refreshView = false, discardSecret = false) => {
    if (!ended && !discardSecret && dlgEl?.querySelector("[data-key-secret]")) return;
    workBuddyAbort?.abort(); workBuddyAbort = null;
    const restoreFocus = dialogFocus?.release();
    const fundingDialog = !!dlgEl?.querySelector(".chat-funding-balances");
    dlgEl?.remove(); dlgEl = null; dialogFocus = null;
    if (refreshView && !ended) render();
    if (!restoreFocus?.() && refreshView) root.querySelector<HTMLElement>(fundingDialog ? '[data-act="chat-funding"]' : '[data-act="new-key"]')?.focus({ preventScroll: true });
  };
  const openDlg = (html: string, cls = "", top = false) => {
    if (dlgEl?.querySelector("[data-key-secret]")) return dlgEl;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const opener = dlgEl ? dialogFocus?.opener() ?? null : active && popEl?.contains(active) ? popAnchor : active;
    closePop();
    closeDlg();
    const el = document.createElement("div");
    el.className = "scrim" + (top ? " top" : "");
    el.innerHTML = `<div class="dlg ${cls}" role="dialog" aria-modal="true">${html}</div>`;
    root.appendChild(el);
    dlgEl = el;
    const heading = el.querySelector("h2");
    if (heading) { heading.id ||= "fx-dialog-title"; el.querySelector("[role=dialog]")?.setAttribute("aria-labelledby", heading.id); }
    dialogFocus = containDialogFocus(root, el, opener);
    return el;
  };
  const xBtn = () => `<button class="icon-btn x" data-act="close" aria-label="${esc(A.common.close)}">${ic("x", 16)}</button>`;
  const openWorkBuddyGuide = async () => {
    const key = selectedApiKey();
    const identity = committed?.session;
    const origin = location.hostname === "fells.dev" || location.hostname.endsWith(".fells.dev") ? "https://api.fells.dev" : location.origin;
    const guide = (state: "loading" | "no-key" | "ready" | "error", catalog?: unknown) => workBuddyGuideBody({ language: D.lang, state, origin, catalog });
    const dialog = openDlg(`${xBtn()}<h2>${esc(workBuddyWords.title)}</h2><div class="body stack" data-workbuddy-guide>${guide(key ? "loading" : "no-key")}</div>`, "workbuddy-dialog");
    if (!key) return;
    const controller = new AbortController(); workBuddyAbort = controller;
    try {
      const catalog = await accountApi.catalog(key.id, controller.signal);
      if (ended || controller.signal.aborted || committed?.session !== identity || dlgEl !== dialog) return;
      const panel = dialog.querySelector("[data-workbuddy-guide]");
      if (panel) panel.innerHTML = guide((selectedApiKey()?.id ?? 0) === key.id ? "ready" : "error", catalog);
    } catch (error) {
      if (ended || controller.signal.aborted || dlgEl !== dialog) return;
      if (error instanceof APIError && error.status === 401) { clearView(); return; }
      const panel = dialog.querySelector("[data-workbuddy-guide]");
      if (panel) panel.innerHTML = guide("error");
    } finally { if (workBuddyAbort === controller) workBuddyAbort = null; }
  };
  const showChatSearch = () => {
    const form = root.querySelector<HTMLFormElement>('[data-form="send"]');
    if (!form || !modelChatEnabled() || isExample()) return;
    const model = V.chatCatalog?.models.find((entry: ChatModel) => entry.model === form.dataset.model);
    const state = chatSearchState(model);
    const reason = state === "error" ? searchWords.loadError : state === "available" ? searchWords.consent : searchWords[state];
    const supported: ChatModel[] = V.chatCatalogStatus === "ready" && V.chatCatalog?.web_search?.available === true ? V.chatCatalog.models.filter((entry: ChatModel) => entry.web_search === true) : [];
    const canChoose = getAppWorkspaceRole(S.current) !== "viewer" && !V.chatStarting;
    openDlg(`${xBtn()}<h2>${esc(searchWords.title)}</h2><div class="body" data-chat-search-info><p data-web-reason="${state}">${esc(reason)}</p>${model ? `<p class="hint">${esc(searchWords.model)}: <b>${esc(model.label)}</b><span class="chat-search-model-id">${esc(model.model)}</span></p>` : ""}<p class="hint">${esc(searchWords.switchHint)}</p><div><h3>${esc(searchWords.supported)}</h3>${supported.length ? `<div class="chat-search-models">${supported.map(entry => `<button class="mi wide" data-act="chat-web-model" data-name="${esc(entry.model)}" ${canChoose ? "" : "disabled"}><span class="grow">${esc(searchWords.useModel)} · ${esc(entry.label)}<small>${esc(entry.model)}</small></span>${ic("chevR", 14)}</button>`).join("")}</div>` : `<p class="hint" data-web-no-models>${esc(searchWords.none)}</p>`}</div><p class="hint">${esc(searchWords.charges)}</p><button class="btn" data-act="chat-web-refresh" ${V.chatCatalogLoading ? "disabled" : ""}>${ic("refresh", 14)}${esc(searchWords.reload)}</button></div>`, "chat-search-dialog");
  };
  const readAccountDialog = async <T>(title: string, read: () => Promise<T>): Promise<T | undefined> => {
    if (ended || !committed) return;
    const session = committed.session;
    const pending = openDlg(`${xBtn()}<h2>${esc(title)}</h2><div class="body" data-read-pending role="status">${esc(words.loading)}…</div>`);
    try {
      const result = await read();
      if (!ended && committed?.session === session && dlgEl === pending) return result;
    } catch (error) {
      if (error instanceof EndedSession || error instanceof APIError && error.status === 401) { clearView(); return; }
      const status = pending.querySelector<HTMLElement>("[data-read-pending]");
      if (status && dlgEl === pending) { status.textContent = accountFailure(error); status.setAttribute("role", "alert"); }
    }
  };
  const showChatFunding = () => {
    const allowance = getAppBootstrap()?.api_allowance.balance;
    if (!allowance) return;
    const funds = funding();
    const row = (label: string, micro: number, bucket: string) => `<div data-funding-bucket="${bucket}"><dt>${esc(label)}</dt><dd>${money2(micro / 1_000_000)}</dd></div>`;
    openDlg(`${xBtn()}<h2>${esc(chatFunding.title)}</h2><div class="body stack"><dl class="chat-funding-balances">${row(funds.explicit ? chatFunding.availableBalance : chatFunding.balance, funds.total, "total")}${row(chatFunding.plan, funds.plan, "plan")}${row(chatFunding.compensation, funds.compensation, "compensation")}${row(chatFunding.independent, funds.independent, "independent")}${funds.explicit || funds.reserved || funds.pending ? `${row(chatFunding.grossBalance, funds.gross, "gross")}${row(chatFunding.reserved, funds.reserved, "reserved")}${row(chatFunding.pending, funds.pending, "pending")}` : ""}</dl>${funds.explicit || funds.reserved || funds.pending ? `<p class="hint">${esc(chatFunding.availabilityNote)}</p>` : ""}<p>${esc(chatFunding.order)}</p><p class="hint">${esc(chatFunding.limits)}</p><p class="hint">${esc(chatFunding.account)}</p><a class="btn" href="#/billing/credits">${esc(chatFunding.wallet)}</a></div>`, "chat-funding-dialog");
  };

  const apiLogRows = () => {
    const query = String(V.logsQuery ?? "").trim().toLocaleLowerCase(D.lang);
    const rows = (V.logs?.logs ?? []).filter((row: any) => !query || [row.model, row.key_name, row.key_prefix, row.status, row.error].join(" ").toLocaleLowerCase(D.lang).includes(query));
    const labels = requestInspectionWordsOf(D.lang), latency = inspectRequestLatency(rows);
    const durations = ["< 500 ms", "500–999 ms", "1,000–1,999 ms", "2,000–4,999 ms", "≥ 5,000 ms"];
    const histogram = V.logsLoading ? "" : `<details class="api-log-inspection api-log-latency" data-request-durations><summary>${esc(labels.duration)} · ${latency.count}</summary><p class="hint">${esc(labels.sample)}: ${latency.count}</p>${latency.count ? `<p class="mono">P50 ${latency.p50} ms · P95 ${latency.p95} ms</p><dl class="api-duration-buckets">${latency.buckets.map((count,index) => `<div><dt>${durations[index]}</dt><dd>${count}<span aria-hidden="true" style="width:${count / latency.count * 100}%"></span></dd></div>`).join("")}</dl>` : `<p class="hint">${esc(labels.empty)}</p>`}<p class="hint">${esc(labels.sampleNote)}</p></details>`;
    const logRows = rows.map((row: any) => {
      const tokens = inspectRequestTokens(row);
      const breakdown = tokens.total === null ? `<p class="hint">${esc(labels.unavailable)}</p>` : `<div class="api-token-bar" role="img" aria-label="${esc(`${labels.total}: ${tokens.total}`)}">${tokens.parts.map(part => `<span class="api-token-${part.key}" style="width:${tokens.total ? part.tokens / tokens.total * 100 : 0}%" title="${esc(`${labels[part.key]}: ${part.tokens}`)}"></span>`).join("")}</div><dl class="api-token-parts">${tokens.parts.map(part => `<div><dt>${esc(labels[part.key])}</dt><dd>${part.tokens.toLocaleString(D.lang)}</dd></div>`).join("")}<div><dt>${esc(labels.total)}</dt><dd>${tokens.total.toLocaleString(D.lang)}</dd></div></dl>`;
      return `<div class="api-log-row"><span class="grow"><b>${esc(row.model)} · ${esc(row.key_name || row.key_prefix || "")}</b><small>${esc(tfmt(Number(row.ts) * 1000))} · HTTP ${esc(row.status)} · ${esc(row.latency_ms)} ms · ${esc(usageTokens(row))} tokens</small>${row.error ? `<small>${esc(row.error)}</small>` : ""}</span><b>${money2(Number(row.allow_micro || 0) / 1_000_000)}</b><details class="api-log-inspection api-request-inspector" data-request-tokens><summary>${esc(labels.details)}</summary>${breakdown}</details></div>`;
    }).join("") || `<p class="muted">${esc(V.logsLoading ? words.loading : words.empty)}</p>`;
    return histogram + logRows;
  };
  const drawApiLogs = () => openDlg(`${xBtn()}<h2 id="api-logs-title">${esc(words.logs)}</h2><div class="body stack" data-api-logs><div class="api-log-toolbar"><label class="f"><span>${esc(zh ? "查找记录" : "Find requests")}</span><input type="search" data-input="logsQuery" value="${esc(V.logsQuery || "")}" placeholder="${esc(zh ? "模型、Key、状态码或错误" : "Model, key, status or error")}" /></label><div class="seg" role="group" aria-label="${esc(A.api.usage)}">${A.api.ranges.map((label: string, i: number) => `<button data-act="api-logs-range" data-i="${i}" aria-pressed="${V.logsRange === i}">${esc(label)}</button>`).join("")}</div></div><p class="hint">${esc(V.logs?.retention_days ? zh ? `调用记录保留 ${V.logs.retention_days} 天` : `Request logs retained for ${V.logs.retention_days} days` : A.api.retention)}</p><div class="api-log-list card list" tabindex="0" role="region" aria-label="${esc(words.logs)}">${apiLogRows()}</div><p role="status" data-api-logs-error>${esc(V.logsError)}</p>${V.logsHasMore ? `<button class="btn sm" data-act="logs-more" ${V.logsLoading ? "disabled" : ""}>${esc(zh ? "加载更早记录" : "Load earlier records")}</button>` : ""}</div>`, "api-log-dialog");
  const loadApiLogs = async (more = false) => {
    if (ended || !committed || more && (V.logsLoading || !V.logsHasMore)) return;
    const identity = committed.session, request = ++V.logsRequest, range = V.logsRange;
    const rows = more ? V.logs?.logs ?? [] : [];
    V.logsLoading = true; V.logsError = "";
    if (!more) { V.logs = null; V.logsHasMore = false; }
    drawApiLogs();
    try {
      const result = await accountApi.logs({ since: usageSince(range), limit: 50, ...(more && rows.length ? { before_id: rows.at(-1).id } : {}) });
      if (ended || committed?.session !== identity || V.logsRequest !== request || V.logsRange !== range) return;
      V.logs = { ...result, logs: [...rows, ...(Array.isArray(result.logs) ? result.logs : [])] };
      V.logsHasMore = Array.isArray(result.logs) && result.logs.length === 50;
    } catch (error) {
      if (ended || committed?.session !== identity || V.logsRequest !== request) return;
      if (error instanceof APIError && error.status === 401) { clearView(); return; }
      V.logsError = error instanceof Error ? error.message : security.saveFailed;
    } finally {
      if (!ended && V.logsRequest === request) {
        V.logsLoading = false;
        if (dlgEl?.querySelector("[data-api-logs]")) drawApiLogs();
      }
    }
  };

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
  const openNewWs = () => {
    const N = A.newWs;
    openDlg(`${xBtn()}<h2>${esc(N.title)}</h2><p class="lead">${esc(N.sub)}</p>
      <form class="body" data-form="new-ws" novalidate>
        <label class="f">${esc(N.name)}<input type="text" name="name" placeholder="${esc(N.namePh)}" maxlength="60" autofocus /><span class="err" data-err hidden>${esc(N.nameRequired)}</span></label>
        <div class="foot" style="margin-top:4px"><button type="button" class="btn" data-act="close">${esc(N.cancel)}</button><button class="btn pri">${esc(N.create)}</button></div>
      </form>`);
  };

  const openAgreement = async () => {
    const result = await readAccountDialog(words.accept, () => accountApi.agreement(undefined, D.lang));
    if (!result) return;
    const accepted = getAppBootstrap()?.agreement.accepted;
    openDlg(`${xBtn()}<h2>${esc(agreementText(result.h1))}</h2><p class="lead">${esc(agreementText(result.lede))}</p><p class="hint">${esc(authUXWords(D.lang).termsSource)}</p><div class="body">${result.clauses.map((c: any) => `<article class="card pad stack"><h3>${esc(agreementText(c.heading))}</h3>${(c.paras ?? []).map((p: string) => `<p>${esc(agreementText(p))}</p>`).join("")}</article>`).join("")}<form class="stack" data-form="agreement"><input type="hidden" name="version" value="${esc(result.version)}" />${accepted ? `<p class="note">${esc(authUXWords(D.lang).agreementAccepted)}</p>` : `<label class="row"><input type="checkbox" name="consent" required />${esc(words.accept)}</label><button class="btn pri">${esc(authUXWords(D.lang).acceptTerms)}</button>`}</form></div>`, "wide");
  };
  const openInvite = async () => {
    const result = await readAccountDialog(A.invite.title, async () => {
      const [referral, rebates] = await Promise.all([accountApi.referral(), accountApi.rebates()]);
      return { referral, rebates };
    });
    if (!result) return;
    const r = result.referral, rb = result.rebates, payable = Number((rb.summary as any)?.payable_micro || 0);
    const code = String((r.stat as any)?.code || "");
    const href = `${location.origin}${D.links.start}?ref=${encodeURIComponent(code)}#signup`;
    V.rebateIntent = { body: { amount_micro: 0, expected_payable: payable, ref: operationKey() }, key: operationKey() };
    openDlg(`${xBtn()}<h2>${esc(A.invite.title)}</h2><div class="body stack"><p class="lead">${esc(r.active ? r.reward_terms || r.name : words.notOffered)}</p>${r.active && r.referee_reward_terms ? `<p>${esc(r.referee_reward_terms)}</p>` : ""}<div class="codebox"><pre class="code">${esc(href)}</pre><button class="btn sm" data-act="copy" data-text="${esc(href)}" data-msg="${esc(A.common.copied)}">${esc(A.common.copy)}</button></div><p class="muted">${esc(zh ? "已邀请" : "Invited")} ${(r.stat as any)?.invited ?? 0} · ${esc(zh ? "已转化" : "Converted")} ${(r.stat as any)?.converted ?? 0}</p><div class="card pad stack"><h3>${esc(zh ? "推荐返佣" : "Referral rebates")}</h3><b>${cny(payable / 1_000_000)}</b><p class="muted">${esc(zh ? `挂账期 ${rb.hold_days} 天，计酬期 ${rb.window_months} 个月；返现池资金充足时可转入人民币现金。` : `Hold period: ${rb.hold_days} days; earning window: ${rb.window_months} months. Transfer to CNY cash requires enough funds in the rebate pool.`)}</p><button class="btn" data-act="rebate-credit" ${payable > 0 ? "" : "disabled"}>${esc(zh ? "确认转入钱包" : "Confirm transfer to wallet")}</button></div></div>`);
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
    openDlg(`${xBtn()}<h2>${esc(title)}</h2><form class="body" data-form="prompt"><label class="f">${esc(label)}<input type="text" name="v" placeholder="${esc(ph)}" maxlength="60" required autofocus /></label><div class="foot" style="margin:0"><button type="button" class="btn" data-act="close">${esc(A.common.cancel)}</button><button class="btn pri">${esc(A.common.save)}</button></div></form>`);
    V.promptOk = onOk;
  };
  const openNewKey = () => {
    const P = A.api;
    openDlg(`${xBtn()}<h2>${esc(P.create)}</h2><form class="body" data-form="key">
      <label class="f">${esc(P.keyName)}<input type="text" name="name" placeholder="${esc(P.keyNamePh)}" required maxlength="40" autofocus /></label>
      <label class="f">${esc(P.limit)} (USD)<input type="text" name="limit" inputmode="decimal" maxlength="24" placeholder="${esc(keyDefaultLabel[D.lang] ?? keyDefaultLabel.en)}" /></label>
      <p class="note">${esc(keyLimitRule[D.lang] ?? keyLimitRule.en)}</p><p data-key-error class="err" role="alert"></p>
      <div class="foot" style="margin:0"><button type="button" class="btn" data-act="close">${esc(A.common.cancel)}</button><button class="btn pri">${esc(P.create)}</button></div></form>`);
  };

  // Command palette
  const palItems = () => {
    const items: { g: string; label: string; icon: string; run: () => void }[] = [];
    const goTo = (label: string, icon: string, h: string) => items.push({ g: A.palette.go, label, icon, run: () => go(h) });
    goTo(A.nav.newChat, "plus", "new");
    if (hasWs()) {
      goTo(A.nav.members, "users", "members"); goTo(A.nav.wsSettings, "gear", "ws-settings");
    }
    goTo(A.account.market, "store", "billing/market"); goTo(A.billing.tabs[1], "card", "billing/credits"); goTo(A.account.apiKey, "key", "api"); goTo(A.account.settings, "gear", "settings/0");
    const act = (label: string, icon: string, run: () => void) => items.push({ g: A.palette.actions, label, icon, run });
    if (hasWs()) D.agents.forEach((a: any) => act(fmt(A.palette.newWith, { agent: a.name }), "spark", () => { V.agent = a.id; go("new"); }));
    act(A.switcher.newWs, "plus", openNewWs);
    act(contactPurchase, "card", requestSupport);
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
      root.classList.toggle("sb-hidden", !!S.sbHidden);
      if (!await save()) root.classList.toggle("sb-hidden", !!S.sbHidden);
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
  const applyChatResult = (chatID: string, requestID: string, result: AppChatResult, notify = true) => {
    const previous = chatRuns.get(chatID);
    const verifiedRun = verifiedChatRunIDs.get(chatID);
    // A history refresh can finish an earlier run while its status GET is in
    // flight. That old response must not replace a later request or its view.
    if (!previous || previous.request_id !== requestID || verifiedRun?.request_id === requestID && result.run?.id && verifiedRun.id !== result.run.id) return;
    if (result.run?.id) verifiedChatRunIDs.set(chatID, { request_id: requestID, id: result.run.id });
    if (previous.status === "completed" && completedChatReceipts.get(chatID)?.request_id === requestID && result.run && result.run.status !== "completed") {
      if (result.snapshot) adopt(result.snapshot);
      return;
    }
    const receipt: LocalChatRun = { ...(result.run ?? { ...previous, status: previous.status === "completed" ? "completed" as const : "unknown" as const }), chat_id: chatID, started_at: previous.started_at, web_search: previous.web_search, attachment_ids: previous.attachment_ids, ...(result.refusal ? { refusal: result.refusal } : {}), ...(result.run?.status === "unknown" ? { server_unknown: true } : {}) };
    if (!result.run && previous.status !== "completed" && result.error instanceof APIError && result.error.code === "chat_not_started") receipt.status = "failed";
    if (result.run?.status === "completed") {
      completedChatReceipts.set(chatID, result.run);
      // Legacy receipts without message bindings keep their existing complete
      // snapshot path. Current receipts require the exact saved user and reply.
      receipt.history_pending = !result.snapshot || !!(result.run.id || result.run.chat_id || result.run.assistant_message_id);
      if (receipt.history_pending && !previous.history_pending) chatHistoryAttempts.delete(requestID);
    }
    chatRuns.set(chatID, receipt);
    if (result.snapshot) adopt(result.snapshot);
    else reconcileChatHistory();
    if (receipt.attachment_ids?.length && (result.run?.message_id || submissionRecorded(chatID) || getAppMessageMetadata(chatID).some(message => message.attachments?.some(file => receipt.attachment_ids!.includes(file.id))))) attachments?.consumed(chatID, receipt.attachment_ids);
    try { persistChatRuns(); } catch { /* Existing marker remains safe to inspect after a reload. */ }
    if (!result.run && !chatDrafts.get(chatID) && chatSubmissions.has(chatID)) chatDrafts.set(chatID, chatSubmissions.get(chatID)!.body);
    if (receipt.status === "failed" && !result.run) {
      if (!chatDrafts.get(chatID) && chatSubmissions.has(chatID)) chatDrafts.set(chatID, chatSubmissions.get(chatID)!.body);
      chatSubmissions.delete(chatID);
    } else if (result.run || submissionRecorded(chatID)) chatSubmissions.delete(chatID);
    if (result.error && notify) toast(result.error instanceof Error ? result.error.message : words.chatUnknown);
  };
  const renderChatRun = (chatID: string) => { if (!ended && route().name === "chat" && route().arg === chatID && !dlgEl && !popEl) render(); };
  const checkChatRun = async (chatID: string, automatic = false) => {
    const pending = chatRuns.get(chatID);
    if (ended || !committed || !pending || chatRequests.has(chatID) || chatChecks.has(chatID) || chatRunSettled(pending)) return;
    const session = committed.session;
    const previousRun = JSON.stringify(pending);
    let changed = false;
    if (automatic) {
      const attempts = pending.history_pending ? chatHistoryAttempts : chatPollAttempts;
      attempts.set(pending.request_id, (attempts.get(pending.request_id) ?? 0) + 1);
    }
    chatChecks.add(chatID); if (!automatic) renderChatRun(chatID);
    try {
      const result = await readAppChatRun(committed, chatID, pending.request_id);
      if (!ended && committed?.session === session) {
        applyChatResult(chatID, pending.request_id, result, !automatic);
        changed = !!result.snapshot || JSON.stringify(chatRuns.get(chatID)) !== previousRun || !canPollChat(chatRuns.get(chatID)!);
      }
    }
    catch (error) {
      if (error instanceof EndedSession) clearView();
      else if (!automatic) toast(error instanceof Error ? error.message : words.chatUnknown);
    } finally { chatChecks.delete(chatID); if (!automatic || changed) renderChatRun(chatID); syncChatPolling(); }
  };
  const sendModelMessage = async (form: HTMLFormElement, body: string) => {
    if (!committed || getAppWorkspaceRole(S.current) === "viewer") return;
    const model = form.dataset.model || "";
    const selectedModel = V.chatCatalog?.models.find((choice: ChatModel) => choice.model === model);
    if (attachments?.blocked(form.dataset.chat, selectedModel)) { toast(attachmentWords.unsupported); return; }
    // A newly created conversation cannot have earlier pending uploads. Capture
    // the existing draft manifest before mounting the new chat starts recovery.
    const attachmentIDs = form.dataset.chat && attachments ? attachments.ids(form.dataset.chat, selectedModel) : [];
    if (attachmentIDs === null) { toast(attachmentWords.unsupported); return; }
    const webSearch = V.webSearch === true && V.chatCatalog?.web_search?.available === true && V.chatCatalog?.models.some((choice: ChatModel) => choice.model === model && choice.web_search === true);
    if (V.chatCatalogStatus !== "ready" || V.chatCatalog?.billing_mode !== "account_allowance" || !V.chatCatalog?.models.some((m: ChatModel) => m.model === model)) { toast(chatModelState() || words.modelError); return; }
    let chatID = form.dataset.chat;
    if (chatID && chatRuns.has(chatID) && !chatRunSettled(chatRuns.get(chatID)!)) { toast(chatRuns.get(chatID)!.history_pending ? progressWords.restoringDetail : words.chatUnknown); return; }
    if (!chatID) {
      const startRoute = location.hash;
      V.chatStarting = true; render();
      chatID = uid();
      S.chats.push({ id: chatID, ws: S.current, title: body.split("\n")[0].slice(0, 48) || A.chat.untitled, agent: "lite", model, created: Date.now(), messages: [] });
      const created = await save(); V.chatStarting = false;
      if (!created) { if (!ended) render(); return; }
      V.draft = "";
      chatDrafts.set(chatID, body);
      if (location.hash === startRoute) go("chat/" + chatID);
      // Mount the chat before moving its unsent draft. hashchange is async and
      // may be suppressed by the paid request's busy guard below.
      if (route().name === "chat" && route().arg === chatID) render();
    }
    const requestID = uid();
    completedChatReceipts.delete(chatID);
    verifiedChatRunIDs.delete(chatID);
    chatRuns.set(chatID, { chat_id: chatID, request_id: requestID, status: "pending", started_at: Date.now(), web_search: webSearch, ...(attachmentIDs.length ? { attachment_ids: attachmentIDs } : {}) });
    try { persistChatRuns(); }
    catch { chatRuns.delete(chatID); toast(words.chatStorage); return; }
    attachments?.beginSend(chatID);
    chatSubmissions.set(chatID, { body, after: S.chats.find(chat => chat.id === chatID)?.messages.length ?? 0 });
    chatDrafts.set(chatID, "");
    const input = route().name === "chat" && route().arg === chatID ? root.querySelector<HTMLTextAreaElement>("#fx-input") : null;
    if (input) input.value = "";
    const session = committed.session;
    chatRequests.add(chatID); renderChatRun(chatID);
    try {
      const result = await generateAppChat(committed, chatID, { request_id: requestID, body, model, billing_mode: "account_allowance", ...(webSearch ? { web_search: true } : {}), ...(attachmentIDs.length ? { attachment_ids: attachmentIDs } : {}) });
      if (!ended && committed?.session === session) applyChatResult(chatID, requestID, result);
    }
    catch (error) {
      if (error instanceof EndedSession) { clearView(); return; }
      // Preflight/identity checks rejected before the generate POST. A network
      // failure after POST is returned as an unknown run by app-service.
      chatRuns.delete(chatID); try { persistChatRuns(); } catch { /* A leftover marker only blocks a future send. */ }
      chatSubmissions.delete(chatID);
      if (!chatDrafts.get(chatID)) chatDrafts.set(chatID, body);
      toast(error instanceof Error ? error.message : words.chatUnknown);
      try { const latest = await readApp(); if (latest) adopt(latest); } catch { /* Preserve the current draft. */ }
    } finally { chatRequests.delete(chatID); renderChatRun(chatID); syncChatPolling(); }
  };
  const sendMessage = async (form: HTMLFormElement) => {
    if (saving || ended || isBusinessBlocked() || isExample()) return;
    const ta = form.querySelector("textarea")!;
    const text = ta.value.trim() || (modelChatEnabled() && attachments?.has(form.dataset.chat) ? attachmentWords.emptyPrompt : "");
    if (!text) { ta.focus(); return; }
    if (text.length > MAX_MESSAGE) { toast(security.tooLarge); return; }
    if (!hasWs()) { openNewWs(); return; }
    if (modelChatEnabled()) { await sendModelMessage(form, text); return; }
    const chatId = form.dataset.chat;
    const note: [string, string][] = [];
    const body = text;
    if (body.length > MAX_MESSAGE) { toast(security.tooLarge); return; }
    if (chatId) {
      const chat = S.chats.find((c) => c.id === chatId);
      if (!chat) return;
      chat.messages = chat.messages.concat([["you", body]], note);
    } else {
      const agent = agentById(V.agent);
      const chat: Chat = { id: uid(), ws: S.current, title: text.split("\n")[0].slice(0, 48) || A.chat.untitled, agent: agent.id, model: currentModel(agent), created: Date.now(), messages: [["you", body], ...note] };
      S.chats.push(chat);
      if (!await save()) return;
      V.draft = "";
      go("chat/" + chat.id);
      toast(words.saved);
      return;
    }
    if (!await save()) return;
    ta.value = "";
    render();
    toast(words.saved);
  };

  // Pause action handlers without replacing the DOM or erasing local drafts.
  const pauseAction = (event: Event) => {
    if (isBusinessBlocked() && event.target instanceof Element && event.target.closest("button,[data-act],[data-go]")) { event.preventDefault(); event.stopImmediatePropagation(); }
  };
  root.addEventListener("click", pauseAction, true);
  root.addEventListener("submit", event => { if (isBusinessBlocked()) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
  const maintenanceChanged = subscribeMaintenance(() => {
    root.dataset.maintenance = String(isBusinessBlocked());
    // Existing forms stay mounted. Their normal identity checks still run
    // before the next write, and a real session change still clears the view.
    if (!isBusinessBlocked() && !editingForm() && !dlgEl) void refresh();
  });
  addEventListener("pagehide", () => maintenanceChanged(), { once: true });
  root.addEventListener("click", async (e) => {
    if (ended) { e.preventDefault(); return; }
    const t = e.target as HTMLElement;
    // Close popover when clicking outside it.
    if (popEl && !popEl.contains(t) && !t.closest("[data-act=switcher],[data-act=account],[data-act=model],[data-act=lang]")) closePop();
    if (dlgEl && t === dlgEl) { closeDlg(true); return; }
    const el = t.closest<HTMLElement>("[data-go],[data-act]");
    if (!el || !root.contains(el)) return;
    if (el.dataset.go !== undefined) {
      e.preventDefault();
      const target = el.dataset.go;
      const name = target.split("/")[0];
      closePop();
      if (dlgEl) closeDlg(true);
      if (needsWs.has(name) && !hasWs()) {
        toast(A.nav.needWs);
        openNewWs();
        return;
      }
      if (name === "new" && !hasWs()) { openNewWs(); return; }
      go(target);
      return;
    }
    const act = el.dataset.act!;
    // A write protects other mutations, not navigation, menus or local drafts.
    if (saving && !["sb", "sb-close", "switcher", "account", "lang", "more", "new-ws", "help", "changelog", "close", "soon", "copy", "agent", "chat-check", "chat-models", "chat-web-search", "chat-web-model", "chat-web-refresh", "chat-funding", "claude-guide", "workbuddy-guide", "workbuddy-keys", "api-models", "history-range", "history-retry", "model", "pick-model", "effort", "prompt", "api-range", "api-usage-refresh", "quick", "new-key", "key-limit", "api-logs", "api-logs-range", "logs-more", "wallet-tab", "mtab", "market-clear", "pal-run"].includes(act)) { e.preventDefault(); return; }
    if (act === "del-chat" && !confirm(security.confirmDelete)) return;
    const id = el.dataset.id || "";
    const i = Number(el.dataset.i);
    switch (act) {
      case "sb": toggleSb(); break;
      case "sb-close": closeSb(); break;
      case "switcher": popEl ? closePop() : openPop(el, switcherMenu()); break;
      case "account": popEl ? closePop() : openPop(el, accountMenu(), "account-pop"); break;
      case "lang": openPop(el, langMenu()); break;
      case "more": V.moreOpen = !V.moreOpen; render(); break;
      case "chat-web-search": {
        const form = root.querySelector<HTMLFormElement>('[data-form="send"]');
        const model = V.chatCatalog?.models.find((entry: ChatModel) => entry.model === form?.dataset.model);
        if (chatSearchState(model) !== "available") { V.webSearch = false; showChatSearch(); break; }
        V.webSearch = !V.webSearch; render(); root.querySelector<HTMLElement>('[data-act="chat-web-search"]')?.focus({ preventScroll: true }); break;
      }
      case "chat-web-model": {
        const form = root.querySelector<HTMLFormElement>('[data-form="send"]');
        const model = V.chatCatalog?.models.find((entry: ChatModel) => entry.model === el.dataset.name);
        if (!form || chatSearchState(model) !== "available") { showChatSearch(); break; }
        if (form.dataset.chat) { V.chatModel ||= {}; V.chatModel[form.dataset.chat] = model!.model; }
        else V.model[form.querySelector<HTMLElement>('[data-act="model"]')!.dataset.agent!] = model!.model;
        V.webSearch = false; closeDlg(); render(); root.querySelector<HTMLElement>('[data-act="chat-web-search"]')?.focus({ preventScroll: true }); break;
      }
      case "chat-web-refresh": closeDlg(); void loadChatModels(); break;
      case "switch": S.current = id; closePop(); closeSb(); go(""); if (!await save()) { if (!ended) render(); return; } void loadAccountViews(); break;
      case "open-example": S.current = "example"; if (!await save()) return; go(""); break;
      case "new-ws": closeSb(); openNewWs(); break;
      case "promo-close": S.promoClosed = true; render(); if (!await save() && !ended) render(); break;
      case "promo-go":
        if (!hasWs()) { openNewWs(); break; }
        V.agent = "codex"; V.model.codex = "GPT-6.1 Sol"; go("new"); break;
      case "agreement": await openAgreement(); break;
      case "invite": closePop(); await openInvite(); break;
      case "rebate-credit": {
        const intent = V.rebateIntent;
        if (!intent || !confirm(zh ? "确认把可支付返佣转入人民币现金钱包？" : "Transfer payable rebates to your CNY cash wallet?")) return;
        const result = await accountAction(() => accountApi.creditRebate(intent.body, intent.key));
        if (result) { closeDlg(); void loadAccountViews(); }
        break;
      }
      case "help": closePop(); openHelp(); break;
      case "changelog": closePop(); openChangelog(); break;
      case "topup": closePop(); go("billing/credits"); break;
      case "buy-token-plan": requestSupport({ product: "token_plan", publicCode: id }); break;
      case "operation-list": await openPurchaseList(); break;
      case "operation-next": await openPurchaseList(el.dataset.cursor); break;
      case "operation-get": await inspectPurchase(id); break;
      case "operation-ack": {
        if (!inspectedPurchase || inspectedPurchase.operation_id !== id || inspectedPurchase.status === "pending") break;
        const result = await accountAction(() => accountApi.acknowledgePurchase(id));
        if (result) { inspectedPurchase = null; closeDlg(); void loadAccountViews(); }
        break;
      }
      case "plan-view": closeDlg(); V.walletTab = "plans"; go("billing/credits"); break;
      case "buy-monthly": requestSupport({ product: "subscription", poolId: Number(el.dataset.pool) }); break;
      case "upgrade-monthly": requestSupport({ product: "subscription", poolId: Number(el.dataset.pool) }); break;
      case "plan-confirm": await openPurchaseList(); break;
      case "plan-recover": await openPurchaseList(); break;
      case "exchange":
      case "exchange-new":
      case "exchange-confirm": await openPurchaseList(); break;
      case "contact-purchase": closePop(); closeDlg(); requestSupport({ title: el.dataset.supportTitle, product: el.dataset.supportProduct, poolId: Number(el.dataset.supportPool), amountMicro: Number(el.dataset.supportAmount), serviceDays: Number(el.dataset.supportDays), publicCode: el.dataset.supportCode }); break;
      case "logout": {
        e.preventDefault();
        saving = true; generation++;
        try { await endApp(committed!.session); clearView(false); }
        catch (error) {
          if (error instanceof EndedSession || (error instanceof APIError && error.status === 401)) clearView();
          else toast(error instanceof Error ? error.message : security.saveFailed);
        }
        finally { saving = false; }
        break;
      }
      case "theme": S.theme = el.dataset.v as any; applyTheme(); el.parentElement?.querySelectorAll("[data-act=theme]").forEach((b) => b.setAttribute("aria-pressed", String(b === el))); if (!await save()) { applyTheme(); if (!ended) render(); } break;
      case "close":
        if (dlgEl?.querySelector("[data-key-secret]") && !keySecretCopied && !confirm(keyWords.closeSecret)) break;
        closeDlg(true, true); break;
      case "soon": toast(A.common.comingSoon); break;
      case "copy": { const copied = await copy(el.dataset.text || "", el.dataset.msg || A.common.copied, el); if (copied && el.closest("[data-key-secret]")) keySecretCopied = true; break; }
      // New chat
      case "agent": V.agent = id; render(); break;
      case "chat-check": await checkChatRun(el.dataset.chat || ""); break;
      case "chat-models": void loadChatModels(); break;
      case "chat-funding": showChatFunding(); break;
      case "claude-guide": V.quickTab = 2; V.quickChosen = true; go("api"); break;
      case "workbuddy-guide": void openWorkBuddyGuide(); break;
      case "workbuddy-keys": closeDlg(); go("api"); break;
      case "api-models": void loadApiCatalog(); break;
      case "history-range": {
        const days = Number(el.dataset.historyRange);
        if ([7, 30, 90].includes(days)) { V.historyRange = days; void loadExchangeHistory(true); }
        break;
      }
      case "history-retry": void loadExchangeHistory(true); break;
      case "model": V.menuChat = el.dataset.chat || ""; openPop(el, modelMenu(el.dataset.agent!), "mm"); V.menuAgent = el.dataset.agent; break;
      case "pick-model": {
        const name = el.dataset.name!;
        if (modelChatEnabled() && !isExample()) {
          if (!V.chatCatalog?.models.some((m: ChatModel) => m.model === name)) break;
          V.webSearch = false;
          if (V.menuChat) { V.chatModel ||= {}; V.chatModel[V.menuChat] = name; } else V.model[V.menuAgent] = name;
        }
        else if (V.menuChat) { if (saving) return; const c = S.chats.find((x) => x.id === V.menuChat); if (c) c.model = name; closePop(); render(); if (!await save()) { if (!ended) render(); return; } }
        else V.model[V.menuAgent] = name;
        closePop(); render(); break;
      }
      case "effort": V.effort = i; popEl?.querySelectorAll("[data-act=effort]").forEach((b, j) => b.setAttribute("aria-pressed", String(j === i))); break;
      case "prompt": V.draft = el.dataset.text || ""; go("new"); setTimeout(() => root.querySelector<HTMLTextAreaElement>("#fx-input")?.focus(), 0); break;
      case "import-history": {
        if (!committed || isExample()) return;
        const identity = { session: committed.session, revision: committed.revision }, workspaceID = S.current;
        fileInput(false, "application/json,.json", async ([file]) => {
          if (!file || ended || saving || committed?.session !== identity.session || S.current !== workspaceID) return;
          if (file.size > 512 * 1024) { toast(security.tooLarge); return; }
          try {
            const data = JSON.parse(await file.text());
            const list = Array.isArray(data.chats) ? data.chats : [data];
            if (!list.length || list.length > 50) throw new Error(zh ? "对话数量必须在 1–50 之间" : "Import 1–50 conversations");
            const values: Chat[] = list.map((c: any) => {
              if (!c || !Array.isArray(c.messages) || c.messages.length > 500 || c.messages.some((m: any) => !Array.isArray(m) || m.length !== 2 || typeof m[0] !== "string" || typeof m[1] !== "string" || m[1].length > MAX_MESSAGE)) throw new Error(zh ? "对话历史格式无效" : "Invalid conversation history");
              if ((c.title !== undefined && (typeof c.title !== "string" || c.title.length > 100)) || (c.agent !== undefined && (typeof c.agent !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(c.agent))) || (c.model !== undefined && (typeof c.model !== "string" || c.model.length > 200))) throw new Error(zh ? "对话属性无效" : "Invalid conversation fields");
              const agent = typeof c.agent === "string" ? c.agent : V.agent;
              return { id: uid(), ws: workspaceID, title: typeof c.title === "string" ? c.title : file.name, agent, model: typeof c.model === "string" ? c.model : agentById(agent).model, created: Number.isSafeInteger(c.created) && c.created >= 0 ? c.created : Date.now(), messages: c.messages };
            });
            if (!confirm(zh ? `确认把 ${values.length} 条对话历史上传并保存到当前工作区？` : `Upload and save ${values.length} conversations to this workspace?`)) return;
            const result = await accountAction(async () => {
              let expected = identity;
              let imported = 0;
              try {
                for (const value of values) { const next = await importAppChat(expected, value); expected = next; imported++; }
              } catch (error) {
                if (error instanceof EndedSession || (error instanceof APIError && error.status === 401)) throw error;
                throw new Error(`${imported}/${values.length} ${zh ? "条对话已保存；剩余导入未确认，请核对历史后再重试。" : "conversations saved; remaining imports are unconfirmed. Check history before retrying."} ${error instanceof Error ? error.message : security.saveFailed}`);
              }
              return true;
            });
            if (result) go("new");
          } catch (error) { toast(error instanceof Error ? error.message : security.saveFailed); }
        });
        break;
      }
      case "del-chat": {
        if (!canDeleteChats() || !S.chats.some((c) => c.id === id && c.ws === S.current)) break;
        const routeBeforeDelete = location.hash;
        const deletingCurrent = route().name === "chat" && route().arg === id;
        const input = root.querySelector<HTMLTextAreaElement>("#fx-input");
        const draft = input ? { value: input.value, start: input.selectionStart, end: input.selectionEnd } : null;
        S.chats = S.chats.filter((c) => c.id !== id);
        if (!await save()) return;
        if (deletingCurrent && location.hash === routeBeforeDelete) go("new");
        else {
          render();
          const remainingInput = root.querySelector<HTMLTextAreaElement>("#fx-input");
          if (draft && remainingInput && location.hash === routeBeforeDelete) {
            remainingInput.value = draft.value;
            remainingInput.setSelectionRange(draft.start, draft.end);
          }
        }
        break;
      }
      // Workspace members
      case "invite-link": {
        const workspaceID = S.current, role = el.dataset.role === "viewer" ? "viewer" : "editor";
        openPrompt(words.addMember, words.username, A.members.invite, async (username) => {
          const result = await accountAction(() => setAppMember(workspaceID, { username, role }));
          if (!result) return;
          closeDlg(); toast(A.members.copied); void loadAccountViews();
        });
        break;
      }
      case "revoke-invitation": {
        const workspaceID = S.current;
        const result = await accountAction(() => revokeAppInvitation(workspaceID, id));
        if (result) void loadAccountViews();
        break;
      }
      case "accept-invitation": {
        const result = await accountAction(() => acceptAppInvitation(id));
        if (!result) break;
        const workspaceID = el.dataset.workspace || "";
        if (result.state.workspaces.some((w) => w.id === workspaceID)) {
          S.current = workspaceID;
          if (!await save()) break;
          go("");
        }
        void loadAccountViews();
        break;
      }
      case "decline-invitation": {
        const result = await accountAction(() => declineAppInvitation(id));
        if (result) void loadAccountViews();
        break;
      }
      case "leave-workspace": {
        if (!confirm(A.members.leaveConfirm)) break;
        const workspaceID = S.current;
        const result = await accountAction(() => leaveAppWorkspace(workspaceID));
        if (result) { go(""); void loadAccountViews(); }
        break;
      }
      case "remove-member": await accountAction(() => removeAppMember(S.current, Number(id))); void loadAccountViews(); break;
      case "member-role": await accountAction(() => updateAppMemberRole(S.current, Number(id), el.dataset.role as "editor" | "viewer")); void loadAccountViews(); break;
      case "set-current-ride": {
        const result = await accountAction(() => accountApi.setCurrentSubscription(Number(id)));
        if (result) void loadAccountViews();
        break;
      }
      case "set-ride-mode": {
        const mode = el.dataset.mode;
        if (mode !== "monthly" && mode !== "allowance") return;
        const result = await accountAction(() => accountApi.setRideMode(mode));
        if (result) void loadAccountViews();
        break;
      }
      // User settings
      case "avatar": S.profile.avatar = i; if (!await save()) return; render(); break;
      case "avatar-shuffle": S.profile.avatar = (typeof S.profile.avatar === "number" ? S.profile.avatar + 1 + Math.floor(Math.random() * (AVATARS.length - 1)) : 0) % AVATARS.length; if (!await save()) return; render(); break;
      case "avatar-remove": S.profile.avatar = 0; if (!await save()) return; render(); break;
      case "avatar-upload": fileInput(false, "image/jpeg,image/png,image/webp,image/gif", ([f]) => {
        if (!f || f.size > 10 * 1048576) return;
        // Downscale before sending the private avatar to the server.
        const img = new Image();
        img.onload = async () => { if (saving || ended) { URL.revokeObjectURL(img.src); return; } const c = document.createElement("canvas"); c.width = c.height = 128; const x = c.getContext("2d")!; const s = Math.min(img.width, img.height); x.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 128, 128); S.profile.avatar = c.toDataURL("image/jpeg", 0.85); URL.revokeObjectURL(img.src); if (!await save()) return; render(); };
        img.src = URL.createObjectURL(f);
      }); break;
      case "send-key": S.prefs.send = i; if (!await save()) return; render(); break;
      case "notif": S.notifs[i] = !S.notifs[i]; el.setAttribute("aria-checked", String(S.notifs[i])); if (!await save() && !ended) render(); break;
      // API
      case "api-range": V.apiRange = i; V.usage = null; stopApiUsage(); render(); break;
      case "api-usage-refresh": void loadApiUsage(true); break;
      case "quick": V.quickChosen = true; V.quickTab = i; render(); break;
      case "new-key": openNewKey(); break;
      case "key-limit": {
        const k = S.keys.find(k => k.id === id); if (!k) return;
        openDlg(`${xBtn()}<h2>${esc(A.api.limit)}</h2><form class="body stack" data-form="key-limit"><input name="id" type="hidden" value="${esc(id)}" /><label class="f">${esc(A.api.limit)} (USD)<input type="text" name="limit" inputmode="decimal" maxlength="24" value="${k.limit === -1 ? "" : k.limit}" ${k.limit === -1 ? `placeholder="${esc(keyUnlimitedLabel[D.lang] ?? keyUnlimitedLabel.en)}"` : "required"} /></label><p class="hint">${esc(k.limit === -1 ? keyUnlimitedHint[D.lang] ?? keyUnlimitedHint.en : keyLimitRule[D.lang] ?? keyLimitRule.en)}</p><p data-key-error class="err" role="alert"></p><button class="btn pri">${esc(A.common.save)}</button></form>`);
        break;
      }
      case "api-logs": V.logsRange = V.apiRange; V.logsQuery = ""; void loadApiLogs(); break;
      case "api-logs-range": V.logsRange = i; void loadApiLogs(); break;
      case "logs-more": void loadApiLogs(true); break;
      case "ledger-page": {
        const page = Number(el.dataset.page);
        if (!Number.isSafeInteger(page) || page < 1) break;
        const result = await accountAction(() => accountApi.walletLedger(page));
        if (result) { V.ledgerPage = page; V.ledger = result; render(); }
        break;
      }
      case "wallet-tab": if (["plans", "ledger", "coupons", "invoices"].includes(el.dataset.v || "")) { V.walletTab = el.dataset.v; render(); root.querySelector<HTMLElement>(`.wallet-tabs [data-v="${V.walletTab}"]`)?.focus({ preventScroll: true }); } break;
      case "revoke": {
        const key = S.keys.find(key => key.id === id); if (!key) break;
        const prefix = getAppKeys().find(issued => String(issued.id) === id)?.prefix ?? "—";
        openDlg(`${xBtn()}<h2>${esc(A.api.revoke)}</h2><div class="body stack"><p>${esc(keyWords.revoke)}</p><dl class="currency-quote"><div><dt>${esc(keyWords.name)}</dt><dd>${esc(key.name)}</dd></div><div><dt>${esc(keyWords.prefix)}</dt><dd>${esc(prefix)}</dd></div></dl><div class="foot"><button class="btn" data-act="close">${esc(A.common.cancel)}</button><button class="btn danger" data-act="key-revoke-confirm" data-id="${esc(id)}">${esc(A.api.revoke)}</button></div></div>`);
        break;
      }
      case "key-revoke-confirm": { const result = await accountAction(() => accountApi.revokeKey(id)); if (result) { closeDlg(); void loadAccountViews(); } break; }
      // Billing
      case "mtab":
        if (!["all", "tokens", "subscriptions", "models"].includes(el.dataset.v || "")) break;
        V.marketTab = el.dataset.v; render();
        root.querySelector<HTMLElement>(`.market-tabs [data-v="${V.marketTab}"]`)?.focus({ preventScroll: true });
        break;
      case "market-clear": V.marketQ = ""; render(); root.querySelector<HTMLInputElement>('[data-input="marketQ"]')?.focus(); break;
      case "default-chan": toast(words.unavailable); break;
      case "budget-pause": toast(words.unavailable); break;
      case "subscribe": case "upgrade-plan": requestSupport(); break;
      // Dialog internals
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
      case "plan-select":
      case "exchange-quote": await openPurchaseList(); break;
      case "coupon-claim": {
        const code = val("code");
        if (!code || code.length > 120 || couponIntent && couponIntent.code !== code) break;
        couponIntent ??= { code, key: operationKey() };
        const intent = couponIntent;
        let rejected = false;
        const result = await accountAction(async () => {
          try { return await accountApi.claimCoupon(intent.code, intent.key); }
          catch (error) { rejected = error instanceof APIError && error.transactionRejected; throw error; }
        });
        if (result || rejected) couponIntent = null;
        if (result) void loadAccountViews(); else if (!ended) render();
        break;
      }
      case "send": sendMessage(form); break;
      case "agreement": {
        if (!fd.has("consent")) return;
        const result = await accountAction(() => accountApi.acceptAgreement(val("version")));
        if (result) closeDlg();
        break;
      }
      case "key-limit": {
        if (val("limit") === "" && S.keys.find(key => key.id === val("id"))?.limit === -1) { closeDlg(); break; }
        const limit = val("limit"), micro = /^0+(?:\.0{1,6})?$/.test(limit) ? 0 : parseCashMicro(limit);
        if (micro === null) {
          const error = form.querySelector<HTMLElement>("[data-key-error]"); if (error) error.textContent = keyWords.invalidLimit;
          form.querySelector<HTMLInputElement>('[name="limit"]')?.focus(); break;
        }
        const result = await accountAction(() => accountApi.setKeyLimits(val("id"), { monthly_micro: micro }));
        if (result) { closeDlg(); void loadAccountViews(); }
        break;
      }
      case "new-ws": {
        const name = val("name");
        if (!name) { form.querySelector("[data-err]")?.removeAttribute("hidden"); form.querySelector<HTMLInputElement>("[name=name]")!.focus(); return; }
        const w: Ws = { id: uid(), name, region: "ap", tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", created: Date.now() };
        S.workspaces.push(w);
        S.current = w.id;
        if (!await save()) return;
        closeDlg();
        go("new");
        void loadAccountViews();
        break;
      }
      case "rename": { const w = ws(); if (w && val("name")) { w.name = val("name"); if (!await save()) return; render(); toast(A.common.save + " ✓"); } break; }
      case "del-ws": {
        if (val("name") !== wsName()) { form.querySelector("input")!.focus(); return; }
        const idv = S.current;
        S.workspaces = S.workspaces.filter((w) => w.id !== idv);
        S.chats = S.chats.filter((c) => c.ws !== idv);
        S.current = S.workspaces[0]?.id || "";
        if (!await save()) return;
        go("");
        break;
      }
      case "profile": S.profile.name = val("name"); if (!await save()) return; render(); toast(A.user.saved); break;
      case "password": {
        // Passwords are sent exactly as typed, matching sign-in and the backend.
        const raw = (k: string) => String(fd.get(k) ?? "");
        const current = raw("current_password"), next = raw("new_password");
        if (!passwordIsValid(next, 8)) { toast(A.user.passwordBad); break; }
        if (next !== raw("confirm_password")) { toast(A.user.passwordMismatch); form.querySelector<HTMLInputElement>('[name="confirm_password"]')?.focus(); break; }
        const button = form.querySelector<HTMLButtonElement>('button[type="submit"],button:not([type])');
        if (button) button.disabled = true;
        try {
          await accountApi.password(current, next);
          ended = true; // This tab navigates below; skip its own announcement.
          announceSessionChange();
          location.replace(`${D.links.start}?password=changed`);
        } catch (error) {
          toast(error instanceof APIError && error.status === 429 ? error.retryAfter > 0 ? fmt(A.user.passwordLimited, { time: retryWait(error.retryAfter) }) : A.user.passwordLimitedLater : error instanceof Error ? error.message : security.saveFailed);
          if (button) button.disabled = false;
        }
        break;
      }
      case "budget": toast(words.unavailable); break;
      case "prompt": { const v = val("v"); if (!v) return; await V.promptOk?.(v); break; }
      case "key": {
        const limitText = val("limit");
        const monthlyMicro = !limitText || /^0+(?:\.0{1,6})?$/.test(limitText) ? 0 : parseCashMicro(limitText);
        const error = form.querySelector<HTMLElement>("[data-key-error]");
        if (monthlyMicro === null) {
          if (error) error.textContent = keyWords.invalidLimit;
          form.querySelector<HTMLInputElement>('[name="limit"]')?.setAttribute("aria-invalid", "true");
          form.querySelector<HTMLInputElement>('[name="limit"]')?.focus();
          break;
        }
        if (error) error.textContent = "";
        form.querySelector<HTMLInputElement>('[name="limit"]')?.removeAttribute("aria-invalid");
        if (!form.reportValidity()) break;
        const result = await accountAction(async () => {
          const created = await accountApi.createKey({ name: val("name"), monthly_micro: monthlyMicro });
          V.nextApiKey = created.key.id; V.apiKeysChanged = true;
          return created;
        });
        if (!result) return;
        const secret = result.raw;
        const P = A.api;
        keySecretCopied = false;
        const apiOrigin = location.hostname === "fells.dev" || location.hostname.endsWith(".fells.dev") ? "https://api.fells.dev" : location.origin;
        openDlg(`${xBtn()}<h2>${esc(P.create)}</h2><div class="body" data-key-secret><p class="note">${esc(P.created)}</p><div class="codebox"><pre class="code">${esc(secret)}</pre><button class="btn sm" data-act="copy" data-text="${esc(secret)}" data-msg="${esc(P.copied)}">${ic("copy", 13)}${esc(P.copy)}</button></div><p class="hint">${esc(keyWords.base)} <code>${esc(apiOrigin)}</code></p><p class="hint">${esc(words.allowance)}</p><div class="foot" style="margin:0"><button class="btn pri" data-act="close">${esc(P.done)}</button></div></div>`);
        break;
      }
    }
  });

  const refreshMarketSearch = (input: HTMLInputElement) => {
    V.marketQ = input.value;
    const start = input.selectionStart, end = input.selectionEnd;
    render();
    const next = root.querySelector<HTMLInputElement>('[data-input="marketQ"]');
    next?.focus({ preventScroll: true });
    if (next && start !== null && end !== null) next.setSelectionRange(start, end);
  };
  root.addEventListener("compositionstart", (e) => {
    if ((e.target as HTMLElement).dataset.input === "marketQ") marketComposing = true;
  });
  root.addEventListener("compositionend", (e) => {
    const input = e.target as HTMLInputElement;
    if (input.dataset.input !== "marketQ") return;
    marketComposing = false;
    if (!saving && !ended) refreshMarketSearch(input);
  });
  root.addEventListener("input", (e) => {
    if (ended) return;
    const t = e.target as HTMLInputElement;
    const k = t.dataset.input;
    if (t.id === "fx-input") { const chat = t.closest<HTMLFormElement>("[data-form=send]")?.dataset.chat; if (chat) chatDrafts.set(chat, t.value); else V.draft = t.value; }
    if (!k) return;
    if (k === "logsQuery") {
      V.logsQuery = t.value;
      const list = dlgEl?.querySelector<HTMLElement>(".api-log-list");
      if (list) list.innerHTML = apiLogRows();
    } else if (k === "marketQ") {
      V[k] = t.value;
      // Keep the composition target alive until the user commits an IME candidate.
      if (!marketComposing && !(e as InputEvent).isComposing) refreshMarketSearch(t);
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
    if (ended) return;
    const t = e.target as HTMLSelectElement;
    if (t.dataset.input === "apiKey") { V.apiKey = Number(t.value); refreshApiKeys(); render(); return; }
    if (t.dataset.input === "claudePlatform" && ["macos", "linux", "windows"].includes(t.value)) { V.claudePlatform = t.value as ClaudePlatform; render(); return; }
    if (t.dataset.input === "claudeModel") { V.claudeModel = t.value; render(); return; }
    if (saving) return;
    if (t.dataset.input === "prefAgent") { S.prefs.agent = t.value; V.agent = t.value; if (!await save()) return; }
    if (t.dataset.input === "defaultChannel") { S.defaultChannel = t.value; if (!await save()) return; }
  });

  document.addEventListener("keydown", (e) => {
    if (ended) return;
    const mod = e.metaKey || e.ctrlKey;
    if (dlgEl) {
      // Native support/image dialogs may temporarily sit above the app dialog.
      if (!dialogFocus?.isCurrent()) return;
      if (e.key === "Tab") { dialogFocus.tab(e); return; }
      if (dlgEl.querySelector("[data-pal]") && mod && e.key.toLowerCase() === "k") { e.preventDefault(); closeDlg(true); return; }
      // Global navigation must not discard an open form or its draft.
      if (mod && (e.key.toLowerCase() === "k" || e.key === "/" || e.shiftKey && e.key.toLowerCase() === "o")) { e.preventDefault(); return; }
    }
    if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); dlgEl ? closeDlg(true) : openPalette(); return; }
    if (mod && e.shiftKey && e.key.toLowerCase() === "o") { e.preventDefault(); hasWs() ? go("new") : openNewWs(); return; }
    if (mod && e.key === "/") { e.preventDefault(); toggleSb(); return; }
    if (e.key === "Escape") {
      if (popEl) { closePop(); return; }
      if (dlgEl) { closeDlg(true); return; }
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

  addEventListener("hashchange", () => { stopApiUsage(); stopChatPolling(); if (!ended) { closePop(); if (root.dataset.route !== location.hash) closeDlg(); render(); void loadExchangeHistory(); } });
  addEventListener("resize", () => { closePop(); if (innerWidth > 860) closeSb(); });
  addEventListener("beforeunload", event => { if (!ended && !keySecretCopied && dlgEl?.querySelector("[data-key-secret]")) { event.preventDefault(); event.returnValue = ""; } });

  // Notifications update views; the transaction protects writes even without them.
  const walletChanged = (value: { userId?: string; sessionId?: string } | null) => {
    const b = getAppBootstrap();
    if (b && value?.userId === String(b.user.id) && value?.sessionId === b.session_id) void refresh();
  };
  try {
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("fells.session.changed");
    // A customer session change elsewhere ends this view at once; private
    // content must not wait on a refresh that may fail offline.
    if (channel) channel.onmessage = (event) => { if (event.data?.audience !== "operator") clearView(); };
    const updates = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("fells.app.changed.v1");
    if (updates) updates.onmessage = () => { void refresh(); };
    const walletUpdates = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("fells.wallet.changed");
    if (walletUpdates) { walletUpdates.onmessage = event => walletChanged(event.data); addEventListener("pagehide", () => walletUpdates.close(), { once: true }); }
  } catch { /* Browser policy can disable cross-tab notifications. */ }
  addEventListener("fells.session.changed", (event) => { if ((event as CustomEvent).detail?.audience !== "operator") clearView(); });
  addEventListener("focus", () => { void refresh(); void loadApiUsage(); syncChatPolling(); });
  addEventListener("fells.wallet.changed", event => walletChanged((event as CustomEvent).detail));
  document.addEventListener("visibilitychange", () => { syncApiUsage(); syncChatPolling(); syncChatProgress(); if (!document.hidden) void refresh(); });
  addEventListener("pageshow", (event) => { if (event.persisted) location.reload(); });
  addEventListener("pagehide", () => { apiUsagePageGone = true; stopApiUsage(); stopChatPolling(); stopChatProgress(); attachments?.dispose(); markdownCache.clear(); root.replaceChildren(); });

  attachments = createChatAttachments(root, {
    language: D.lang,
    identity: { userId: fxIdentity.user.id, sessionId: fxIdentity.session_id },
    active: () => !ended && committed?.session === fxIdentity.session_id,
    unauthorized: clearView,
    current: () => {
      const form = root.querySelector<HTMLFormElement>("[data-form=send]"), chatID = form?.dataset.chat;
      const capabilities = V.chatCatalog?.models.find((model: ChatModel) => model.model === form?.dataset.model);
      const run = chatID && chatRuns.get(chatID);
      return { draftKey: chatID ? `chat:${chatID}` : `new:${S.current}`, chatID, capabilities, enabled: !!form && modelChatEnabled() && !isExample(), recover: !!V.chatCatalog?.models.some((model: ChatModel) => model.attachments || model.vision || model.documents),
        blocked: saving || !!V.chatStarting || isBusinessBlocked() || !committed || getAppWorkspaceRole(S.current) === "viewer" || !!run && !chatRunSettled(run) };
    },
    ensureChat: async () => {
      const form = root.querySelector<HTMLFormElement>("[data-form=send]");
      if (ended || saving || !committed || !hasWs() || isExample() || getAppWorkspaceRole(S.current) === "viewer" || !["", "new"].includes(route().name) || !form || V.chatCatalogStatus !== "ready") return;
      const model = form.dataset.model ?? "", workspace = S.current, startRoute = location.hash, body = root.querySelector<HTMLTextAreaElement>("#fx-input")?.value ?? V.draft;
      if (!V.chatCatalog?.models.some((choice: ChatModel) => choice.model === model)) return;
      const chatID = uid(); V.chatStarting = true; render();
      S.chats.push({ id: chatID, ws: workspace, title: body.split("\n")[0].slice(0, 48) || A.chat.untitled, agent: "lite", model, created: Date.now(), messages: [] });
      try {
        if (!await save() || ended) return;
        chatDrafts.set(chatID, body); V.draft = "";
        if (location.hash === startRoute && S.current === workspace) go("chat/" + chatID);
        return chatID;
      } finally { V.chatStarting = false; if (!ended) render(); }
    },
  });

  // Website links may preselect a view: /app#/billing/credits etc.
  render();
  root.removeAttribute("aria-busy");
  void loadExchangeHistory();
  if (!getAppBootstrap()?.agreement.accepted) void openAgreement();
  else if (!S.onboarded) openOnboard();
  // Conversation readiness must not wait for unrelated wallet/history APIs.
  // The loader coalesces concurrent calls from loadAccountViews below.
  if (modelChatEnabled()) void loadChatModels();
  void loadAccountViews();
}
