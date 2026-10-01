import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ingest, renderReport } from '../scripts/lib/ingest.mjs';
import { scanImages } from '../scripts/lib/image-index.mjs';
import { scrub } from '../scripts/lib/image-metadata.mjs';
import { hash8, parseIntakeName } from '../scripts/lib/image-naming.mjs';
import { makeHeic, makeJpeg, makePng, put, tmpRepo } from './fixtures.mjs';

const readIndex = (root) => JSON.parse(readFileSync(join(root, 'index.json'), 'utf8'));

test('strips GPS EXIF and publishes under a content-hash name', () => {
  const root = tmpRepo();
  const original = makeJpeg({ gps: true });
  put(root, 'intake/INV-0001-front.jpg', original);

  const out = ingest(root);
  assert.equal(out.ok, true);
  const [r] = out.results;
  const bytes = readFileSync(join(root, r.path));
  assert.equal(scrub(bytes).removed.length, 0);
  assert.ok(!bytes.includes('GPSLatitude'));
  assert.ok(!bytes.includes('iPhone'));
  assert.equal(r.path, `images/INV-0001/front-${hash8(bytes)}.jpg`);
  assert.notEqual(hash8(bytes), hash8(original));
  assert.equal(existsSync(join(root, 'intake/INV-0001-front.jpg')), false);
  assert.deepEqual(readIndex(root), { 'INV-0001': { front: r.path } });
});

test('hash changes when the bytes change, and not when only metadata differs', () => {
  const root = tmpRepo();
  put(root, 'intake/INV-0001-front.jpg', makeJpeg({ tag: 'a' }));
  const a = ingest(root).results[0].path;
  put(root, 'intake/INV-0001-front.jpg', makeJpeg({ tag: 'b' }));
  const b = ingest(root).results[0].path;
  assert.notEqual(a, b);

  put(root, 'intake/INV-0001-front.jpg', makeJpeg({ tag: 'b', gps: true }));
  assert.equal(ingest(root).results[0].path, b);
});

test('replacing a view removes the old file and updates the index', () => {
  const root = tmpRepo();
  put(root, 'intake/INV-0001-front.jpg', makeJpeg({ tag: 'a' }));
  put(root, 'intake/INV-0001-back.jpg', makeJpeg({ tag: 'x' }));
  ingest(root);
  const before = readIndex(root)['INV-0001'];

  put(root, 'intake/INV-0001-front.jpg', makeJpeg({ tag: 'b' }));
  const out = ingest(root);
  assert.equal(out.ok, true);
  assert.deepEqual(out.results[0].replaced, [before.front]);
  assert.equal(existsSync(join(root, before.front)), false);
  const after = readIndex(root)['INV-0001'];
  assert.notEqual(after.front, before.front);
  assert.equal(after.back, before.back);
  assert.equal(readdirSync(join(root, 'images/INV-0001')).length, 2);
});

test('bad names are reported, not ingested, and nothing changes', () => {
  const root = tmpRepo();
  put(root, 'intake/INV-0001-front.jpg', makeJpeg());
  put(root, 'intake/IMG_1234.JPG', makeJpeg());
  put(root, 'intake/HV-RS-0001-front.jpg', makeJpeg());
  put(root, 'intake/INV-0002-front.heic', makeHeic());
  put(root, 'intake/INV-0003-front.jpg', makeHeic());
  put(root, 'intake/INV-0004-back.jpg', makeJpeg());

  const out = ingest(root);
  assert.equal(out.ok, false);
  assert.equal(out.problems.length, 5);
  assert.match(out.problems.join('\n'), /IMG_1234\.JPG/);
  assert.match(out.problems.join('\n'), /heic/);
  assert.match(out.problems.join('\n'), /INV-0004: no 'front' photo/);
  assert.ok(existsSync(join(root, 'intake/INV-0001-front.jpg')));
  assert.deepEqual(readdirSync(join(root, 'images')), []);
  assert.equal(existsSync(join(root, 'index.json')), false);
  assert.match(renderReport(out), /nothing was published/);
});

test('rejects duplicate views in one batch, accepts subfolders, .jpeg and upper-case names', () => {
  const root = tmpRepo();
  put(root, 'intake/INV-0001-front.jpg', makeJpeg());
  put(root, 'intake/group/INV-0001-front.png', makePng());
  assert.equal(ingest(root).ok, false);

  const ok = tmpRepo();
  put(ok, 'intake/group-a/INV-0010-FRONT.JPEG', makeJpeg());
  put(ok, 'intake/group-a/INV-0010-back.png', makePng({ text: true }));
  const out = ingest(ok);
  assert.equal(out.ok, true);
  assert.deepEqual(Object.keys(readIndex(ok)['INV-0010']), ['front', 'back']);
  assert.match(readIndex(ok)['INV-0010'].back, /\.png$/);
  assert.equal(existsSync(join(ok, 'intake/group-a')), false);
  assert.ok(existsSync(join(ok, 'intake')));
});

test('index.json contains nothing but id -> view -> path, sorted in attach order', () => {
  const root = tmpRepo();
  for (const name of ['INV-0012-back', 'INV-0002-detail-2', 'INV-0002-front', 'INV-0002-zzz', 'INV-0002-back', 'INV-10000-front', 'INV-0012-front']) {
    put(root, `intake/${name}.jpg`, makeJpeg({ tag: name }));
  }
  assert.equal(ingest(root).ok, true);
  const index = readIndex(root);
  assert.deepEqual(Object.keys(index), ['INV-0002', 'INV-0012', 'INV-10000']);
  assert.deepEqual(Object.keys(index['INV-0002']), ['front', 'back', 'detail-2', 'zzz']);
  for (const views of Object.values(index)) {
    for (const [view, path] of Object.entries(views)) {
      assert.equal(typeof path, 'string');
      assert.match(path, new RegExp(`^images/INV-\\d+/${view}-[0-9a-f]{8}\\.(jpg|png)$`));
    }
  }
  const text = readFileSync(join(root, 'index.json'), 'utf8');
  assert.ok(!/price|cost|note|\$/i.test(text));
});

test('is idempotent: a second run with an empty intake changes nothing', () => {
  const root = tmpRepo();
  put(root, 'intake/INV-0001-front.jpg', makeJpeg({ gps: true }));
  ingest(root);
  const first = ['index.json', 'index.html', 'sitemap.xml'].map((f) => readFileSync(join(root, f), 'utf8'));
  const out = ingest(root);
  assert.equal(out.ok, true);
  assert.deepEqual(out.results, []);
  assert.deepEqual(['index.json', 'index.html', 'sitemap.xml'].map((f) => readFileSync(join(root, f), 'utf8')), first);
  assert.deepEqual(scanImages(root).problems, []);
});

test('re-uploading identical bytes is a no-op replacement', () => {
  const root = tmpRepo();
  put(root, 'intake/INV-0001-front.jpg', makeJpeg());
  const a = ingest(root).results[0].path;
  put(root, 'intake/INV-0001-front.jpg', makeJpeg());
  const out = ingest(root);
  assert.equal(out.results[0].path, a);
  assert.deepEqual(out.results[0].replaced, []);
});

test('a hash that does not match the file contents is a validation problem', () => {
  const root = tmpRepo();
  put(root, 'images/INV-0001/front-deadbeef.jpg', makeJpeg());
  assert.match(scanImages(root).problems[0], /hash in the name does not match/);
});

test('report lists public URLs', () => {
  const root = tmpRepo();
  put(root, 'intake/INV-0001-front.jpg', makeJpeg({ gps: true }));
  const out = ingest(root);
  const md = renderReport(out);
  assert.ok(md.includes(`https://huntikins.github.io/huntikins.vault-images/${out.results[0].path}`));
  assert.ok(md.includes(`https://raw.githubusercontent.com/huntikins/huntikins.vault-images/main/${out.results[0].path}`));
});

test('parseIntakeName', () => {
  assert.deepEqual(parseIntakeName('INV-0001-front.jpg'), { ok: true, id: 'INV-0001', view: 'front', ext: 'jpg' });
  assert.deepEqual(parseIntakeName('inv-12345-Corner-TL.JPEG'), { ok: true, id: 'INV-12345', view: 'corner-tl', ext: 'jpg' });
  for (const bad of ['INV-001-front.jpg', 'front.jpg', 'INV-0001.jpg', 'INV-0001-front.heic', 'HV-RS-0001-front.jpg']) {
    assert.equal(parseIntakeName(bad).ok, false, bad);
  }
});

const BODY = (...lines) => `Some text\n\n\`\`\`\n${lines.join('\n')}\n\`\`\`\n`;
const idx = (root) => JSON.parse(readFileSync(join(root, 'index.json'), 'utf8'));

test('mapping: positional lines name front, back, then detail-N', () => {
  const root = tmpRepo();
  for (const n of [6513, 6514, 6515, 6516, 6517]) put(root, `intake/IMG_${n}.JPG`, makeJpeg({ tag: String(n) }));
  const out = ingest(root, { prBody: BODY('INV-0010: IMG_6513 IMG_6514', 'INV-0011: IMG_6515 IMG_6516 IMG_6517') });
  assert.equal(out.ok, true, out.problems.join('\n'));
  const index = idx(root);
  assert.deepEqual(Object.keys(index['INV-0010']), ['front', 'back']);
  assert.deepEqual(Object.keys(index['INV-0011']), ['front', 'back', 'detail-1']);
  assert.equal(readdirSync(join(root, 'intake')).length, 0);
});

test('mapping: explicit view form', () => {
  const root = tmpRepo();
  for (const n of [6513, 6514, 6520]) put(root, `intake/IMG_${n}.jpg`, makeJpeg({ tag: String(n) }));
  const out = ingest(root, { prBody: BODY('INV-0010 front=IMG_6513 back=IMG_6514 corner-tl=IMG_6520') });
  assert.equal(out.ok, true, out.problems.join('\n'));
  assert.deepEqual(Object.keys(idx(root)['INV-0010']), ['front', 'back', 'corner-tl']);
});

test('mapping: mixed upload of mapped and pre-named files', () => {
  const root = tmpRepo();
  put(root, 'intake/IMG_1.jpg', makeJpeg({ tag: '1' }));
  put(root, 'intake/IMG_2.jpg', makeJpeg({ tag: '2' }));
  put(root, 'intake/INV-0020-front.jpg', makeJpeg({ tag: '3' }));
  const out = ingest(root, { prBody: BODY('INV-0010: IMG_1 IMG_2') });
  assert.equal(out.ok, true, out.problems.join('\n'));
  assert.deepEqual(Object.keys(idx(root)), ['INV-0010', 'INV-0020']);
});

test('mapping: files named INV-NNNN-view work with no body at all', () => {
  const root = tmpRepo();
  put(root, 'intake/INV-0001-front.jpg', makeJpeg());
  assert.equal(ingest(root, { prBody: '' }).ok, true);
  const second = tmpRepo();
  put(second, 'intake/INV-0001-front.jpg', makeJpeg());
  assert.equal(ingest(second, { prBody: null }).ok, true);
});

test('mapping: an unmapped, unnamed file fails everything', () => {
  const root = tmpRepo();
  put(root, 'intake/IMG_1.jpg', makeJpeg({ tag: '1' }));
  put(root, 'intake/IMG_2.jpg', makeJpeg({ tag: '2' }));
  put(root, 'intake/IMG_3.jpg', makeJpeg({ tag: '3' }));
  const out = ingest(root, { prBody: BODY('INV-0010: IMG_1 IMG_2') });
  assert.equal(out.ok, false);
  assert.equal(out.problems.length, 1);
  assert.match(out.problems[0], /IMG_3\.jpg.*not named.*pull request description/);
  assert.ok(existsSync(join(root, 'intake/IMG_1.jpg')));
  assert.deepEqual(readdirSync(join(root, 'images')), []);
});

test('mapping: a mapped name with no file is reported', () => {
  const root = tmpRepo();
  put(root, 'intake/IMG_1.jpg', makeJpeg());
  const out = ingest(root, { prBody: BODY('INV-0010: IMG_1 IMG_9') });
  assert.equal(out.ok, false);
  assert.match(out.problems.join('\n'), /'IMG_9' is mapped to INV-0010 but no file/);
});

test('mapping: duplicate view, missing front and every problem are listed together', () => {
  const root = tmpRepo();
  put(root, 'intake/IMG_1.jpg', makeJpeg({ tag: '1' }));
  put(root, 'intake/IMG_2.jpg', makeJpeg({ tag: '2' }));
  put(root, 'intake/IMG_3.jpg', makeJpeg({ tag: '3' }));
  const out = ingest(root, { prBody: BODY('INV-0010 back=IMG_1 back=IMG_2', 'INV-0011: IMG_8') });
  assert.equal(out.ok, false);
  const text = out.problems.join('\n');
  assert.match(text, /two photos for view 'back'/);
  assert.match(text, /'IMG_8' is mapped to INV-0011 but no file/);
  assert.match(text, /INV-0010: no 'front'/);
  assert.match(text, /IMG_3\.jpg/);
});

test('mapping: stems and extensions match case-insensitively', () => {
  const root = tmpRepo();
  put(root, 'intake/img_6513.JPEG', makeJpeg({ tag: 'a' }));
  put(root, 'intake/Img_6514.PNG', makePng());
  const out = ingest(root, { prBody: BODY('INV-0010: IMG_6513 IMG_6514') });
  assert.equal(out.ok, true, out.problems.join('\n'));
  assert.match(idx(root)['INV-0010'].back, /\.png$/);
});

test('mapping: body text outside fences, junk lines and shell syntax are inert', () => {
  const root = tmpRepo();
  put(root, 'intake/IMG_1.jpg', makeJpeg());
  const body = 'INV-0099: IMG_404\n\n```\nINV-0010: IMG_1\nINV-0011: $(rm -rf /) `x`\n```\n';
  const out = ingest(root, { prBody: body });
  assert.equal(out.ok, false);
  assert.equal(out.problems.length, 1);
  assert.match(out.problems[0], /could not read the line/);
  assert.ok(existsSync(join(root, 'intake/IMG_1.jpg')));
});

test('mapping: the same file listed twice is rejected', () => {
  const root = tmpRepo();
  put(root, 'intake/IMG_1.jpg', makeJpeg());
  const out = ingest(root, { prBody: BODY('INV-0010: IMG_1', 'INV-0011: IMG_1') });
  assert.equal(out.ok, false);
  assert.match(out.problems.join('\n'), /listed more than once/);
});
