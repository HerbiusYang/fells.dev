export const MODES = Object.freeze(['normal', 'scheduled', 'maintenance', 'incident', 'recovering']);
export const BLOCKED_MODES = new Set(['maintenance', 'incident', 'recovering']);
export const STATUS_PATH = '/__maintenance/status';
export const CONTROL_PATH = '/__maintenance/control';
export const MAX_STATE_BYTES = 65_536;

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
const bounded = (value, length) => typeof value === 'string' && value.length <= length && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value);

export function validStatusURL(value) {
  if (value === '') return true;
  if (!bounded(value, 2048)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !value.includes('#');
  } catch { return false; }
}

export function validState(value) {
  return plain(value) && value.version === 1 && Number.isSafeInteger(value.revision) && value.revision >= 0
    && MODES.includes(value.mode) && bounded(value.incident_id, 128) && (!BLOCKED_MODES.has(value.mode) || value.incident_id.trim().length > 0) && bounded(value.title, 200) && bounded(value.message, 4000)
    && timestamp(value.updated_at) && ['starts_at', 'expected_end_at', 'next_update_at'].every(key => value[key] === null || timestamp(value[key]))
    && Number.isInteger(value.retry_after_seconds) && value.retry_after_seconds >= 1 && value.retry_after_seconds <= 3600
    && validStatusURL(value.status_url);
}

// Copy a fixed allowlist: storage and public status never echo admin credentials,
// probe URLs, arbitrary JSON keys, or internal monitoring metadata.
export function publicState(value) {
  if (!validState(value)) throw new Error('Invalid maintenance state');
  return Object.fromEntries(['version', 'revision', 'mode', 'incident_id', 'title', 'message', 'starts_at', 'expected_end_at', 'next_update_at', 'updated_at', 'retry_after_seconds', 'status_url'].map(key => [key, value[key]]));
}

export function normalState(now = new Date(), statusURL = '') {
  return {
    version: 1, revision: 0, mode: 'normal', incident_id: '', title: '', message: '',
    starts_at: null, expected_end_at: null, next_update_at: null, updated_at: now.toISOString(),
    retry_after_seconds: 60, status_url: validStatusURL(statusURL) ? statusURL : '',
  };
}

export function unavailableState(now = new Date(), statusURL = '') {
  return { ...normalState(now, statusURL), mode: 'incident', incident_id: 'edge-status-unavailable', title: 'Service temporarily unavailable', message: 'We are investigating a service interruption. Please check this page for updates.' };
}

export function json(value, status = 200, extra = {}) {
  return new Response(JSON.stringify(value), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'", ...extra,
  } });
}

export function errorResponse(state, head = false, uncertain = false) {
  const response = json({
    error: { code: state.mode === 'incident' ? 'service_unavailable' : 'service_maintenance', message: state.message || state.title || 'Service is temporarily unavailable.' },
    maintenance: state,
    // Rejection before dispatch is distinct from a connection lost after dispatch.
    ...(uncertain ? { request_result_unknown: true } : { transaction_rejected: true }),
  }, 503, { 'X-Fells-Maintenance': '1', 'Retry-After': String(state.retry_after_seconds) });
  return head ? new Response(null, response) : response;
}

export async function readSmallJSON(request) {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) throw new Error('JSON required');
  const length = request.headers.get('Content-Length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_STATE_BYTES)) throw new Error('Request too large');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('JSON required');
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_STATE_BYTES) throw new Error('Request too large');
      chunks.push(value);
    }
  } catch (error) {
    try { await reader.cancel(); } catch { /* Keep the bounded error. */ }
    throw error;
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

// Compare fixed-size digests rather than attacker-controlled string lengths.
export async function authorized(request, secret) {
  if (typeof secret !== 'string' || secret.length < 32) return false;
  const header = request.headers.get('Authorization') ?? '';
  if (!header.startsWith('Bearer ') || header.length > 4096) return false;
  const digest = async value => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  const [actual, expected] = await Promise.all([digest(header.slice(7)), digest(secret)]);
  let different = 0;
  for (let index = 0; index < actual.length; index++) different |= actual[index] ^ expected[index];
  return different === 0;
}

export class MaintenanceState {
  constructor(ctx, env) { this.storage = ctx.storage; this.env = env; }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/state') {
      return this.storage.transaction(async transaction => {
        let record = await transaction.get('state');
        if (!record) {
          record = { status: normalState(new Date(), this.env.STATUS_URL ?? ''), owner: 'manual', failures: 0, successes: 0 };
          await transaction.put('state', record);
        }
        return json(publicState(record.status));
      });
    }
    if (request.method !== 'POST' || !['/control', '/probe'].includes(url.pathname)) return json({ error: 'Not found' }, 404);
    let input;
    try { input = await readSmallJSON(request); } catch { return json({ error: 'Invalid request' }, 400); }
    return this.storage.transaction(async transaction => {
      const record = await transaction.get('state') ?? { status: normalState(new Date(), this.env.STATUS_URL ?? ''), owner: 'manual', failures: 0, successes: 0 };
      // Corrupt persisted state must not silently reopen admission.
      if (!validState(record.status)) return json({ error: 'State unavailable' }, 503);
      if (url.pathname === '/control') {
        if (!plain(input) || !Number.isSafeInteger(input.expected_revision) || input.expected_revision < 0 || !validState(input.state)) return json({ error: 'Invalid state' }, 400);
        if (input.expected_revision !== record.status.revision) return json({ error: 'Revision conflict', state: publicState(record.status) }, 409);
        if (record.status.revision >= Number.MAX_SAFE_INTEGER) return json({ error: 'Revision exhausted' }, 409);
        const status = publicState({ ...input.state, revision: record.status.revision + 1, updated_at: new Date().toISOString() });
        await transaction.put('state', { status, owner: 'manual', failures: 0, successes: 0 });
        return json(status);
      }
      if (!plain(input) || typeof input.healthy !== 'boolean') return json({ error: 'Invalid probe result' }, 400);
      // A result begun before an operator update cannot replace that update.
      if (input.expected_revision !== record.status.revision) return json(publicState(record.status));
      if (record.owner === 'manual' && record.status.mode !== 'normal') return json(publicState(record.status));
      record.failures = input.healthy ? 0 : Math.min((record.failures || 0) + 1, 3);
      record.successes = input.healthy ? Math.min((record.successes || 0) + 1, 2) : 0;
      let mode = record.status.mode;
      if (record.failures >= 3 && ['normal', 'recovering'].includes(mode)) mode = 'incident';
      if (record.successes >= 2 && mode === 'incident' && record.owner === 'monitor') mode = 'recovering';
      if (mode !== record.status.mode) {
        if (record.status.revision >= Number.MAX_SAFE_INTEGER) return json({ error: 'Revision exhausted' }, 409);
        record.status = {
          ...record.status, revision: record.status.revision + 1, mode, updated_at: new Date().toISOString(),
          incident_id: record.status.incident_id || `auto-${new Date().toISOString()}`,
          title: mode === 'recovering' ? 'Service recovery is being verified' : 'Service temporarily unavailable',
          message: mode === 'recovering' ? 'Connectivity has recovered. We are verifying the service before reopening access.' : 'We are investigating a service interruption. Please check this page for updates.',
          starts_at: record.status.starts_at || new Date().toISOString(), expected_end_at: null, next_update_at: null,
        };
        record.owner = 'monitor';
      }
      await transaction.put('state', record);
      return json(publicState(record.status));
    });
  }
}
