const en = {
  tokens: "Token Plans", subscriptions: "Monthly subscriptions", models: "Supplied models · base prices",
  intro: "Current products and model prices from the Fells catalog.",
  account: "Contact support to activate", accountNote: "Place your order with support. Support verifies payment, activates the plan and assigns the subscription.",
  loading: "Loading current products…", error: "Current products could not be loaded. Try again or view options in your account.",
  empty: "No products are currently offered in this category.", noJS: "Enable JavaScript to view the live catalog, or continue to your account.", retry: "Try again",
  days: "/ {n} days", available: "Available", soldOut: "Sold out", trial: "New customers only",
  guaranteed: "Guaranteed allowance", burst: "Maximum including burst", burstNote: "Burst capacity depends on spare upstream capacity. Unused Token Plan allowance expires at the end of the period.",
  share: "{share} share of the upstream subscription", shareNote: "Monthly usage follows the subscription’s window and weekly limits. No automatic renewal.",
  model: "Model", input: "Input", output: "Output", cache: "Cache read", cacheWrite: "Cache write · 5m", cacheWrite1h: "Cache write · 1h", long: "When the full prompt, including applicable cache tokens, exceeds {n} tokens, these rates apply to the entire request.", request: "Per request", clients: "Access", webChat: "Web chat",
  unit: "USD per million tokens; per-request charges are shown separately.",
  priceNote: "Base list prices. Your account shows applicable pricing and model permissions before use.",
  unverified: "Not yet verified", temporary: "Temporarily unavailable",
};
type Words = { [K in keyof typeof en]: string };
const copy: Record<string, Words> = {
  en,
  zh: {
    tokens: "Token Plan", subscriptions: "包月订阅", models: "已提供模型 · 基础标价", intro: "商品与模型价格来自 Fells 当前目录。",
    account: "联系客服开通", accountNote: "请联系客服下单。客服核实收款后，人工开通套餐并分配订阅。",
    loading: "正在读取当前商品…", error: "暂时无法读取当前商品，请重试或进入账户查看。", empty: "此分类当前暂无在售商品。", noJS: "启用 JavaScript 可查看实时目录，也可直接进入账户。", retry: "重试",
    days: "/ {n} 天", available: "可购买", soldOut: "当前售罄", trial: "仅限新用户",
    guaranteed: "保底额度", burst: "含弹性额度的最高上限", burstNote: "弹性额度取决于上游剩余容量；Token Plan 未用额度在当期结束后失效。",
    share: "上游订阅的 {share} 份额", shareNote: "包月用量遵循订阅的窗口与每周限制，不自动续费。",
    model: "模型", input: "输入", output: "输出", cache: "缓存读取", cacheWrite: "缓存写入 · 5 分钟", cacheWrite1h: "缓存写入 · 1 小时", long: "整笔提示词（含适用缓存）超过 {n} token 时，整笔请求按此行单价计费。", request: "每次请求", clients: "接入方式", webChat: "网页聊天",
    unit: "每百万 token · 美元；按次费用单独列出。", priceNote: "此处显示基础标价；适用价格及模型权限请在账户中确认。", unverified: "尚待验证", temporary: "暂时不可用",
  },
  "zh-hant": {
    tokens: "Token Plan", subscriptions: "包月訂閱", models: "已提供模型 · 基礎標價", intro: "商品與模型價格來自 Fells 目前目錄。",
    account: "聯絡客服開通", accountNote: "請聯絡客服下單。客服核實收款後，人工開通套餐並分配訂閱。",
    loading: "正在讀取目前商品…", error: "暫時無法讀取目前商品，請重試或進入帳戶查看。", empty: "此分類目前暫無在售商品。", noJS: "啟用 JavaScript 可查看即時目錄，也可直接進入帳戶。", retry: "重試",
    days: "/ {n} 天", available: "可購買", soldOut: "目前售罄", trial: "僅限新使用者",
    guaranteed: "保底額度", burst: "含彈性額度的最高上限", burstNote: "彈性額度取決於上游剩餘容量；Token Plan 未用額度在當期結束後失效。",
    share: "上游訂閱的 {share} 份額", shareNote: "包月用量遵循訂閱的視窗與每週限制，不自動續費。",
    model: "模型", input: "輸入", output: "輸出", cache: "快取讀取", cacheWrite: "快取寫入 · 5 分鐘", cacheWrite1h: "快取寫入 · 1 小時", long: "整筆提示詞（含適用快取）超過 {n} token 時，整筆請求按此列單價計費。", request: "每次請求", clients: "接入方式", webChat: "網頁聊天",
    unit: "每百萬 token · 美元；按次費用單獨列出。", priceNote: "此處顯示基礎標價；適用價格及模型權限請在帳戶中確認。", unverified: "尚待驗證", temporary: "暫時無法使用",
  },
  ja: {
    tokens: "Token Plan", subscriptions: "月額プラン", models: "提供モデル · 基本料金", intro: "Fells の現在のカタログに基づく商品とモデル料金です。",
    account: "サポートに申し込む", accountNote: "サポートに注文してください。入金確認後、担当者がプランを有効化し、契約を割り当てます。",
    loading: "商品を読み込み中…", error: "商品を読み込めませんでした。再試行するかアカウントで確認してください。", empty: "この分類には現在販売中の商品がありません。", noJS: "最新カタログは JavaScript を有効にするか、アカウントで確認してください。", retry: "再試行",
    days: "/ {n} 日", available: "購入可能", soldOut: "売り切れ", trial: "新規利用者限定",
    guaranteed: "保証利用枠", burst: "バーストを含む最大利用枠", burstNote: "バーストは上流の空き容量に依存します。Token Plan の未使用枠は期間終了時に失効します。",
    share: "上流サブスクリプションの {share} シェア", shareNote: "月額利用にはウィンドウと週次の制限が適用されます。自動更新はありません。",
    model: "モデル", input: "入力", output: "出力", cache: "キャッシュ読取", cacheWrite: "キャッシュ書込 · 5分", cacheWrite1h: "キャッシュ書込 · 1時間", long: "適用されるキャッシュを含むプロンプト全体が {n} トークンを超えると、リクエスト全体にこの料金が適用されます。", request: "リクエスト毎", clients: "接続方法", webChat: "ウェブチャット",
    unit: "100万トークン当たりの USD。リクエスト毎の料金は別記。", priceNote: "基本料金です。適用料金とモデル権限はアカウントで確認してください。", unverified: "未検証", temporary: "一時的に利用不可",
  },
  ko: {
    tokens: "Token Plan", subscriptions: "월간 구독", models: "제공 모델 · 기본 요금", intro: "현재 Fells 카탈로그의 상품과 모델 요금입니다.",
    account: "고객 지원에 개통 요청", accountNote: "고객 지원에 주문하세요. 입금 확인 후 담당자가 요금제를 개통하고 구독을 할당합니다.",
    loading: "현재 상품을 불러오는 중…", error: "상품을 불러오지 못했습니다. 다시 시도하거나 계정에서 확인하세요.", empty: "현재 이 분류에서 판매 중인 상품이 없습니다.", noJS: "실시간 카탈로그를 보려면 JavaScript를 켜거나 계정으로 이동하세요.", retry: "다시 시도",
    days: "/ {n}일", available: "구매 가능", soldOut: "품절", trial: "신규 사용자 전용",
    guaranteed: "보장 사용량", burst: "버스트 포함 최대 사용량", burstNote: "버스트는 업스트림 여유 용량에 따라 제공됩니다. Token Plan의 미사용량은 기간 종료 시 만료됩니다.",
    share: "업스트림 구독의 {share} 지분", shareNote: "월간 사용에는 구독의 기간별 및 주간 제한이 적용됩니다. 자동 갱신되지 않습니다.",
    model: "모델", input: "입력", output: "출력", cache: "캐시 읽기", cacheWrite: "캐시 쓰기 · 5분", cacheWrite1h: "캐시 쓰기 · 1시간", long: "해당 캐시를 포함한 전체 프롬프트가 {n} 토큰을 초과하면 요청 전체에 이 요금이 적용됩니다.", request: "요청당", clients: "접속 방식", webChat: "웹 채팅",
    unit: "백만 토큰당 USD. 요청당 요금은 별도로 표시됩니다.", priceNote: "기본 요금입니다. 적용 요금과 모델 권한은 계정에서 확인하세요.", unverified: "검증 대기", temporary: "일시적 사용 불가",
  },
  es: {
    tokens: "Token Plan", subscriptions: "Suscripciones mensuales", models: "Modelos ofrecidos · precios base", intro: "Productos y precios del catálogo actual de Fells.",
    account: "Solicitar activación a soporte", accountNote: "Haz el pedido con soporte. Tras verificar el pago, el equipo activa el plan y asigna la suscripción.",
    loading: "Cargando productos actuales…", error: "No se pudieron cargar los productos. Reintenta o consulta tu cuenta.", empty: "No hay productos a la venta en esta categoría.", noJS: "Activa JavaScript para ver el catálogo actual o entra en tu cuenta.", retry: "Reintentar",
    days: "/ {n} días", available: "Disponible", soldOut: "Agotado", trial: "Solo clientes nuevos",
    guaranteed: "Cuota garantizada", burst: "Máximo con capacidad adicional", burstNote: "La capacidad adicional depende de la capacidad libre del proveedor. La cuota Token Plan no utilizada caduca al final del período.",
    share: "Participación de {share} en la suscripción del proveedor", shareNote: "El uso mensual respeta las ventanas y límites semanales de la suscripción. Sin renovación automática.",
    model: "Modelo", input: "Entrada", output: "Salida", cache: "Lectura de caché", cacheWrite: "Escritura de caché · 5 min", cacheWrite1h: "Escritura de caché · 1 h", long: "Si el prompt completo, incluida la caché aplicable, supera {n} tokens, estas tarifas se aplican a toda la solicitud.", request: "Por solicitud", clients: "Acceso", webChat: "Chat web",
    unit: "USD por millón de tokens; los cargos por solicitud se muestran aparte.", priceNote: "Precios base. Confirma los precios aplicables y permisos en tu cuenta.", unverified: "Sin verificar", temporary: "Temporalmente no disponible",
  },
};

export function publicCatalogWordsOf(language: string): Words {
  const locale = language.toLowerCase();
  return copy[locale === "zh-cn" ? "zh" : locale === "zh-tw" ? "zh-hant" : locale] ?? en;
}
