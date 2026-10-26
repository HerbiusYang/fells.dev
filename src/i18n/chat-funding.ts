const copy = {
  en: {
    balance: "Account API balance", details: "How charges work", title: "Conversation charges",
    plan: "Token Plan available now", compensation: "Compensation USD", independent: "12-month USD allowance", wallet: "View plans & credits",
    order: "Calls use Token Plan guaranteed quota first, then burst capacity when available, compensation, and finally 12-month USD allowance. Gift USD is used before purchased USD.",
    limits: "Burst availability is checked when the request is settled. Any remainder uses the following balances. Actual usage is billed at the model price and service tier; a final request can exceed the remaining balance.",
    account: "The person sending the message pays from this account. CNY wallets and monthly subscriptions do not pay for these conversations. No personal API key is needed.",
  },
  zh: {
    balance: "账户 API 可用额度", details: "扣费说明", title: "对话如何扣费",
    plan: "Token Plan 当前可用", compensation: "补偿美元额度", independent: "12 个月美元额度", wallet: "查看套餐与额度",
    order: "依次使用 Token Plan 保底、有余量时的弹性、补偿额度，最后使用 12 个月美元额度；赠送美元先于购买所得美元扣除。",
    limits: "弹性额度在请求结算时判断，不足部分继续使用后续额度。按实际用量、模型价格和服务档位计费；最后一笔请求可能超出剩余额度。",
    account: "由发送消息的当前账户付款。人民币钱包和包月订阅不直接支付这些对话，无需个人 API Key。",
  },
  "zh-hant": {
    balance: "帳戶 API 可用額度", details: "扣費說明", title: "對話如何扣費",
    plan: "Token Plan 目前可用", compensation: "補償美元額度", independent: "12 個月美元額度", wallet: "查看方案與額度",
    order: "依序使用 Token Plan 保底、有餘量時的彈性、補償額度，最後使用 12 個月美元額度；贈送美元先於購買所得美元扣除。",
    limits: "彈性額度在請求結算時判斷，不足部分繼續使用後續額度。依實際用量、模型價格和服務級別計費；最後一筆請求可能超出剩餘額度。",
    account: "由傳送訊息的目前帳戶付款。人民幣錢包和包月訂閱不直接支付這些對話，無需個人 API Key。",
  },
  ja: {
    balance: "アカウントAPI残高", details: "課金の仕組み", title: "会話の課金",
    plan: "現在利用可能なToken Plan", compensation: "補償USD利用枠", independent: "12か月のUSD利用枠", wallet: "プランとクレジットを確認",
    order: "Token Planの保証枠、利用可能な追加枠、補償枠、12か月のUSD利用枠の順に使います。付与されたUSDは購入したUSDより先に消費します。",
    limits: "追加枠の可用性はリクエスト精算時に判定し、不足分は後続の残高を使います。実際の使用量、モデル価格、サービス階層で課金し、最後のリクエストは残高を超える場合があります。",
    account: "送信者の現在のアカウントが支払います。CNYウォレットや月額プランからは支払いません。個人APIキーは不要です。",
  },
  ko: {
    balance: "계정 API 잔액", details: "요금 안내", title: "대화 요금",
    plan: "현재 사용 가능한 Token Plan", compensation: "보상 USD 한도", independent: "12개월 USD 한도", wallet: "요금제 및 크레딧 보기",
    order: "Token Plan 보장 한도, 이용 가능한 추가 한도, 보상 한도, 12개월 USD 한도 순으로 사용합니다. 무료로 받은 USD를 구매한 USD보다 먼저 차감합니다.",
    limits: "추가 한도는 요청 정산 시 이용 가능 여부를 확인하며 부족한 금액은 다음 잔액에서 차감합니다. 실제 사용량, 모델 가격, 서비스 등급으로 계산하며 마지막 요청이 남은 잔액을 초과할 수 있습니다.",
    account: "메시지를 보낸 현재 계정에서 결제합니다. CNY 지갑과 월간 구독에서는 대화 요금을 차감하지 않습니다. 개인 API 키는 필요하지 않습니다.",
  },
  es: {
    balance: "Saldo API de la cuenta", details: "Cómo se cobra", title: "Cobro de conversaciones",
    plan: "Token Plan disponible ahora", compensation: "Cuota compensatoria en USD", independent: "Cuota USD de 12 meses", wallet: "Ver planes y créditos",
    order: "Las llamadas consumen primero la cuota garantizada de Token Plan, después la capacidad adicional disponible, la cuota compensatoria y por último la cuota USD de 12 meses. Los USD regalados se consumen antes que los comprados.",
    limits: "La capacidad adicional se comprueba al liquidar la solicitud. El resto usa los siguientes saldos. El uso real se cobra según el precio del modelo y el nivel de servicio; una última solicitud puede superar el saldo restante.",
    account: "Paga la cuenta de la persona que envía el mensaje. Las carteras CNY y las suscripciones mensuales no pagan estas conversaciones. No se necesita una clave API personal.",
  },
};

export function chatFundingWordsOf(language: string) {
  const code = language.toLowerCase();
  if (code.startsWith("zh-hant") || code.startsWith("zh-tw")) return copy["zh-hant"];
  if (code.startsWith("zh")) return copy.zh;
  if (code.startsWith("ja")) return copy.ja;
  if (code.startsWith("ko")) return copy.ko;
  if (code.startsWith("es")) return copy.es;
  return copy.en;
}
