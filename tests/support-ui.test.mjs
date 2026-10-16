import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeSupport, prepareSupportImage, supportUnread, renderSupportMessages, installSupportImageViewer, supportError } from '../src/lib/support-ui.ts';
import { supportCopy } from '../src/i18n/support.ts';
import { APIError } from '../src/lib/app-http.ts';
import { InvalidSupportData, SupportSessionEnded, SupportStorageFull, MAX_SUPPORT_IMAGE_BYTES } from '../src/lib/support-store.ts';
import { MAX_SUPPORT_IMAGE_PIXELS } from '../src/lib/support-image.ts';
import { png, jpeg, webp } from './fixtures/support-images.mjs';

const copy = supportCopy('en');
function globals(t, values) {
  for (const [key, value] of Object.entries(values)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
}

test('image preparation validates bytes before decode and preserves bounded filenames', async t => {
  let reads = 0, decodes = 0, readerFails = false, decodeFails = false, width = 1, height = 1;
  class Reader {
    readAsDataURL(file) {
      reads++;
      file.arrayBuffer().then(bytes => {
        if (readerFails) { this.onerror(); return; }
        this.result = `data:${file.type};base64,${Buffer.from(bytes).toString('base64')}`;
        this.onload();
      });
    }
  }
  class DecodedImage {
    naturalWidth = width;
    naturalHeight = height;
    async decode() { decodes++; if (decodeFails) throw Error('Corrupt compressed pixels'); }
  }
  globals(t, { FileReader: Reader, Image: DecodedImage });
  for (const [bytes, type] of [[png, 'image/png'], [jpeg, 'image/jpeg'], [webp, 'image/webp']]) {
    const prepared = await prepareSupportImage(new File([bytes], 'x'.repeat(300), { type }));
    assert.equal(prepared.name.length, 255);
    assert.equal(prepared.type, type);
    assert.equal(prepared.size, bytes.length);
    assert.equal(prepared.dataUrl, `data:${type};base64,${bytes.toString('base64')}`);
  }
  assert.equal(decodes, 3);
  for (const file of [new File([png], 'unsafe.svg', { type: 'image/svg+xml' }), new File([], 'empty.png', { type: 'image/png' }), new File([new Uint8Array(MAX_SUPPORT_IMAGE_BYTES + 1)], 'large.png', { type: 'image/png' })]) {
    await assert.rejects(prepareSupportImage(file), InvalidSupportData);
  }
  assert.equal(reads, 3, 'invalid MIME and size never allocate an image reader');
  await assert.rejects(prepareSupportImage(new File(['not a PNG'], 'forged.png', { type: 'image/png' })), InvalidSupportData);
  assert.equal(decodes, 3, 'header validation happens before pixel decoding');
  readerFails = true;
  await assert.rejects(prepareSupportImage(new File([png], 'read.png', { type: 'image/png' })), InvalidSupportData);
  readerFails = false; decodeFails = true;
  await assert.rejects(prepareSupportImage(new File([png], 'pixels.png', { type: 'image/png' })), InvalidSupportData);
  decodeFails = false;
  for (const dimensions of [[0, 1], [1, 0], [MAX_SUPPORT_IMAGE_PIXELS + 1, 1]]) {
    [width, height] = dimensions;
    await assert.rejects(prepareSupportImage(new File([png], 'dimensions.png', { type: 'image/png' })), InvalidSupportData);
  }
});

test('message rendering escapes customer content and keeps receipts and unread counts specific to each viewer', () => {
  const conversation = { id: '21', user: { name: '<Customer & "name">' }, userReadAt: 200, agentReadAt: 150, messages: [
    { id: '1', sender: 'user', created: 100, text: '<script>unsafe</script>' },
    { id: '2', sender: 'agent', created: 200, text: 'Reply', image: { name: 'Proof <1>.png', dataUrl: '/api/support/attachments/1?x=1&y="2"' } },
    { id: '3', sender: 'user', created: 300, text: '', orderId: '00000000-0000-4000-8000-000000000090', orderTitle: 'Original <order>', orderAmountMicro: 1230000 },
    { id: '4', sender: 'agent', created: 400, text: 'Latest reply' },
  ] };
  assert.equal(supportUnread(conversation, 'user'), 1);
  assert.equal(supportUnread(conversation, 'agent'), 1);
  const user = renderSupportMessages(conversation, copy, 'en', 'user');
  assert.match(user, /&lt;script&gt;unsafe&lt;\/script&gt;/);
  assert.match(user, /&lt;Customer &amp; &quot;name&quot;&gt;/);
  assert.match(user, /Proof &lt;1&gt;\.png/);
  assert.match(user, /x=1&amp;y=&quot;2&quot;/);
  assert.match(user, /data-support-order="00000000-0000-4000-8000-000000000090"/);
  assert.match(user, /Original &lt;order&gt;/);
  assert.equal((user.match(/data-support-receipt/g) ?? []).length, 2);
  assert.match(user, /data-read="true"/);
  assert.match(user, /data-read="false"/);
  const agent = renderSupportMessages(conversation, copy, 'en', 'agent');
  assert.equal((agent.match(/data-support-receipt/g) ?? []).length, 2);
  assert.doesNotMatch(renderSupportMessages(conversation, copy, 'en'), /data-support-receipt/);
  assert.match(renderSupportMessages({ ...conversation, messages: [{ ...conversation.messages[2], orderAmountMicro: undefined }] }, copy, 'en'), /0\.00/);
  assert.equal(renderSupportMessages({ ...conversation, messages: [] }, copy, 'en'), '');
  assert.equal(escapeSupport(null), '');
  assert.equal(escapeSupport("&<>\"'"), '&amp;&lt;&gt;&quot;&#39;');
});

// A small DOM boundary supplies only browser operations used by this controller.
// Focus, replacement and customer changes are asserted independently of markup.
function viewerDOM(t) {
  let document;
  class Element extends EventTarget {
    constructor(tag) { super(); this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = new Map(); this.open = false; }
    setAttribute(key, value) { this.attributes.set(key, String(value)); }
    removeAttribute(key) { this.attributes.delete(key); if (key === 'src') this.src = ''; }
    append(...children) { for (const child of children) { child.remove(); child.parent = this; this.children.push(child); } }
    remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = undefined; }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    matches(selector) { return selector === this.tagName || this.attributes.has(selector.slice(1, -1)); }
    closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector); }
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    get isConnected() { return document.body.contains(this); }
    focus() { document.activeElement = this; }
    showModal() { this.open = true; }
    close() { this.open = false; }
  }
  document = { body: new Element('body'), activeElement: null, createElement: tag => new Element(tag) };
  globals(t, { document });
  const node = (tag, attribute) => { const result = new Element(tag); if (attribute) result.setAttribute(attribute, ''); return result; };
  const root = node('section'), log = node('div', 'data-support-messages'); document.body.append(root); root.append(log);
  const message = (id = '31', conversationId = '21', withImage = true) => {
    const article = node('article', 'data-support-message'); article.dataset = { messageId: id, conversationId };
    const button = node('button', 'data-support-image'), image = node('img'); image.src = '/private/proof.png'; image.alt = 'Payment proof';
    if (withImage) button.append(image); article.append(button); log.append(article);
    return { article, button, image };
  };
  const emit = (element, type, target = element, key) => {
    const event = new Event(type, { cancelable: true }); Object.defineProperty(event, 'target', { value: target });
    if (key) Object.defineProperty(event, 'key', { value: key }); element.dispatchEvent(event); return event;
  };
  return { document, root, log, message, emit, node };
}

test('private image viewer traps focus, restores its current message and removes private pixels on close', t => {
  const dom = viewerDOM(t), original = dom.message(); let closes = 0;
  const viewer = installSupportImageViewer(dom.root, copy, () => closes++), dialog = dom.document.body.querySelector('dialog');
  assert.equal(dialog.attributes.get('aria-label'), copy.imageAlt);
  dom.emit(dom.root, 'click', original.image);
  assert.equal(viewer.isOpen(), true);
  const displayed = dialog.querySelector('img'), close = dialog.querySelector('button');
  assert.equal(displayed.src, '/private/proof.png'); assert.equal(displayed.alt, 'Payment proof');
  assert.equal(dom.emit(dialog, 'keydown', dialog, 'Tab').defaultPrevented, true);
  assert.equal(dom.document.activeElement, close);
  assert.equal(dom.emit(dialog, 'keydown', dialog, 'Enter').defaultPrevented, false);
  dom.emit(dialog, 'click', displayed); assert.equal(viewer.isOpen(), true, 'clicking the image does not dismiss it');
  original.article.remove(); const refreshed = dom.message();
  assert.equal(dom.emit(dialog, 'cancel').defaultPrevented, true);
  assert.equal(viewer.isOpen(), false); assert.equal(displayed.src, ''); assert.equal(displayed.alt, '');
  assert.equal(dom.document.activeElement, refreshed.button); assert.equal(closes, 1);
  dom.emit(dom.root, 'click', refreshed.button); dom.emit(close, 'click');
  assert.equal(closes, 2); assert.equal(dom.document.activeElement, refreshed.button);
  dom.emit(dom.root, 'click', refreshed.button); dom.emit(dialog, 'click');
  assert.equal(closes, 3); assert.equal(viewer.isOpen(), false);
  viewer.dispose(); assert.equal(dialog.isConnected, false);
});

test('viewer focus restoration never crosses customer identity or targets a hidden or removed message', t => {
  const dom = viewerDOM(t), first = dom.message(), viewer = installSupportImageViewer(dom.root, copy);
  const dialog = dom.document.body.querySelector('dialog');
  dom.emit(dom.root, 'click', dom.log); assert.equal(viewer.isOpen(), false);
  const missing = dom.message('32', '21', false); dom.emit(dom.root, 'click', missing.button); assert.equal(viewer.isOpen(), false);
  const outside = dom.node('button', 'data-support-image'); outside.append(dom.node('img')); dom.emit(dom.root, 'click', outside); assert.equal(viewer.isOpen(), false);
  dom.emit(dom.root, 'click', first.button); first.article.remove(); dom.message('33', '21'); viewer.close(true);
  assert.equal(dom.document.activeElement, dom.log, 'same-customer refresh falls back to the message log');
  const active = dom.message('34', '21'); dom.emit(dom.root, 'click', active.button);
  for (const article of [...dom.log.children]) article.remove(); const foreign = dom.message('34', '22');
  dom.document.activeElement = null; viewer.close(true); assert.equal(dom.document.activeElement, null, 'same message ID in a different conversation must not receive focus');
  dom.emit(dom.root, 'click', foreign.button); foreign.article.setAttribute('hidden', ''); viewer.close(true); assert.equal(dom.document.activeElement, null);
  foreign.article.removeAttribute('hidden'); dom.emit(dom.root, 'click', foreign.button); viewer.close(); assert.equal(dom.document.activeElement, null, 'programmatic close does not steal focus');
  dom.emit(dom.root, 'click', foreign.button); viewer.dispose(); assert.equal(dialog.isConnected, false);
  dom.emit(dom.root, 'click', foreign.button); assert.equal(viewer.isOpen(), false, 'disposed controller no longer opens private images');
});

test('customer errors distinguish transport, expired identity, image validation and storage capacity', () => {
  assert.equal(supportError(new APIError(409, 'Transfer evidence changed'), copy), 'Transfer evidence changed');
  assert.equal(supportError(new SupportSessionEnded('stale'), copy), copy.sessionEnded);
  assert.equal(supportError(new SupportStorageFull('quota'), copy), copy.storageFull);
  assert.equal(supportError(new InvalidSupportData('Invalid JPEG image'), copy), copy.imageInvalid);
  assert.equal(supportError(new InvalidSupportData('Invalid message'), copy), copy.saveFailed);
  assert.equal(supportError(new Error('offline'), copy), copy.saveFailed);
  assert.equal(supportError(null, copy), copy.saveFailed);
});
