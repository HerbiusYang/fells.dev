import test from 'node:test';
import assert from 'node:assert/strict';
import { readSupportImageDimensions, MAX_SUPPORT_IMAGE_PIXELS } from '../src/lib/support-image.ts';
import { png, jpeg, webp, webpLossless, webpExtended, webpAnimated } from './fixtures/support-images.mjs';

const inspect = (data, type) => readSupportImageDimensions(data.toString('latin1'), type);
const changed = (fixture, mutate) => { const data = Buffer.from(fixture); mutate(data); return data; };
const sof = jpeg.indexOf(Buffer.from([0xff, 0xc0])) + 2;

test('real PNG, JPEG, VP8, VP8L and VP8X headers expose bounded dimensions', () => {
  assert.deepEqual(inspect(png, 'image/png'), { width: 1, height: 1 });
  assert.deepEqual(inspect(jpeg, 'image/jpeg'), { width: 2, height: 3 });
  for (const data of [webp, webpLossless, webpExtended, webpAnimated]) assert.deepEqual(inspect(data, 'image/webp'), { width: 2, height: 3 });
});

test('headers cannot masquerade as another allowed MIME or end before required fields', () => {
  for (const [fixture, type, required] of [[png, 'image/png', 33], [jpeg, 'image/jpeg', sof + 17], [webp, 'image/webp', webp.length], [webpLossless, 'image/webp', webpLossless.length], [webpExtended, 'image/webp', webpExtended.length]]) {
    for (let end = 0; end < required; end++) assert.equal(inspect(fixture.subarray(0, end), type), null, `${type} ends at ${end}`);
    for (const other of ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']) if (other !== type) assert.equal(inspect(fixture, other), null);
  }
});

test('PNG rejects empty/huge dimensions and invalid IHDR fields before decompression', () => {
  const invalid = [
    data => data.writeUInt32BE(0, 16), data => data.writeUInt32BE(0, 20),
    data => { data.writeUInt32BE(5001, 16); data.writeUInt32BE(5000, 20); },
    data => data.writeUInt32BE(12, 8), data => { data[12] = 0; },
    data => { data[24] = 3; }, data => { data[25] = 5; },
    data => { data[26] = 1; }, data => { data[27] = 1; }, data => { data[28] = 2; },
  ];
  for (const mutate of invalid) assert.equal(inspect(changed(png, mutate), 'image/png'), null);
  // Header-only mutation: never allocate or decode a 25-million-pixel image.
  const edge = changed(png, data => { data.writeUInt32BE(5000, 16); data.writeUInt32BE(5000, 20); });
  assert.deepEqual(inspect(edge, 'image/png'), { width: 5000, height: 5000 });
  assert.equal(5000 * 5000, MAX_SUPPORT_IMAGE_PIXELS);
});

test('JPEG bounds every marker segment and validates the SOF dimensions/components', () => {
  for (const mutate of [
    data => data.writeUInt16BE(0, sof + 3), data => data.writeUInt16BE(0, sof + 5),
    data => { data.writeUInt16BE(6000, sof + 3); data.writeUInt16BE(6000, sof + 5); },
    data => data.writeUInt16BE(0, sof), data => data.writeUInt16BE(65535, sof),
    data => { data[sof + 2] = 0; }, data => { data[sof + 7] = 0; },
    data => { data[sof + 9] = 0; }, data => { data[sof + 11] = data[sof + 8]; },
    data => { data[sof - 1] = 0xda; }, data => data.writeUInt16BE(65535, 4),
  ]) assert.equal(inspect(changed(jpeg, mutate), 'image/jpeg'), null);
  assert.equal(inspect(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), 'image/jpeg'), null);
  const paddedMarker = Buffer.concat([jpeg.subarray(0, sof - 1), Buffer.from([0xff]), jpeg.subarray(sof - 1)]);
  assert.deepEqual(inspect(paddedMarker, 'image/jpeg'), { width: 2, height: 3 });
});

test('WebP validates RIFF sizes, VP8/VP8L headers and extended canvas consistency', () => {
  for (const [fixture, mutate] of [
    [webp, data => data.writeUInt32LE(data.length, 4)], [webp, data => data.writeUInt32LE(65535, 16)],
    [webp, data => { data[20] |= 1; }], [webp, data => { data[20] |= 8; }],
    [webp, data => { data[23] = 0; }], [webp, data => data.writeUInt16LE(0, 26)],
    [webp, data => { data.writeUInt16LE(6000, 26); data.writeUInt16LE(6000, 28); }],
    [webp, data => { data[20] = 0xf0; data[21] = 0xff; data[22] = 0xff; }],
    [webpLossless, data => { data[20] = 0; }], [webpLossless, data => { data[24] |= 0x20; }],
    [webpLossless, data => data.writeUInt32LE((6000 - 1) + (6000 - 1) * 16384, 21)],
    [webpLossless, data => { data[data.length - 1] = 1; }],
    [webpExtended, data => data.writeUInt32LE(9, 16)], [webpExtended, data => { data[20] |= 0x80; }],
    [webpExtended, data => { data[21] = 1; }], [webpExtended, data => { data[24] = 0; }],
    [webpExtended, data => { data.writeUIntLE(6000 - 1, 24, 3); data.writeUIntLE(6000 - 1, 27, 3); }],
  ]) assert.equal(inspect(changed(fixture, mutate), 'image/webp'), null);
  assert.equal(inspect(Buffer.from('RIFF\x04\0\0\0WEBP', 'latin1'), 'image/webp'), null);
});

test('animated WebP frame headers stay inside the bounded canvas and chunk payload', () => {
  for (const mutate of [
    data => { data[20] = 0; }, data => data.writeUInt32LE(7, 34),
    data => data.writeUInt32LE(65535, 48), data => { data[52] = 1; },
    data => { data[58] = 2; }, data => { data[67] |= 4; },
    data => { data[77] = 3; }, data => { data[124] = 0; },
  ]) assert.equal(inspect(changed(webpAnimated, mutate), 'image/webp'), null);
});
