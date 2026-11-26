export interface ReferralWords {
  authLabel: string;
  authPlaceholder: string;
  authHint: string;
  codeLabel: string;
  linkLabel: string;
  copyCode: string;
  copyLink: string;
  invited: string;
  converted: string;
  rewards: string;
  pending: string;
  teamLabel: string;
  ratesLabel: string;
  minTopup: string;
  rebatesTitle: string;
  payable: string;
  held: string;
  pendingBonus: string;
  accrued: string;
  credited: string;
  paid: string;
  holdDays: string;
  holdInstant: string;
  windowMonths: string;
  windowUnlimited: string;
  poolNote: string;
  transferBtn: string;
  pendingListTitle: string;
  dueOn: string;
  historyTitle: string;
  historyEmpty: string;
  level: string;
  kinds: Record<"accrual" | "referral_bonus" | "credit" | "payout" | "adjust", string>;
}

const dict: Record<string, ReferralWords> = {
  en: {
    authLabel: "Invite code (optional)",
    authPlaceholder: "Enter friend's invite code",
    authHint: "Bind at registration only. Invalid codes never block sign-up.",
    codeLabel: "Your invite code",
    linkLabel: "Your invite link",
    copyCode: "Copy code",
    copyLink: "Copy link",
    invited: "Invited",
    converted: "Converted",
    rewards: "Rewards",
    pending: "Pending",
    teamLabel: "Referral network",
    ratesLabel: "Active commission rates",
    minTopup: "Min qualifying top-up: {amount}",
    rebatesTitle: "Referral rebates",
    payable: "Available to transfer",
    held: "In hold period",
    pendingBonus: "Pending bonuses",
    accrued: "Total earned",
    credited: "Transferred to wallet",
    paid: "Paid offline",
    holdDays: "Hold period: {days} days",
    holdInstant: "Hold period: immediate",
    windowMonths: "earning window: {months} months",
    windowUnlimited: "earning window: unlimited",
    poolNote: "Transfer to CNY cash requires enough funds in the rebate pool.",
    transferBtn: "Confirm transfer to wallet",
    pendingListTitle: "Pending fixed bonuses",
    dueOn: "Scheduled {date}",
    historyTitle: "Recent rebate activity",
    historyEmpty: "No rebate activity yet.",
    level: "L{n}",
    kinds: {
      accrual: "Commission",
      referral_bonus: "Referral bonus",
      credit: "Transferred to wallet",
      payout: "Offline payout",
      adjust: "Adjustment",
    },
  },
  zh: {
    authLabel: "推荐码（选填）",
    authPlaceholder: "填写好友的推荐码",
    authHint: "仅可在注册时绑定一次，填错不会阻止注册。",
    codeLabel: "我的推荐码",
    linkLabel: "我的邀请链接",
    copyCode: "复制推荐码",
    copyLink: "复制链接",
    invited: "已邀请",
    converted: "已转化",
    rewards: "已得奖励",
    pending: "待发奖励",
    teamLabel: "三级推荐人数",
    ratesLabel: "当前返佣比例",
    minTopup: "单笔最低实付：{amount}",
    rebatesTitle: "推荐返佣",
    payable: "可转入钱包",
    held: "挂账中",
    pendingBonus: "待到期固定奖励",
    accrued: "累计已赚",
    credited: "已转入钱包",
    paid: "已线下结算",
    holdDays: "挂账期 {days} 天",
    holdInstant: "无挂账期（计提即可转）",
    windowMonths: "计酬期 {months} 个月",
    windowUnlimited: "计酬期不限",
    poolNote: "返现池资金充足时可转入人民币现金钱包。",
    transferBtn: "确认转入钱包",
    pendingListTitle: "待发放固定奖励",
    dueOn: "预计 {date} 发放",
    historyTitle: "最近返佣流水",
    historyEmpty: "暂无返佣流水。",
    level: "{n}级",
    kinds: {
      accrual: "充值返佣",
      referral_bonus: "推荐固定奖励",
      credit: "转入钱包",
      payout: "线下结算",
      adjust: "账目调整",
    },
  },
  "zh-hant": {
    authLabel: "推薦碼（選填）",
    authPlaceholder: "輸入好友的推薦碼",
    authHint: "僅可在註冊時綁定一次，填錯不會阻止註冊。",
    codeLabel: "我的推薦碼",
    linkLabel: "我的邀請連結",
    copyCode: "複製推薦碼",
    copyLink: "複製連結",
    invited: "已邀請",
    converted: "已轉化",
    rewards: "已得獎勵",
    pending: "待發獎勵",
    teamLabel: "三級推薦人數",
    ratesLabel: "目前返佣比例",
    minTopup: "單筆最低實付：{amount}",
    rebatesTitle: "推薦返佣",
    payable: "可轉入錢包",
    held: "掛帳中",
    pendingBonus: "待到期固定獎勵",
    accrued: "累計已賺",
    credited: "已轉入錢包",
    paid: "已線下結算",
    holdDays: "掛帳期 {days} 天",
    holdInstant: "無掛帳期（計提即可轉）",
    windowMonths: "計酬期 {months} 個月",
    windowUnlimited: "計酬期不限",
    poolNote: "返現池資金充足時可轉入人民幣現金錢包。",
    transferBtn: "確認轉入錢包",
    pendingListTitle: "待發放固定獎勵",
    dueOn: "預計 {date} 發放",
    historyTitle: "最近返佣紀錄",
    historyEmpty: "暫無返佣紀錄。",
    level: "{n}級",
    kinds: {
      accrual: "儲值返佣",
      referral_bonus: "推薦固定獎勵",
      credit: "轉入錢包",
      payout: "線下結算",
      adjust: "帳目調整",
    },
  },
  ja: {
    authLabel: "紹介コード（任意）",
    authPlaceholder: "友達の紹介コードを入力",
    authHint: "登録時のみ紐付けられます。無効なコードでも登録は継続できます。",
    codeLabel: "あなたの紹介コード",
    linkLabel: "招待リンク",
    copyCode: "コードをコピー",
    copyLink: "リンクをコピー",
    invited: "招待済み",
    converted: "購入済み",
    rewards: "獲得報酬",
    pending: "確定待ち",
    teamLabel: "紹介ネットワーク",
    ratesLabel: "現在の報酬率",
    minTopup: "対象となる最低入金：{amount}",
    rebatesTitle: "紹介報酬",
    payable: "ウォレットへ移行可能",
    held: "保留中",
    pendingBonus: "確定待ちボーナス",
    accrued: "累計獲得",
    credited: "ウォレット移行済み",
    paid: "オフライン支払済み",
    holdDays: "保留期間：{days}日",
    holdInstant: "保留期間：即時",
    windowMonths: "対象期間：{months}か月",
    windowUnlimited: "対象期間：無期限",
    poolNote: "CNY 現金ウォレットへの移行には報酬プールの残高が必要です。",
    transferBtn: "ウォレットへ移す",
    pendingListTitle: "確定待ち固定ボーナス",
    dueOn: "{date} 付与予定",
    historyTitle: "最近の報酬履歴",
    historyEmpty: "報酬履歴はまだありません。",
    level: "L{n}",
    kinds: {
      accrual: "紹介報酬",
      referral_bonus: "固定ボーナス",
      credit: "ウォレット移行",
      payout: "オフライン支払",
      adjust: "調整",
    },
  },
  ko: {
    authLabel: "추천 코드 (선택)",
    authPlaceholder: "친구의 추천 코드를 입력하세요",
    authHint: "가입 시 한 번만 연결됩니다. 잘못된 코드여도 가입은 막히지 않습니다.",
    codeLabel: "내 추천 코드",
    linkLabel: "내 초대 링크",
    copyCode: "코드 복사",
    copyLink: "링크 복사",
    invited: "초대함",
    converted: "결제 완료",
    rewards: "보상",
    pending: "대기 중",
    teamLabel: "추천 네트워크",
    ratesLabel: "현재 보상 비율",
    minTopup: "최소 결제 금액: {amount}",
    rebatesTitle: "추천 보상",
    payable: "지갑 이체 가능",
    held: "보류 중",
    pendingBonus: "지급 대기 보너스",
    accrued: "누적 보상",
    credited: "지갑 이체 완료",
    paid: "오프라인 지급",
    holdDays: "보류 기간: {days}일",
    holdInstant: "보류 기간: 즉시",
    windowMonths: "적립 기간: {months}개월",
    windowUnlimited: "적립 기간: 제한 없음",
    poolNote: "CNY 현금 지갑으로 옮기려면 보상 풀 잔액이 충분해야 합니다.",
    transferBtn: "지갑으로 옮기기",
    pendingListTitle: "지급 대기 고정 보너스",
    dueOn: "{date} 지급 예정",
    historyTitle: "최근 보상 내역",
    historyEmpty: "아직 보상 내역이 없습니다.",
    level: "L{n}",
    kinds: {
      accrual: "추천 보상",
      referral_bonus: "고정 보너스",
      credit: "지갑 이체",
      payout: "오프라인 지급",
      adjust: "조정",
    },
  },
  es: {
    authLabel: "Código de invitación (opcional)",
    authPlaceholder: "Introduce el código de un amigo",
    authHint: "Solo se vincula al registrarte. Un código inválido no bloquea el registro.",
    codeLabel: "Tu código de invitación",
    linkLabel: "Tu enlace de invitación",
    copyCode: "Copiar código",
    copyLink: "Copiar enlace",
    invited: "Invitados",
    converted: "Convertidos",
    rewards: "Recompensas",
    pending: "Pendientes",
    teamLabel: "Red de referidos",
    ratesLabel: "Tasas de comisión vigentes",
    minTopup: "Recarga mínima: {amount}",
    rebatesTitle: "Comisiones por referidos",
    payable: "Disponible para transferir",
    held: "En período de retención",
    pendingBonus: "Bonos pendientes",
    accrued: "Total acumulado",
    credited: "Transferido a la cartera",
    paid: "Pagado fuera de línea",
    holdDays: "Retención: {days} días",
    holdInstant: "Retención: inmediata",
    windowMonths: "ventana: {months} meses",
    windowUnlimited: "ventana: sin límite",
    poolNote: "Transferir a efectivo CNY requiere saldo suficiente en el fondo de comisiones.",
    transferBtn: "Confirmar transferencia a la cartera",
    pendingListTitle: "Bonos fijos pendientes",
    dueOn: "Previsto el {date}",
    historyTitle: "Actividad reciente de comisiones",
    historyEmpty: "Aún no hay actividad de comisiones.",
    level: "N{n}",
    kinds: {
      accrual: "Comisión",
      referral_bonus: "Bono por referido",
      credit: "Transferencia a cartera",
      payout: "Pago externo",
      adjust: "Ajuste",
    },
  },
};

export function referralWordsOf(locale: string): ReferralWords {
  const normalized = locale.toLowerCase().replaceAll("_", "-");
  const key = normalized.startsWith("zh-hant") || normalized.startsWith("zh-tw")
    ? "zh-hant"
    : normalized.split("-")[0];
  return dict[key] ?? dict.en;
}
