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
const availability = {
  "en": {
    "title": "Web search availability",
    "details": "View availability and supported models",
    "modelUnavailable": "The selected model does not support web search.",
    "serviceUnavailable": "Web search is currently unavailable for this account.",
    "loading": "Model capabilities are loading. Try again shortly.",
    "loadError": "Model capabilities could not be loaded. Refresh the model list to try again.",
    "readOnly": "This workspace is read-only. You cannot send model requests here.",
    "busy": "Wait for this conversation to finish being created before changing web search.",
    "model": "Current model",
    "supported": "Models with web search",
    "none": "No models with web search are currently available.",
    "useModel": "Use model",
    "switchHint": "Switching models does not enable web search or send a request. Enable it separately after reviewing the possible charges.",
    "reload": "Refresh model list"
  },
  "zh": {
    "title": "联网搜索可用情况",
    "details": "查看原因与支持联网的模型",
    "modelUnavailable": "当前选择的模型不支持联网搜索。",
    "serviceUnavailable": "当前账户暂时没有可用的联网搜索能力。",
    "loading": "正在加载模型能力，请稍后再试。",
    "loadError": "未能加载模型能力，可刷新模型列表重试。",
    "readOnly": "当前工作区为只读，不能在此发送模型请求。",
    "busy": "请等待当前会话创建完成后再设置联网搜索。",
    "model": "当前模型",
    "supported": "支持联网搜索的模型",
    "none": "当前暂无可用的联网搜索模型。",
    "useModel": "切换至",
    "switchHint": "切换模型不会开启联网或发送请求。请先查看可能产生的费用，再单独开启联网。",
    "reload": "刷新模型列表"
  },
  "zh-hant": {
    "title": "聯網搜尋可用情況",
    "details": "查看原因與支援聯網的模型",
    "modelUnavailable": "目前選擇的模型不支援聯網搜尋。",
    "serviceUnavailable": "目前帳戶暫時沒有可用的聯網搜尋能力。",
    "loading": "正在載入模型能力，請稍後再試。",
    "loadError": "未能載入模型能力，可重新整理模型清單再試。",
    "readOnly": "目前工作區為唯讀，不能在此傳送模型請求。",
    "busy": "請等待目前對話建立完成後再設定聯網搜尋。",
    "model": "目前模型",
    "supported": "支援聯網搜尋的模型",
    "none": "目前沒有可用的聯網搜尋模型。",
    "useModel": "切換至",
    "switchHint": "切換模型不會開啟聯網或傳送請求。請先查看可能產生的費用，再個別開啟聯網。",
    "reload": "重新整理模型清單"
  },
  "ja": {
    "title": "ウェブ検索の利用状況",
    "details": "利用できない理由と対応モデルを確認",
    "modelUnavailable": "選択中のモデルはウェブ検索に対応していません。",
    "serviceUnavailable": "現在、このアカウントではウェブ検索を利用できません。",
    "loading": "モデルの機能を読み込み中です。しばらくしてから再試行してください。",
    "loadError": "モデルの機能を読み込めませんでした。モデル一覧を更新して再試行してください。",
    "readOnly": "このワークスペースは読み取り専用のため、モデルにリクエストを送信できません。",
    "busy": "会話の作成が完了してからウェブ検索を設定してください。",
    "model": "現在のモデル",
    "supported": "ウェブ検索対応モデル",
    "none": "現在、ウェブ検索対応モデルは利用できません。",
    "useModel": "モデルを選択",
    "switchHint": "モデルを変更しても検索や送信は開始されません。追加料金の可能性を確認してから、別途ウェブ検索を有効にしてください。",
    "reload": "モデル一覧を更新"
  },
  "ko": {
    "title": "웹 검색 사용 가능 여부",
    "details": "사용할 수 없는 이유와 지원 모델 보기",
    "modelUnavailable": "현재 선택한 모델은 웹 검색을 지원하지 않습니다.",
    "serviceUnavailable": "현재 이 계정에서 웹 검색을 사용할 수 없습니다.",
    "loading": "모델 기능을 불러오는 중입니다. 잠시 후 다시 시도해 주세요.",
    "loadError": "모델 기능을 불러오지 못했습니다. 모델 목록을 새로 고친 후 다시 시도하세요.",
    "readOnly": "이 작업 공간은 읽기 전용이므로 모델 요청을 보낼 수 없습니다.",
    "busy": "대화 생성이 완료된 후 웹 검색을 설정해 주세요.",
    "model": "현재 모델",
    "supported": "웹 검색 지원 모델",
    "none": "현재 사용 가능한 웹 검색 지원 모델이 없습니다.",
    "useModel": "모델 선택",
    "switchHint": "모델을 변경해도 웹 검색을 켜거나 요청을 보내지 않습니다. 추가 요금 가능성을 확인한 후 웹 검색을 따로 켜세요.",
    "reload": "모델 목록 새로 고침"
  },
  "es": {
    "title": "Disponibilidad de la búsqueda web",
    "details": "Ver el motivo y los modelos compatibles",
    "modelUnavailable": "El modelo seleccionado no admite la búsqueda web.",
    "serviceUnavailable": "La búsqueda web no está disponible actualmente para esta cuenta.",
    "loading": "Se están cargando las capacidades de los modelos. Inténtalo de nuevo en breve.",
    "loadError": "No se pudieron cargar las capacidades. Actualiza la lista de modelos para reintentar.",
    "readOnly": "Este espacio es de solo lectura. No puedes enviar solicitudes al modelo aquí.",
    "busy": "Espera a que termine de crearse esta conversación antes de cambiar la búsqueda web.",
    "model": "Modelo actual",
    "supported": "Modelos con búsqueda web",
    "none": "No hay modelos con búsqueda web disponibles actualmente.",
    "useModel": "Usar modelo",
    "switchHint": "Cambiar de modelo no activa la búsqueda ni envía una solicitud. Revisa los posibles cargos y actívala por separado.",
    "reload": "Actualizar lista de modelos"
  }
};
export function chatSearchWords(language: string) {
  const code = language.toLowerCase();
  const key = code.startsWith("zh-hant") || code.startsWith("zh-tw") ? "zh-hant" : code.startsWith("zh") ? "zh" : code.startsWith("ja") ? "ja" : code.startsWith("ko") ? "ko" : code.startsWith("es") ? "es" : "en";
  return { ...copy[key], ...availability[key], charges: charges[key] };
}
