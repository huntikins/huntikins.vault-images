#!/usr/bin/env node
// Strip privacy-sensitive metadata (EXIF/GPS, XMP, IPTC, MPF, comments) from images.
//
//   scrub-image-metadata.mjs <file...>            strip in place
//   scrub-image-metadata.mjs --check <file...>    exit 1 unless every file is provably clean
//
// Fail closed: a file the strict parser cannot fully account for (fill bytes,
// unknown markers, truncated segments, data after the end of the image, a
// second image) is never rewritten and never reported clean — re-encode it
// from its pixels instead. --check additionally searches the whole file for
// metadata signatures, independent of the parser.
import { readFileSync, writeFileSync } from 'node:fs';
import { checkImage, scrub } from './lib/image-metadata.mjs';

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const files = args.filter((a) => a !== '--check');

if (files.length === 0) {
  console.error('usage: scrub-image-metadata.mjs [--check] <file...>');
  process.exit(2);
}

let bad = 0;

for (const file of files) {
  let buf;
  try {
    buf = readFileSync(file);
  } catch (err) {
    console.error(`  ! ${file}: cannot read (${err.code ?? err.message})`);
    bad++;
    continue;
  }

  if (checkOnly) {
    const { clean, problems } = checkImage(buf);
    if (!clean) {
      bad++;
      console.error(`  ✗ ${file}: ${problems.join('; ')}`);
    }
    continue;
  }

  const r = scrub(buf);
  if (r.unsupported) {
    bad++;
    console.error(`  ? ${file}: ${r.kind} — cannot verify metadata; convert to JPEG/PNG first`);
    continue;
  }
  if (r.rejected) {
    bad++;
    console.error(`  ✗ ${file}: rejected, left untouched — ${r.rejected}. Re-encode it from its pixels.`);
    continue;
  }
  const after = checkImage(r.out);
  if (!after.clean) {
    bad++;
    console.error(`  ✗ ${file}: still not clean after stripping — ${after.problems.join('; ')}`);
    continue;
  }
  if (r.removed.length === 0) {
    console.log(`  · ${file}: already clean`);
    continue;
  }
  writeFileSync(file, r.out);
  console.log(`  ✓ ${file}: stripped ${r.removed.join(', ')} (-${buf.length - r.out.length} bytes)`);
}

if (bad > 0) {
  console.error(`\n${bad} file(s) carry metadata or could not be verified.`);
  process.exit(1);
}
process.exit(0);
