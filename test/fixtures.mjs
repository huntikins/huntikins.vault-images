import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const seg = (marker, payload) => {
  const len = Buffer.alloc(2);
  len.writeUInt16BE(payload.length + 2);
  return Buffer.concat([Buffer.from([0xff, marker]), len, payload]);
};

/** A structurally valid JPEG (no real pixels) with optional GPS EXIF. `tag` varies the bytes. */
export function makeJpeg({ gps = false, tag = 'a' } = {}) {
  const parts = [Buffer.from([0xff, 0xd8]), seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0'))];
  if (gps) {
    parts.push(seg(0xe1, Buffer.from('Exif\0\0MM GPSLatitude 41.8781 GPSLongitude -87.6298 Make iPhone')));
    parts.push(seg(0xfe, Buffer.from('shot at home')));
  }
  parts.push(seg(0xda, Buffer.from(`\x01\x01\x00\x00\x3f\x00${tag}`)));
  parts.push(Buffer.from(`pixels-${tag}`), Buffer.from([0xff, 0xd9]));
  return Buffer.concat(parts);
}

const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
};

export function makePng({ text = false, tag = 'a' } = {}) {
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', Buffer.alloc(13))];
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
