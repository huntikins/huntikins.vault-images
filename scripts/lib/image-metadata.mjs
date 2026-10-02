// Pure-Node image metadata scrubbing — no exiftool/ImageMagick required.
//
// Fail closed. The file is parsed completely, segment by segment (JPEG) or
// chunk by chunk (PNG). Anything the parser does not fully understand is a
// rejection, never "keep the rest verbatim": fill bytes, unknown or misplaced
// markers, truncated segments, bad lengths or CRCs, bytes after EOI/IEND, a
// second image. A rejected file must be re-encoded from its pixels (the
// private intake does that with ImageMagick or sips) or not published.
//
// JPEG keeps only what decoding needs plus colour: SOFn, DHT, DQT, DRI, DAC,
// SOS + entropy data, EOI; APP0 only as a plain 16-byte JFIF header; APP2 only
// as ICC_PROFILE; APP14 only as the 14-byte Adobe colour transform segment.
// Every other APPn (EXIF/GPS, XMP, MPF, IPTC, vendor blobs) and COM is removed.
//
// PNG keeps an allowlist of chunks (pixels, palette, transparency and colour);
// every other chunk (tEXt/zTXt/iTXt, eXIf, tIME, vendor chunks) is removed.
//
// checkImage() is the independent backstop used by --check: the strict parse
// must find nothing to remove, and a byte search over the whole file must find
// no metadata signature.

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_KEEP = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'pHYs', 'bKGD']);
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const TABLES = new Set([0xc4, 0xdb, 0xdd, 0xcc]); // DHT, DQT, DRI, DAC

// Byte strings that only metadata carries. Long enough that entropy-coded or
// compressed pixel data will not produce them by chance.
export const METADATA_SIGNATURES = [
  'Exif\0\0',
  'http://ns.adobe.com/xap',
  '<x:xmpmeta',
  'XML:com.adobe.xmp',
  'Photoshop 3.0\0',
  'MPF\0II*\0',
  'MPF\0MM\0*',
].map((s) => Buffer.from(s, 'latin1'));

export class ImageRejectedError extends Error {
  constructor(detail) {
    super(detail);
    this.name = 'ImageRejectedError';
  }
}

const reject = (detail) => {
  throw new ImageRejectedError(detail);
};

export function kindOf(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(PNG_SIG)) return 'png';
  if (buf.length > 12 && buf.subarray(4, 8).toString('latin1') === 'ftyp') return 'heic-like';
  return 'unknown';
}

const hex = (n) => `0x${n.toString(16).padStart(2, '0')}`;
const startsWith = (seg, text) => seg.subarray(4, 4 + text.length).equals(Buffer.from(text, 'latin1'));

function describeApp(marker, seg) {
  const hint = seg.subarray(4, 14).toString('latin1').replace(/[^\x20-\x7e]/g, '').trim();
  const tag = marker === 0xfe ? 'COM' : `APP${marker - 0xe0}`;
  return hint ? `${tag} (${hint})` : tag;
}

function keepApp(marker, seg) {
  if (marker === 0xe0) return seg.length === 18 && startsWith(seg, 'JFIF\0') && seg[16] === 0 && seg[17] === 0;
  if (marker === 0xe2) return startsWith(seg, 'ICC_PROFILE\0');
  if (marker === 0xee) return seg.length === 16 && startsWith(seg, 'Adobe');
  return false;
}

/** Reject a table or frame segment whose declared length is not exactly its content. */
function checkStructure(marker, seg, at) {
  const body = seg.subarray(4);
  const bad = () => reject(`segment ${hex(marker)} at byte ${at} is malformed`);
  if (SOF.has(marker)) {
    const nf = body[5];
    if (nf === undefined || nf < 1 || body.length !== 6 + 3 * nf) bad();
    return;
  }
  if (marker === 0xdd) {
    if (body.length !== 2) bad();
    return;
  }
  if (marker === 0xcc) {
    if (body.length === 0 || body.length % 2 !== 0) bad();
    return;
  }
  let j = 0;
  while (j < body.length) {
    const info = body[j];
    if (marker === 0xdb) {
      j += 1 + 64 * (info >> 4 ? 2 : 1);
    } else {
      if (j + 17 > body.length) bad();
      let count = 0;
      for (let k = 1; k <= 16; k++) count += body[j + k];
      j += 17 + count;
    }
  }
  if (j !== body.length || body.length === 0) bad();
}

/** End offset of the entropy-coded data that starts at `i` (the offset of the next marker). */
function entropyEnd(buf, i) {
  let j = i;
  while (j < buf.length) {
    if (buf[j] !== 0xff) {
      j++;
      continue;
    }
    const next = buf[j + 1];
    if (next === undefined) reject('truncated scan data');
    if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
      j += 2;
      continue;
    }
    return j;
  }
  reject('scan data runs to the end of the file without EOI');
}

/**
 * Strictly parse a JPEG and rebuild it without metadata.
 * @returns {{out: Buffer, removed: string[]}}
 * @throws {ImageRejectedError} on anything not cleanly parsed
 */
export function scrubJpeg(buf) {
  if (kindOf(buf) !== 'jpeg') reject('not a JPEG');
  const removed = [];
  const chunks = [buf.subarray(0, 2)];
  let i = 2;
  let frames = 0;
  let scans = 0;
  for (;;) {
    if (i + 2 > buf.length) reject('truncated before EOI');
    if (buf[i] !== 0xff) reject(`expected a marker at byte ${i}, found ${hex(buf[i])}`);
    const marker = buf[i + 1];
    if (marker === 0xff) reject(`fill bytes before a marker at byte ${i}`);
    if (marker === 0xd9) {
      if (scans === 0) reject('EOI before any image data');
      chunks.push(buf.subarray(i, i + 2));
      i += 2;
      break;
    }
    if (marker === 0xd8) reject(`a second image (SOI) at byte ${i}`);
    if (i + 4 > buf.length) reject(`truncated segment ${hex(marker)} at byte ${i}`);
    const len = buf.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > buf.length) reject(`segment ${hex(marker)} at byte ${i} has a bad length`);
    const seg = buf.subarray(i, i + 2 + len);
    const isApp = marker >= 0xe0 && marker <= 0xef;
    if (isApp || marker === 0xfe) {
      if (isApp && keepApp(marker, seg)) chunks.push(seg);
      else removed.push(describeApp(marker, seg));
      i += 2 + len;
      continue;
    }
    if (SOF.has(marker)) {
      if (++frames > 1) reject('more than one frame');
      if (scans > 0) reject('frame header after scan data');
      checkStructure(marker, seg, i);
      chunks.push(seg);
      i += 2 + len;
      continue;
    }
    if (TABLES.has(marker)) {
      checkStructure(marker, seg, i);
      chunks.push(seg);
      i += 2 + len;
      continue;
    }
    if (marker === 0xda) {
      if (frames !== 1) reject('scan without a frame header');
      const components = seg[4];
      if (components === undefined || components < 1 || components > 4 || len !== 6 + 2 * components) {
        reject(`scan header at byte ${i} is malformed`);
      }
      scans++;
      const end = entropyEnd(buf, i + 2 + len);
      chunks.push(buf.subarray(i, end));
      i = end;
      continue;
    }
    reject(`unexpected marker ${hex(marker)} at byte ${i}`);
  }
  if (i !== buf.length) reject(`${buf.length - i} byte(s) after EOI (appended data or a second image)`);
  return { out: Buffer.concat(chunks), removed };
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

export function crc32(bytes) {
  let c = -1;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/**
 * Strictly parse a PNG and rebuild it from allowlisted chunks only.
 * @returns {{out: Buffer, removed: string[]}}
 * @throws {ImageRejectedError} on anything not cleanly parsed
 */
export function scrubPng(buf) {
  if (kindOf(buf) !== 'png') reject('not a PNG');
  const removed = [];
  const chunks = [buf.subarray(0, 8)];
  let i = 8;
  let first = true;
  let ended = false;
  let idatSeen = false;
  while (!ended) {
    if (i + 12 > buf.length) reject('truncated before IEND');
    const len = buf.readUInt32BE(i);
    const typeBytes = buf.subarray(i + 4, i + 8);
    const type = typeBytes.toString('latin1');
    if (!/^[A-Za-z]{4}$/.test(type)) reject(`bad chunk type at byte ${i}`);
    const end = i + 12 + len;
    if (len > 0x7fffffff || end > buf.length) reject(`chunk ${type} at byte ${i} has a bad length`);
    if (crc32(buf.subarray(i + 4, i + 8 + len)) !== buf.readUInt32BE(i + 8 + len)) {
      reject(`chunk ${type} at byte ${i} has a bad CRC`);
    }
    if (first && type !== 'IHDR') reject('IHDR is not the first chunk');
    if (!first && type === 'IHDR') reject('a second IHDR');
    first = false;
    if (type === 'IDAT') idatSeen = true;
    if (type === 'IEND') {
      if (!idatSeen) reject('IEND before any image data');
      ended = true;
    }
    if (PNG_KEEP.has(type)) chunks.push(buf.subarray(i, end));
    else removed.push(type);
    i = end;
  }
  if (i !== buf.length) reject(`${buf.length - i} byte(s) after IEND`);
  return { out: Buffer.concat(chunks), removed };
}

/**
 * Scrub one image.
 * @returns {{kind: string, out: Buffer, removed: string[]} |
 *           {kind: string, rejected: string} |
 *           {kind: string, unsupported: true}}
 */
export function scrub(buf) {
  const kind = kindOf(buf);
  if (kind !== 'jpeg' && kind !== 'png') return { kind, unsupported: true };
  try {
    return { kind, ...(kind === 'jpeg' ? scrubJpeg(buf) : scrubPng(buf)) };
  } catch (err) {
    if (err instanceof ImageRejectedError) return { kind, rejected: err.message };
    throw err;
  }
}

/** Metadata signatures found anywhere in the bytes. */
export function signaturesIn(buf) {
  return METADATA_SIGNATURES.filter((s) => buf.includes(s)).map((s) => JSON.stringify(s.toString('latin1')));
}

/**
 * The independent check: clean only if the strict parse succeeds with nothing
 * to remove AND no metadata signature appears anywhere in the file.
 * @returns {{clean: boolean, kind: string, problems: string[]}}
 */
export function checkImage(buf) {
  const r = scrub(buf);
  const problems = [];
  if (r.unsupported) problems.push(`${r.kind}: cannot be verified (only JPEG and PNG)`);
  else if (r.rejected) problems.push(`not cleanly parsed: ${r.rejected}`);
  else if (r.removed.length > 0) problems.push(`metadata present: ${r.removed.join(', ')}`);
  const sigs = signaturesIn(buf);
  if (sigs.length > 0) problems.push(`metadata signature(s) in the bytes: ${sigs.join(', ')}`);
  return { clean: problems.length === 0, kind: r.kind, problems };
}
