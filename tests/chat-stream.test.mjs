import test from 'node:test';
import assert from 'node:assert/strict';
import { readChatStream } from '../src/lib/chat-stream.ts';
import { InvalidState, MAX_MESSAGE } from '../src/lib/preview-state.ts';

const encode = new TextEncoder();
const event = (kind, value) => `event: ${kind}\ndata: ${JSON.stringify(value)}\n\n`;
const snapshot = (overrides = {}) => ({ seq: 0, text: '', progress: 'queued', run: { request_id: 'synthetic' }, live: true, cancel_available: false, ...overrides });
function body() {
  let writer, cancelled = false;
  const stream = new ReadableStream({ start(controller) { writer = controller; }, cancel() { cancelled = true; } });
  return { response: new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } }),
    push: value => writer.enqueue(typeof value === 'string' ? encode.encode(value) : value), end: () => writer.close(), cancelled: () => cancelled };
}

test('SSE is decoded across UTF-8 and record boundaries, including CRLF and comment heartbeats', async () => {
  const stream = body(), received = []; let chunks = 0;
  const reading = readChatStream(stream.response, value => received.push(value), undefined, () => chunks++);
  stream.push(': keepalive\r\n\r\n' + event('snapshot', snapshot()).replaceAll('\n', '\r\n'));
  const bytes = encode.encode(event('delta', { seq: 1, text: '**中文**' }));
  const cut = bytes.findIndex(value => value > 127) + 1;
  stream.push(bytes.subarray(0, cut));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(received.map(value => value.type), ['snapshot'], 'a partial UTF-8/SSE record produces no provisional text');
  stream.push(bytes.subarray(cut)); stream.push(event('terminal', { seq: 2, run: { status: 'completed' } }));
  await reading;
  assert.equal(received[1].text, '**中文**'); assert.deepEqual(received.map(value => value.type), ['snapshot', 'delta', 'terminal']);
  assert.equal(stream.cancelled(), true, 'a real terminal releases observation without waiting for HTTP EOF');
  assert.ok(chunks >= 3, 'real heartbeat bytes count as transport activity');
});

test('EOF after a valid snapshot/delta is only a disconnect, never an invented terminal', async () => {
  const stream = body(), received = [], reading = readChatStream(stream.response, value => received.push(value));
  stream.push(event('snapshot', snapshot()) + event('delta', { seq: 1, text: 'Partial answer' })); stream.end();
  await reading; assert.deepEqual(received.map(value => value.type), ['snapshot', 'delta']);
});

for (const [label, raw] of [
  ['negative seq', event('snapshot', snapshot({ seq: -1 }))],
  ['fractional seq', event('snapshot', snapshot({ seq: 1.5 }))],
  ['overflow seq', event('snapshot', snapshot({ seq: 2147483648 }))],
  ['string seq', event('snapshot', snapshot({ seq: '0' }))],
  ['unknown progress', event('snapshot', snapshot({ progress: 'SYNTHETIC_UNSAFE_VALUE' }))],
  ['non-string text', event('snapshot', snapshot({ text: null }))],
  ['oversize text', event('snapshot', snapshot({ text: 'x'.repeat(MAX_MESSAGE + 1) }))],
  ['unbound first delta', event('delta', { seq: 1, text: 'Must not render' })],
  ['unknown event', event('other', snapshot())],
  ['invalid JSON', 'event: snapshot\ndata: SYNTHETIC_DO_NOT_LEAK\n\n'],
  ['unfinished record', event('snapshot', snapshot()) + 'event: delta\ndata: {"seq":1'],
]) test(`stream rejects ${label} without exposing its raw value in the error`, async () => {
  const response = new Response(raw, { headers: { 'Content-Type': 'text/event-stream' } });
  await assert.rejects(readChatStream(response, () => {}), error => error instanceof InvalidState && !error.message.includes('SYNTHETIC_DO_NOT_LEAK') && !error.message.includes('SYNTHETIC_UNSAFE_VALUE'));
});

test('HTML maintenance pages and invalid UTF-8 are not interpreted as events', async () => {
  await assert.rejects(readChatStream(new Response('<html>maintenance</html>', { headers: { 'Content-Type': 'text/html' } }), () => {}), InvalidState);
  const response = new Response(new Uint8Array([0xff]), { headers: { 'Content-Type': 'text/event-stream' } });
  await assert.rejects(readChatStream(response, () => {}), TypeError);
});

test('event buffering is bounded even when a server never sends a line terminator', async () => {
  const response = new Response('x'.repeat(262145), { headers: { 'Content-Type': 'text/event-stream' } });
  await assert.rejects(readChatStream(response, () => {}), InvalidState);
});

test('aborting a silent observer releases its pending reader without fabricating a terminal', async () => {
  const stream = body(), controller = new AbortController(), seen = [];
  const reading = readChatStream(stream.response, value => seen.push(value), controller.signal);
  stream.push(event('snapshot', snapshot())); await new Promise(resolve => setImmediate(resolve));
  controller.abort(new DOMException('Synthetic route left', 'AbortError'));
  await assert.rejects(reading, error => error.name === 'AbortError');
  assert.equal(stream.cancelled(), true); assert.deepEqual(seen.map(value => value.type), ['snapshot']);
});
