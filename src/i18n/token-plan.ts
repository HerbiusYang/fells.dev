import { manualSalesWords } from "./manual-sales.ts";
/** Account labels for the GET /api/app/plans contract. */
const words = {
  en: {
    title: "My Token Plan", noActive: "No active Token Plan", current: "Current period",
    until: "Ends", guaranteed: "Guaranteed quota remaining", of: "of",
    next: "Queued next period",
    from: "Starts", to: "Ends", noData: "Plan status unavailable",
    available: "Token Plan catalog", guaranteedTotal: "Guaranteed quota",
    period: "days per period", newUser: "New users only; once per account", confirm: manualSalesWords("en").rule,
    trialScope: "General quota for Gemini, Claude, GPT, Grok and other models. Model access and compatible clients depend on your account.",
  },
  zh: {
    title: "我的 Token Plan", noActive: "暂无生效中的 Token Plan", current: "当前期",
    until: "到期", guaranteed: "剩余保底额度", of: "/ 总额度",
    next: "排队中的下一期",
    from: "开始", to: "到期", noData: "暂无法读取套餐状态",
    available: "Token Plan 套餐目录", guaranteedTotal: "保底额度",
    period: "天/期", newUser: "仅限新用户，每账号一次", confirm: manualSalesWords("zh").rule,
    trialScope: "保底额度为通用额度，Gemini、Claude、GPT、Grok 等模型均可使用；可用模型和兼容客户端以账户权限为准。",
  },
  "zh-hant": {
    title: "我的 Token Plan", noActive: "目前沒有生效中的 Token Plan", current: "目前週期",
    until: "到期", guaranteed: "剩餘保底額度", of: "/ 總額度",
    next: "排隊中的下一期",
    from: "開始", to: "到期", noData: "暫時無法讀取方案狀態",
    available: "Token Plan 方案目錄", guaranteedTotal: "保底額度",
    period: "天/期", newUser: "僅限新用戶，每帳戶一次", confirm: manualSalesWords("zh-hant").rule,
    trialScope: "保底額度為通用額度，Gemini、Claude、GPT、Grok 等模型皆可使用；可用模型和相容用戶端以帳戶權限為準。",
  },
  ja: {
    title: "マイ Token Plan", noActive: "有効な Token Plan はありません", current: "現在の期間",
    until: "終了", guaranteed: "保証利用枠の残高", of: "/ 総利用枠",
    next: "予約済みの次の期間",
    from: "開始", to: "終了", noData: "プランの状態を読み込めません",
    available: "Token Plan カタログ", guaranteedTotal: "保証利用枠",
    period: "日／期間", newUser: "新規ユーザー限定、1アカウント1回", confirm: manualSalesWords("ja").rule,
    trialScope: "保証利用枠は Gemini、Claude、GPT、Grok などで使える共通利用枠です。利用可能なモデルと対応クライアントはアカウントの権限によって異なります。",
  },
  ko: {
    title: "내 Token Plan", noActive: "활성 Token Plan이 없습니다", current: "현재 기간",
    until: "종료", guaranteed: "남은 보장 한도", of: "/ 총 한도",
    next: "대기 중인 다음 기간",
    from: "시작", to: "종료", noData: "요금제 상태를 불러올 수 없습니다",
    available: "Token Plan 카탈로그", guaranteedTotal: "보장 한도",
    period: "일/기간", newUser: "신규 사용자 전용, 계정당 1회", confirm: manualSalesWords("ko").rule,
    trialScope: "보장 한도는 Gemini, Claude, GPT, Grok 등 모든 모델에 쓰는 공통 한도입니다. 사용 가능한 모델과 호환 클라이언트는 계정 권한에 따라 달라집니다.",
  },
  es: {
    title: "Mi Token Plan", noActive: "No hay un Token Plan activo", current: "Período actual",
    until: "Termina", guaranteed: "Cuota garantizada restante", of: "de",
    next: "Próximo período en cola",
    from: "Comienza", to: "Termina", noData: "No se puede consultar el estado del plan",
    available: "Catálogo de Token Plan", guaranteedTotal: "Cuota garantizada",
    period: "días por período", newUser: "Solo nuevos usuarios; una vez por cuenta", confirm: manualSalesWords("es").rule,
    trialScope: "La cuota garantizada es general: sirve para Gemini, Claude, GPT, Grok y otros modelos. Los modelos y clientes compatibles dependen de los permisos de tu cuenta.",
  },
};

export function tokenPlanWordsOf(language: string) {
  const code = language.toLowerCase();
  if (code.startsWith("zh-hant") || code.startsWith("zh-tw")) return words["zh-hant"];
  if (code.startsWith("zh")) return words.zh;
  if (code.startsWith("ja")) return words.ja;
  if (code.startsWith("ko")) return words.ko;
  if (code.startsWith("es")) return words.es;
  return words.en;
}
