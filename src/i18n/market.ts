const en = {
  title: "Choose the capacity for your next creation.",
  intro: "Find your fit across Token Plans, monthly subscriptions and API models.",
  manage: "My plans & allowance", manageHint: "View usage, expiry and subscription settings",
  all: "All", tokens: "Token Plan", subscriptions: "Monthly subscriptions", models: "Models",
  search: "Search models or plans", categories: "Product categories",
  trial: "Trying Fells for the first time?", trialAction: "Ask about this plan",
  tokenIntro: "A fixed budget. A clear allowance.", subscriptionIntro: "Choose the share that fits your work.",
  modelIntro: "Currently offered models and list prices. Access depends on your account and client.",
  perPeriod: "/ {days} days", noRenewal: "No automatic renewal",
  bestValue: "Lowest unit price", capacity: "Conditional capacity depends on spare pool capacity.",
  rules: "Allowance is measured at official API list prices. The conditional ceiling includes the guaranteed allowance and is not guaranteed. Unused allowance expires at period end.",
  input: "Input / 1M tokens", output: "Output / 1M tokens", protocol: "Available in", model: "Model",
  noMatch: "No matching products", noMatchHint: "Try another name or clear the search.",
  clear: "Clear search", count: "{n} results", unavailable: "Catalog unavailable. Please try again later.",
};
type MarketWords = typeof en;
const words: Record<string, MarketWords> = {
  en,
  zh: {
    title: "为你的下一次创造，选好算力。", intro: "Token Plan、包月订阅与 API 模型，在这里找到适合你的方案。",
    manage: "我的套餐与额度", manageHint: "查看用量、有效期与订阅设置",
    all: "全部", tokens: "Token Plan", subscriptions: "包月订阅", models: "模型", search: "搜索模型或套餐", categories: "商品分类",
    trial: "第一次使用 Fells？", trialAction: "咨询体验方案", tokenIntro: "固定预算，清晰额度", subscriptionIntro: "按使用习惯，选择合适份额", modelIntro: "当前供应模型与调用标价；实际访问取决于账户权限及接入方式。",
    perPeriod: "/ {days} 天", noRenewal: "不自动续费", bestValue: "单价最低", capacity: "弹性额度按账号池余量开放",
    rules: "额度按官方 API 标价计量；弹性上限包含保底额度，且不保证可用。未用额度到期失效。",
    input: "输入 / 1M tokens", output: "输出 / 1M tokens", protocol: "接入方式", model: "模型", noMatch: "没有匹配的商品", noMatchHint: "试试其他名称，或清空搜索。", clear: "清空搜索", count: "{n} 项结果", unavailable: "暂无法读取目录，请稍后重试。",
  },
  "zh-hant": {
    title: "為你的下一次創造，選好算力。", intro: "Token Plan、包月訂閱與 API 模型，在這裡找到適合你的方案。",
    manage: "我的方案與額度", manageHint: "查看用量、有效期限與訂閱設定",
    all: "全部", tokens: "Token Plan", subscriptions: "包月訂閱", models: "模型", search: "搜尋模型或方案", categories: "商品分類",
    trial: "第一次使用 Fells？", trialAction: "諮詢體驗方案", tokenIntro: "固定預算，清晰額度", subscriptionIntro: "依使用習慣，選擇合適份額", modelIntro: "目前供應模型與呼叫標價；實際存取取決於帳戶權限與接入方式。",
    perPeriod: "/ {days} 天", noRenewal: "不自動續費", bestValue: "單價最低", capacity: "彈性額度依帳號池餘量開放",
    rules: "額度按官方 API 標價計量；彈性上限包含保底額度，且不保證可用。未用額度到期失效。",
    input: "輸入 / 1M tokens", output: "輸出 / 1M tokens", protocol: "接入方式", model: "模型", noMatch: "沒有符合的商品", noMatchHint: "試試其他名稱，或清除搜尋。", clear: "清除搜尋", count: "{n} 項結果", unavailable: "暫時無法讀取目錄，請稍後重試。",
  },
  ja: {
    title: "次の創造に、最適な利用枠を。", intro: "Token Plan、月額プラン、APIモデルから、用途に合うサービスを選べます。",
    manage: "プランと利用枠", manageHint: "利用状況・有効期限・契約設定を確認",
    all: "すべて", tokens: "Token Plan", subscriptions: "月額プラン", models: "モデル", search: "モデルやプランを検索", categories: "商品カテゴリー",
    trial: "Fellsを初めて使いますか？", trialAction: "体験プランを相談", tokenIntro: "予算を固定し、利用枠を明確に。", subscriptionIntro: "使い方に合うシェアを選択。", modelIntro: "提供中のモデルと定価。利用権限と対応クライアントを確認してください。",
    perPeriod: "/ {days}日", noRenewal: "自動更新なし", bestValue: "最低単価", capacity: "追加利用枠はアカウントプールの余裕に応じて利用可能です。",
    rules: "利用枠は公式API定価で計算されます。条件付き上限は保証枠を含み、利用は保証されません。未使用枠は期間終了時に失効します。",
    input: "入力 / 100万トークン", output: "出力 / 100万トークン", protocol: "利用方法", model: "モデル", noMatch: "該当する商品はありません", noMatchHint: "別の名前で検索するか、検索をクリアしてください。", clear: "検索をクリア", count: "{n}件", unavailable: "カタログを読み込めません。後でもう一度お試しください。",
  },
  ko: {
    title: "다음 창작을 위한 사용량을 선택하세요.", intro: "Token Plan, 월간 구독, API 모델 중 알맞은 서비스를 찾아보세요.",
    manage: "내 요금제 및 한도", manageHint: "사용량, 만료일, 구독 설정 확인",
    all: "전체", tokens: "Token Plan", subscriptions: "월간 구독", models: "모델", search: "모델 또는 요금제 검색", categories: "상품 분류",
    trial: "Fells가 처음이신가요?", trialAction: "체험 요금제 문의", tokenIntro: "정해진 예산, 명확한 한도.", subscriptionIntro: "사용 방식에 맞는 지분을 선택하세요.", modelIntro: "현재 제공 모델과 정가입니다. 계정 권한과 접속 방법을 확인하세요.",
    perPeriod: "/ {days}일", noRenewal: "자동 갱신 없음", bestValue: "최저 단가", capacity: "추가 한도는 계정 풀의 여유 용량에 따라 제공됩니다.",
    rules: "한도는 공식 API 정가로 계산합니다. 조건부 상한에는 보장 한도가 포함되며 이용이 보장되지 않습니다. 미사용 한도는 기간 종료 시 만료됩니다.",
    input: "입력 / 100만 토큰", output: "출력 / 100만 토큰", protocol: "접속 방법", model: "모델", noMatch: "일치하는 상품이 없습니다", noMatchHint: "다른 이름으로 검색하거나 검색을 지우세요.", clear: "검색 지우기", count: "결과 {n}개", unavailable: "목록을 불러올 수 없습니다. 나중에 다시 시도하세요.",
  },
  es: {
    title: "Elige capacidad para tu próxima creación.", intro: "Encuentra tu opción entre Token Plan, suscripciones mensuales y modelos API.",
    manage: "Mis planes y saldo", manageHint: "Ver uso, vencimiento y ajustes de suscripción",
    all: "Todo", tokens: "Token Plan", subscriptions: "Suscripciones", models: "Modelos", search: "Buscar modelos o planes", categories: "Categorías de productos",
    trial: "¿Es tu primera vez en Fells?", trialAction: "Consultar este plan", tokenIntro: "Presupuesto fijo. Cuota clara.", subscriptionIntro: "Elige la participación que necesitas.", modelIntro: "Modelos ofrecidos y precios. El acceso depende de tu cuenta y cliente.",
    perPeriod: "/ {days} días", noRenewal: "Sin renovación automática", bestValue: "Menor precio unitario", capacity: "La capacidad adicional depende de la disponibilidad del grupo.",
    rules: "La cuota se mide a precios oficiales de API. El máximo condicional incluye la cuota garantizada y no está garantizado. La cuota no utilizada caduca al terminar el período.",
    input: "Entrada / 1M tokens", output: "Salida / 1M tokens", protocol: "Acceso", model: "Modelo", noMatch: "No hay productos coincidentes", noMatchHint: "Prueba otro nombre o borra la búsqueda.", clear: "Borrar búsqueda", count: "{n} resultados", unavailable: "Catálogo no disponible. Inténtalo más tarde.",
  },
};
export function marketWordsOf(language: string): MarketWords {
  const code = language.toLowerCase();
  if (code.startsWith("zh-hant") || code.startsWith("zh-tw")) return words["zh-hant"];
  return words[code.split("-")[0]] || en;
}
