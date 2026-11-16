const keys = ["invalid", "conflict", "forbidden", "missing", "unavailable", "pending", "limited"] as const;
const rows = {
  en: ["Check the fields and the original order, amount and evidence.", "This record changed. Reload it and review the latest details; your draft is kept.", "Your account cannot perform this action. Ask an authorized operator to continue.", "This record is no longer available. Refresh the list.", "Support is temporarily unavailable. Your draft is kept; try again.", "The result is not confirmed. Retry the same operation to check it.", "Too many requests. Wait a moment and retry."],
  zh: ["请检查填写内容，并核对原订单、金额与证据后重试。", "记录已更新，请重新载入并核对最新内容，草稿已保留。", "当前账号没有此操作权限，请交由有权限的客服处理。", "记录已不再可用，请刷新列表。", "客服服务暂时不可用，草稿已保留，请稍后重试。", "提交结果尚未确认，请重试同一操作以核对结果。", "操作过于频繁，请稍候重试。"],
  "zh-hant": ["請檢查填寫內容，並核對原訂單、金額與證據後重試。", "記錄已更新，請重新載入並核對最新內容，草稿已保留。", "目前帳號沒有此操作權限，請交由有權限的客服處理。", "記錄已不再可用，請重新整理清單。", "客服服務暫時無法使用，草稿已保留，請稍後重試。", "提交結果尚未確認，請重試同一操作以核對結果。", "操作過於頻繁，請稍候重試。"],
  ja: ["入力内容、元の注文、金額、証拠を確認してください。", "記録が更新されました。再読み込みして確認してください。下書きは保持されています。", "この操作を行う権限がありません。権限のある担当者に依頼してください。", "この記録は利用できません。一覧を更新してください。", "サポートを一時的に利用できません。下書きは保持されています。再試行してください。", "結果は未確認です。同じ操作を再試行して確認してください。", "操作が多すぎます。しばらくしてから再試行してください。"],
  ko: ["입력 내용과 원 주문, 금액, 증거를 확인하세요.", "기록이 변경되었습니다. 새로 불러와 확인하세요. 초안은 유지됩니다.", "이 작업에 대한 권한이 없습니다. 권한이 있는 담당자에게 요청하세요.", "기록을 더 이상 이용할 수 없습니다. 목록을 새로 고치세요.", "일시적으로 고객 지원을 이용할 수 없습니다. 초안은 유지됩니다. 다시 시도하세요.", "결과가 확인되지 않았습니다. 같은 작업을 다시 시도하여 확인하세요.", "요청이 너무 많습니다. 잠시 후 다시 시도하세요."],
  es: ["Revisa los campos, el pedido original, el importe y las pruebas.", "El registro cambió. Vuelve a cargarlo y revísalo. El borrador se conserva.", "Tu cuenta no tiene permiso. Pide ayuda a un agente autorizado.", "El registro ya no está disponible. Actualiza la lista.", "El soporte no está disponible temporalmente. El borrador se conserva. Reintenta.", "El resultado no está confirmado. Reintenta la misma operación para verificarlo.", "Demasiadas solicitudes. Espera un momento y reintenta."],
};
export function supportErrorCopy(locale: string) {
  const values = rows[locale as keyof typeof rows] ?? rows.en;
  const business = {
    en: { capacity: "This subscription has no available capacity. Review the available plans before retrying.", plan: "This plan is no longer available. Review the original quote and choose an available plan.", funds: "The customer's CNY cash balance is insufficient. Check the actual payment and original order amount.", quote: "The quote changed or expired. Reload it and ask the customer to review and confirm it." },
    zh: { capacity: "所选订阅暂无可用名额，请核对可售套餐后再试。", plan: "该套餐已不可用，请核对原报价并重新选择可售套餐。", funds: "客户的人民币现金余额不足，请核对实际收款与原订单金额。", quote: "报价已变化或过期，请重新载入并由客户核对后确认。" },
    "zh-hant": { capacity: "所選訂閱暫無可用名額，請核對可售套餐後再試。", plan: "該套餐已無法使用，請核對原報價並重新選擇可售套餐。", funds: "客戶的人民幣現金餘額不足，請核對實際收款與原訂單金額。", quote: "報價已變更或過期，請重新載入並由客戶核對後確認。" },
    ja: { capacity: "このサブスクリプションには空きがありません。販売中のプランを確認してください。", plan: "このプランは提供されていません。元の見積もりを確認し、利用可能なプランを選択してください。", funds: "顧客の人民元現金残高が不足しています。実際の入金と元の注文金額を確認してください。", quote: "見積もりが変更されたか期限切れです。再読み込みし、顧客に再確認してもらってください。" },
    ko: { capacity: "선택한 구독에 여유 정원이 없습니다. 판매 중인 요금제를 확인하세요.", plan: "이 요금제를 더 이상 사용할 수 없습니다. 원 견적을 확인하고 사용 가능한 요금제를 선택하세요.", funds: "고객의 위안화 현금 잔액이 부족합니다. 실제 결제와 원 주문 금액을 확인하세요.", quote: "견적이 변경되었거나 만료되었습니다. 다시 불러와 고객의 확인을 받으세요." },
    es: { capacity: "Esta suscripción no tiene plazas disponibles. Revisa los planes antes de reintentar.", plan: "Este plan ya no está disponible. Revisa el presupuesto original y elige uno disponible.", funds: "El saldo en efectivo CNY del cliente es insuficiente. Comprueba el pago real y el importe del pedido original.", quote: "El presupuesto cambió o caducó. Vuelve a cargarlo y pide al cliente que lo revise y confirme." },
  };
  const common = Object.fromEntries(keys.map((key, index) => [key, values[index]])) as Record<typeof keys[number], string>;
  const details = business[locale as keyof typeof business] ?? business.en;
  return { ...common, ...details };
}
