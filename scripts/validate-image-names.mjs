#!/usr/bin/env node
// Enforce images/<INV>/<view>-<hash8>.<ext>, including that hash8 matches the file.
//
//   validate-image-names.mjs [root]     default root: images
//
// Exits 1 with a report if anything deviates.
import { existsSync } from 'node:fs';
import { dirname, basename } from 'node:path';
import { scanImages } from './lib/image-index.mjs';
import { isStandardView, REQUIRED_VIEWS, VIEW_ORDER } from './lib/image-naming.mjs';

const imagesDir = process.argv[2] ?? 'images';
if (!existsSync(imagesDir)) {
  console.log(`${imagesDir}/ does not exist — nothing to check.`);
  process.exit(0);
}
if (basename(imagesDir) !== 'images') {
  console.error(`expected a directory named 'images', got '${imagesDir}'`);
  process.exit(2);
}

const { index, problems } = scanImages(dirname(imagesDir) || '.');
const warnings = [];
for (const [id, views] of Object.entries(index)) {
  for (const req of REQUIRED_VIEWS) {
    if (!views[req]) problems.push(`${id}: missing required view '${req}'`);
  }
  for (const view of Object.keys(views)) {
    if (!isStandardView(view)) warnings.push(`${id}/${view}: not a standard view — published anyway, ordered last`);
  }
}

console.log(`Checked ${Object.keys(index).length} item folder(s).`);
for (const w of warnings) console.warn(`  ! ${w}`);
if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(`\nStandard views: ${VIEW_ORDER.join(', ')}, detail-1 … detail-99.`);
  process.exit(1);
}
console.log('All image names conform.');
