export function publicCatalogFixture() {
  const base = { offered: true, routable: true, availability: 'available', list_priced: true, usd_in: 4250000, usd_out: 21250000, usd_cache_r: 425000, usd_cache_w: 5312500, usd_cache_w_1h: 8500000, usd_req: 12000 };
  return {
    schema_version: 1,
    token_plans: [
      { code: 'live-trial', name: 'Current Trial', currency: 'CNY', price_micro: 83000000, quota_usd_micro: 110000000, burst_usd_micro: 110000000, period_days: 14, new_user_only: true, status: 'available' },
      { code: 'live-token', name: 'Current Token', currency: 'CNY', price_micro: 731000000, quota_usd_micro: 850000000, burst_usd_micro: 1600000000, period_days: 30, new_user_only: false, status: 'available' },
    ],
    subscriptions: [
      { code: 'current-quarter', name: 'Current Quarter Seat', currency: 'CNY', price_micro: 615000000, period_days: 30, share_denominator: 4, status: 'available' },
      { code: 'current-half', name: 'Current Half Seat', currency: 'CNY', price_micro: 1095000000, period_days: 30, share_denominator: 2, status: 'sold_out' },
    ],
    models: [
      { ...base, model: 'supplied/chat', display_name: 'Supplied Chat', formats: ['openai-completions'], client_formats: { api: ['openai-completions'], claude_code: [], web_chat: ['openai-completions'] }, long_threshold: 125000, usd_in_long: 8500000, usd_out_long: 31875000, usd_cache_r_long: 850000, usd_cache_w_long: 10625000, usd_cache_w_1h_long: 17000000 },
      { ...base, model: 'supplied/native', display_name: 'Supplied Native', formats: ['anthropic-messages'], client_formats: { api: [], claude_code: ['anthropic-messages'], web_chat: [] } },
      { ...base, model: 'supplied/temporary', display_name: 'Temporarily Unavailable Supply', availability: 'temporarily_unavailable', formats: ['openai-responses'], client_formats: { api: ['openai-responses'], claude_code: [], web_chat: [] } },
      { ...base, model: 'supplied/unverified', display_name: 'Unverified Supply', availability: 'unverified', formats: ['anthropic-messages'], client_formats: { api: ['anthropic-messages'], claude_code: [], web_chat: [] } },
      { ...base, model: 'price-only/unoffered', display_name: 'Unprovided Price Only Model', offered: false, routable: false, availability: 'not_configured', usd_in: 100000, usd_out: 500000 },
      { ...base, model: 'invalid/unroutable', display_name: 'Unroutable Offer', routable: false, formats: ['openai-completions'], client_formats: { api: ['openai-completions'] } },
      { ...base, model: 'invalid/no-clients', display_name: 'No Client Offer', formats: ['openai-completions'], client_formats: { api: [], claude_code: [], web_chat: [] } },
    ],
  };
}
