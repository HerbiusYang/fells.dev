const rows: Record<string, [string, string][]> = {
  en: [
    ['What does a monthly subscription provide?', 'It provides the service period and account share agreed in the quotation. Check the sharing ratio, usage windows and limits before confirming. After manual activation, your account shows the actual assignment and expiry.'],
    ['Which subscription tier should I choose?', 'Compare the sharing ratio, usage limits, period and price of the offered tiers against your workload. Support confirms capacity and the exact quotation before activation; a higher price alone does not establish a model or token entitlement.'],
    ['How are CNY cash, API allowance and Token Plans different?', 'CNY cash records received funds. Independent USD API allowance and a Token Plan are separate usage entitlements with their own quotas and expiry. Collection does not automatically exchange funds or activate either product; support delivers the confirmed order.'],
  ],
  zh: [
    ['包月订阅提供什么？', '提供报价约定的服务期和账号份额。确认前请核对共享比例、用量窗口和限制；客服人工开通后，账户会显示实际分配与到期时间。'],
    ['应该选择哪个订阅档位？', '按工作需求比较在售档位的共享比例、用量限制、周期与价格。客服在开通前确认名额和具体报价；价格更高本身不代表包含某个模型或固定 token 数。'],
    ['人民币现金、API 额度和 Token Plan 有何区别？', '人民币现金记录已收到的款项；独立美元 API 额度与 Token Plan 是分别有额度、有效期的用量权益。收款不会自动兑换或开通；客服按已确认订单交付。'],
  ],
  'zh-hant': [
    ['包月訂閱提供什麼？', '提供報價約定的服務期與帳號份額。確認前請核對共享比例、用量窗口與限制；客服人工開通後，帳戶會顯示實際分配及到期時間。'],
    ['應該選擇哪個訂閱檔位？', '依工作需求比較在售檔位的共享比例、用量限制、週期與價格。客服於開通前確認名額及具體報價；價格較高本身不代表包含某模型或固定 token 數。'],
    ['人民幣現金、API 額度與 Token Plan 有何區別？', '人民幣現金記錄已收到的款項；獨立美元 API 額度和 Token Plan 是各自有額度、有效期的用量權益。收款不會自動兌換或開通；客服依已確認訂單交付。'],
  ],
  ja: [
    ['月額契約には何が含まれますか？', '見積もりで合意した期間とアカウントの持ち分を提供します。確認前に共有比率、利用枠の時間帯、制限を確認してください。手動開通後、実際の割り当てと有効期限をアカウントに表示します。'],
    ['どの契約ティアを選べばよいですか？', '作業量に合わせ、提供ティアの共有比率、利用制限、期間、料金を比較してください。開通前にサポートが空きと見積もりを確認します。高額なだけでは特定モデルや固定トークン数を含むとは限りません。'],
    ['人民元残高、API利用枠、Token Planの違いは？', '人民元残高は受領した資金です。独立した米ドルAPI利用枠とToken Planは、それぞれ利用枠と有効期限を持つ別の権利です。入金だけで自動交換や開通は行われず、サポートが確認済み注文を提供します。'],
  ],
  ko: [
    ['월 구독에는 무엇이 포함되나요?', '견적에서 합의한 서비스 기간과 계정 지분을 제공합니다. 확인 전에 공유 비율, 사용량 시간대와 제한을 확인하세요. 수동 활성화 후 실제 할당과 만료일이 계정에 표시됩니다.'],
    ['어떤 구독 등급을 선택해야 하나요?', '작업량에 맞춰 제공 등급의 공유 비율, 사용 제한, 기간과 가격을 비교하세요. 활성화 전에 고객 지원이 자리와 견적을 확인합니다. 높은 가격만으로 특정 모델이나 고정 토큰 수가 포함되는 것은 아닙니다.'],
    ['위안 현금, API 한도와 Token Plan은 어떻게 다른가요?', '위안 현금은 수령한 자금을 기록합니다. 별도 달러 API 한도와 Token Plan은 각각 한도와 만료일이 있는 사용 권한입니다. 입금만으로 자동 환전되거나 활성화되지 않으며 고객 지원이 확인한 주문을 제공합니다.'],
  ],
  es: [
    ['¿Qué ofrece una suscripción mensual?', 'Ofrece el período y la parte de cuenta acordados en el presupuesto. Revisa la proporción compartida, las ventanas y los límites antes de confirmar. Tras la activación manual, la cuenta muestra la asignación y fecha de vencimiento reales.'],
    ['¿Qué nivel de suscripción debo elegir?', 'Compara proporción compartida, límites, período y precio de los niveles ofrecidos con tu carga de trabajo. Soporte confirma plazas y presupuesto antes de activar; un precio mayor no implica por sí solo un modelo o un número fijo de tokens.'],
    ['¿En qué se diferencian CNY, saldo API y Token Plans?', 'El efectivo CNY registra fondos recibidos. El saldo API USD independiente y un Token Plan son derechos de uso separados con cuotas y caducidades propias. Cobrar no cambia ni activa estos productos automáticamente; soporte entrega el pedido confirmado.'],
  ],
};
export function publicFAQExtra(code: string) { return (rows[code] ?? rows.en).map(([q, a]) => ({ q, a })); }
