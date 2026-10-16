const rows = {
  en: ["The latest status is loaded. Your explanation is saved. Check the result, then submit again.", "Could not load the latest status. Your explanation is saved; try loading it again.", "Load latest status", "This result has changed or a problem is already reported. Your explanation is kept below; contact support if you need to add it.", "Customer ID (leave empty for everyone)", "Apply filter", "Oldest pending operations first", "Currently pending", "Records shown", "Load older queue records", "Enter a positive customer ID."],
  "zh-CN": ["已载入最新状态，问题说明已保留。请核对后再次提交。", "暂时无法载入最新状态，问题说明已保留，请重试载入。", "载入最新状态", "当前结果已变更或已有异议。你的问题说明保留如下，需要补充时请联系客服。", "客户编号（留空显示全部）", "应用筛选", "最久未处理的资金操作优先", "当前待核对总数", "已显示记录", "加载后续待核对记录", "请输入正整数客户编号。"],
  "zh-TW": ["已載入最新狀態，問題說明已保留。請核對後再次提交。", "暫時無法載入最新狀態，問題說明已保留，請重試載入。", "載入最新狀態", "目前結果已變更或已有異議。你的問題說明保留如下，需要補充時請聯絡客服。", "客戶編號（留空顯示全部）", "套用篩選", "最久未處理的資金操作優先", "目前待核對總數", "已顯示記錄", "載入後續待核對記錄", "請輸入正整數客戶編號。"],
  ja: ["最新の状況を読み込み、説明を保存しました。内容を確認してから再送信してください。", "最新の状況を読み込めませんでした。説明は保存されています。再読み込みしてください。", "最新の状況を読み込む", "状況が変わったか、問題がすでに報告されています。説明は以下に保存されています。追記はサポートへご連絡ください。", "お客様ID（空欄ですべて表示）", "絞り込む", "未処理期間の長い資金操作から表示", "現在の未確認件数", "表示中の記録", "続きの未確認記録を読み込む", "正の整数のお客様IDを入力してください。"],
  ko: ["최신 상태를 불러왔으며 설명을 보관했습니다. 결과를 확인한 후 다시 제출하세요.", "최신 상태를 불러오지 못했습니다. 설명은 보관되어 있으니 다시 불러오세요.", "최신 상태 불러오기", "상태가 변경되었거나 문제가 이미 신고되었습니다. 설명은 아래에 보관되며, 추가 내용은 지원팀에 문의하세요.", "고객 ID (비우면 전체 표시)", "필터 적용", "가장 오래 대기한 자금 작업부터 표시", "현재 검토 대기 수", "표시된 기록", "다음 검토 대기 기록 불러오기", "양의 정수 고객 ID를 입력하세요."],
  es: ["Se ha cargado el estado actual y guardado tu explicación. Revísalo antes de volver a enviar.", "No se pudo cargar el estado actual. Tu explicación está guardada; intenta cargarlo de nuevo.", "Cargar estado actual", "El resultado ha cambiado o ya hay un problema comunicado. Tu explicación se conserva abajo; contacta con soporte para añadirla.", "ID del cliente (vacío para todos)", "Aplicar filtro", "Primero las operaciones pendientes más antiguas", "Pendientes actuales", "Registros mostrados", "Cargar siguientes registros pendientes", "Introduce un ID de cliente entero positivo."],
} as const;
const keys = ["disputeUpdated", "disputeRefreshFailed", "refreshDispute", "disputeUnavailable", "customerFilter", "applyFilter", "oldestFirst", "pendingTotal", "loaded", "loadOperations", "invalidCustomer"] as const;
export function supportRecoveryCopy(lang: string) {
  const locale = lang === "zh" ? "zh-CN" : lang === "zh-hant" ? "zh-TW" : lang;
  const values = rows[locale as keyof typeof rows] ?? rows.en;
  return Object.fromEntries(keys.map((key, index) => [key, values[index]])) as Record<typeof keys[number], string>;
}
