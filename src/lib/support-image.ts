export const MAX_SUPPORT_IMAGE_PIXELS = 25_000_000;
type Dimensions = { width: number; height: number };

const dimensions = (width: number, height: number): Dimensions | null =>
  width > 0 && height > 0 && width <= MAX_SUPPORT_IMAGE_PIXELS / height ? { width, height } : null;

// Metadata preflight only; compressed pixels still need the browser's decoder.
// PNG IHDR: https://www.w3.org/TR/png/#11IHDR
function png(data: string): Dimensions | null {
  if (data.length < 33 || !data.startsWith("\x89PNG\r\n\x1a\n") || data.slice(12, 16) !== "IHDR") return null;
  const byte = (at: number) => data.charCodeAt(at);
  const uint32 = (at: number) => byte(at) * 0x1000000 + byte(at + 1) * 0x10000 + byte(at + 2) * 0x100 + byte(at + 3);
  const depths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
  if (uint32(8) !== 13 || !depths[byte(25)]?.includes(byte(24)) || byte(26) !== 0 || byte(27) !== 0 || byte(28) > 1) return null;
  return dimensions(uint32(16), uint32(20));
}

// JPEG marker segments / SOF: ITU T.81, B.1.1.4 and B.2.2.
// https://www.w3.org/Graphics/JPEG/itu-t81.pdf
function jpeg(data: string): Dimensions | null {
  if (!data.startsWith("\xff\xd8")) return null;
  const byte = (at: number) => data.charCodeAt(at);
  const uint16 = (at: number) => byte(at) * 256 + byte(at + 1);
  let at = 2;
  while (at < data.length) {
    if (byte(at++) !== 0xff) return null;
    while (at < data.length && byte(at) === 0xff) at++;
    if (at >= data.length) return null;
    const marker = byte(at++);
    if (marker === 0x01) continue;
    if (marker === 0 || marker >= 0xd0 && marker <= 0xda || at + 2 > data.length) return null;
    const length = uint16(at), end = at + length;
    if (length < 2 || end > data.length) return null;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (length < 11) return null;
      const precision = byte(at + 2), components = byte(at + 7);
      const lossless = [0xc3, 0xc7, 0xcb, 0xcf].includes(marker);
      if (!components || length !== 8 + 3 * components || (marker === 0xc0 ? precision !== 8 : lossless ? precision < 2 || precision > 16 : ![8, 12].includes(precision))) return null;
      const ids = new Set<number>();
      for (let component = at + 8; component < end; component += 3) {
        const sampling = byte(component + 1), table = byte(component + 2);
        if (ids.has(byte(component)) || !(sampling >> 4) || sampling >> 4 > 4 || !(sampling & 15) || (sampling & 15) > 4 || table > (lossless ? 0 : 3)) return null;
        ids.add(byte(component));
      }
      // Reject DNL's initially unknown height rather than decoding an unbounded image.
      return dimensions(uint16(at + 5), uint16(at + 3));
    }
    at = end;
  }
  return null;
}

// RIFF/VP8X/ANMF: https://developers.google.com/speed/webp/docs/riff_container
// VP8 key frame: https://datatracker.ietf.org/doc/html/rfc6386#section-9.1
// VP8L: https://developers.google.com/speed/webp/docs/webp_lossless_bitstream_specification
function webp(data: string): Dimensions | null {
  if (data.length < 20 || !data.startsWith("RIFF") || data.slice(8, 12) !== "WEBP") return null;
  const byte = (at: number) => data.charCodeAt(at);
  const uint16 = (at: number) => byte(at) + byte(at + 1) * 256;
  const uint24 = (at: number) => uint16(at) + byte(at + 2) * 0x10000;
  const uint32 = (at: number) => uint24(at) + byte(at + 3) * 0x1000000;
  if (uint32(4) + 8 !== data.length) return null;
  function chunk(at: number, limit: number) {
    if (at + 8 > limit) return null;
    const size = uint32(at + 4), start = at + 8, end = start + size, next = end + (size & 1);
    if (next > limit || size % 2 && byte(end) !== 0) return null;
    return { kind: data.slice(at, at + 4), size, start, end, next };
  }
  function bitstream(kind: string, start: number, size: number): Dimensions | null {
    if (kind === "VP8 ") {
      if (size < 10 || data.slice(start + 3, start + 6) !== "\x9d\x01\x2a") return null;
      const tag = uint24(start), partition = tag >>> 5;
      if (tag & 1 || ((tag >>> 1) & 7) > 3 || !(tag & 16) || !partition || partition > size - 10) return null;
      return dimensions(uint16(start + 6) & 0x3fff, uint16(start + 8) & 0x3fff);
    }
    if (kind === "VP8L") {
      if (size < 5 || byte(start) !== 0x2f) return null;
      const header = uint32(start + 1);
      return header >>> 29 ? null : dimensions((header & 0x3fff) + 1, ((header >>> 14) & 0x3fff) + 1);
    }
    return null;
  }
  function frame(start: number, end: number, expected: Dimensions): boolean {
    let found = false;
    while (start < end) {
      const part = chunk(start, end);
      if (!part) return false;
      if (part.kind === "VP8 " || part.kind === "VP8L") {
        const size = bitstream(part.kind, part.start, part.size);
        if (found || !size || size.width !== expected.width || size.height !== expected.height) return false;
        found = true;
      } else if (part.kind !== "ALPH" || found) return false;
      start = part.next;
    }
    return found;
  }
  let at = 12, canvas: Dimensions | null = null, image: Dimensions | null = null, animated = false, animationHeader = false, frames = 0;
  while (at < data.length) {
    const part = chunk(at, data.length);
    if (!part) return null;
    if (at === 12 && part.kind !== "VP8X" && part.kind !== "VP8 " && part.kind !== "VP8L") return null;
    if (part.kind === "VP8X") {
      if (at !== 12 || part.size !== 10 || byte(part.start) & 0xc1 || uint24(part.start + 1)) return null;
      canvas = dimensions(uint24(part.start + 4) + 1, uint24(part.start + 7) + 1);
      if (!canvas) return null;
      animated = Boolean(byte(part.start) & 2);
    } else if (part.kind === "VP8 " || part.kind === "VP8L") {
      if (image || animated) return null;
      image = bitstream(part.kind, part.start, part.size);
      if (!image || canvas && (canvas.width !== image.width || canvas.height !== image.height)) return null;
    } else if (part.kind === "ANIM") {
      if (!animated || animationHeader || part.size !== 6 || frames) return null;
      animationHeader = true;
    } else if (part.kind === "ANMF") {
      if (!canvas || !animated || !animationHeader || part.size < 16 || byte(part.start + 15) & 0xfc) return null;
      const size = dimensions(uint24(part.start + 6) + 1, uint24(part.start + 9) + 1);
      if (!size || uint24(part.start) * 2 + size.width > canvas.width || uint24(part.start + 3) * 2 + size.height > canvas.height || !frame(part.start + 16, part.end, size)) return null;
      frames++;
    }
    at = part.next;
  }
  return animated ? animationHeader && frames ? canvas : null : image;
}

export function readSupportImageDimensions(data: string, type: string): Dimensions | null {
  return type === "image/png" ? png(data) : type === "image/jpeg" ? jpeg(data) : type === "image/webp" ? webp(data) : null;
}
