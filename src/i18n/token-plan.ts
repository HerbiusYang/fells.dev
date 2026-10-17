import { planCheckoutCopy } from "./plan-checkout.ts";
/** Account labels for the GET /api/app/plans contract. */
const words = {
  en: {
    title: "My Token Plan", noActive: "No active Token Plan", current: "Current period",
    until: "Ends", guaranteed: "Guaranteed quota remaining", of: "of",
    burst: "Additional conditional capacity remaining", burstOpen: "Available now while the account pool has spare capacity; this can change.",
    burstClosed: "Currently unavailable because the account pool has no spare capacity.",
    burstNote: "Conditional capacity is not guaranteed quota.", next: "Queued next period",
    from: "Starts", to: "Ends", noData: "Plan status unavailable",
    available: "Token Plan catalog", guaranteedTotal: "Guaranteed quota", burstMax: "Conditional capacity up to",
    period: "days per period", newUser: "New users only; once per account", confirm: planCheckoutCopy("en").rule,
  },
  zh: {
    title: "我的 Token Plan", noActive: "暂无生效中的 Token Plan", current: "当前期",
    until: "到期", guaranteed: "剩余保底额度", of: "/ 总额度",
    burst: "剩余弹性额度上限", burstOpen: "当前账号池有余量时可用，状态可能变化。",
    burstClosed: "当前账号池无余量，弹性额度暂不可用。",
    burstNote: "弹性额度不是保底额度。", next: "排队中的下一期",
    from: "开始", to: "到期", noData: "暂无法读取套餐状态",
    available: "Token Plan 套餐目录", guaranteedTotal: "保底额度", burstMax: "弹性上限",
    period: "天/期", newUser: "仅限新用户，每账号一次", confirm: planCheckoutCopy("zh").rule,
  },
  "zh-hant": {
    title: "我的 Token Plan", noActive: "目前沒有生效中的 Token Plan", current: "目前週期",
    until: "到期", guaranteed: "剩餘保底額度", of: "/ 總額度",
    burst: "剩餘彈性額度上限", burstOpen: "目前帳號池有餘量時可用，狀態可能變化。",
    burstClosed: "目前帳號池沒有餘量，彈性額度暫不可用。",
    burstNote: "彈性額度不是保底額度。", next: "排隊中的下一期",
    from: "開始", to: "到期", noData: "暫時無法讀取方案狀態",
    available: "Token Plan 方案目錄", guaranteedTotal: "保底額度", burstMax: "彈性上限",
    period: "天/期", newUser: "僅限新用戶，每帳戶一次", confirm: planCheckoutCopy("zh-hant").rule,
  },
  ja: {
    title: "マイ Token Plan", noActive: "有効な Token Plan はありません", current: "現在の期間",
    until: "終了", guaranteed: "保証利用枠の残高", of: "/ 総利用枠",
    burst: "追加の条件付き利用枠の残高", burstOpen: "アカウントプールに余裕がある間は利用できます。状況は変わります。",
    burstClosed: "アカウントプールに余裕がないため、現在は利用できません。",
    burstNote: "条件付き利用枠は保証利用枠ではありません。", next: "予約済みの次の期間",
    from: "開始", to: "終了", noData: "プランの状態を読み込めません",
    available: "Token Plan カタログ", guaranteedTotal: "保証利用枠", burstMax: "条件付き利用枠の上限",
    period: "日／期間", newUser: "新規ユーザー限定、1アカウント1回", confirm: planCheckoutCopy("ja").rule,
  },
  ko: {
    title: "내 Token Plan", noActive: "활성 Token Plan이 없습니다", current: "현재 기간",
    until: "종료", guaranteed: "남은 보장 한도", of: "/ 총 한도",
    burst: "남은 조건부 추가 한도", burstOpen: "계정 풀에 여유가 있는 동안 사용 가능하며 상태가 바뀔 수 있습니다.",
    burstClosed: "계정 풀에 여유가 없어 현재 사용할 수 없습니다.",
    burstNote: "조건부 추가 한도는 보장 한도가 아닙니다.", next: "대기 중인 다음 기간",
    from: "시작", to: "종료", noData: "요금제 상태를 불러올 수 없습니다",
    available: "Token Plan 카탈로그", guaranteedTotal: "보장 한도", burstMax: "조건부 추가 한도 상한",
    period: "일/기간", newUser: "신규 사용자 전용, 계정당 1회", confirm: planCheckoutCopy("ko").rule,
  },
  es: {
    title: "Mi Token Plan", noActive: "No hay un Token Plan activo", current: "Período actual",
    until: "Termina", guaranteed: "Cuota garantizada restante", of: "de",
    burst: "Capacidad adicional condicional restante", burstOpen: "Disponible ahora mientras haya capacidad en el grupo de cuentas; puede cambiar.",
    burstClosed: "No disponible ahora porque no hay capacidad libre en el grupo de cuentas.",
    burstNote: "La capacidad condicional no forma parte de la cuota garantizada.", next: "Próximo período en cola",
    from: "Comienza", to: "Termina", noData: "No se puede consultar el estado del plan",
    available: "Catálogo de Token Plan", guaranteedTotal: "Cuota garantizada", burstMax: "Capacidad condicional hasta",
    period: "días por período", newUser: "Solo nuevos usuarios; una vez por cuenta", confirm: planCheckoutCopy("es").rule,
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
