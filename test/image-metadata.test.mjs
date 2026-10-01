import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kindOf, scrub } from '../scripts/lib/image-metadata.mjs';

function jpegWithExif() {
  const exifBody = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), Buffer.alloc(20, 0x11)]);
  const len = Buffer.alloc(2);
  len.writeUInt16BE(exifBody.length + 2);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), len, exifBody]);
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]), app1, app0,
    Buffer.from([0xff, 0xda, 0x00, 0x02]), Buffer.from([0x12, 0x34]),
    Buffer.from([0xff, 0xd9]),
  ]);
}

test('detects file kinds', () => {
  assert.equal(kindOf(jpegWithExif()), 'jpeg');
  assert.equal(kindOf(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])), 'png');
});

test('removes the EXIF segment from a JPEG and keeps JFIF and image data', () => {
  const { removed, out } = scrub(jpegWithExif());
  assert.match(removed.join(), /APP1/);
  assert.equal(out.includes(Buffer.from('Exif', 'latin1')), false);
  assert.deepEqual(out.subarray(0, 2), Buffer.from([0xff, 0xd8]));
  assert.ok(out.includes(Buffer.from([0xff, 0xe0])));
  assert.deepEqual(out.subarray(-2), Buffer.from([0xff, 0xd9]));
});

test('is idempotent', () => {
  assert.deepEqual(scrub(scrub(jpegWithExif()).out).removed, []);
});

test('never claims an unparseable container is clean', () => {
  const heic = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypheic', 'latin1'), Buffer.alloc(8)]);
  const r = scrub(heic);
  assert.equal(r.unsupported, true);
  assert.equal(r.kind, 'heic-like');
});

test('strips PNG text chunks', () => {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
  };
  const png = Buffer.concat([sig, chunk('IHDR', Buffer.alloc(13)), chunk('tEXt', Buffer.from('Comment\0at home', 'latin1')), chunk('IEND', Buffer.alloc(0))]);
  const { removed, out } = scrub(png);
  assert.ok(removed.includes('tEXt'));
  assert.equal(out.includes(Buffer.from('at home', 'latin1')), false);
});
