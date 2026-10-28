const copy = {
  en: { label: "Web search", unavailable: "Web search is unavailable", consent: "Allow this request to use the server's available web search capability.", pending: "Waiting for the web-enabled request", running: "Processing the web-enabled request" },
  zh: { label: "联网", unavailable: "当前暂不支持联网搜索", consent: "允许本次请求使用服务器提供的联网搜索能力。", pending: "正在等待联网请求结果", running: "联网请求处理中" },
  "zh-hant": { label: "聯網", unavailable: "目前暫不支援聯網搜尋", consent: "允許本次請求使用伺服器提供的聯網搜尋能力。", pending: "正在等待聯網請求結果", running: "聯網請求處理中" },
  ja: { label: "ウェブ検索", unavailable: "ウェブ検索は利用できません", consent: "このリクエストでサーバーのウェブ検索機能を利用します。", pending: "ウェブ検索付きリクエストの結果を待っています", running: "ウェブ検索付きリクエストを処理中" },
  ko: { label: "웹 검색", unavailable: "웹 검색을 사용할 수 없습니다", consent: "이 요청에서 서버가 제공하는 웹 검색 기능을 사용합니다.", pending: "웹 검색 요청 결과를 기다리는 중", running: "웹 검색 요청 처리 중" },
  es: { label: "Buscar en la web", unavailable: "La búsqueda web no está disponible", consent: "Permite que esta solicitud use la búsqueda web disponible en el servidor.", pending: "Esperando el resultado de la solicitud con búsqueda web", running: "Procesando la solicitud con búsqueda web" },
};
const charges = {
  en: "Web search may incur additional charges billed to your account.",
  zh: "联网搜索可能另行收费，由当前账户支付。",
  "zh-hant": "聯網搜尋可能另行收費，由目前帳戶支付。",
  ja: "ウェブ検索には追加料金が発生し、現在のアカウントに請求される場合があります。",
  ko: "웹 검색에는 추가 요금이 발생할 수 있으며 현재 계정으로 청구됩니다.",
  es: "La búsqueda web puede generar cargos adicionales en tu cuenta.",
};
export function chatSearchWords(language: string) {
  const code = language.toLowerCase();
  const key = code.startsWith("zh-hant") || code.startsWith("zh-tw") ? "zh-hant" : code.startsWith("zh") ? "zh" : code.startsWith("ja") ? "ja" : code.startsWith("ko") ? "ko" : code.startsWith("es") ? "es" : "en";
  return { ...copy[key], charges: charges[key] };
}
