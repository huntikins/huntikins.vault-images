import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkImage, kindOf, scrub } from '../scripts/lib/image-metadata.mjs';
import { chunk, DHT, DQT, EOI, exifApp1, JFIF, makeJpeg, makePng, PNG_SIG, seg, SOF0, SOS } from './fixtures.mjs';

const SOI = Buffer.from([0xff, 0xd8]);
const EXIF = Buffer.from('Exif\0\0', 'latin1');
const GPS = Buffer.from('GPSLatitude', 'latin1');

/** Never "passed with residual metadata": either rejected, or the output is provably clean. */
function assertCleanOrRejected(buf) {
  const r = scrub(buf);
  if (r.rejected || r.unsupported) {
    assert.equal(checkImage(buf).clean, false, 'a rejected input must not pass --check');
    return 'rejected';
  }
  assert.equal(r.out.includes(EXIF), false);
  assert.equal(r.out.includes(GPS), false);
  assert.equal(checkImage(r.out).clean, true);
  return 'clean';
}

test('detects file kinds', () => {
  assert.equal(kindOf(makeJpeg()), 'jpeg');
  assert.equal(kindOf(makePng()), 'png');
});

test('removes the EXIF segment from a JPEG and keeps JFIF and image data', () => {
  const { removed, out } = scrub(makeJpeg({ gps: true }));
  assert.match(removed.join(), /APP1/);
  assert.match(removed.join(), /COM/);
  assert.equal(out.includes(EXIF), false);
  assert.deepEqual(out.subarray(0, 2), SOI);
  assert.ok(out.includes(JFIF));
  assert.ok(out.includes(Buffer.from('pixels-a')));
  assert.deepEqual(out.subarray(-2), EOI);
  assert.equal(checkImage(out).clean, true);
  assert.equal(checkImage(makeJpeg({ gps: true })).clean, false);
});

test('is idempotent', () => {
  assert.deepEqual(scrub(scrub(makeJpeg({ gps: true })).out).removed, []);
});

test('never claims an unparseable container is clean', () => {
  const heic = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypheic', 'latin1'), Buffer.alloc(8)]);
  const r = scrub(heic);
  assert.equal(r.unsupported, true);
  assert.equal(r.kind, 'heic-like');
  assert.equal(checkImage(heic).clean, false);
});

test('strips PNG text chunks', () => {
  const { removed, out } = scrub(makePng({ text: true }));
  assert.ok(removed.includes('tEXt'));
  assert.equal(out.includes(Buffer.from('home', 'latin1')), false);
  assert.equal(checkImage(out).clean, true);
});

// --- the fail-open cases from the 2026-10-02 security review -----------------

test('review case: a 0xFF fill byte before APP1 is rejected, not passed through', () => {
  const buf = Buffer.concat([SOI, JFIF, Buffer.from([0xff]), exifApp1(), DQT, SOF0, DHT, SOS, Buffer.from('px'), EOI]);
  const r = scrub(buf);
  assert.match(r.rejected, /fill bytes/);
  assert.equal(assertCleanOrRejected(buf), 'rejected');
});

test('review case: a second JPEG with EXIF appended after EOI is rejected', () => {
  const second = Buffer.concat([SOI, exifApp1(), DQT, SOF0, DHT, SOS, Buffer.from('px2'), EOI]);
  const buf = Buffer.concat([makeJpeg(), second]);
  assert.match(scrub(buf).rejected, /after EOI/);
  assert.equal(assertCleanOrRejected(buf), 'rejected');
});

test('review case: a PNG eXIf chunk after IDAT is removed', () => {
  const buf = Buffer.concat([
    PNG_SIG,
    chunk('IHDR', Buffer.alloc(13)),
    chunk('IDAT', Buffer.from('px')),
    chunk('eXIf', Buffer.from('MM\0*GPSLatitude 41.8781', 'latin1')),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  const r = scrub(buf);
  assert.deepEqual(r.removed, ['eXIf']);
  assert.equal(assertCleanOrRejected(buf), 'clean');
  assert.equal(checkImage(buf).clean, false);
});

// --- other parse surprises ----------------------------------------------------

test('rejects JPEG parse surprises instead of copying the rest verbatim', () => {
  const cases = {
    'non-marker byte': Buffer.concat([SOI, JFIF, Buffer.from([0x00]), exifApp1(), DQT, SOF0, DHT, SOS, EOI]),
    'truncated segment': Buffer.concat([SOI, JFIF, exifApp1().subarray(0, 10)]),
    'bad length': Buffer.concat([SOI, Buffer.from([0xff, 0xe1, 0xff, 0xff]), Buffer.from('Exif\0\0')]),
    'unknown marker': Buffer.concat([SOI, seg(0xde, Buffer.from('xx')), DQT, SOF0, DHT, SOS, EOI]),
    'no EOI': Buffer.concat([SOI, DQT, SOF0, DHT, SOS, Buffer.from('px')]),
    'scan without a frame': Buffer.concat([SOI, DQT, DHT, SOS, Buffer.from('px'), EOI]),
    'second SOI mid-file': Buffer.concat([SOI, JFIF, SOI, exifApp1(), DQT, SOF0, DHT, SOS, EOI]),
    'padded table segment': Buffer.concat([SOI, seg(0xdb, Buffer.concat([Buffer.from([0]), Buffer.alloc(64, 1), Buffer.from('Exif\0\0GPS')])), SOF0, DHT, SOS, EOI]),
    'trailing zero padding': Buffer.concat([makeJpeg(), Buffer.alloc(4)]),
  };
  for (const [name, buf] of Object.entries(cases)) {
    assert.ok(scrub(buf).rejected, `${name} should be rejected`);
    assert.equal(checkImage(buf).clean, false, `${name} must not pass --check`);
  }
});

test('drops MPF and non-ICC APP2, keeps an ICC profile', () => {
  const icc = seg(0xe2, Buffer.from('ICC_PROFILE\0\x01\x01profile-bytes', 'latin1'));
  const mpf = seg(0xe2, Buffer.from('MPF\0II*\0rest', 'latin1'));
  const r = scrub(Buffer.concat([SOI, JFIF, icc, mpf, DQT, SOF0, DHT, SOS, Buffer.from('px'), EOI]));
  assert.ok(r.out.includes(icc));
  assert.equal(r.out.includes(mpf), false);
  assert.match(r.removed.join(), /APP2 \(MPF/);
});

test('rejects PNG parse surprises', () => {
  const good = makePng();
  const badCrc = Buffer.from(good);
  badCrc[badCrc.length - 13] ^= 0xff;
  const cases = {
    'bad CRC': badCrc,
    'data after IEND': Buffer.concat([good, Buffer.from('Exif\0\0')]),
    'truncated': good.subarray(0, good.length - 6),
    'IHDR not first': Buffer.concat([PNG_SIG, chunk('IDAT', Buffer.from('x')), chunk('IEND', Buffer.alloc(0))]),
  };
  for (const [name, buf] of Object.entries(cases)) {
    assert.ok(scrub(buf).rejected, `${name} should be rejected`);
    assert.equal(checkImage(buf).clean, false, `${name} must not pass --check`);
  }
});

test('--check finds a metadata signature even where the parser would not look', () => {
  const smuggled = Buffer.concat([SOI, JFIF, DQT, SOF0, DHT, SOS, Buffer.from('xx<x:xmpmeta GPS', 'latin1'), EOI]);
  assert.deepEqual(scrub(smuggled).removed, []);
  assert.equal(checkImage(smuggled).clean, false);
});
