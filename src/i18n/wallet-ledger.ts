const rows: Record<string, string[]> = {
  en: ['Payment received', 'Subscription', 'Token Plan', 'API allowance', 'Refund', 'Balance adjustment', 'Referral credit', 'Wallet activity'],
  zh: ['核实收款', '订阅', 'Token Plan', 'API 额度', '退款', '余额调整', '推荐返佣', '钱包变动'],
  'zh-hant': ['核實收款', '訂閱', 'Token Plan', 'API 額度', '退款', '餘額調整', '推薦返佣', '錢包變動'],
  ja: ['入金確認', 'サブスクリプション', 'Token Plan', 'API利用枠', '返金', '残高調整', '紹介報酬', 'ウォレットの取引'],
  ko: ['입금 확인', '구독', 'Token Plan', 'API 한도', '환불', '잔액 조정', '추천 보상', '지갑 거래'],
  es: ['Pago verificado', 'Suscripción', 'Token Plan', 'Saldo API', 'Reembolso', 'Ajuste de saldo', 'Comisión por referido', 'Movimiento del monedero'],
};
export function ledgerKind(kind: unknown, language: string): string {
  const code = language.toLowerCase();
  const values = rows[code] ?? rows[code.startsWith('zh-tw') ? 'zh-hant' : code.startsWith('zh') ? 'zh' : code.split('-')[0]] ?? rows.en;
  const index = ({ topup: 0, seat: 1, token_plan: 2, tplan: 2, allowance: 3, refund: 4, adjust: 5, rebate: 6 } as Record<string, number>)[String(kind)];
  return values[index ?? 7];
}
