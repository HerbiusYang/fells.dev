// Owner decision 2026-11-18: API usage is debited at the official price, with
// no discount, for Token Plans and USD API quota alike.
const notes: Record<string, string> = {
  en: "USD quota is debited at the official price, with no discount.",
  zh: "USD 额度按官方原价扣减，不打折。",
  "zh-hant": "USD 額度按官方原價扣減，不打折。",
  ja: "USD利用枠は公式価格で差し引かれ、割引はありません。",
  ko: "USD 한도는 공식 가격으로 차감되며 할인이 없습니다.",
  es: "La cuota USD se descuenta al precio oficial, sin descuento.",
};
export function pricingDebitNoteOf(language: string): string {
  const code = language.toLowerCase();
  const key = code.startsWith("zh-hant") || code.startsWith("zh-tw") ? "zh-hant" : code.split(/[-_]/)[0];
  return notes[key] ?? notes.en;
}
