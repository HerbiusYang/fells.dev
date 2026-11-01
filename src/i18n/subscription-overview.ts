export interface SubscriptionOverviewWords {
  details: string; recordedStatus: string; recordedAt: string; timeUnavailable: string;
  used: string; window: string; fiveHours: string; weekly: string;
  resets: string; serverReset: string; expectedResetPassed: string; unavailable: string;
  states: Record<"ready" | "tight" | "full" | "scoped_full" | "pending" | "unknown", string>;
}

const words: Record<string, SubscriptionOverviewWords> = {
  en: {
    details: "View usage", recordedStatus: "Recorded status", recordedAt: "Reading time", timeUnavailable: "Reading time unavailable",
    used: "Used", window: "Limit", fiveHours: "5 hours", weekly: "Weekly", resets: "Expected reset",
    serverReset: "Previous window expired; waiting for a new reading", expectedResetPassed: "Expected reset time passed; waiting for a new reading", unavailable: "No reading available",
    states: { ready: "Available", tight: "Near limit", full: "Limit reached", scoped_full: "Model limit reached", pending: "Awaiting assignment", unknown: "No current reading" },
  },
  zh: {
    details: "查看用量", recordedStatus: "记录状态", recordedAt: "读数时间", timeUnavailable: "暂无有效读数时间",
    used: "已用", window: "限额", fiveHours: "5 小时", weekly: "每周", resets: "预计重置",
    serverReset: "旧窗口已到期，等待新读数", expectedResetPassed: "预计重置时间已过，等待新读数", unavailable: "暂无读数",
    states: { ready: "可用", tight: "接近限额", full: "已用满", scoped_full: "部分模型限额已用满", pending: "等待分配", unknown: "暂无当前读数" },
  },
  "zh-hant": {
    details: "查看用量", recordedStatus: "記錄狀態", recordedAt: "讀數時間", timeUnavailable: "暫無有效讀數時間",
    used: "已用", window: "限額", fiveHours: "5 小時", weekly: "每週", resets: "預計重置",
    serverReset: "舊視窗已到期，等待新讀數", expectedResetPassed: "預計重置時間已過，等待新讀數", unavailable: "暫無讀數",
    states: { ready: "可用", tight: "接近限額", full: "已用滿", scoped_full: "部分模型限額已用滿", pending: "等待分配", unknown: "暫無目前讀數" },
  },
  ja: {
    details: "使用量を表示", recordedStatus: "記録された状態", recordedAt: "記録時刻", timeUnavailable: "記録時刻は不明です",
    used: "使用済み", window: "利用枠", fiveHours: "5時間", weekly: "週間", resets: "リセット予定",
    serverReset: "前の期間は終了しました。新しい記録を待っています", expectedResetPassed: "リセット予定時刻を過ぎました。新しい記録を待っています", unavailable: "記録がありません",
    states: { ready: "利用可能", tight: "上限間近", full: "上限到達", scoped_full: "モデルの上限に到達", pending: "割り当て待ち", unknown: "現在の記録がありません" },
  },
  ko: {
    details: "사용량 보기", recordedStatus: "기록된 상태", recordedAt: "기록 시각", timeUnavailable: "기록 시각을 알 수 없습니다",
    used: "사용량", window: "한도", fiveHours: "5시간", weekly: "주간", resets: "예상 초기화",
    serverReset: "이전 기간이 종료되었습니다. 새 기록을 기다리는 중입니다", expectedResetPassed: "예상 초기화 시각이 지났습니다. 새 기록을 기다리는 중입니다", unavailable: "기록이 없습니다",
    states: { ready: "사용 가능", tight: "한도에 근접", full: "한도 도달", scoped_full: "모델 한도 도달", pending: "할당 대기", unknown: "현재 기록이 없습니다" },
  },
  es: {
    details: "Ver consumo", recordedStatus: "Estado registrado", recordedAt: "Hora de lectura", timeUnavailable: "Hora de lectura no disponible",
    used: "Consumido", window: "Límite", fiveHours: "5 horas", weekly: "Semanal", resets: "Restablecimiento previsto",
    serverReset: "El período anterior terminó; esperando una nueva lectura", expectedResetPassed: "Pasó la hora prevista; esperando una nueva lectura", unavailable: "Sin lectura disponible",
    states: { ready: "Disponible", tight: "Cerca del límite", full: "Límite alcanzado", scoped_full: "Límite del modelo alcanzado", pending: "Pendiente de asignación", unknown: "Sin lectura actual" },
  },
};

export function subscriptionOverviewWords(locale: string): SubscriptionOverviewWords {
  const language = locale.toLowerCase().replaceAll("_", "-");
  const key = language.startsWith("zh-hant") || language.startsWith("zh-tw") ? "zh-hant" : language.split("-")[0];
  return words[key] ?? words.en;
}
