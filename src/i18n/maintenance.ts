const rows = {
  en: ["Service notice", "Scheduled maintenance", "Service temporarily unavailable", "Service recovery in progress", "Starts", "Expected recovery", "To be confirmed", "Last updated", "Next update", "Service status", "Check status", "Online support is paused during maintenance. Your draft is kept on this page.", "Event"],
  zh: ["服务公告", "计划维护", "服务暂时不可用", "服务正在恢复", "开始时间", "预计恢复", "待确认", "最后更新", "下次更新", "服务状态", "查看状态", "维护期间在线客服暂停，草稿保留在当前页面。", "事件编号"],
  "zh-hant": ["服務公告", "預定維護", "服務暫時無法使用", "服務正在恢復", "開始時間", "預計恢復", "待確認", "最後更新", "下次更新", "服務狀態", "查看狀態", "維護期間線上客服暫停，草稿保留在目前頁面。", "事件編號"],
  ja: ["サービスのお知らせ", "メンテナンス予定", "サービスを一時的に利用できません", "サービスを復旧中です", "開始", "復旧予定", "未定", "最終更新", "次回更新", "サービス状況", "状況を確認", "メンテナンス中はサポートを停止しています。下書きはこのページに保持されます。", "事象番号"],
  ko: ["서비스 공지", "예정된 점검", "서비스를 일시적으로 이용할 수 없습니다", "서비스 복구 중", "시작", "복구 예정", "미정", "최근 업데이트", "다음 업데이트", "서비스 상태", "상태 확인", "점검 중에는 온라인 지원이 중단됩니다. 초안은 현재 페이지에 유지됩니다.", "이벤트 번호"],
  es: ["Aviso del servicio", "Mantenimiento programado", "Servicio temporalmente no disponible", "Recuperación del servicio en curso", "Inicio", "Recuperación prevista", "Por confirmar", "Última actualización", "Próxima actualización", "Estado del servicio", "Consultar estado", "El soporte está pausado durante el mantenimiento. El borrador se conserva en esta página.", "Incidente"],
} as const;
const keys = ["notice", "scheduled", "unavailable", "recovering", "starts", "expected", "unknown", "updated", "next", "status", "check", "supportPaused", "event"] as const;
export function maintenanceCopy(locale: string) {
  const key = locale === "zh-CN" ? "zh" : locale === "zh-TW" ? "zh-hant" : locale;
  const row = rows[key as keyof typeof rows] ?? rows.en;
  return Object.fromEntries(keys.map((field, index) => [field, row[index]])) as Record<typeof keys[number], string>;
}
