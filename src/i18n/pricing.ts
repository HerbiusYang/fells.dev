const notes: Record<string, string> = {
  en: "USD quota is debited at Fells unit prices; official prices are a reference. Lower unit prices let the same USD quota cover more usage.",
  zh: "USD 额度按 Fells 实际单价扣减；官方价仅供对照。单价降低后，相同 USD 额度可支持更多用量。",
  "zh-hant": "USD 額度按 Fells 實際單價扣減；官方價僅供對照。單價降低後，相同 USD 額度可支援更多用量。",
  ja: "USD利用枠はFellsの適用単価で差し引かれ、公式価格は参考値です。単価が下がると、同じUSD利用枠でより多く利用できます。",
  ko: "USD 한도는 Fells 실제 단가로 차감되며 공식 가격은 참고용입니다. 단가가 낮아지면 같은 USD 한도로 더 많이 사용할 수 있습니다.",
  es: "La cuota USD se descuenta según los precios unitarios de Fells; los precios oficiales son una referencia. Un precio menor permite más uso con la misma cuota USD.",
};
export function pricingDebitNoteOf(language: string): string {
  const code = language.toLowerCase();
  const key = code.startsWith("zh-hant") || code.startsWith("zh-tw") ? "zh-hant" : code.split(/[-_]/)[0];
  return notes[key] ?? notes.en;
}
