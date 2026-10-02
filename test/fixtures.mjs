import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { crc32 } from '../scripts/lib/image-metadata.mjs';

export const seg = (marker, payload) => {
  const len = Buffer.alloc(2);
  len.writeUInt16BE(payload.length + 2);
  return Buffer.concat([Buffer.from([0xff, marker]), len, Buffer.from(payload)]);
};

export const JFIF = seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1'));
export const DQT = seg(0xdb, Buffer.concat([Buffer.from([0x00]), Buffer.alloc(64, 1)]));
export const SOF0 = seg(0xc0, Buffer.from([0x08, 0x00, 0x08, 0x00, 0x08, 0x01, 0x01, 0x11, 0x00]));
export const DHT = seg(0xc4, Buffer.concat([Buffer.from([0x00, 0x01]), Buffer.alloc(15, 0), Buffer.from([0x00])]));
export const SOS = seg(0xda, Buffer.from([0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]));
export const EOI = Buffer.from([0xff, 0xd9]);
export const exifApp1 = (text = 'GPSLatitude 41.8781 GPSLongitude -87.6298 Make iPhone') =>
  seg(0xe1, Buffer.from(`Exif\0\0MM\0*${text}`, 'latin1'));

/** A structurally valid baseline JPEG (no real pixels) with optional GPS EXIF. `tag` varies the bytes. */
export function makeJpeg({ gps = false, tag = 'a' } = {}) {
  const parts = [Buffer.from([0xff, 0xd8]), JFIF];
  if (gps) {
    parts.push(exifApp1());
    parts.push(seg(0xfe, Buffer.from('shot at home')));
  }
  parts.push(DQT, SOF0, DHT, SOS, Buffer.from(`pixels-${tag}`), EOI);
  return Buffer.concat(parts);
}

export const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

export const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function makePng({ text = false, tag = 'a' } = {}) {
  const parts = [PNG_SIG, chunk('IHDR', Buffer.alloc(13))];
  if (text) parts.push(chunk('tEXt', Buffer.from('Location\0home')));
  parts.push(chunk('IDAT', Buffer.from(tag)), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

export function makeHeic() {
  return Buffer.concat([Buffer.alloc(4), Buffer.from('ftypheic'), Buffer.alloc(16)]);
}

export function tmpRepo() {
  const root = mkdtempSync(join(tmpdir(), 'vault-images-'));
  mkdirSync(join(root, 'intake'));
  mkdirSync(join(root, 'images'));
  return root;
}

export function put(root, rel, bytes) {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, bytes);
}
