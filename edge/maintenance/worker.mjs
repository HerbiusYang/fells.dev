import { BLOCKED_MODES, CONTROL_PATH, STATUS_PATH, MaintenanceState, authorized, errorResponse, json, publicState, readSmallJSON, unavailableState } from './state.mjs';
import { renderPage } from './templates/page.mjs';

export { MaintenanceState };
const hostList = value => new Set((typeof value === 'string' ? value : '').split(',').map(host => host.trim().toLowerCase()).filter(Boolean));
const machineRequest = request => /^(?:\/api|\/v1|\/admin\/api)(?:\/|$)/.test(new URL(request.url).pathname)
  || !['GET', 'HEAD'].includes(request.method) || /(?:application\/(?:json|problem\+json)|text\/event-stream)/i.test(request.headers.get('Accept') ?? '');
const operatorPath = path => /^\/(?:zh\/|zh-hant\/|ja\/|ko\/|es\/)?support(?:\/|$)/.test(path);
const callbackPaths = new Set(['/hooks/sidecar-report', '/hooks/sidecar-direct-receipt', '/hooks/sidecar-direct-receipt-v2']);
const internalRequest = (path, value) => new Request(`https://maintenance.internal${path}`, value === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
const object = env => env.MAINTENANCE.get(env.MAINTENANCE.idFromName('global'));

export async function readState(env) {
  const response = await object(env).fetch(internalRequest('/state'));
  if (!response.ok) throw new Error('State unavailable');
  return publicState(await response.json());
}

async function control(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, { Allow: 'POST' });
  if (!await authorized(request, env.MAINTENANCE_CONTROL_TOKEN)) return json({ error: 'Unauthorized' }, 401, { 'WWW-Authenticate': 'Bearer' });
  let input;
  try { input = await readSmallJSON(request); } catch { return json({ error: 'Invalid request' }, 400); }
  try {
    const response = await object(env).fetch(internalRequest('/control', input));
    // No durable-object headers or exceptions can echo the control credential.
    return json(await response.json(), response.status);
  } catch { return json({ error: 'State unavailable' }, 503); }
}

export async function handleFetch(request, env, originFetch = fetch) {
  const url = new URL(request.url), publicHosts = hostList(env.PUBLIC_HOSTS), operatorHosts = hostList(env.OPERATOR_HOSTS);
  const statusHost = String(env.STATUS_HOST ?? '').toLowerCase(), controlHost = String(env.CONTROL_HOST ?? env.STATUS_HOST ?? '').toLowerCase();
  const allowed = publicHosts.has(url.hostname) || operatorHosts.has(url.hostname) || url.hostname === statusHost || url.hostname === controlHost;
  if (!allowed) return json({ error: 'Misdirected request' }, 421);
  if (url.pathname === CONTROL_PATH) return url.hostname === controlHost ? control(request, env) : json({ error: 'Not found' }, 404);
  // Existing node callbacks must settle journals and bills while new business
  // is closed, including when state storage is unreachable. This exact host,
  // method and path allowlist does not authenticate a node: the unchanged
  // origin handler still verifies its existing credentials and signed receipts.
  if (hostList(env.CALLBACK_HOSTS).has(url.hostname) && request.method === 'POST' && callbackPaths.has(url.pathname)) {
    try { return await originFetch(request); }
    catch { return errorResponse(unavailableState(new Date(), env.STATUS_URL ?? ''), false, true); }
  }
  // Only this exact endpoint is public. It never forwards to business services.
  if (url.pathname === STATUS_PATH && !['GET', 'HEAD'].includes(request.method)) return json({ error: 'Method not allowed' }, 405, { Allow: 'GET, HEAD' });
  let state;
  try { state = await readState(env); }
  catch { state = unavailableState(new Date(), env.STATUS_URL ?? ''); }
  if (url.pathname === STATUS_PATH) {
    const response = json(state);
    return request.method === 'HEAD' ? new Response(null, response) : response;
  }
  if (url.hostname === controlHost && controlHost !== statusHost && !publicHosts.has(url.hostname) && !operatorHosts.has(url.hostname)) return json({ error: 'Not found' }, 404);
  if (url.hostname === statusHost) {
    if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'Method not allowed' }, 405, { Allow: 'GET, HEAD' });
    if (!/^\/(?:en\/|zh\/|zh-hant\/|ja\/|ko\/|es\/)?$/.test(url.pathname)) return json({ error: 'Not found' }, 404);
    return renderPage(request, state, 200, env.CONTACT_TEXT);
  }
  // Maintenance must not make the fixed operator support entry visible on a
  // public hostname. Cloudflare Access remains ahead of configured operator hosts.
  if (!operatorHosts.has(url.hostname) && operatorPath(url.pathname)) return json({ error: 'Not found' }, 404);
  if (BLOCKED_MODES.has(state.mode)) return machineRequest(request) ? errorResponse(state, request.method === 'HEAD') : renderPage(request, state, 503, env.CONTACT_TEXT);
  try {
    // Routes (not custom domains) on public hostnames let fetch(request) reach
    // the existing origin. Preserve request body ownership and stream response;
    // never clone/read/retry an inference or transaction request.
    const response = await originFetch(request);
    // Cloudflare origin-connect failures may be HTTP responses rather than
    // thrown fetch errors. Replace only browser HTML navigations; API/vendor
    // responses, ordinary origin errors and streams keep their exact contract.
    const navigation = /text\/html/i.test(request.headers.get('Accept') ?? '');
    if (!machineRequest(request) && navigation && response.status >= 521 && response.status <= 526) {
      try { await response.body?.cancel(); } catch { /* The connection is already unavailable. */ }
      return renderPage(request, unavailableState(new Date(), env.STATUS_URL ?? ''), 503, env.CONTACT_TEXT);
    }
    return response;
  } catch {
    const transient = unavailableState(new Date(), env.STATUS_URL ?? '');
    return machineRequest(request) ? errorResponse(transient, request.method === 'HEAD', true) : renderPage(request, transient, 503, env.CONTACT_TEXT);
  }
}

export function probeConfiguration(env) {
  if (!env.ORIGIN_PROBE_URL) return null;
  const url = new URL(env.ORIGIN_PROBE_URL), forbidden = new Set([...hostList(env.PUBLIC_HOSTS), ...hostList(env.OPERATOR_HOSTS), String(env.STATUS_HOST ?? '').toLowerCase(), String(env.CONTROL_HOST ?? '').toLowerCase()]);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || forbidden.has(url.hostname)
    || url.pathname !== '/__maintenance/probe' || typeof env.ORIGIN_PROBE_TOKEN !== 'string' || env.ORIGIN_PROBE_TOKEN.length < 32) throw new Error('Invalid independent origin probe configuration');
  return url;
}

export async function runProbe(env, originFetch = fetch) {
  const url = probeConfiguration(env);
  if (!url) return;
  const before = await readState(env);
  if (['scheduled', 'maintenance'].includes(before.mode)) return;
  let healthy = false;
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 4000);
  try {
    // Workers supports manual/follow only. Keep redirects visible to the
    // strict 200 check instead of throwing before the request is dispatched.
    const response = await originFetch(url.href, { method: 'GET', headers: { Authorization: `Bearer ${env.ORIGIN_PROBE_TOKEN}`, Accept: 'text/plain', 'Cache-Control': 'no-store' }, redirect: 'manual', signal: controller.signal, cache: 'no-store' });
    // Limit response consumption as well as connection time. Never accept the
    // maintenance page, liveness "ok", a redirect or an arbitrary 200 as ready.
    if (response.status === 200 && response.headers.get('X-Fells-Maintenance') !== '1') {
      const reader = response.body?.getReader();
      if (reader) {
        let text = '', bytes = 0;
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) { healthy = text.trim() === 'ready'; break; }
            bytes += value.byteLength;
            if (bytes > 64) break;
            text += new TextDecoder().decode(value);
          }
        } finally { try { await reader.cancel(); } catch { /* Probe already failed. */ } reader.releaseLock(); }
      }
    } else { try { await response.body?.cancel(); } catch { /* Probe already failed. */ } }
  } catch { /* An unreachable origin is a failed probe, not a worker exception. */ }
  finally { clearTimeout(timeout); }
  const response = await object(env).fetch(internalRequest('/probe', { healthy, expected_revision: before.revision }));
  if (!response.ok) throw new Error('Probe state update failed');
}

export default {
  fetch(request, env) { return handleFetch(request, env); },
  async scheduled(_event, env, ctx) { ctx.waitUntil(runProbe(env)); },
};
