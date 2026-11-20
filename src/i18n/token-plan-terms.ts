/**
 * Token Plan purchase terms and the domestic-model bonus (owner decision
 * 2026-11-18). Prices, ratios and model scope come from the API (`terms`,
 * `token_plan_bonus_models` / `bonus_models`); this file only holds wording.
 */
const en = {
  termSelector: "Billing period",
  terms: { 1: "Monthly", 3: "Quarterly", 6: "Half-yearly", 12: "Yearly" } as Record<number, string>,
  months: "{n} months",
  forMonths: "/ {n} months",
  perPeriod: "per 30-day period",
  monthlyOnly: "Monthly only",
  generalQuota: "General quota for Gemini, Claude, GPT, Grok and other models. Model access and compatible clients depend on your account.",
  bonus: "Bonus quota for {models}",
  bonusPct: "+{pct}%",
  bonusNote: "The bonus is {pct}% of the guaranteed quota, granted every 30-day period and valid only in that period. It is used only for {models}, before the general quota; other models never use it.",
  termsNote: "Buy one, three, six or twelve months at the monthly price × months, with no discount. Longer terms add more bonus: 30% monthly, 40% quarterly, 60% half-yearly, 100% yearly.",
  nonRefundable: "A Token Plan cannot be refunded once activated.",
  bonusRemaining: "Bonus quota remaining",
  menuBonus: "+{amount} {models} bonus",
  term: "Term",
  queued: "Paid periods still to start: {n}",
  bonusOrder: "Calls to {models} use the Token Plan bonus first.",
};
type TermWords = typeof en;
const copy: Record<string, TermWords> = {
  en,
  zh: {
    termSelector: "购买周期",
    terms: { 1: "月付", 3: "季付", 6: "半年付", 12: "年付" },
    months: "{n} 个月", forMonths: "/ {n} 个月", perPeriod: "每期（30 天）", monthlyOnly: "仅支持月付",
    generalQuota: "保底额度为通用额度，Gemini、Claude、GPT、Grok 等模型均可使用；可用模型和兼容客户端以账户权限为准。",
    bonus: "赠送 {models} 额度", bonusPct: "加赠 {pct}%",
    bonusNote: "赠送额度为保底额度的 {pct}%，每 30 天一期发放、当期有效，仅用于 {models}，并先于通用额度扣减；其他模型不使用赠送额度。",
    termsNote: "可按月、季、半年或年购买，价格为月价 × 月数，不打折。长周期加赠国产模型额度：月付赠 30%，季付赠 40%，半年付赠 60%，年付赠 100%。",
    nonRefundable: "Token Plan 开通后不支持退款。",
    bonusRemaining: "国产模型赠送额度剩余", menuBonus: "+{amount} {models} 赠送额度", term: "购买周期", queued: "已付款待生效 {n} 期",
    bonusOrder: "调用 {models} 时先扣 Token Plan 赠送额度。",
  },
  "zh-hant": {
    termSelector: "購買週期",
    terms: { 1: "月付", 3: "季付", 6: "半年付", 12: "年付" },
    months: "{n} 個月", forMonths: "/ {n} 個月", perPeriod: "每期（30 天）", monthlyOnly: "僅支援月付",
    generalQuota: "保底額度為通用額度，Gemini、Claude、GPT、Grok 等模型皆可使用；可用模型和相容用戶端以帳戶權限為準。",
    bonus: "贈送 {models} 額度", bonusPct: "加贈 {pct}%",
    bonusNote: "贈送額度為保底額度的 {pct}%，每 30 天一期發放、當期有效，僅用於 {models}，並先於通用額度扣減；其他模型不使用贈送額度。",
    termsNote: "可按月、季、半年或年購買，價格為月價 × 月數，不打折。長週期加贈國產模型額度：月付贈 30%，季付贈 40%，半年付贈 60%，年付贈 100%。",
    nonRefundable: "Token Plan 開通後不支援退款。",
    bonusRemaining: "國產模型贈送額度剩餘", menuBonus: "+{amount} {models} 贈送額度", term: "購買週期", queued: "已付款待生效 {n} 期",
    bonusOrder: "呼叫 {models} 時先扣 Token Plan 贈送額度。",
  },
  ja: {
    termSelector: "購入期間",
    terms: { 1: "月払い", 3: "3か月払い", 6: "6か月払い", 12: "年払い" },
    months: "{n}か月", forMonths: "/ {n}か月", perPeriod: "1期（30日）あたり", monthlyOnly: "月払いのみ",
    generalQuota: "保証利用枠は Gemini、Claude、GPT、Grok などで使える共通利用枠です。利用可能なモデルと対応クライアントはアカウントの権限によって異なります。",
    bonus: "{models} 用ボーナス枠", bonusPct: "+{pct}%",
    bonusNote: "ボーナス枠は保証利用枠の {pct}% で、30日ごとに付与され、その期間内のみ有効です。{models} にのみ使われ、共通利用枠より先に差し引かれます。他のモデルでは使われません。",
    termsNote: "1・3・6・12か月単位で購入でき、価格は月額 × 月数で割引はありません。長期ほど国産モデル用ボーナスが増えます：月払い 30%、3か月 40%、6か月 60%、年払い 100%。",
    nonRefundable: "Token Plan は有効化後の返金はできません。",
    bonusRemaining: "国産モデル用ボーナス枠の残高", menuBonus: "+{amount} {models} ボーナス枠", term: "購入期間", queued: "支払い済みで開始待ちの期間：{n}",
    bonusOrder: "{models} の呼び出しでは Token Plan のボーナス枠から先に差し引かれます。",
  },
  ko: {
    termSelector: "결제 주기",
    terms: { 1: "월 결제", 3: "분기 결제", 6: "반기 결제", 12: "연 결제" },
    months: "{n}개월", forMonths: "/ {n}개월", perPeriod: "회차(30일)당", monthlyOnly: "월 결제만 가능",
    generalQuota: "보장 한도는 Gemini, Claude, GPT, Grok 등 모든 모델에 쓰는 공통 한도입니다. 사용 가능한 모델과 호환 클라이언트는 계정 권한에 따라 달라집니다.",
    bonus: "{models} 보너스 한도", bonusPct: "+{pct}%",
    bonusNote: "보너스 한도는 보장 한도의 {pct}%이며 30일 회차마다 지급되고 해당 회차에만 유효합니다. {models}에만 사용되며 공통 한도보다 먼저 차감됩니다. 다른 모델은 사용하지 않습니다.",
    termsNote: "1·3·6·12개월 단위로 구매할 수 있으며 가격은 월 가격 × 개월 수로 할인이 없습니다. 기간이 길수록 중국 모델 보너스가 늘어납니다: 월 30%, 분기 40%, 반기 60%, 연 100%.",
    nonRefundable: "Token Plan은 활성화 후 환불되지 않습니다.",
    bonusRemaining: "중국 모델 보너스 한도 잔액", menuBonus: "+{amount} {models} 보너스 한도", term: "결제 주기", queued: "결제 완료 후 시작 대기 중인 회차: {n}",
    bonusOrder: "{models} 호출은 Token Plan 보너스 한도에서 먼저 차감됩니다.",
  },
  es: {
    termSelector: "Período de pago",
    terms: { 1: "Mensual", 3: "Trimestral", 6: "Semestral", 12: "Anual" },
    months: "{n} meses", forMonths: "/ {n} meses", perPeriod: "por período de 30 días", monthlyOnly: "Solo mensual",
    generalQuota: "La cuota garantizada es general: sirve para Gemini, Claude, GPT, Grok y otros modelos. Los modelos y clientes compatibles dependen de los permisos de tu cuenta.",
    bonus: "Cuota de regalo para {models}", bonusPct: "+{pct}%",
    bonusNote: "La cuota de regalo es el {pct}% de la cuota garantizada, se entrega cada período de 30 días y solo vale en ese período. Solo se usa con {models} y antes que la cuota general; los demás modelos no la usan.",
    termsNote: "Compra uno, tres, seis o doce meses al precio mensual × meses, sin descuento. Los plazos largos regalan más cuota para modelos chinos: 30% mensual, 40% trimestral, 60% semestral, 100% anual.",
    nonRefundable: "Un Token Plan no se reembolsa una vez activado.",
    bonusRemaining: "Cuota de regalo restante", menuBonus: "+{amount} de regalo para {models}", term: "Período", queued: "Períodos pagados por empezar: {n}",
    bonusOrder: "Las llamadas a {models} usan primero la cuota de regalo del Token Plan.",
  },
};

export function tokenPlanTermWordsOf(language: string): TermWords {
  const code = language.toLowerCase();
  if (code.startsWith("zh-hant") || code.startsWith("zh-tw")) return copy["zh-hant"];
  if (code.startsWith("zh")) return copy.zh;
  return copy[code.split(/[-_]/)[0]] ?? en;
}

/** Display name for a purchase term: Monthly / Quarterly / … or "{n} months". */
export function termLabel(months: number, language: string): string {
  const words = tokenPlanTermWordsOf(language);
  return words.terms[months] ?? words.months.replace("{n}", String(months));
}

// Vendor names are matched anywhere in a glob, so production scopes such as
// "*glm*", "*kimi*", "k3" and model ids like "morph-glm52-744b" all resolve.
const vendors: [RegExp, string][] = [[/glm/i, "GLM"], [/kimi|(?:^|[^a-z0-9])k\d/i, "Kimi"], [/deepseek/i, "DeepSeek"], [/qwen/i, "Qwen"], [/minimax/i, "MiniMax"]];

/** Human label for the bonus model globs, e.g. ["glm-*","kimi-*","k3"] → "GLM、Kimi". */
export function bonusModelsLabel(patterns: unknown, language: string): string {
  const names: string[] = [];
  for (const pattern of Array.isArray(patterns) ? patterns : []) {
    if (typeof pattern !== "string" || !pattern.trim()) continue;
    const core = pattern.trim().replace(/^[*?]+/, "");
    const name = vendors.find(([test]) => test.test(core))?.[1] ?? core.replace(/[*?]+/g, "").replace(/^[-_.]+|[-_.]+$/g, "");
    if (name && !names.includes(name)) names.push(name);
  }
  const fallback = ["GLM", "Kimi"];
  const list = names.length ? names : fallback;
  const code = language.toLowerCase();
  return list.join(code.startsWith("zh") || code.startsWith("ja") ? "、" : ", ");
}

/** One purchasable term of a plan as served by the API (snake_case or camelCase). */
interface PlanTerm { months: number; priceMicro: number; bonusPct: number; bonusUsdMicro: number }

/**
 * Validated terms of a plan. Servers before 2026-11-18 send none: the plan is
 * then monthly only at its listed price, with no bonus — exactly what it sold.
 */
export function planTerms(plan: Record<string, unknown>): PlanTerm[] {
  const safe = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
  const raw = Array.isArray(plan.terms) ? plan.terms : [];
  const out: PlanTerm[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const months = row.months, price = row.price_micro ?? row.priceMicro, pct = row.bonus_pct ?? row.bonusPct, bonus = row.bonus_usd_micro ?? row.bonusUsdMicro;
    if (!safe(months) || Number(months) < 1 || Number(months) > 24 || !safe(price) || !safe(pct) || !safe(bonus)) continue;
    if (out.some(term => term.months === months)) continue;
    out.push({ months: Number(months), priceMicro: Number(price), bonusPct: Number(pct), bonusUsdMicro: Number(bonus) });
  }
  if (!out.length && safe(plan.price_micro ?? plan.priceMicro)) out.push({ months: 1, priceMicro: Number(plan.price_micro ?? plan.priceMicro), bonusPct: 0, bonusUsdMicro: 0 });
  return out.sort((a, b) => a.months - b.months);
}
