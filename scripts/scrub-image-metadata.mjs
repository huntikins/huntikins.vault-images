#!/usr/bin/env node
// Strip privacy-sensitive metadata (EXIF/GPS, XMP, IPTC, comments) from images.
//
//   scrub-image-metadata.mjs <file...>            strip in place
//   scrub-image-metadata.mjs --check <file...>    exit 1 if any metadata found
//
// Pure Node — no exiftool or ImageMagick needed. Used by the image repo's
// pre-commit hook (local commits) and its CI workflow (covers API uploads too).
import { readFileSync, writeFileSync } from 'node:fs';
import { scrub } from './lib/image-metadata.mjs';

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const files = args.filter((a) => a !== '--check');

if (files.length === 0) {
  console.error('usage: scrub-image-metadata.mjs [--check] <file...>');
  process.exit(2);
}

let dirty = 0;
let unsupported = 0;

for (const file of files) {
  let buf;
  try {
    buf = readFileSync(file);
  } catch (err) {
    console.error(`  ! ${file}: cannot read (${err.code ?? err.message})`);
    dirty++;
    continue;
  }
  const { kind, out, removed, unsupported: unsup } = scrub(buf);

  if (unsup) {
    unsupported++;
    // HEIC/unknown containers can hold GPS this tool cannot parse. Never claim clean.
    console.error(`  ? ${file}: ${kind} — cannot verify metadata; convert to JPEG/PNG before committing`);
    dirty++;
    continue;
  }
  if (removed.length === 0) {
    if (!checkOnly) console.log(`  · ${file}: already clean`);
    continue;
  }
  dirty++;
  if (checkOnly) {
    console.error(`  ✗ ${file}: metadata present — ${removed.join(', ')}`);
  } else {
    writeFileSync(file, out);
    const saved = buf.length - out.length;
    console.log(`  ✓ ${file}: stripped ${removed.join(', ')} (-${saved} bytes)`);
  }
}

if (checkOnly && dirty > 0) {
  console.error(`\n${dirty} file(s) carry metadata or could not be verified.`);
  console.error('Run ./scripts/scrub-image-metadata.mjs <files> to strip, then re-commit.');
  process.exit(1);
}
if (unsupported > 0 && !checkOnly) process.exit(1);
process.exit(0);
