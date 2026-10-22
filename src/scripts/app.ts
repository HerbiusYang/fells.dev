// Client for /app. Renders every signed-in view from the JSON blob in AppPage.astro.
// Business state is read from the same-origin API; transient drafts stay in memory.
import { freshState, MAX_MESSAGE, type Ws, type Chat } from "../lib/preview-state";
import { readApp, commitApp, endApp, getAppBootstrap, getAppKeys, getAppWorkspaceRole, getAppMessageMetadata, listAppMembers, listAppPendingInvitations, listAppReceivedInvitations, setAppMember, revokeAppInvitation, acceptAppInvitation, declineAppInvitation, leaveAppWorkspace, updateAppMemberRole, removeAppMember, importAppChat, generateAppChat, readAppChatRun, type AppChatRun, type AppChatResult } from "../lib/app-service";
import { removeLegacyStorage, StaleState, EndedSession } from "../lib/preview-store";
import { accountApi, agreementText, passwordIsValid, announceSessionChange, setExpectedUser, usageTokens } from "../lib/account-api";
import { APIError, operationKey } from "../lib/app-http";
import { businessRulesOf } from "../i18n/business-rules";
import { tokenPlanWordsOf } from "../i18n/token-plan";
import { planCheckoutCopy } from "../i18n/plan-checkout";
import { planPriceCeiling, validPlanPurchase, validPlanReceipt, type PlanPurchase, type PlanKind } from "../lib/plan-checkout";
import { marketWordsOf } from "../i18n/market";
import { currencyFlowCopy } from "../i18n/currency-flow";
import { parseCashMicro, validExchangeQuote, validExchangeReconciliation, microText, storeMoneyIntent, type ExchangeQuote } from "../lib/currency-flow";
import { parseChatModels, conversationKey, modelFormat, type ChatModel, type ChatModelCatalog } from "../lib/model-chat";
import { claudeSettings, claudeTemporary, claudeInstall, claudeSettingsPath, type ClaudePlatform } from "../lib/claude-setup";
import { claudeSetupWordsOf } from "../i18n/claude-setup";
/* eslint-disable @typescript-eslint/no-explicit-any */

const root = document.getElementById("fx");
const blob = document.getElementById("fx-data");
if (root && blob) {
  const data = JSON.parse(blob.textContent || "{}");
  if (window.self !== window.top) root.textContent = data.security.frameBlocked;
  else start(root, data).catch((error) => {
    // The layout's skip link targets #fx-main, so the error state is a <main> too.
    const main = document.createElement("main");
    main.id = "fx-main";
    const message = document.createElement("p");
    message.textContent = error instanceof Error ? error.message : "Unable to connect to the service";
    const link = document.createElement("a");
    link.href = data.links.start;
    link.textContent = data.security.enter;
    main.append(message, link);
    root.replaceChildren(main);
  });
}

async function start(root: HTMLElement, D: any) {
  const A = D.a;
  const security = D.security;
  const zh = D.lang.startsWith("zh");
  const billingRules = businessRulesOf(D.lang);
  const planWords = tokenPlanWordsOf(D.lang);
  const pc = planCheckoutCopy(D.lang);
  const marketWords = marketWordsOf(D.lang);
  const fx = currencyFlowCopy(D.lang);
  const claudeWords = claudeSetupWordsOf(D.lang);
  const contactPurchase = fx.fund;
  const requestSupport = (intent: Record<string, unknown> = {}) => document.dispatchEvent(new CustomEvent("fells:support-open", { detail: intent }));
  const keyLimitRule: Record<string, string> = { "zh-CN": "按该 Key 的美元 API 额度消耗计量；0 表示跟随默认限额。", "zh-TW": "按此 Key 的美元 API 額度消耗計量；0 表示使用預設上限。", ja: "このキーの USD API 利用枠で計測します。0 は既定上限を使用します。", ko: "이 키의 USD API 이용 한도로 계산합니다. 0은 기본 한도를 따릅니다.", es: "Se mide por el saldo API en USD de esta clave; 0 usa el límite predeterminado.", en: "Measured by this key’s USD API allowance consumption; 0 follows the default limit." };
  const keyDefaultLabel: Record<string, string> = { "zh-CN": "跟随默认限额", "zh-TW": "使用預設上限", ja: "既定上限", ko: "기본 한도", es: "Límite predeterminado", en: "Default limit" };
  const keyUnlimitedLabel: Record<string, string> = { "zh-CN": "不限额（运营设置）", "zh-TW": "不限額（營運設定）", ja: "上限なし（運営設定）", ko: "무제한 (운영자 설정)", es: "Sin límite (configurado por operaciones)", en: "Unlimited (set by operations)" };
  const keyUnlimitedHint: Record<string, string> = { "zh-CN": "留空可保留当前不限额设置；填写0改为默认限额，填写正数设置自己的上限。", "zh-TW": "留空可保留目前不限額設定；填寫0改為預設上限，填寫正數設定自己的上限。", ja: "空欄で現在の上限なし設定を維持します。0は既定上限、正の数は独自の上限に変更します。", ko: "비워 두면 현재 무제한 설정을 유지합니다. 0은 기본 한도, 양수는 직접 설정한 한도로 변경합니다.", es: "Déjalo vacío para conservar la configuración sin límite. Usa 0 para el límite predeterminado o un valor positivo para fijar tu límite.", en: "Leave blank to keep the current unlimited setting. Enter 0 for the default limit or a positive value for your own cap." };
  const words = {
    unavailable: zh ? "服务尚未配置" : "Service is not configured",
    history: zh ? "导入 JSON 对话历史" : "Import JSON conversation history",
    historyHint: zh ? "选择 Fells 导出的 JSON，或含 title、agent、model、messages 的单条对话。历史标记为导入内容，不代表 Agent 实际执行。" : "Choose a Fells JSON export or one conversation with title, agent, model and messages. Imported history does not represent agent execution.",
    listValue: zh ? "调用标价" : "Provider list value",
    listValueHint: zh ? "按请求记录中的美元标价汇总" : "USD list prices recorded with requests",
    saved: zh ? "已保存到工作区，Agent 执行服务尚未配置" : "Saved to the workspace. Agent execution is not configured.",
    cash: zh ? "人民币现金" : "CNY cash", grant: zh ? "人民币赠金" : "CNY promotional balance",
    allowance: zh ? "独立美元 API 额度" : "Independent USD API allowance", wallet: zh ? "人民币钱包" : "CNY wallet",
    allowanceTerms: billingRules.expiry,
    manualBillingMode: billingRules.modes,
    exchange: zh ? "兑换 API 额度" : "Buy API allowance", ledger: zh ? "钱包流水" : "Wallet ledger",
    contactPurchase,
    logs: zh ? "调用记录" : "Request logs", empty: zh ? "暂无记录" : "No records",
    loading: zh ? "正在读取" : "Loading", addMember: A.members.invite,
    username: zh ? "用户名或已验证邮箱" : "Username or verified email",
    monthly: zh ? "/月" : "/month",
    memberRoleChange: zh ? "改为" : "Change to",
    notOffered: zh ? "暂无在售商品" : "No products are currently offered",
    accept: zh ? "阅读并接受当前服务条款" : "Read and accept the current terms",
    pendingTopup: contactPurchase,
    mySubscriptions: zh ? "我的订阅" : "My subscriptions",
    expires: zh ? "到期" : "Expires",
    currentRide: zh ? "当前使用" : "Current",
    makeCurrentRide: zh ? "切换到这份订阅" : "Use this subscription",
    monthlyRideMode: zh ? "包月订阅" : "Monthly subscription",
    allowanceRideMode: zh ? "API 额度" : "API allowance",
    couponWallet: zh ? "我的优惠券" : "My coupons",
    couponStatus: zh ? "状态" : "Status",
    couponStates: zh ? { issued: "可使用", expired: "已过期", redeemed: "已使用", void: "已作废" } : { issued: "Available", expired: "Expired", redeemed: "Redeemed", void: "Voided" },
    invoices: zh ? "发票" : "Invoices",
    download: zh ? "下载" : "Download",
    invoiceEmpty: zh ? "暂无已开具的发票" : "No issued invoices yet",
    workspaceSummary: zh ? "管理工作区名称和成员。" : "Manage this workspace name and its members.",
    workspaceDelete: zh ? "删除工作区" : "Delete workspace",
    workspaceDeleteSub: zh ? "此操作会永久删除工作区及其中保存的对话。" : "This permanently deletes the workspace and its saved conversations.",
    workspaceDeleteConfirm: zh ? "输入工作区名称以确认删除。" : "Enter the workspace name to confirm deletion.",
    modelChat: zh ? "文字模型对话" : "Model conversation",
    chatWelcome: zh ? "开始新对话" : "Start a conversation",
    chatWelcomeNote: zh ? "选择模型，聊聊你的想法。" : "Choose a model and share your ideas.",
    chatBilling: zh ? "模型调用按所选 Key 计费" : "Model calls are billed to the selected key.",
    chatBillingKey: zh ? "计费 Key" : "Billing key",
    chatManageKey: zh ? "管理" : "Manage",
    chatReloadModels: zh ? "刷新模型" : "Reload models",
    chatPlaceholder: zh ? "向所选模型发送文字消息" : "Send a text message to the selected model",
    modelLoading: zh ? "正在加载模型…" : "Loading models…",
    modelEmpty: zh ? "此 Key 暂无可用模型。" : "This key has no available models.",
    modelEmptyLabel: zh ? "暂无可用模型" : "No available models",
    modelError: zh ? "无法加载模型，请重试。" : "Models could not be loaded. Try again.",
    modelErrorLabel: zh ? "模型加载失败" : "Models unavailable",
    noChatKey: zh ? "请选择一把有效的个人 API Key。" : "Choose an active personal API key to continue.",
    noChatKeyLabel: zh ? "选择 API Key" : "Select an API key",
    manageKeys: zh ? "管理 API Key" : "Manage API keys",
    chatCheck: zh ? "查看本次结果" : "Check this request",
    chatPending: zh ? "本次模型请求尚未结束。可只读查看结果；请勿重复发送相同消息。" : "This model request has not finished. Check its status without sending the same message again.",
    chatUnknown: zh ? "本次结果尚未确认，可能已执行并计费。请先查看本次结果或刷新历史，不要重复发送。" : "The outcome is not confirmed and the request may have run and been charged. Check this request or refresh history before sending again.",
    chatFailed: zh ? "本次模型请求未完成。消息和结果以服务器记录为准；不会自动重试。" : "This model request did not complete. Server history is authoritative; it will not be retried automatically.",
    chatCompleted: zh ? "模型回复已保存。" : "The model reply has been saved.",
    chatStorage: zh ? "无法保存本次请求标记，尚未发送模型请求。请允许会话存储后重试。" : "The request marker could not be saved, so no model request was sent. Allow session storage before trying again.",
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
  let committed = await readApp();
  if (!committed) { location.replace(D.links.start); return; }
  let S = structuredClone(committed.state);
  let accountSnapshot = JSON.stringify(getAppBootstrap());
  let marketComposing = false;
  const bindIdentity = () => { const b = getAppBootstrap(); if (b) setExpectedUser({ userId: b.user.id, sessionId: b.session_id }); };
  bindIdentity();
  const fxIdentity = getAppBootstrap()!;
  const fxStorageKey = `fells.exchange.v1:${fxIdentity.user.id}:${fxIdentity.session_id}`;
  let exchangeIntent: { key: string; quote: ExchangeQuote } | null = null;
  try {
    const stored = JSON.parse(sessionStorage.getItem(fxStorageKey) ?? "null");
    if (stored && /^[a-f0-9-]{36}$/.test(stored.key) && validExchangeQuote(stored.quote)) exchangeIntent = stored;
  } catch { /* The form reports storage failure before any financial request. */ }
  const planStorageKey = `fells.plan-purchase.v1:${fxIdentity.user.id}:${fxIdentity.session_id}`;
  let planIntent: PlanPurchase | null = null, planReview: PlanPurchase | null = null;
  let planSelection: { kind: PlanKind; code?: string; pool?: number; tier?: number } | null = null;
  let planMonths = 1, planError = "";
  try {
    const stored = JSON.parse(sessionStorage.getItem(planStorageKey) ?? "null");
    if (validPlanPurchase(stored)) planIntent = stored;
  } catch { /* A new financial request requires verified intent storage. */ }
  let exchangeQuote: ExchangeQuote | null = null;
  let exchangeAmount = "", exchangeError = "";
  const editingForm = () => document.activeElement instanceof HTMLElement && root.contains(document.activeElement) && (!!document.activeElement.closest('[data-form]') || (marketComposing && document.activeElement.dataset.input === "marketQ"));
  // Never serialize these values, including on theme/profile saves.
  let saving = false;
  let refreshPending = false;
  let ended = false;
  let generation = 0;
  const clearView = () => {
    if (ended) return; // One navigation: a local logout also announces itself.
    ended = true;
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
    accountSnapshot = JSON.stringify(getAppBootstrap());
    bindIdentity();
    const cash = root.querySelector<HTMLElement>("[data-exchange-cash]");
    if (cash) cash.textContent = `CNY ${microText(getAppBootstrap()!.wallet.cash_micro)}`;
  };
  const showLatest = (next: Awaited<ReturnType<typeof readApp>>) => {
    if (!next || next.session !== committed!.session) { clearView(); return; }
    if (next.revision > committed!.revision) {
      adopt(next); closeDlg(); closePop(); render();
      toast(security.conflict);
    } else {
      const unchanged = next.revision === committed!.revision && accountSnapshot === JSON.stringify(getAppBootstrap());
      adopt(next);
      if (!unchanged && !dlgEl && !popEl && !editingForm()) render();
    }
  };
  const refresh = async () => {
    if (ended) return;
    if (saving) { refreshPending = true; return; }
    refreshPending = false;
    const before = generation;
    try {
      const next = await readApp();
      if (saving || ended || before !== generation) return;
      showLatest(next);
    } catch (error) {
      if (error instanceof EndedSession || (error instanceof APIError && error.status === 401)) { clearView(); return; }
      toast(error instanceof Error ? error.message : security.saveFailed);
    }
  };
  const save = async (): Promise<boolean> => {
    if (saving || ended) return false;
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
  // The server includes Token Plan capacity in allowance.micro. Display the
  // independent 12-month/compensation balance separately from the plan below.
  const balance = () => {
    const allowance = getAppBootstrap()?.api_allowance.balance;
    return ((allowance?.micro ?? 0) - (allowance?.plan_micro ?? 0)) / 1_000_000;
  };
  const cashBalance = () => (getAppBootstrap()?.wallet.cash_micro ?? 0) / 1_000_000;
  const cny = (n: number) => "¥" + n.toFixed(2);
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
    claudePlatform: (/Win/.test(navigator.platform || navigator.userAgent) ? "windows" : MAC ? "macos" : "linux") as ClaudePlatform,
    claudeSetup: "saved",
    claudeModel: "",
    usage: null, logs: null, catalog: null, subscriptions: null, tokenPlans: null, ledger: null,
    members: [], membersWorkspace: "", invitations: null, pendingInvitations: null, pendingWorkspace: "", dataError: "", dataLoading: false,
    apiCatalog: null, catalogStatus: "loading", catalogError: "", catalogKeyLoaded: -1, catalogLoading: false, chatCatalog: null as ChatModelCatalog | null, chatCatalogStatus: "loading", chatCatalogError: "", chatKey: 0, chatKeyLoaded: 0, chatCatalogLoading: false,
  };
  const modelChatEnabled = () => getAppBootstrap()?.capabilities.model_chat === true;
  type LocalChatRun = AppChatRun & { chat_id: string };
  const runStorageKey = `fells.chat-run.v1:${fxIdentity.user.id}:${fxIdentity.session_id}`;
  const chatRuns = new Map<string, LocalChatRun>();
  try {
    const stored = JSON.parse(sessionStorage.getItem(runStorageKey) ?? "[]");
    if (Array.isArray(stored) && stored.length <= 100) for (const run of stored) {
      if (run && typeof run === "object" && typeof run.chat_id === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(run.chat_id) && /^[0-9a-f-]{36}$/i.test(run.request_id) && ["pending", "running", "unknown"].includes(run.status)) chatRuns.set(run.chat_id, run);
    }
  } catch { /* A fresh request still requires a readable marker before dispatch. */ }
  const persistChatRuns = () => {
    const value = JSON.stringify([...chatRuns.values()].filter(run => !["completed", "failed"].includes(run.status)));
    sessionStorage.setItem(runStorageKey, value);
    if (sessionStorage.getItem(runStorageKey) !== value) throw new Error(words.chatStorage);
  };
  const availableChatKeys = () => getAppKeys().filter(key => conversationKey(key));
  const selectedChatKey = () => availableChatKeys().find(key => key.id === V.chatKey) ?? availableChatKeys()[0];
  const loadApiCatalog = async () => {
    if (ended || !committed || V.catalogLoading) return;
    const keyID = selectedChatKey()?.id ?? 0;
    if (modelChatEnabled() && !keyID) { V.apiCatalog = null; V.catalogStatus = "no-key"; if (!saving && !dlgEl && !popEl) render(); return; }
    const identity = committed.session;
    V.catalogLoading = true; V.catalogStatus = "loading"; V.catalogError = ""; V.apiCatalog = null;
    if (!saving && !dlgEl && !popEl) render();
    try {
      const catalog = await accountApi.catalog(keyID || undefined);
      if (ended || committed?.session !== identity || (selectedChatKey()?.id ?? 0) !== keyID) return;
      if (!catalog || !Array.isArray(catalog.models) || catalog.models.some((model: any) => !model || typeof model.model !== "string" || !model.model)) throw new Error(words.modelError);
      V.apiCatalog = catalog; V.catalogStatus = "ready"; V.catalogKeyLoaded = keyID;
    } catch (error) {
      if (ended || committed?.session !== identity || (selectedChatKey()?.id ?? 0) !== keyID) return;
      if (error instanceof APIError && error.status === 401) { clearView(); return; }
      V.apiCatalog = null; V.catalogStatus = "error"; V.catalogError = error instanceof Error ? error.message : words.modelError;
    } finally {
      V.catalogLoading = false;
      if (!ended && (selectedChatKey()?.id ?? 0) !== keyID) void loadApiCatalog();
      else if (!ended && !saving && !dlgEl && !popEl) render();
    }
  };
  const loadChatModels = async () => {
    if (!modelChatEnabled() || ended || !committed || V.chatCatalogLoading) return;
    const key = selectedChatKey();
    if (!key) { V.chatCatalogStatus = "no-key"; V.chatCatalog = null; if (!saving && !dlgEl && !popEl) render(); return; }
    const identity = committed.session, keyID = key.id;
    V.chatKey = keyID; V.chatCatalogLoading = true; V.chatCatalogStatus = "loading"; V.chatCatalogError = "";
    if (!saving && !dlgEl && !popEl) render();
    try {
      const catalog = parseChatModels(await accountApi.chatModels(keyID), keyID);
      if (ended || committed?.session !== identity || selectedChatKey()?.id !== keyID) return;
      V.chatCatalog = catalog; V.chatCatalogStatus = catalog.models.length ? "ready" : "empty"; V.chatKeyLoaded = keyID;
    } catch (error) {
      if (ended || committed?.session !== identity || selectedChatKey()?.id !== keyID) return;
      if (error instanceof APIError && error.status === 401) { clearView(); return; }
      V.chatCatalog = null; V.chatCatalogStatus = "error"; V.chatCatalogError = error instanceof Error ? error.message : words.modelError;
    } finally {
      V.chatCatalogLoading = false;
      if (!ended && selectedChatKey()?.id !== keyID) void loadChatModels();
      else if (!ended && !saving && !dlgEl && !popEl) render();
    }
  };

  const accountAction = async <T>(run: () => Promise<T>): Promise<T | undefined> => {
    if (saving || ended || !committed) return;
    const identity = committed.session;
    let result: T | undefined;
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
        const message = error instanceof Error ? error.message : security.saveFailed;
        try { const next = await readApp(); if (!next || next.session !== identity) { clearView(); return; } adopt(next); render(); } catch { /* One-time issuance secrets still need to be exposed below. */ }
        toast(message);
      }
      // A completed key issuance must still expose its one-time secret when a
      // later refresh fails. A replaced/ended identity discards it instead.
      if (!ended && committed?.session === identity && getAppBootstrap()?.session_id === identity) return result;
      return;
    } finally {
      saving = false; root.removeAttribute("aria-busy");
      if (refreshPending) void refresh();
    }
  };
  const loadAccountViews = async () => {
    if (ended || !committed) return;
    if (V.dataLoading) { V.dataReload = true; return; }
    const identity = committed.session, epoch = generation, range = V.apiRange, workspaceID = S.current;
    V.dataLoading = true;
    if (!V.apiCatalog || V.catalogKeyLoaded !== (selectedChatKey()?.id ?? 0)) void loadApiCatalog();
    const since = usageSince(range);
    const tasks = [accountApi.usage({ since }), accountApi.logs({ since }), accountApi.catalog(), accountApi.subscriptions(), accountApi.tokenPlans(), accountApi.walletLedger(), accountApi.coupons(), accountApi.invoices()];
    const members = S.current && S.current !== "example" ? listAppMembers(S.current) : Promise.resolve([]);
    const invitations = listAppReceivedInvitations();
    const pending = S.current && S.current !== "example" && getAppWorkspaceRole(S.current) === "owner"
      ? listAppPendingInvitations(S.current) : Promise.resolve([]);
    const results = await Promise.allSettled([...tasks, members, invitations, pending]);
    V.dataLoading = false;
    if (ended || !committed || committed.session !== identity || generation !== epoch || V.apiRange !== range || S.current !== workspaceID) { void loadAccountViews(); return; }
    const names = ["usage", "logs", "catalog", "subscriptions", "tokenPlans", "ledger", "coupons", "invoices", "members", "invitations", "pendingInvitations"];
    V.dataError = "";
    results.forEach((result, i) => {
      if (names[i] === "catalog" && result.status === "fulfilled" && (!result.value || !Array.isArray((result.value as any).models) || (result.value as any).models.some((model: any) => !model || typeof model.model !== "string" || !model.model))) {
        V.catalog = null; V.dataError ||= words.modelError; return;
      }
      if (result.status === "fulfilled") V[names[i]] = result.value;
      else {
        V[names[i]] = null;
        V.dataError ||= result.reason instanceof Error ? result.reason.message : security.saveFailed;
      }
    });
    V.membersWorkspace = workspaceID;
    V.pendingWorkspace = workspaceID;
    if (!popEl && !dlgEl && !editingForm()) render();
    if (modelChatEnabled() && (!V.chatCatalog || V.chatKeyLoaded !== selectedChatKey()?.id)) void loadChatModels();
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
    closeSb();
    if (location.hash.replace(/^#\/?/, "") === h) render();
    else location.hash = h ? "/" + h : "";
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
  const copy = async (text: string, msg: string) => {
    try { await navigator.clipboard.writeText(text); } catch {}
    toast(msg);
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
  const chatModelState = () => V.chatCatalogStatus === "ready" ? "" : V.chatCatalogStatus === "no-key" ? words.noChatKey : V.chatCatalogStatus === "empty" ? words.modelEmpty : V.chatCatalogStatus === "error" ? words.modelError : words.modelLoading;
  const chatModelLabel = () => V.chatCatalogStatus === "no-key" ? words.noChatKeyLabel : V.chatCatalogStatus === "empty" ? words.modelEmptyLabel : V.chatCatalogStatus === "error" ? words.modelErrorLabel : words.modelLoading;
  const chatRunNotice = (chatID: string) => {
    const run = chatRuns.get(chatID);
    if (!run) return "";
    const message = run.status === "completed" ? words.chatCompleted : run.status === "failed" ? words.chatFailed : run.status === "unknown" ? words.chatUnknown : words.chatPending;
    return `<div class="note chat-run-status" role="status" data-chat-run="${esc(run.request_id)}" data-run-status="${esc(run.status)}"><p>${esc(message)}${run.error_code ? ` ${esc(run.error_code)}` : ""}</p>${!["completed", "failed"].includes(run.status) ? `<button class="btn sm" data-act="chat-check" data-chat="${esc(chatID)}">${esc(words.chatCheck)}</button>` : ""}</div>`;
  };

  const composer = (opts: { chat?: Chat; disabled?: boolean } = {}) => {
    const agent = agentById(opts.chat ? opts.chat.agent : V.agent);
    const real = modelChatEnabled() && !isExample();
    const requested = opts.chat ? V.chatModel?.[opts.chat.id] ?? opts.chat.model : currentModel(agent);
    const choice: ChatModel | undefined = real ? V.chatCatalog?.models.find((m: ChatModel) => m.model === requested) ?? V.chatCatalog?.models[0] : undefined;
    const model = real ? choice?.model ?? "" : requested;
    const pending = opts.chat && chatRuns.get(opts.chat.id);
    const disabled = opts.disabled || (!isExample() && getAppWorkspaceRole(S.current) === "viewer") || real && (saving || V.chatCatalogStatus !== "ready" || !choice || !selectedChatKey() || !!pending && !["completed", "failed"].includes(pending.status));
    const ph = real ? words.chatPlaceholder : agent.id === "media" ? A.newChat.mediaPlaceholder : fmt(A.newChat.placeholder, { agent: agent.name });
    const modelLabel = real ? V.chatCatalogStatus === "ready" && choice ? choice.label : chatModelLabel() : model;
    return `
      ${real ? `<div class="chat-model-state" data-model-state="${esc(V.chatCatalogStatus)}"><div class="chat-key-toolbar"><label class="chat-key-control"><span>${esc(words.chatBillingKey)}</span><select data-input="chatKey" aria-label="${esc(words.chatBillingKey)}" ${saving || !availableChatKeys().length ? "disabled" : ""}>${availableChatKeys().map(key => `<option value="${key.id}" ${selectedChatKey()?.id === key.id ? "selected" : ""}>${esc(key.name)} · ${esc(key.prefix)}</option>`).join("") || `<option value="">${esc(words.noChatKeyLabel)}</option>`}</select></label><div class="chat-key-actions"><button class="icon-btn" data-act="chat-models" title="${esc(words.chatReloadModels)}" aria-label="${esc(words.chatReloadModels)}" ${V.chatCatalogLoading || saving || !selectedChatKey() ? "disabled" : ""}>${ic("refresh", 15)}</button><a href="#/api" aria-label="${esc(words.manageKeys)}">${esc(words.chatManageKey)}</a></div></div><p class="chat-model-message" role="status" ${chatModelState() ? "" : "hidden"}>${esc(chatModelState())}</p></div>` : ""}
      <form class="composer ${disabled ? "off" : ""}" data-form="send" data-model="${esc(model)}" ${opts.chat ? `data-chat="${esc(opts.chat.id)}"` : ""}>
        <label class="sr" for="fx-input">${esc(ph)}</label>
        <textarea id="fx-input" name="text" maxlength="${MAX_MESSAGE}" rows="2" placeholder="${esc(opts.disabled ? A.example.composer : ph)}" ${disabled ? "disabled" : ""}>${esc(opts.chat ? "" : V.draft)}</textarea>
        <div class="tools">
          <div class="r">
            <button type="button" class="model-btn" data-act="model" data-agent="${esc(agent.id)}" ${opts.chat ? `data-chat="${esc(opts.chat.id)}"` : ""} title="${esc(real && V.chatCatalogStatus === "ready" ? model : modelLabel)}" aria-haspopup="menu" ${opts.disabled || real && (saving || V.chatCatalogStatus !== "ready") ? "disabled" : ""}>${real ? ic("box", 18) : agent.id === "media" ? mk(M.images[model] || M.agents.media, 18) : mk(M.providers[(D.models.find((x: any) => x.name === model) || {}).provider] || M.agents[agent.id], 18)}<span>${esc(modelLabel)}</span>${real && V.chatCatalogStatus === "ready" && choice?.label !== model ? `<small>${esc(model)}</small>` : ""}${!real || V.chatCatalogStatus === "ready" ? ic("chev", 14) : ""}</button>
            <button class="send" type="submit" aria-label="${esc(A.newChat.send)}" ${disabled ? "disabled" : ""}>${ic("up", 16)}</button>
          </div>
        </div>
      </form>
      ${real ? `<p class="chat-billing-note">${esc(words.chatBilling)}</p>` : ""}
      `;
  };

  const vNew = () => {
    if (modelChatEnabled() && !isExample()) return `${bar(words.modelChat, wsName(), `<button class="btn sm soft" data-go="import">${ic("import", 14)}${esc(A.nav.importLocal)}</button>`, true)}<div class="scroll"><div class="nc model-chat-welcome"><h2>${esc(words.chatWelcome)}</h2><p>${esc(words.chatWelcomeNote)}</p></div></div><div class="dock">${composer()}</div>`;
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
        return `<div class="msg ${s.user ? "user" : ""}"><div class="msg-who">${s.html}${esc(s.name)}${author?.imported ? `<span class="tag">${esc(zh ? "导入历史" : "Imported history")}</span>` : ""}</div><div class="msg-body">${esc(text)}</div></div>`;
      })
      .join("");
    const right = !canDeleteChats() ? "" : `<button class="icon-btn" data-act="del-chat" data-id="${esc(chat.id)}" title="${esc(A.chat.delete)}" aria-label="${esc(A.chat.delete)}">${ic("trash", 16)}</button>`;
    return `
      ${bar(chat.title, `${agent.name} · ${chat.model}`, right)}
      ${modelChatEnabled() && !isExample() ? "" : `${strip()}<p class="note chat-execution-note">${esc(A.newChat.executionNote)}</p>`}
      ${modelChatEnabled() && !isExample() ? chatRunNotice(chat.id) : ""}
      <div class="scroll" data-thread><div class="thread">${msgs}</div></div>
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
    const claudeModels = catalogModels.filter((m: any) => modelFormat(m, ["anthropic-messages"], "claude_code") && typeof m.model === "string" && m.model.trim().length > 0);
    const claudeModel = claudeModels.find((m: any) => m.model === V.claudeModel) ?? claudeModels[0];
    if (!V.quickChosen && V.catalogStatus === "ready") V.quickTab = curlModel ? 0 : openAIModel ? 1 : claudeModel ? 2 : 0;
    const claudeSnippet = !claudeModel ? catalogUnavailable || (zh ? "# 当前暂无适用于 Claude Code 的模型。" : "# No Claude Code-compatible model is currently available for this account.")
      : V.claudeSetup === "temporary"
        ? claudeTemporary(apiOrigin, claudeModel.model, V.claudePlatform, claudeWords.temporaryKeyPrompt, claudeWords.emptyKeyMessage)
        : claudeSettings(apiOrigin, claudeModel.model);
    const quickFormat = V.quickTab === 1 ? openAIFormat : V.quickTab === 2 ? claudeModel ? "anthropic-messages" : undefined : curlFormat;
    const quickBase = V.quickTab === 2 || quickFormat === "anthropic-messages" || quickFormat === "gemini-generatecontent" ? apiOrigin : base;
    const quickEndpoint = quickFormat === "anthropic-messages" ? "/v1/messages" : quickFormat === "openai-completions" ? "/v1/chat/completions" : quickFormat === "openai-responses" ? "/v1/responses" : quickFormat === "gemini-generatecontent" ? "/v1beta/models/{model}:generateContent" : "";
    const stats = (V.usage?.usage ?? []).reduce((out: any, row: any) => ({
      requests: out.requests + Number(row.requests ?? 0), tokens: out.tokens + usageTokens(row),
      charged: out.charged + Number(row.allow_micro ?? 0), covered: out.covered + Number(row.list_micro ?? 0),
    }), { requests: 0, tokens: 0, charged: 0, covered: 0 });
    const snippets = [
      ["curl", curlSnippet],
      ["OpenAI SDK", openAISnippet],
      ["Claude Code", claudeSnippet],
    ];
    const primarySnippet = `<div class="codebox" data-catalog-state="${esc(V.catalogStatus)}" ${V.quickTab === 2 ? `data-claude-mode="${esc(V.claudeSetup)}"` : ""}><pre class="code">${esc(snippets[V.quickTab][1])}</pre><button class="btn sm" data-act="copy" data-text="${esc(snippets[V.quickTab][1])}" data-msg="${esc(A.common.copied)}">${ic("copy", 13)}${esc(V.quickTab === 2 && claudeModel ? V.claudeSetup === "saved" ? claudeWords.copyConfig : claudeWords.copyCommand : A.common.copy)}</button></div>`;
    const guideCode = (code: string) => `<div class="setup-code"><pre class="code">${esc(code)}</pre><button class="btn sm" data-act="copy" data-text="${esc(code)}" data-msg="${esc(A.common.copied)}">${ic("copy", 13)}${esc(claudeWords.copyCommand)}</button></div>`;
    const claudeGuide = V.quickTab !== 2 ? primarySnippet : !claudeModel
      ? `${primarySnippet}<p class="hint">${esc(claudeWords.noModelHint)}</p>`
      : `<section class="claude-guide" aria-labelledby="claude-setup-title" data-claude-guide>
        <header class="claude-guide-head"><h3 id="claude-setup-title">${esc(claudeWords.title)}</h3><p>${esc(claudeWords.intro)}</p></header>
        <div class="claude-guide-controls"><label class="f">${esc(claudeWords.platform)}<select data-input="claudePlatform">${([ ["macos", "macOS · Zsh"], ["linux", "Linux / Bash"], ["windows", "Windows · PowerShell"] ] as const).map(([value, label]) => `<option value="${value}" ${V.claudePlatform === value ? "selected" : ""}>${label}</option>`).join("")}</select></label><label class="f">${esc(claudeWords.model)}<select data-input="claudeModel">${claudeModels.map((m: any) => `<option value="${esc(m.model)}" ${claudeModel.model === m.model ? "selected" : ""}>${esc(m.display_name || m.model)}</option>`).join("")}</select><small>${esc(claudeWords.modelHint)}</small></label></div>
        <details class="claude-guide-details" data-claude-prerequisites><summary>${esc(claudeWords.installTitle)}</summary><div class="stack"><p>${esc(claudeWords.installBody)}</p>${guideCode(claudeInstall(V.claudePlatform))}<a href="https://code.claude.com/docs/en/setup#install-claude-code" target="_blank" rel="noopener noreferrer">${esc(claudeWords.installLink)}${ic("ext", 12)}</a><h4>${esc(claudeWords.keyTitle)}</h4><p>${esc(claudeWords.keyBody)}</p></div></details>
        <div class="seg claude-setup-mode" role="group" aria-label="${esc(claudeWords.settingsTitle)}"><button type="button" data-act="claude-mode" data-v="saved" aria-pressed="${V.claudeSetup === "saved"}">${esc(claudeWords.saved)}</button><button type="button" data-act="claude-mode" data-v="temporary" aria-pressed="${V.claudeSetup === "temporary"}">${esc(claudeWords.temporary)}</button></div>
        <ol class="claude-guide-steps">
          <li><div class="stack"><h4>${esc(V.claudeSetup === "saved" ? claudeWords.settingsTitle : claudeWords.temporaryTitle)}</h4>
            ${V.claudeSetup === "temporary" ? `<p>${esc(claudeWords.temporaryBody)}</p><p class="hint">${esc(claudeWords.promptNote)}</p>` : `<p>${esc(claudeWords.settingsBody)}</p><div class="claude-settings-path"><span>${esc(claudeWords.pathLabel)}</span><code>${esc(claudeSettingsPath(V.claudePlatform))}</code><button class="icon-btn" data-act="copy" data-text="${esc(claudeSettingsPath(V.claudePlatform))}" aria-label="${esc(A.common.copy)}">${ic("copy", 14)}</button></div><p class="hint">${esc(claudeWords.mergeNote)}</p><p>${esc(claudeWords.replaceKey)}</p>`}${primarySnippet}<p class="hint">${esc(claudeWords.secretNote)}</p></div></li>
          ${V.claudeSetup === "saved" ? `<li><div class="stack"><h4>${esc(claudeWords.runTitle)}</h4><p>${esc(claudeWords.runBody)}</p>${guideCode("claude")}<p class="hint">${esc(claudeWords.promptNote)}</p></div></li>` : ""}
          <li><div class="stack"><h4>${esc(claudeWords.verifyTitle)}</h4><p>${esc(claudeWords.verifyBody)}</p>${guideCode("/status")}<p class="hint">${esc(claudeWords.statusExpected)}</p></div></li>
        </ol>
        <details class="claude-guide-details" data-claude-help><summary>${esc(claudeWords.helpTitle)}</summary><dl>${claudeWords.help.map(item => `<div><dt>${esc(item.title)}</dt><dd>${esc(item.body)}</dd></div>`).join("")}</dl></details>
        <footer class="claude-guide-footer"><p class="hint">${esc(claudeWords.permissionNote)}</p><a href="https://code.claude.com/docs/en/llm-gateway-connect" target="_blank" rel="noopener noreferrer">${esc(claudeWords.docs)}${ic("ext", 12)}</a></footer>
      </section>`;
    const keys = S.keys;
    return `
      ${bar(P.title, P.sub, `<button class="btn sm pri" data-act="new-key" ${paid() ? "" : "disabled"}>${ic("plus", 14)}${esc(P.create)}</button>`)}
      <div class="scroll"><div class="page stack lg">
        ${paid() ? "" : `<div class="card pad between" style="background:var(--sub)"><div><h3>${ic("lock", 16)} ${esc(P.gateTitle)}</h3><p class="muted" style="margin-top:4px;font-size:13px">${esc(P.gateBody)}</p></div><div class="row"><a class="btn" href="#/billing/market">${esc(P.market)}</a><button class="btn pri" data-act="contact-purchase">${esc(contactPurchase)}</button></div></div>`}
        <section><div class="sec-title"><h3>${esc(P.usage)}</h3><div class="seg">${P.ranges.map((r: string, i: number) => `<button data-act="api-range" data-i="${i}" aria-selected="${V.apiRange === i}">${esc(r)}</button>`).join("")}</div></div>
          <div class="kv"><div><small>${esc(P.requests)}</small><b>${V.usage ? stats.requests.toLocaleString() : "—"}</b><span class="s">${esc(P.calls)}</span></div><div><small>${esc(P.tokens)}</small><b>${V.usage ? stats.tokens.toLocaleString() : "—"}</b><span class="s">${esc(P.tokensSub)}</span></div><div><small>${esc(words.listValue)}</small><b>${V.usage ? money2(stats.covered / 1_000_000) : "—"}</b><span class="s">${esc(words.listValueHint)}</span></div><div><small>${esc(P.charges)}</small><b>${V.usage ? money2(stats.charged / 1_000_000) : "—"}</b><span class="s">${esc(P.chargesSub)}</span></div></div>
          <p class="hint" style="margin-top:8px">${esc(zh ? `调用记录保留 ${V.logs?.retention_days ?? "—"} 天` : `Request logs retained for ${V.logs?.retention_days ?? "—"} days`)}</p></section>
        <section><div class="sec-title"><h3>${esc(P.mine)}</h3></div>
          ${keys.length ? `<div class="card list">${keys.map((k: any) => `<div>${ic("key", 16)}<span class="grow"><b>${esc(k.name)}</b><small class="mono">${esc(k.prefix || ("…" + k.last4))} · ${esc(dfmt(k.created))}${` · ${esc(k.limit === -1 ? keyUnlimitedLabel[D.lang] ?? keyUnlimitedLabel.en : k.limit === 0 ? keyDefaultLabel[D.lang] ?? keyDefaultLabel.en : money(k.limit) + "/mo")}`}</small></span><button class="btn sm soft" data-act="key-limit" data-id="${esc(k.id)}">${esc(P.limit)}</button><button class="btn sm soft" data-act="revoke" data-id="${esc(k.id)}">${esc(P.revoke)}</button></div>`).join("")}</div>` : `<div class="card empty" style="padding:36px"><div class="ico">${ic("key", 22)}</div><h3>${esc(P.empty)}</h3><p>${esc(P.emptySub)}</p></div>`}</section>
        <section><div class="sec-title"><h3>${esc(words.logs)}</h3></div><div class="card list">${(V.logs?.logs ?? []).map((l: any) => `<div><span class="grow"><b>${esc(l.model)} · ${esc(l.key_name || l.key_prefix || "")}</b><small>${esc(tfmt(Number(l.ts) * 1000))} · HTTP ${esc(l.status)} · ${esc(l.latency_ms)} ms · ${esc(usageTokens(l))} tokens${l.seat_covered ? ` · ${esc(P.covered)}` : ""}</small>${l.error ? `<small>${esc(l.error)}</small>` : ""}</span><b>${money2(Number(l.allow_micro || 0) / 1_000_000)}</b></div>`).join("") || `<div class="muted">${esc(V.logs ? words.empty : words.loading)}</div>`}</div>${(V.logs?.logs?.length ?? 0) >= 50 ? `<button class="btn sm" data-act="logs-more">${esc(zh ? "加载更早记录" : "Load earlier records")}</button>` : ""}${V.dataError ? `<p class="note" role="status">${esc(V.dataError)}</p>` : ""}</section>
        <section><div class="sec-title"><h3>${esc(P.quick)}</h3><span class="muted">${esc(P.quickSub)}</span></div>
          <div class="card pad stack">${availableChatKeys().length || modelChatEnabled() ? `<div class="chat-key-toolbar quick-key-control"><label class="chat-key-control"><span>API Key</span><select data-input="apiKey" aria-label="API Key" ${saving || !availableChatKeys().length ? "disabled" : ""}>${availableChatKeys().map(key => `<option value="${key.id}" ${selectedChatKey()?.id === key.id ? "selected" : ""}>${esc(key.name)} · ${esc(key.prefix)}</option>`).join("") || `<option value="">${esc(words.noChatKeyLabel)}</option>`}</select></label><div class="chat-key-actions"><button class="icon-btn" data-act="api-models" aria-label="${esc(words.chatReloadModels)}" title="${esc(words.chatReloadModels)}" ${V.catalogLoading || !selectedChatKey() || saving ? "disabled" : ""}>${ic("refresh", 15)}</button></div></div>` : ""}<div class="between quick-connection"><span class="muted">${esc(V.quickTab === 1 ? "OpenAI Base URL" : zh ? "连接地址" : "Connection URL")}</span><span class="row"><code class="mono">${quickBase}</code><button class="icon-btn" data-act="copy" data-text="${quickBase}" data-msg="${esc(A.common.copied)}" aria-label="${esc(A.common.copy)}">${ic("copy", 14)}</button></span></div>${quickEndpoint ? `<p class="hint quick-endpoint">${esc(zh ? "端点：" : "Endpoint: ")}${esc(quickEndpoint)}</p>` : ""}
          <div class="seg">${snippets.map(([n], i) => `<button data-act="quick" data-i="${i}" aria-selected="${V.quickTab === i}">${esc(n)}</button>`).join("")}</div>
          ${claudeGuide}
          <p class="hint">${esc(words.allowance)}</p></div></section>
      </div></div>`;
  };

  const monthlyActions = (p: any, cls: string) => `<button class="btn ${cls}" data-act="buy-monthly" data-pool="${esc(p.pool_id)}" data-tier="${esc(p.tier)}">${esc(p.held || p.current ? pc.renew : pc.buyMonthly)}${ic("chevR", 14)}</button>${p.upgrade_from ? `<button class="btn ${cls}" data-act="upgrade-monthly" data-pool="${esc(p.pool_id)}" data-tier="${esc(p.tier)}">${esc(pc.upgrade)}</button>` : ""}`;
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
    const models = (V.catalog?.models ?? []).filter((m: any) => matches(m.display_name, m.model, (m.protocols || []).join(" "), W.models));
    const count = (visible("tokens") ? tokenPlans.length : 0) + (visible("subscriptions") ? monthly.length : 0) + (visible("models") ? models.length : 0);
    const ready = (!visible("tokens") || V.tokenPlans) && (!visible("subscriptions") || V.subscriptions) && (!visible("models") || V.catalog);
    const empty = (loaded: unknown) => `<div class="market-empty"><p>${esc(loaded ? words.notOffered : V.dataLoading ? words.loading : W.unavailable)}</p></div>`;
    const purchase = (p: any, cls: string) => `<button class="btn ${cls}" data-act="buy-token-plan" data-id="${esc(p.code)}">${esc(pc.buyToken)}${ic("chevR", 14)}</button>`;
    const trialCards = trials.map((p: any) => `<article class="market-trial">${ic("spark", 24)}<div class="market-trial-copy"><h3>${esc(p.name || W.trial)}</h3><p>${esc(planWords.guaranteedTotal)} ${amount(p.quota_usd_micro, "$")} · ${esc(p.period_days)} ${esc(planWords.period)}<br />${esc(planWords.newUser)}</p></div><div class="market-trial-price"><strong>${amount(p.price_micro, "¥")}</strong></div>${purchase(p, "market-trial-action")}</article>`).join("");
    const cards = standard.map((p: any) => `<article class="market-plan${p === best ? " is-featured" : ""}"><div class="market-plan-top"><span class="market-plan-icon">${ic("layers", 23)}</span><div><h3>${esc(p.name)}</h3><p>${esc(W.tokens)}</p></div>${p === best ? `<span class="market-plan-badge">${esc(W.bestValue)}</span>` : ""}</div><div class="market-plan-price"><strong>${amount(p.price_micro, "¥")}</strong><small>${esc(period(p.period_days))}</small></div><div class="market-plan-quota"><span>${esc(planWords.guaranteedTotal)}</span><strong>${amount(p.quota_usd_micro, "$")}</strong></div>${p.burst_usd_micro > p.quota_usd_micro ? `<div class="market-plan-burst"><span>${esc(planWords.burstMax)}</span><strong>${amount(p.burst_usd_micro, "$")}</strong></div>` : ""}<div class="market-plan-foot"><p>${esc(p.burst_usd_micro > p.quota_usd_micro ? W.capacity : W.noRenewal)}</p>${purchase(p, "market-plan-action")}</div></article>`).join("");
    const tokenSection = visible("tokens") && (!q || tokenPlans.length) ? `<section class="market-section" data-token-plan-catalog aria-labelledby="market-token-title">${trialCards}<div class="market-section-head"><div class="market-section-copy"><h2 id="market-token-title">${esc(W.tokens)}</h2><p>${esc(W.tokenIntro)}</p></div><span>${esc(W.noRenewal)}</span></div>${cards ? `<div class="market-plans-grid">${cards}</div>` : !trials.length ? empty(V.tokenPlans) : ""}<p class="market-rules">${ic("info", 15)}<span>${esc(W.rules)}</span></p><p class="market-note">${esc(pc.rule)}</p></section>` : "";
    const monthlySection = visible("subscriptions") && (!q || monthly.length) ? `<section class="market-section" data-market-subscriptions aria-labelledby="market-monthly-title"><div class="market-section-head"><div class="market-section-copy"><h2 id="market-monthly-title">${esc(W.subscriptions)}</h2><p>${esc(W.subscriptionIntro)}</p></div></div>${monthly.length ? `<div class="market-subscriptions-grid">${monthly.map((p: any) => `<article class="market-subscription"><span class="market-subscription-icon">${ic("users", 22)}</span><div class="market-subscription-copy"><h3>${esc(p.name)}</h3><p>${esc(p.blurb || "")}</p></div><div class="market-subscription-price"><strong>${amount(p.price_micro, "¥")}</strong><small>${esc(p.period_days > 0 ? period(p.period_days) : words.monthly)}</small></div><div class="stack">${monthlyActions(p,"market-subscription-action")}</div></article>`).join("")}</div>` : empty(V.subscriptions)}<p class="market-note">${esc(pc.rule)}</p></section>` : "";
    const modelPrice = (m: any, field: string) => m.list_priced && typeof m[field] === "number" && Number.isFinite(m[field]) && m[field] >= 0 ? money2(m[field] / 1_000_000) : "—";
    const modelSection = visible("models") && (!q || models.length) ? `<section class="market-section" data-market-models aria-labelledby="market-model-title"><div class="market-section-head"><div class="market-section-copy"><h2 id="market-model-title">${esc(W.models)}</h2><p>${esc(W.modelIntro)}</p></div><a class="btn sm" href="#/api">${esc(A.account.apiKey)}${ic("ext", 13)}</a></div>${models.length ? `<div class="market-model-table-wrap" tabindex="0" role="region" aria-labelledby="market-model-title"><table class="market-model-table"><thead><tr><th scope="col">${esc(W.model)}</th><th scope="col">${esc(W.input)}</th><th scope="col">${esc(W.output)}</th><th scope="col">${esc(W.protocol)}</th></tr></thead><tbody>${models.map((m: any) => `<tr><th scope="row"><div class="market-model-name">${ic("box", 18)}<span>${esc(m.display_name || m.model)}<small class="market-model-provider">${esc(m.model)}</small></span></div></th><td>${modelPrice(m, "usd_in")}</td><td>${modelPrice(m, "usd_out")}</td><td>${esc((m.protocols || []).join(" · ") || "—")}</td></tr>`).join("")}</tbody></table></div>` : empty(V.catalog)}</section>` : "";
    const filters = [["all", W.all], ["tokens", W.tokens], ["subscriptions", W.subscriptions], ["models", W.models]];
    return `<header class="market-heading"><div><p class="market-eyebrow">FELLS MARKET</p><h1>${esc(W.title)}</h1><p class="market-intro">${esc(W.intro)}</p></div><a class="market-account-link" href="#/billing/credits">${ic("layers", 22)}<span><strong>${esc(W.manage)}</strong><small>${esc(W.manageHint)}</small></span>${ic("chevR", 16)}</a></header>
      <div class="market-toolbar"><div class="market-tabs" role="group" aria-label="${esc(W.categories)}">${filters.map(([id, label]) => `<button type="button" data-act="mtab" data-v="${id}" aria-pressed="${V.marketTab === id}">${esc(label)}</button>`).join("")}</div><label class="market-search">${ic("search", 17)}<input type="search" data-input="marketQ" value="${esc(V.marketQ)}" placeholder="${esc(W.search)}" aria-label="${esc(W.search)}" /></label></div>
      ${q ? `<p class="market-result-count" role="status">${esc(ready ? fmt(W.count, { n: count }) : V.dataLoading ? words.loading : W.unavailable)}</p>` : ""}
      ${q && !count && ready ? `<div class="market-empty">${ic("search", 28)}<h2>${esc(W.noMatch)}</h2><p>${esc(W.noMatchHint)}</p><button class="btn" data-act="market-clear">${esc(W.clear)}</button></div>` : tokenSection + monthlySection + modelSection}${!ready && q && !count ? empty(null) : ""}`;
  };

  // Wallet currencies and subscriptions are separate server-owned products.
  const vBilling = (tab: string) => {
    const B = A.billing, t = tab === "credits" ? 1 : 0;
    const seg = `<div class="seg" role="tablist">${B.tabs.map((x: string, i: number) => `<button role="tab" data-go="billing/${i ? "credits" : "market"}" aria-selected="${t === i}">${esc(i ? words.wallet : x)}</button>`).join("")}</div>`;
    const b = getAppBootstrap()!;
    const usdMicro = (value: number) => money2(Math.max(0, Number(value) || 0) / 1_000_000);
    const currentPlan = V.tokenPlans?.current;
    const queuedPlan = currentPlan?.queued;
    const tokenPlanStatus = `<section data-token-plan><div class="sec-title"><h3>${esc(planWords.title)}</h3></div><p class="note">${esc(billingRules.tokenPlan)}</p><div class="card list">${currentPlan ? `<div><span class="grow"><b>${esc(currentPlan.name || currentPlan.plan_code)} · ${esc(planWords.current)}</b><small>${esc(planWords.until)} ${esc(dfmt(currentPlan.period_end * 1000))}</small></span></div><div><span class="grow"><b>${esc(planWords.guaranteed)}</b><small>${usdMicro(currentPlan.remaining_guaranteed_usd_micro)} ${esc(planWords.of)} ${usdMicro(currentPlan.quota_usd_micro)}</small></span></div>${currentPlan.burst_usd_micro > currentPlan.quota_usd_micro ? `<div><span class="grow"><b>${esc(planWords.burst)}</b><small>${usdMicro(currentPlan.remaining_burst_usd_micro)} · ${esc(currentPlan.burst_allowed ? planWords.burstOpen : planWords.burstClosed)} ${esc(planWords.burstNote)}</small></span></div>` : ""}${queuedPlan ? `<div><span class="grow"><b>${esc(planWords.next)} · ${esc(queuedPlan.plan_code)}</b><small>${esc(planWords.from)} ${esc(dfmt(queuedPlan.period_start * 1000))} · ${esc(planWords.to)} ${esc(dfmt(queuedPlan.period_end * 1000))}</small></span></div>` : ""}` : `<div class="muted">${esc(V.tokenPlans ? planWords.noActive : V.dataLoading ? words.loading : planWords.noData)}</div>`}</div></section>`;
    const plans = V.subscriptions?.plans ?? [];
    const planCards = plans.map((p: any) => `<div class="chan"><h4>${esc(p.name)}</h4><p>${esc(p.blurb ?? "")}</p><div class="between"><span class="price">${cny(p.price_micro / 1_000_000)}<small>${esc(words.monthly)}</small></span><div class="stack">${monthlyActions(p,"sm pri")}</div></div></div>`).join("");
    const subscriptions = `<section><div class="sec-title"><h3>${esc(B.plans)}</h3></div><div class="grid2">${planCards || `<p class="muted">${esc(V.subscriptions ? words.notOffered : words.loading)}</p>`}</div></section>`;
    const rides = V.subscriptions?.rides ?? [];
    const rideMode = V.subscriptions?.preferred_ride_mode;
    const rideModeControl = V.subscriptions ? `<div class="row wrap" style="margin:0 0 12px"><span class="muted">${esc(zh ? "使用方式" : "Usage mode")}</span><button class="btn sm ${rideMode === "monthly" ? "pri" : "soft"}" data-act="set-ride-mode" data-mode="monthly" ${rideMode === "monthly" ? "aria-pressed=true" : "aria-pressed=false"}>${esc(words.monthlyRideMode)}</button><button class="btn sm ${rideMode === "allowance" ? "pri" : "soft"}" data-act="set-ride-mode" data-mode="allowance" ${rideMode === "allowance" ? "aria-pressed=true" : "aria-pressed=false"}>${esc(words.allowanceRideMode)}</button></div>` : "";
    const mySubscriptions = `<section><div class="sec-title"><h3>${esc(words.mySubscriptions)}</h3></div><p class="note">${esc(words.manualBillingMode)}</p>${rideModeControl}<div class="card list">${rides.map((ride: any) => `<div><span class="grow"><b>${esc(ride.pool_name)} · ${esc(ride.tier)} ${esc(zh ? "人档" : "seats")}${ride.current ? ` · ${esc(words.currentRide)}` : ""}</b><small>${esc(words.expires)} ${esc(dfmt(Number(ride.expires_at) * 1000))}${ride.seated ? "" : ` · ${esc(zh ? "尚未分配座位" : "Seat not assigned yet")}`}</small></span>${!ride.current && Number.isSafeInteger(Number(ride.pool_id)) && Number(ride.pool_id) > 0 ? `<button class="btn sm" data-act="set-current-ride" data-id="${esc(ride.pool_id)}">${esc(words.makeCurrentRide)}</button>` : ""}</div>`).join("") || `<div class="muted">${esc(V.subscriptions ? words.notOffered : words.loading)}</div>`}</div></section>`;
    const coupons = V.coupons?.coupons ?? [];
    const couponWallet = `<section><div class="sec-title"><h3>${esc(words.couponWallet)}</h3></div><div class="card list">${coupons.map((coupon: any) => `<div><span class="grow"><b>${esc(coupon.name || coupon.terms || (zh ? "优惠券" : "Coupon"))}</b><small>${esc(coupon.terms || "")} · ${esc(words.couponStatus)}: ${esc(words.couponStates[coupon.state as keyof typeof words.couponStates] || coupon.state)}${coupon.expires_at ? ` · ${esc(words.expires)} ${esc(dfmt(Number(coupon.expires_at) * 1000))}` : ""}</small></span><button class="btn sm" data-act="contact-purchase">${esc(contactPurchase)}</button></div>`).join("") || `<div class="muted">${esc(V.coupons ? words.empty : words.loading)}</div>`}</div></section>`;
    const invoiceFiles = V.invoices?.files ?? [];
    const invoiceList = `<section><div class="sec-title"><h3>${esc(words.invoices)}</h3></div><div class="card list">${invoiceFiles.map((file: any) => `<div><span class="grow"><b>${esc(file.filename)}</b><small>#${esc(file.topup_id)} · ${esc(dfmt(Number(file.uploaded_at) * 1000))} · ${(Number(file.size_bytes) / 1024).toFixed(0)} KB</small></span><a class="btn sm" href="/api/app/invoices/${encodeURIComponent(String(file.id))}" target="_blank" rel="noopener">${esc(words.download)}</a></div>`).join("") || `<div class="muted">${esc(V.invoices ? words.invoiceEmpty : words.loading)}</div>`}</div></section>`;
    let body: string;
    if (t === 0) {
      body = vMarket();
    } else {
      const entries = V.ledger?.entries ?? V.ledger?.items ?? [];
      body = `<div class="balance"><small>${esc(words.wallet)}</small><div class="amt">${cny(cashBalance())}</div><button class="btn top" data-act="contact-purchase">${ic("plus", 14)}${esc(fx.fund)}</button>
        <div class="parts"><div><small>${esc(words.cash)}</small><b>${cny(cashBalance())}</b></div><div><small>${esc(words.grant)}</small><b>${cny(b.wallet.grant_micro / 1_000_000)}</b></div><div><small>${esc(words.allowance)}</small><b>${money2(balance())}</b><small>${bonusExpiry() ? esc(dfmt(bonusExpiry())) : "—"}</small></div></div>
        <p style="position:relative;z-index:1;margin-top:12px;color:#9a9aa0;font-size:12.5px">${esc(fx.fundHint)}</p></div>
        <div class="card pad stack" data-currency-exchange><h4>${esc(fx.exchange)}</h4><p class="muted">${esc(fx.rule)}</p><p class="muted">${esc(words.allowanceTerms)}</p><button class="btn" data-act="exchange">${esc(exchangeIntent ? fx.retry : fx.exchange)}</button>${planIntent ? `<button class="btn" data-act="plan-recover">${esc(pc.recover)}</button>` : ""}</div>
        ${tokenPlanStatus}${mySubscriptions}${subscriptions}${couponWallet}${invoiceList}<section><div class="sec-title"><h3>${esc(words.ledger)}</h3></div><div class="card list">${entries.map((e: any) => `<div><span class="grow">${esc(e.memo || e.kind)}<small>${esc(dfmt(Number(e.created_at) * 1000))}</small></span><b>${cny(Number(e.delta_micro) / 1_000_000)}</b></div>`).join("") || `<div class="muted">${esc(V.ledger ? words.empty : words.loading)}</div>`}</div></section>`;
    }
    if (V.dataError) body += `<p class="note" role="status">${esc(V.dataError)}</p>`;
    return `${bar(B.title, B.sub, seg)}<div class="scroll"><div class="${t === 0 ? "page market-page" : "page stack lg"}">${body}</div></div>`;
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
    const draft = oldInput ? { value: oldInput.value, start: oldInput.selectionStart, end: oldInput.selectionEnd, focused: document.activeElement === oldInput } : null;
    const status = root.querySelector<HTMLElement>(".toast");
    const sidebarScrim = root.querySelector<HTMLElement>(".sb-scrim");
    root.classList.toggle("sb-hidden", !!S.sbHidden);
    const scroll = root.querySelector<HTMLElement>(".main .scroll");
    const keep = scroll && root.dataset.route === location.hash ? scroll.scrollTop : 0;
    root.innerHTML = `${sidebar()}<main class="main" id="fx-main">${main()}</main>`;
    if (status) root.appendChild(status);
    if (sidebarScrim) root.appendChild(sidebarScrim);
    root.dataset.route = location.hash;
    root.dataset.workspace = S.current;
    const input = root.querySelector<HTMLTextAreaElement>('[data-form=send][data-chat] #fx-input');
    if (draft && input) {
      input.value = draft.value;
      input.setSelectionRange(draft.start, draft.end);
      if (draft.focused) input.focus({ preventScroll: true });
    }
    const marketSearch = root.querySelector<HTMLInputElement>('[data-input="marketQ"]');
    if (search && marketSearch) {
      marketSearch.value = search.value;
      marketSearch.focus({ preventScroll: true });
      if (search.start !== null && search.end !== null) marketSearch.setSelectionRange(search.start, search.end);
    }
    const s2 = root.querySelector<HTMLElement>(".main .scroll");
    if (s2) s2.scrollTop = root.querySelector("[data-thread]") ? s2.scrollHeight : keep;
    document.title = A.metaTitle + (wsName() ? " · " + wsName() : "");
  };

  // ---------- popovers ----------
  let popEl: HTMLElement | null = null;
  const closePop = () => { popEl?.remove(); popEl = null; };
  const openPop = (anchor: HTMLElement, html: string, cls = "") => {
    // Nested menus replace their parent, so measure the trigger while it is still attached.
    const r = anchor.getBoundingClientRect();
    closePop();
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
    <div class="credit-row"><div><small class="muted">${esc(A.account.credits)}</small><b style="display:block">${money2(balance())}</b><small class="dim">${bonusExpiry() ? esc(dfmt(bonusExpiry())) : "—"}</small></div><button class="btn sm pri" data-act="contact-purchase">${esc(contactPurchase)}</button></div>
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
    if (modelChatEnabled() && !isExample()) return `<div class="search"><input type="search" data-input="modelQ" value="${esc(q)}" placeholder="${esc(A.newChat.modelSearch)}" aria-label="${esc(A.newChat.modelSearch)}" /></div><div data-mlist>${ms.map((m: any) => `<button class="mi" data-act="pick-model" data-name="${esc(m.name)}"><span class="grow">${esc(m.label)}<small>${esc(m.name)} · ${esc(m.formats.join(" · "))}</small></span>${cur === m.name ? ic("check", 16) : ""}</button>`).join("") || `<p class="ph">${esc(A.newChat.noModel)}</p>`}</div>`;
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

  // Catalog reads prepare a review only. A persisted intent is created at the
  // final click and keeps its original terms and ceiling through uncertain replies.
  const openPlanReview = () => {
    const p = planIntent ?? planReview;
    if (!p) return;
    const rows: [string,string][] = [[fx.cash, `CNY ${microText(getAppBootstrap()!.wallet.cash_micro)}`], [pc.period, String(p.days)], [pc.estimate, `CNY ${microText(p.chargeMicro)}`], [pc.maxCharge, `CNY ${microText(p.maxChargeMicro)}`]];
    if (p.kind === "token") rows.splice(2,0,[planWords.guaranteedTotal, `USD ${microText(p.quotaMicro!)}`], [planWords.burstMax, `USD ${microText(p.burstMicro!)}`]);
    if (p.startsAt && p.expiresAt) rows.push([planWords.from,new Date(p.startsAt*1000).toLocaleString(D.lang)],[planWords.to,new Date(p.expiresAt*1000).toLocaleString(D.lang)]);
    if (p.kind === "upgrade") rows.splice(2,0,[pc.original,p.sourceName ?? ""],[pc.credit,`CNY ${microText(p.creditMicro ?? 0)}`]);
    openDlg(`${xBtn()}<h2>${esc(pc.title)}</h2><div class="body stack" data-plan-review><h3>${esc(p.title)}</h3><dl class="currency-quote">${rows.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl><p class="note">${esc(pc.rule)}</p>${p.kind==="token" ? `<p class="note">${esc(planWords.burstNote)}</p>${p.newUserOnly?`<p>${esc(planWords.newUser)}</p>`:""}${p.queued?`<p>${esc(pc.queued)}</p>`:""}${p.enableKeys===true?`<p data-plan-keys>${esc(pc.enableKeys)}</p>`:!getAppBootstrap()?.user.self_keys?`<p data-plan-keys>${esc(pc.keysRestricted)}</p>`:""}`:""}${p.kind==="upgrade"?`<p class="note">${esc(pc.upgradeRule)}</p>`:""}${planIntent?`<p role="status">${esc(fx.pending)}</p><p class="mono">${esc(fx.operation)}: ${esc(p.key)}</p>`:""}<p data-plan-error role="status">${esc(planError)}</p><button class="btn pri" data-act="plan-confirm">${esc(planIntent?fx.retry:pc.confirm)}</button></div>`);
  };
  const openPlanSelection = () => {
    openDlg(`${xBtn()}<h2>${esc(planSelection?.kind==="upgrade"?pc.upgrade:pc.buyMonthly)}</h2><div class="body stack"><p class="note">${esc(pc.rule)}</p>${planSelection?.kind==="upgrade"?`<p class="note">${esc(pc.upgradeRule)}</p>`:""}<form class="stack" data-form="plan-select"><label class="f">${esc(pc.months)}<input name="months" type="number" min="1" max="24" step="1" required value="${planMonths}" autofocus /></label><button class="btn pri">${esc(pc.preview)}</button></form><p data-plan-error role="status">${esc(planError)}</p></div>`);
  };
  const preparePlan = async () => {
    const selection = planSelection;
    if (!selection || saving || ended) return;
    let prepared: PlanPurchase | null = null;
    planError = "";
    const result = await accountAction(async () => {
      const key = operationKey();
      if (selection.kind === "token") {
        const offers = await accountApi.tokenPlans(), p = offers.plans.find(plan=>plan.code===selection.code && plan.enabled);
        if (!p) throw Error(pc.unavailable);
        prepared = {kind:"token",title:p.name,key,body:{plan:p.code,max_charge_micro:p.price_micro,terms_hash:p.terms_hash},days:p.period_days,months:1,quotaMicro:p.quota_usd_micro,burstMicro:p.burst_usd_micro,chargeMicro:p.price_micro,maxChargeMicro:p.price_micro,enableKeys:offers.api_keys_will_enable,queued:!!offers.current,newUserOnly:p.new_user_only};
      } else {
        const offers = await accountApi.subscriptions(), p = offers.plans.find(plan=>plan.pool_id===selection.pool && plan.tier===selection.tier);
        if (!p) throw Error(pc.unavailable);
        const total = planPriceCeiling(p.price_micro,planMonths);
        if (total===null) throw Error(pc.unavailable);
        if (selection.kind === "upgrade") {
          if (!p.upgrade_from) throw Error(pc.unavailable);
          const reply = await accountApi.upgradeQuote({from_pool:p.upgrade_from,pool_id:p.pool_id,tier:p.tier,months:planMonths});
          const q = reply.quote as Record<string,unknown> | undefined;
          if (!q || q.from_pool!==p.upgrade_from || q.to_pool!==p.pool_id || q.to_tier!==p.tier || q.months!==planMonths || typeof q.from_name!=="string" || !Number.isSafeInteger(q.starts_at) || !Number.isSafeInteger(q.expires_at) || Number(q.starts_at)<=0 || Number(q.expires_at)<=Number(q.starts_at) || !Number.isSafeInteger(q.applied_micro) || Number(q.applied_micro)<0) throw Error(pc.unavailable);
          prepared = {kind:"upgrade",title:p.name,key,body:{from_pool:p.upgrade_from,pool_id:p.pool_id,tier:p.tier,months:planMonths,max_charge_micro:Number(reply.max_charge_micro)},days:planMonths*30,months:planMonths,startsAt:Number(q.starts_at),expiresAt:Number(q.expires_at),sourceName:q.from_name,creditMicro:Number(q.applied_micro),chargeMicro:Number(q.charge_micro),maxChargeMicro:Number(reply.max_charge_micro)};
        } else prepared = {kind:"subscription",title:p.name,key,body:{pool_id:p.pool_id,tier:p.tier,months:planMonths,max_charge_micro:total},days:planMonths*30,months:planMonths,chargeMicro:total,maxChargeMicro:total};
      }
      if (!validPlanPurchase(prepared)) throw Error(pc.unavailable);
      return prepared;
    });
    if (ended) return;
    if (result && validPlanPurchase(result)) { planReview = result; openPlanReview(); }
    else { planReview = null; planError = pc.unavailable; if(selection.kind!=="token") openPlanSelection(); else toast(pc.unavailable); }
  };
  const beginPlan = async (selection: NonNullable<typeof planSelection>) => {
    closePop();
    if (planIntent) { openPlanReview(); return; }
    if (exchangeIntent) { openExchange(); return; }
    planSelection = selection; planReview = null; planMonths = 1; planError = "";
    if (selection.kind === "token") await preparePlan(); else openPlanSelection();
  };
  const confirmPlan = async () => {
    const p = planIntent ?? planReview;
    if (!p || saving || ended || !validPlanPurchase(p)) return;
    if (!planIntent) {
      try { storeMoneyIntent(planStorageKey,p); } catch { planError = fx.storage; openPlanReview(); return; }
      planIntent = p;
    }
    let rejected = false;
    const result = await accountAction(async () => {
      try {
        const b=p.body;
        const receipt = p.kind==="token" ? await accountApi.buyTokenPlan({plan:String(b.plan),max_charge_micro:p.maxChargeMicro,terms_hash:String(b.terms_hash)},p.key)
          : p.kind==="upgrade" ? await accountApi.upgradeSubscription({from_pool:Number(b.from_pool),pool_id:Number(b.pool_id),tier:Number(b.tier),months:Number(b.months),max_charge_micro:p.maxChargeMicro},p.key)
          : await accountApi.buySubscription({pool_id:Number(b.pool_id),tier:Number(b.tier),months:Number(b.months),max_charge_micro:p.maxChargeMicro},p.key);
        if (!validPlanReceipt(receipt,p,fxIdentity.user.id)) throw Error(fx.pending);
        if (receipt.reconciled === true) {
          const next = await readApp();
          if (!next || next.session !== fxIdentity.session_id) throw new EndedSession();
          adopt(next);
        }
        return receipt;
      } catch (failure) { rejected = failure instanceof APIError && failure.transactionRejected; planError = rejected && failure instanceof Error ? failure.message : fx.pending; throw failure; }
    });
    if (ended) return;
    if (result || rejected) {
      planIntent = null; planReview = null;
      try { sessionStorage.removeItem(planStorageKey); } catch { /* No replacement financial operation is sent. */ }
    }
    if (result) { closeDlg(); toast(pc.done); void loadAccountViews(); }
    else if (rejected) { openDlg(`${xBtn()}<h2>${esc(pc.title)}</h2><div class="body stack"><p data-plan-error role="status">${esc(planError)}</p><p>${esc(pc.unavailable)}</p><button class="btn" data-act="close">${esc(A.common.close)}</button></div>`); void loadAccountViews(); }
    else openPlanReview();
  };

  const quoteSummary = (q: ExchangeQuote) => `<dl class="currency-quote">${[
    [fx.source, "European Central Bank (ECB)"], [fx.date, q.as_of], [fx.updated, new Date(q.fetched_at).toLocaleString(D.lang)],
    [fx.reference, q.reference_rate], [fx.effective, q.effective_rate], [fx.amount, `CNY ${microText(q.cash_micro)}`],
    [fx.fee, `CNY ${microText(q.fee_cny_micro)}`], [fx.principal, `CNY ${microText(q.principal_cash_micro)}`],
    [fx.receive, `USD ${microText(q.usd_micro)}`], [fx.expires, new Date(q.expires_at).toLocaleString(D.lang)],
  ].map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl>${q.api_keys_will_enable === true ? `<p class="note" data-exchange-keys>${esc(fx.enableKeys)}</p>` : q.api_keys_will_enable === false && !getAppBootstrap()?.user.self_keys ? `<p class="note" data-exchange-keys>${esc(fx.keysRestricted)}</p>` : ""}`;
  const openExchange = () => {
    const q = exchangeIntent?.quote ?? exchangeQuote;
    openDlg(`${xBtn()}<h2>${esc(fx.exchange)}</h2><div class="body stack"><p>${esc(fx.cash)}: <span data-exchange-cash>CNY ${esc(microText(getAppBootstrap()!.wallet.cash_micro))}</span></p><p class="note">${esc(fx.rule)}</p>${q ? `${quoteSummary(q)}${exchangeIntent ? `<p role="status">${esc(fx.pending)}</p><p class="mono">${esc(fx.operation)}: ${esc(exchangeIntent.key)}</p>` : ""}<div class="foot wrap">${!exchangeIntent ? `<button class="btn" data-act="exchange-new">${esc(fx.newQuote)}</button>` : ""}<button class="btn pri" data-act="exchange-confirm">${esc(exchangeIntent ? fx.retry : fx.confirm)}</button></div>` : `<form class="stack" data-form="exchange-quote"><label class="f">${esc(fx.amount)}<input name="cash" inputmode="decimal" type="text" pattern="[0-9]+([.][0-9]{1,6})?" maxlength="24" value="${esc(exchangeAmount)}" required autofocus /></label><button class="btn pri">${esc(fx.preview)}</button></form>`}<p data-exchange-error class="note" role="status">${esc(exchangeError)}</p></div>`);
  };
  const openExchangeWithBalance = async () => {
    if (planIntent) { openPlanReview(); return; }
    if (saving || ended || !committed) return;
    const identity = committed.session;
    saving = true; generation++; root.setAttribute("aria-busy", "true");
    try {
      const next = await readApp();
      if (!next || next.session !== identity) { clearView(); return; }
      adopt(next); render(); openExchange();
    } catch (failure) {
      if (failure instanceof EndedSession || failure instanceof APIError && failure.status === 401) clearView();
      else if (!ended && committed?.session === identity) { if (exchangeIntent) openExchange(); else toast(fx.unavailable); }
    } finally { saving = false; root.removeAttribute("aria-busy"); if (refreshPending) void refresh(); }
  };
  const confirmExchange = async () => {
    const q = exchangeIntent?.quote ?? exchangeQuote;
    if (!q) return;
    if (!exchangeIntent && Date.parse(q.expires_at) <= Date.now()) { exchangeError = fx.expired; openExchange(); return; }
    if (!exchangeIntent) {
      const intent = { key: operationKey(), quote: q };
      try { storeMoneyIntent(fxStorageKey, intent); } catch { exchangeError = fx.storage; openExchange(); return; }
      exchangeIntent = intent;
    }
    const intent = exchangeIntent;
    let definitiveFailure = false;
    const result = await accountAction(async () => {
      try {
        const receipt = await accountApi.buyAllowance(intent.quote.cash_micro, intent.quote.id, intent.key);
        const reconciled = validExchangeReconciliation(receipt,intent.quote);
        if (!reconciled && (!validExchangeQuote(receipt.exchange, intent.quote.cash_micro) || receipt.exchange.id !== intent.quote.id)) throw new Error(fx.pending);
        if (reconciled) {
          const next = await readApp();
          if (!next || next.session !== fxIdentity.session_id) throw new EndedSession();
          adopt(next);
        }
        return receipt;
      }
      catch (failure) {
        definitiveFailure = failure instanceof APIError && failure.transactionRejected;
        exchangeError = definitiveFailure ? (failure instanceof Error ? failure.message : fx.expired) : fx.pending;
        throw failure;
      }
    });
    if (ended) return;
    if (result || definitiveFailure) {
      exchangeIntent = null; exchangeQuote = null;
      try { sessionStorage.removeItem(fxStorageKey); } catch { /* No new request is issued. */ }
    }
    if (result) { exchangeAmount = ""; exchangeError = ""; closeDlg(); toast(fx.done); void loadAccountViews(); }
    else openExchange();
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
    const result = await accountAction(() => accountApi.agreement(undefined, D.lang));
    if (!result) return;
    const accepted = getAppBootstrap()?.agreement.accepted;
    openDlg(`${xBtn()}<h2>${esc(agreementText(result.h1))}</h2><p class="lead">${esc(agreementText(result.lede))}</p><div class="body">${result.clauses.map((c: any) => `<article class="card pad stack"><h3>${esc(agreementText(c.heading))}</h3>${(c.paras ?? []).map((p: string) => `<p>${esc(agreementText(p))}</p>`).join("")}</article>`).join("")}<form class="stack" data-form="agreement"><input type="hidden" name="version" value="${esc(result.version)}" />${accepted ? `<p class="note">${esc(zh ? "已接受当前版本" : "Current version accepted")}</p>` : `<label class="row"><input type="checkbox" name="consent" required />${esc(words.accept)}</label><button class="btn pri">${esc(result.ui.accept || A.common.save)}</button>`}</form></div>`, "wide");
  };
  const openInvite = async () => {
    const result = await accountAction(async () => ({ referral: await accountApi.referral(), rebates: await accountApi.rebates() }));
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
      <label class="f">${esc(P.limit)} (USD)<input type="number" name="limit" min="0" step="0.000001" placeholder="${esc(keyDefaultLabel[D.lang] ?? keyDefaultLabel.en)}" /></label>
      <p class="note">${esc(keyLimitRule[D.lang] ?? keyLimitRule.en)}</p>
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
  const applyChatResult = (chatID: string, requestID: string, result: AppChatResult) => {
    if (result.snapshot) adopt(result.snapshot);
    const receipt: LocalChatRun = { ...(result.run ?? { request_id: requestID, status: "unknown" as const }), chat_id: chatID };
    if (!result.run && result.error instanceof APIError && result.error.code === "chat_not_started") receipt.status = "failed";
    // A receipt can confirm completion while the history refresh is offline.
    // Keep sending blocked until a read recovers that authoritative history.
    if (!result.snapshot && receipt.status === "completed") receipt.status = "unknown";
    chatRuns.set(chatID, receipt);
    try { persistChatRuns(); } catch { /* Existing marker remains safe to inspect after a reload. */ }
    if (result.run) {
      const input = root.querySelector<HTMLTextAreaElement>("#fx-input");
      if (input) input.value = "";
      V.draft = "";
    }
    if (result.error) toast(result.error instanceof Error ? result.error.message : words.chatUnknown);
    render();
  };
  const checkChatRun = async (chatID: string) => {
    const pending = chatRuns.get(chatID);
    if (saving || ended || !committed || !pending) return;
    saving = true; generation++; root.setAttribute("aria-busy", "true");
    try { applyChatResult(chatID, pending.request_id, await readAppChatRun(committed, chatID, pending.request_id)); }
    catch (error) {
      if (error instanceof EndedSession) clearView();
      else { toast(error instanceof Error ? error.message : words.chatUnknown); try { const latest = await readApp(); if (latest) adopt(latest); } catch { /* Keep the safe run marker. */ } }
    } finally { saving = false; root.removeAttribute("aria-busy"); if (!ended) render(); if (refreshPending) void refresh(); }
  };
  const sendModelMessage = async (form: HTMLFormElement, body: string) => {
    if (!committed || getAppWorkspaceRole(S.current) === "viewer") return;
    const model = form.dataset.model || "", key = selectedChatKey();
    if (!key || V.chatKeyLoaded !== key.id || V.chatCatalogStatus !== "ready" || !V.chatCatalog?.models.some((m: ChatModel) => m.model === model)) { toast(chatModelState() || words.modelError); return; }
    let chatID = form.dataset.chat;
    if (chatID && chatRuns.has(chatID) && !["completed", "failed"].includes(chatRuns.get(chatID)!.status)) { toast(words.chatUnknown); return; }
    if (!chatID) {
      chatID = uid();
      S.chats.push({ id: chatID, ws: S.current, title: body.split("\n")[0].slice(0, 48) || A.chat.untitled, agent: "lite", model, created: Date.now(), messages: [] });
      if (!await save()) { if (!ended) render(); return; }
      V.draft = ""; go("chat/" + chatID);
      // Mount the chat before moving its unsent draft. hashchange is async and
      // may be suppressed by the paid request's busy guard below.
      render();
      const input = root.querySelector<HTMLTextAreaElement>("#fx-input"); if (input) input.value = body;
    }
    const requestID = uid();
    chatRuns.set(chatID, { chat_id: chatID, request_id: requestID, status: "pending" });
    try { persistChatRuns(); }
    catch { chatRuns.delete(chatID); toast(words.chatStorage); return; }
    saving = true; generation++; root.setAttribute("aria-busy", "true"); render();
    try { applyChatResult(chatID, requestID, await generateAppChat(committed, chatID, { request_id: requestID, body, model, key_id: key.id })); }
    catch (error) {
      if (error instanceof EndedSession) { clearView(); return; }
      // Preflight/identity checks rejected before the generate POST. A network
      // failure after POST is returned as an unknown run by app-service.
      chatRuns.delete(chatID); try { persistChatRuns(); } catch { /* A leftover marker only blocks a future send. */ }
      toast(error instanceof Error ? error.message : words.chatUnknown);
      try { const latest = await readApp(); if (latest) adopt(latest); } catch { /* Preserve the current draft. */ }
    } finally { saving = false; root.removeAttribute("aria-busy"); if (!ended) render(); if (refreshPending) void refresh(); }
  };
  const sendMessage = async (form: HTMLFormElement) => {
    if (saving || ended || isExample()) return;
    const ta = form.querySelector("textarea")!;
    const text = ta.value.trim();
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

  root.addEventListener("click", async (e) => {
    if (saving || ended) { e.preventDefault(); return; }
    const t = e.target as HTMLElement;
    // Close popover when clicking outside it.
    if (popEl && !popEl.contains(t) && !t.closest("[data-act=switcher],[data-act=account],[data-act=model],[data-act=lang]")) closePop();
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
        toast(A.nav.needWs);
        openNewWs();
        return;
      }
      if (name === "new" && !hasWs()) { openNewWs(); return; }
      go(target);
      return;
    }
    const act = el.dataset.act!;
    if (["del-chat", "revoke"].includes(act) && !confirm(security.confirmDelete)) return;
    const id = el.dataset.id || "";
    const i = Number(el.dataset.i);
    switch (act) {
      case "sb": toggleSb(); break;
      case "sb-close": closeSb(); break;
      case "switcher": popEl ? closePop() : openPop(el, switcherMenu()); break;
      case "account": popEl ? closePop() : openPop(el, accountMenu(), "account-pop"); break;
      case "lang": openPop(el, langMenu()); break;
      case "more": V.moreOpen = !V.moreOpen; render(); break;
      case "switch": S.current = id; if (!await save()) return; closePop(); closeSb(); go(""); void loadAccountViews(); break;
      case "open-example": S.current = "example"; if (!await save()) return; go(""); break;
      case "new-ws": closeSb(); openNewWs(); break;
      case "promo-close": S.promoClosed = true; if (!await save()) return; render(); break;
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
      case "topup": closePop(); requestSupport(); break;
      case "buy-token-plan": await beginPlan({ kind: "token", code: id }); break;
      case "buy-monthly": await beginPlan({ kind: "subscription", pool: Number(el.dataset.pool), tier: Number(el.dataset.tier) }); break;
      case "upgrade-monthly": await beginPlan({ kind: "upgrade", pool: Number(el.dataset.pool), tier: Number(el.dataset.tier) }); break;
      case "plan-confirm": await confirmPlan(); break;
      case "plan-recover": openPlanReview(); break;
      case "exchange": closePop(); await openExchangeWithBalance(); break;
      case "exchange-new": if (!exchangeIntent) { exchangeQuote = null; exchangeError = ""; openExchange(); } break;
      case "exchange-confirm": await confirmExchange(); break;
      case "contact-purchase": closePop(); closeDlg(); requestSupport({ title: el.dataset.supportTitle, product: el.dataset.supportProduct, poolId: Number(el.dataset.supportPool), amountMicro: Number(el.dataset.supportAmount) }); break;
      case "logout": {
        e.preventDefault();
        saving = true; generation++;
        try { await endApp(committed!.session); clearView(); }
        catch (error) {
          if (error instanceof EndedSession || (error instanceof APIError && error.status === 401)) clearView();
          else toast(error instanceof Error ? error.message : security.saveFailed);
        }
        finally { saving = false; }
        break;
      }
      case "theme": S.theme = el.dataset.v as any; if (!await save()) return; applyTheme(); el.parentElement?.querySelectorAll("[data-act=theme]").forEach((b) => b.setAttribute("aria-pressed", String(b === el))); if (!popEl) render(); break;
      case "close": closeDlg(); break;
      case "soon": toast(A.common.comingSoon); break;
      case "copy": copy(el.dataset.text || "", el.dataset.msg || A.common.copied); break;
      // New chat
      case "agent": V.agent = id; render(); break;
      case "chat-check": await checkChatRun(el.dataset.chat || ""); break;
      case "chat-models": void loadChatModels(); break;
      case "api-models": void loadApiCatalog(); break;
      case "model": V.menuChat = el.dataset.chat || ""; openPop(el, modelMenu(el.dataset.agent!), "mm"); V.menuAgent = el.dataset.agent; break;
      case "pick-model": {
        const name = el.dataset.name!;
        if (modelChatEnabled() && !isExample()) {
          if (!V.chatCatalog?.models.some((m: ChatModel) => m.model === name)) break;
          if (V.menuChat) { V.chatModel ||= {}; V.chatModel[V.menuChat] = name; } else V.model[V.menuAgent] = name;
        }
        else if (V.menuChat) { const c = S.chats.find((x) => x.id === V.menuChat); if (c) c.model = name; if (!await save()) return; }
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
      case "notif": S.notifs[i] = !S.notifs[i]; if (!await save()) return; el.setAttribute("aria-checked", String(S.notifs[i])); break;
      // API
      case "api-range": V.apiRange = i; V.usage = null; render(); void loadAccountViews(); break;
      case "quick": V.quickChosen = true; V.quickTab = i; render(); break;
      case "claude-mode": V.claudeSetup = el.dataset.v === "temporary" ? "temporary" : "saved"; render(); break;
      case "new-key": openNewKey(); break;
      case "key-limit": {
        const k = S.keys.find(k => k.id === id); if (!k) return;
        openDlg(`${xBtn()}<h2>${esc(A.api.limit)}</h2><form class="body stack" data-form="key-limit"><input name="id" type="hidden" value="${esc(id)}" /><label class="f">${esc(A.api.limit)} (USD)<input type="number" name="limit" min="0" step="0.000001" value="${k.limit === -1 ? "" : k.limit}" ${k.limit === -1 ? `placeholder="${esc(keyUnlimitedLabel[D.lang] ?? keyUnlimitedLabel.en)}"` : "required"} /></label><p class="hint">${esc(k.limit === -1 ? keyUnlimitedHint[D.lang] ?? keyUnlimitedHint.en : keyLimitRule[D.lang] ?? keyLimitRule.en)}</p><button class="btn pri">${esc(A.common.save)}</button></form>`);
        break;
      }
      case "logs-more": {
        const rows = V.logs?.logs || []; if (!rows.length) return;
        const identity = committed!.session, range = V.apiRange;
        const result = await accountAction(() => accountApi.logs({ since: usageSince(range), before_id: rows.at(-1).id }));
        if (result && committed?.session === identity && V.apiRange === range) { V.logs = { ...V.logs, logs: [...rows, ...((result as any).logs || [])] }; render(); }
        break;
      }
      case "revoke": await accountAction(() => accountApi.revokeKey(id)); void loadAccountViews(); break;
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
      case "plan-select": {
        const months = Number(val("months"));
        if (!Number.isSafeInteger(months) || months < 1 || months > 24) return;
        planMonths = months; await preparePlan(); break;
      }
      case "exchange-quote": {
        exchangeAmount = val("cash");
        const micro = parseCashMicro(exchangeAmount);
        if (exchangeIntent) { openExchange(); return; }
        if (micro === null) { exchangeError = fx.invalid; openExchange(); return; }
        exchangeError = "";
        const result = await accountAction(() => accountApi.quoteAllowance(micro));
        if (ended) return;
        if (result && validExchangeQuote(result.quote, micro) && Date.parse(result.quote.expires_at) > Date.now()) exchangeQuote = result.quote;
        else { exchangeQuote = null; exchangeError = fx.unavailable; }
        openExchange(); break;
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
        const limit = Number(val("limit")), micro = Math.round(limit * 1_000_000);
        if (!Number.isFinite(limit) || limit < 0 || !Number.isSafeInteger(micro)) return;
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
        const limit = Number(val("limit")) || 0;
        if (!Number.isFinite(limit) || limit < 0 || !Number.isSafeInteger(Math.round(limit * 1_000_000))) return;
        const result = await accountAction(async () => {
          const created = await accountApi.createKey({ name: val("name") });
          let limitError = "";
          if (limit > 0) {
            try { await accountApi.setKeyLimits(created.key.id, { monthly_micro: Math.round(limit * 1_000_000) }); }
            catch (error) { limitError = error instanceof Error ? error.message : security.saveFailed; }
          }
          return { ...created, limitError };
        });
        if (!result) return;
        const secret = result.raw;
        const P = A.api;
        openDlg(`${xBtn()}<h2>${esc(P.create)}</h2><div class="body"><p class="note">${esc(P.created)}</p><div class="codebox"><pre class="code">${esc(secret)}</pre><button class="btn sm" data-act="copy" data-text="${esc(secret)}" data-msg="${esc(P.copied)}">${ic("copy", 13)}${esc(P.copy)}</button></div>${result.limitError ? `<p class="note" role="alert">${esc(result.limitError)}</p>` : ""}<p class="hint">${esc(words.allowance)}</p><div class="foot" style="margin:0"><button class="btn pri" data-act="close">${esc(P.done)}</button></div></div>`);
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
    if (saving || ended) return;
    const t = e.target as HTMLInputElement;
    const k = t.dataset.input;
    if (t.id === "fx-input" && !root.querySelector("[data-form=send][data-chat]")) V.draft = t.value;
    if (!k) return;
    if (k === "marketQ") {
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
    if (saving || ended) return;
    const t = e.target as HTMLSelectElement;
    if (t.dataset.input === "chatKey" || t.dataset.input === "apiKey") { V.chatKey = Number(t.value); V.claudeModel = ""; V.chatCatalog = null; V.chatCatalogStatus = "loading"; V.apiCatalog = null; V.catalogStatus = "loading"; void loadChatModels(); void loadApiCatalog(); render(); return; }
    if (t.dataset.input === "claudePlatform" && ["macos", "linux", "windows"].includes(t.value)) { V.claudePlatform = t.value as ClaudePlatform; render(); return; }
    if (t.dataset.input === "claudeModel") { V.claudeModel = t.value; render(); return; }
    if (t.dataset.input === "prefAgent") { S.prefs.agent = t.value; V.agent = t.value; if (!await save()) return; }
    if (t.dataset.input === "defaultChannel") { S.defaultChannel = t.value; if (!await save()) return; }
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
  addEventListener("focus", () => { void refresh(); });
  addEventListener("fells.wallet.changed", event => walletChanged((event as CustomEvent).detail));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void refresh(); });
  addEventListener("pageshow", (event) => { if (event.persisted) location.reload(); });
  addEventListener("pagehide", () => { root.replaceChildren(); });

  // Website links may preselect a view: /app#/billing/credits etc.
  render();
  if (!S.onboarded) openOnboard();
  void loadAccountViews();
  void refresh();
}
