/** Presentation of server-owned monthly subscription facts. */
export function monthlySoldOut(plan: { held?: boolean; current?: boolean; free?: number; capacity?: number }): boolean {
  if (plan.held || plan.current) return false;
  // Older servers may omit inventory. Unknown stock is checked by the server at purchase.
  return (typeof plan.free === "number" && plan.free <= 0) || (typeof plan.capacity === "number" && plan.capacity <= 0);
}

export function subscriptionWords(lang: string) {
  const rows: Record<string, string[]> = {
    en: ["Fixed share", "Sold out", "Available", "Allocated", "Allocation pending", "Current expiry", "The confirmed service period appears on your purchase receipt.", "View my subscription", "Client access", "Web chat", "Claude Code", "Developer API", "Not priced", "No automatic renewal"],
    zh: ["固定份额", "暂时满座", "可购买", "已分配", "等待分配", "当前到期时间", "最终服务期限以购买成功的回执为准。", "查看我的订阅", "接入方式", "网页聊天", "Claude Code", "开发者 API", "暂未定价", "不自动续费"],
    "zh-hant": ["固定份額", "暫時滿座", "可購買", "已分配", "等待分配", "目前到期時間", "最終服務期限以購買成功的回執為準。", "查看我的訂閱", "接入方式", "網頁聊天", "Claude Code", "開發者 API", "暫未定價", "不自動續費"],
    ja: ["固定シェア", "満席", "購入可能", "割り当て済み", "割り当て待ち", "現在の有効期限", "確定したサービス期間は購入完了の明細で確認できます。", "契約を確認", "利用方法", "Webチャット", "Claude Code", "開発者API", "料金未設定", "自動更新なし"],
    ko: ["고정 지분", "매진", "구매 가능", "할당 완료", "할당 대기", "현재 만료일", "확정된 서비스 기간은 구매 완료 내역에서 확인할 수 있습니다.", "내 구독 확인", "접속 방법", "웹 채팅", "Claude Code", "개발자 API", "가격 미설정", "자동 갱신 없음"],
    es: ["Participación fija", "Agotado", "Disponible", "Asignado", "Asignación pendiente", "Vencimiento actual", "El período confirmado aparece en el recibo de la compra.", "Ver mi suscripción", "Acceso", "Chat web", "Claude Code", "API de desarrollo", "Sin precio", "Sin renovación automática"],
  };
  const keys = ["share", "soldOut", "available", "allocated", "pending", "currentExpiry", "receiptPeriod", "view", "clients", "web", "cli", "api", "unpriced", "noRenewal"] as const;
  const language = lang.toLowerCase();
  const values = rows[language] ?? rows[language.startsWith("zh-tw") ? "zh-hant" : language.startsWith("zh") ? "zh" : language.split("-")[0]] ?? rows.en;
  return Object.fromEntries(keys.map((key, i) => [key, values[i]])) as Record<typeof keys[number], string>;
}

export function offeredModel(model: any): boolean {
  return !!model && model.offered === true && model.routable === true && !!model.client_formats && Array.isArray(model.formats) &&
    ["api", "claude_code", "web_chat"].some(client => Array.isArray(model.client_formats[client]) && model.client_formats[client].some((format: unknown) => typeof format === "string" && model.formats.includes(format)));
}
