// Pure-Node image metadata scrubbing — no exiftool/ImageMagick required.
//
// JPEG: drops APPn marker segments that carry metadata (EXIF/GPS in APP1, XMP in
// APP1, IPTC/Photoshop in APP13, vendor blobs elsewhere) and COM comments, while
// KEEPING APP0 (JFIF), APP2 (ICC colour profile) and APP14 (Adobe) so colour is
// unchanged.
// PNG: drops tEXt/zTXt/iTXt/eXIf/tIME chunks.
//
// Anything else is reported as unsupported rather than silently passed through.

const JPEG_KEEP = new Set([0xe0, 0xe2, 0xee]); // APP0 JFIF, APP2 ICC, APP14 Adobe
const PNG_STRIP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function kindOf(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return 'jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(PNG_SIG)) return 'png';
  if (buf.length > 12 && buf.subarray(4, 8).toString('latin1') === 'ftyp') return 'heic-like';
  return 'unknown';
}

/** @returns {{out: Buffer, removed: string[]}} */
export function scrubJpeg(buf) {
  const removed = [];
  const chunks = [buf.subarray(0, 2)]; // SOI
  let i = 2;
  while (i + 3 < buf.length) {
    if (buf[i] !== 0xff) break; // desync — stop rewriting, keep remainder verbatim
    const marker = buf[i + 1];
    if (marker === 0xd9) break; // EOI
    if (marker === 0xda) {
      chunks.push(buf.subarray(i)); // SOS + entropy data to end
      i = buf.length;
      break;
    }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > buf.length) break;
    const seg = buf.subarray(i, i + 2 + len);
    const isApp = marker >= 0xe0 && marker <= 0xef;
    const isCom = marker === 0xfe;
    if ((isApp && !JPEG_KEEP.has(marker)) || isCom) {
      const tag = isCom ? 'COM' : `APP${marker - 0xe0}`;
      const hint = seg.subarray(4, 10).toString('latin1').replace(/[^\x20-\x7e]/g, '');
      removed.push(hint ? `${tag} (${hint.trim()})` : tag);
    } else {
      chunks.push(seg);
    }
    i += 2 + len;
  }
  if (i < buf.length) chunks.push(buf.subarray(i));
  return { out: Buffer.concat(chunks), removed };
}

/** @returns {{out: Buffer, removed: string[]}} */
export function scrubPng(buf) {
  const removed = [];
  const chunks = [buf.subarray(0, 8)];
  let i = 8;
  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.subarray(i + 4, i + 8).toString('latin1');
    const end = i + 12 + len;
    if (end > buf.length) break;
    if (PNG_STRIP.has(type)) removed.push(type);
    else chunks.push(buf.subarray(i, end));
    i = end;
    if (type === 'IEND') break;
  }
  return { out: Buffer.concat(chunks), removed };
}

export function scrub(buf) {
  const kind = kindOf(buf);
  if (kind === 'jpeg') return { kind, ...scrubJpeg(buf) };
  if (kind === 'png') return { kind, ...scrubPng(buf) };
  return { kind, out: buf, removed: [], unsupported: true };
}
