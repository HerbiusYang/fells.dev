export const LOCALES = Object.freeze(['en', 'zh', 'zh-hant', 'ja', 'ko', 'es']);

const COPY = {
  en: { title: 'Service status', normal: 'No active maintenance notice', scheduled: 'Scheduled maintenance', maintenance: 'Service maintenance', incident: 'Service interruption', recovering: 'Recovery verification', message: 'Service is temporarily unavailable. Please check this page for updates.', start: 'Started / scheduled', end: 'Estimated restoration', unknown: 'To be confirmed', updated: 'Last updated', next: 'Next update', incidentID: 'Event', status: 'View service status', refresh: 'Refresh', time: 'Times are shown in UTC.', contact: 'Contact', operational: 'There is no active maintenance notice. This page remains available during an origin outage.' },
  zh: { title: '服务状态', normal: '当前无维护公告', scheduled: '计划维护', maintenance: '服务维护中', incident: '服务暂时中断', recovering: '恢复验证中', message: '服务暂时不可用，请查看此页面获取最新进展。', start: '开始／计划时间', end: '预计恢复时间', unknown: '待确认', updated: '最近更新时间', next: '下次更新时间', incidentID: '事件编号', status: '查看服务状态', refresh: '刷新', time: '时间均以 UTC 显示。', contact: '联系方式', operational: '当前没有维护公告。源站故障期间，此页面仍可访问。' },
  'zh-hant': { title: '服務狀態', normal: '目前無維護公告', scheduled: '計畫維護', maintenance: '服務維護中', incident: '服務暫時中斷', recovering: '恢復驗證中', message: '服務暫時無法使用，請查看此頁面取得最新進展。', start: '開始／計畫時間', end: '預計恢復時間', unknown: '待確認', updated: '最近更新時間', next: '下次更新時間', incidentID: '事件編號', status: '查看服務狀態', refresh: '重新整理', time: '時間均以 UTC 顯示。', contact: '聯絡方式', operational: '目前沒有維護公告。來源站故障期間，此頁面仍可存取。' },
  ja: { title: 'サービス状況', normal: '現在メンテナンスのお知らせはありません', scheduled: 'メンテナンス予定', maintenance: 'メンテナンス中', incident: 'サービス中断', recovering: '復旧確認中', message: '現在サービスを利用できません。このページで最新情報をご確認ください。', start: '開始／予定時刻', end: '復旧予定', unknown: '確認中', updated: '最終更新', next: '次回更新', incidentID: '事象番号', status: 'サービス状況を見る', refresh: '更新', time: '時刻は UTC です。', contact: 'お問い合わせ', operational: '現在メンテナンスのお知らせはありません。このページはサーバー停止中も利用できます。' },
  ko: { title: '서비스 상태', normal: '현재 유지보수 공지 없음', scheduled: '유지보수 예정', maintenance: '유지보수 중', incident: '서비스 중단', recovering: '복구 확인 중', message: '현재 서비스를 이용할 수 없습니다. 이 페이지에서 최신 정보를 확인하세요.', start: '시작／예정 시간', end: '복구 예상 시간', unknown: '확인 중', updated: '마지막 업데이트', next: '다음 업데이트', incidentID: '이벤트 번호', status: '서비스 상태 보기', refresh: '새로고침', time: '시간은 UTC로 표시됩니다.', contact: '연락처', operational: '현재 유지보수 공지가 없습니다. 서버 중단 중에도 이 페이지를 이용할 수 있습니다.' },
  es: { title: 'Estado del servicio', normal: 'Sin aviso de mantenimiento activo', scheduled: 'Mantenimiento programado', maintenance: 'Servicio en mantenimiento', incident: 'Interrupción del servicio', recovering: 'Verificando la recuperación', message: 'El servicio no está disponible temporalmente. Consulta esta página para ver las novedades.', start: 'Inicio／hora prevista', end: 'Restablecimiento estimado', unknown: 'Por confirmar', updated: 'Última actualización', next: 'Próxima actualización', incidentID: 'Incidente', status: 'Ver estado del servicio', refresh: 'Actualizar', time: 'Las horas se muestran en UTC.', contact: 'Contacto', operational: 'No hay un aviso de mantenimiento activo. Esta página sigue disponible durante una caída del servidor.' },
};

const STYLE = ':root{color-scheme:dark;font-family:system-ui,sans-serif;background:#090b0e;color:#e8edf5}body{margin:0;min-height:100svh;display:grid;place-items:center}main{box-sizing:border-box;width:min(100%,720px);padding:40px 24px}header{display:flex;justify-content:space-between;gap:20px;align-items:center}strong{letter-spacing:.04em}h1{font-size:clamp(1.7rem,5vw,2.6rem);line-height:1.2;margin-top:36px}p{line-height:1.75;white-space:pre-wrap;overflow-wrap:anywhere;color:#b9c5d6}dl{display:grid;grid-template-columns:minmax(110px,1fr) 2fr;gap:14px 24px;padding:24px 0;border-block:1px solid #293241}dt{color:#a4b3c7}dd{margin:0;overflow-wrap:anywhere}a{color:#9bc9ff;text-underline-offset:4px}nav,footer{display:flex;gap:16px;flex-wrap:wrap;margin-top:24px}small{color:#a4b3c7}nav[aria-label]{font-size:.85rem}footer{line-height:1.7}@media(max-width:420px){dl{grid-template-columns:1fr;gap:8px}dd{margin-bottom:12px}}';
const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

export function localeFor(request) {
  const path = new URL(request.url).pathname.split('/')[1].toLowerCase();
  if (LOCALES.includes(path)) return path;
  const languages = (request.headers.get('Accept-Language') ?? '').toLowerCase().split(',').map(value => value.trim().split(';')[0]);
  for (const language of languages) {
    if (/^zh-(?:tw|hk|mo|hant)/.test(language)) return 'zh-hant';
    const short = language.split('-')[0];
    if (LOCALES.includes(short)) return short;
  }
  return 'en';
}

export async function renderPage(request, state, status = 503, contact = '') {
  const locale = localeFor(request), copy = COPY[locale];
  // A leading // pathname alone would be a cross-origin network-path link.
  const requestURL = new URL(request.url), refreshURL = requestURL.origin + requestURL.pathname;
  const time = value => value ? `<time datetime="${escape(value)}">${escape(value)}</time>` : escape(copy.unknown);
  const row = (label, value) => `<dt>${escape(label)}</dt><dd>${value}</dd>`;
  const message = state.message || (state.mode === 'normal' ? copy.operational : copy.message);
  const title = state.title || copy[state.mode];
  const contactText = typeof contact === 'string' && contact.length <= 254 ? contact : '';
  const body = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>${escape(title)} · Fells</title><style>${STYLE}</style></head><body><main><header><strong>FELLS</strong><span>${escape(copy.title)}</span></header><h1>${escape(title)}</h1><p>${escape(message)}</p><dl>${row(copy.start, time(state.starts_at))}${row(copy.end, time(state.expected_end_at))}${row(copy.updated, time(state.updated_at))}${row(copy.next, time(state.next_update_at))}${state.incident_id ? row(copy.incidentID, escape(state.incident_id)) : ''}</dl><small>${escape(copy.time)}</small><nav><a href="${escape(refreshURL)}">${escape(copy.refresh)}</a>${state.status_url ? `<a href="${escape(state.status_url)}" rel="noreferrer">${escape(copy.status)}</a>` : ''}</nav><nav aria-label="Language">${LOCALES.map(language => `<a href="${language === 'en' ? '/' : `/${language}/`}" lang="${language}" hreflang="${language}">${escape(({ en: 'English', zh: '简体中文', 'zh-hant': '繁體中文', ja: '日本語', ko: '한국어', es: 'Español' })[language])}</a>`).join('')}</nav>${contactText ? `<footer><small>${escape(copy.contact)}: ${escape(contactText)}</small></footer>` : ''}</main></body></html>`;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(STYLE)));
  const hash = btoa(String.fromCharCode(...digest));
  return new Response(request.method === 'HEAD' ? null : body, { status, headers: {
    'Content-Type': 'text/html; charset=utf-8', 'Content-Language': locale, 'Cache-Control': 'no-store',
    'Content-Security-Policy': `default-src 'none'; style-src 'sha256-${hash}'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow, noarchive', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Vary': 'Accept-Language', ...(status === 503 ? { 'X-Fells-Maintenance': '1', 'Retry-After': String(state.retry_after_seconds) } : {}),
  } });
}
