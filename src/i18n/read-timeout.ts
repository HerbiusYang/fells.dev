const messages: Record<string, string> = {
  en: "Loading timed out. Please try again.",
  zh: "读取超时，请重试。",
  "zh-hant": "讀取逾時，請重試。",
  ja: "読み込みがタイムアウトしました。もう一度お試しください。",
  ko: "불러오기 시간이 초과되었습니다. 다시 시도해 주세요.",
  es: "La carga agotó el tiempo de espera. Inténtalo de nuevo.",
};

export function readTimeoutMessage(language: string): string {
  const lang = language.toLowerCase();
  return messages[lang === "zh-tw" || lang.startsWith("zh-hant") ? "zh-hant" : lang.split("-")[0]] ?? messages.en;
}
