// The maintenance document does not load the application bundle. Its only
// interactive action retries the revocation already requested on this device.
export function installLogoutRetry() {
  const panel = document.getElementById('pending-logout');
  const operator = panel.dataset.audience === 'operator';
  const key = operator ? 'fells.operator.pending-logout.v1' : 'fells.customer.logout.v1';
  const button = panel.querySelector('button'), info = panel.querySelector('p');
  const cookieName = operator ? '__Host-fells-pending-operator-logout' : '__Host-fells-pending-logout';
  const records = () => {
    const items = [];
    for (const name of ['localStorage', 'sessionStorage']) {
      try {
        const value = JSON.parse(window[name].getItem(key));
        if (value) items.push({ name, value });
      } catch { /* Storage may be disabled. */ }
    }
    try {
      const cookie = document.cookie.split('; ').find(entry => entry.startsWith(cookieName + '='));
      const value = cookie && JSON.parse(decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1)));
      if (value && typeof value === 'object') items.push({ name: 'cookie', value });
    } catch { /* Optional fallback. */ }
    if (!operator) items.sort((a, b) => b.value.at - a.value.at || Number(!!a.value.identity) - Number(!!b.value.identity));
    return items;
  };
  const fingerprint = value => operator ? value?.fingerprint : value?.identity?.sessionId;
  const record = records()[0]?.value;
  const owner = operator ? record?.id : record?.identity?.userId;
  const session = fingerprint(record);
  if (!/^[1-9]\d{0,18}$/.test(String(owner)) || !/^[a-f0-9]{64}$/.test(session)) return;
  panel.hidden = false;
  button.onclick = async () => {
    if (fingerprint(records()[0]?.value) !== session) { panel.hidden = true; return; }
    button.disabled = true;
    const headers = operator ? {
      'X-Fells-Support-Audience': 'operator', 'X-Fells-Expected-Operator': String(owner),
      'X-Fells-Expected-Operator-Session': session, 'Content-Type': 'application/json',
    } : { 'X-Fells-Expected-User': String(owner), 'X-Fells-Expected-Session': session };
    try {
      const res = await fetch(operator ? '/api/support/session' : '/api/app/session', {
        method: 'DELETE', headers, ...(operator ? { body: '{}' } : {}), credentials: 'same-origin',
        referrerPolicy: 'strict-origin', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000),
      });
      const body = await res.json();
      const code = body?.error?.code ?? body?.code;
      const changed = res.status === 401 && code === 'session_changed';
      const ended = operator && res.status === 401 && code === 'operator_session_ended';
      if (!changed && !ended && !(res.ok && body?.ok === true && (!operator || body.data === null))) return;
      if (fingerprint(records()[0]?.value) !== session) { panel.hidden = true; return; }
      const finished = JSON.stringify({ at: record.at, changed });
      for (const { name, value } of records()) {
        if (fingerprint(value) !== session) continue;
        if (name === 'cookie') continue;
        else if (operator) window[name].removeItem(key);
        else window[name].setItem(key, finished);
      }
      document.cookie = cookieName + '=; Path=/; Secure; SameSite=Strict; Max-Age=0';
      const redirect = !changed && record.authMethod === 'access' ? '/cdn-cgi/access/logout' : '/admin/';
      try {
        const channel = new BroadcastChannel('fells.session.changed');
        channel.postMessage(operator ? { audience: 'operator', redirect } : { audience: 'customer', logoutRecord: finished });
        channel.close();
      } catch { /* Storage events also notify open application pages. */ }
      button.hidden = true;
      info.textContent = changed ? panel.dataset.changed : panel.dataset.done;
      if (operator && redirect === '/cdn-cgi/access/logout') location.replace(redirect);
    } catch { /* The same bound request remains available for retry. */ }
    finally { button.disabled = false; }
  };
}

const words = {
  en: ['Retry sign-out', 'Server sign-out is pending.', 'Signed out.', 'The original session is no longer active.'],
  zh: ['重试退出', '服务器尚未确认退出。', '已退出。', '原会话已失效。'],
  'zh-hant': ['重試登出', '伺服器尚未確認登出。', '已登出。', '原工作階段已失效。'],
  ja: ['ログアウトを再試行', 'ログアウトの確認待ちです。', 'ログアウトしました。', '元のセッションは終了しました。'],
  ko: ['로그아웃 다시 시도', '로그아웃 확인을 기다리고 있습니다.', '로그아웃했습니다.', '이전 세션이 종료되었습니다.'],
  es: ['Reintentar el cierre de sesión', 'Falta confirmar el cierre de sesión.', 'Sesión cerrada.', 'La sesión original ha terminado.'],
};

export function logoutPanel(locale, audience) {
  const [retry, pending, done, changed] = words[locale];
  return `<section id="pending-logout" hidden data-audience="${audience}" data-done="${done}" data-changed="${changed}"><p role="status">${pending}</p><button type="button">${retry}</button></section>`;
}
