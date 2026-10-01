// Build and read index.json: { "<INV>": { "<view>": "images/<INV>/<view>-<hash8>.<ext>" } }.
// Nothing but INV -> view -> path. Never prices, notes or anything else.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { compareIds, compareViews, hash8, ID_PATTERN, parsePublishedName, publishedPath } from './image-naming.mjs';

/**
 * Walk images/ and return the index plus any structural problems.
 * @returns {{index: Record<string, Record<string, string>>, problems: string[]}}
 */
export function scanImages(root) {
  const imagesDir = join(root, 'images');
  const problems = [];
  const found = {};
  if (existsSync(imagesDir)) {
    for (const entry of readdirSync(imagesDir)) {
      if (entry.startsWith('.')) continue;
      const dir = join(imagesDir, entry);
      if (!statSync(dir).isDirectory()) {
        problems.push(`images/${entry}: loose file — images must live in images/<INV>/`);
        continue;
      }
      if (!ID_PATTERN.test(entry)) {
        problems.push(`images/${entry}: folder is not a valid id (expected INV-NNNN)`);
        continue;
      }
      for (const file of readdirSync(dir)) {
        if (file.startsWith('.')) continue;
        const parsed = parsePublishedName(file);
        if (!parsed) {
          problems.push(`images/${entry}/${file}: not named <view>-<hash8>.jpg|png`);
          continue;
        }
        const actual = hash8(readFileSync(join(dir, file)));
        if (actual !== parsed.hash) {
          problems.push(`images/${entry}/${file}: hash in the name does not match the file contents (${actual})`);
          continue;
        }
        if (found[entry]?.[parsed.view]) {
          problems.push(`images/${entry}: more than one file for view '${parsed.view}'`);
          continue;
        }
        (found[entry] ??= {})[parsed.view] = publishedPath(entry, parsed.view, parsed.hash, parsed.ext);
      }
    }
  }
  return { index: sortIndex(found), problems };
}

export function sortIndex(index) {
  const out = {};
  for (const id of Object.keys(index).sort(compareIds)) {
    out[id] = {};
    for (const view of Object.keys(index[id]).sort(compareViews)) out[id][view] = index[id][view];
  }
  return out;
}

export function serializeIndex(index) {
  return `${JSON.stringify(sortIndex(index), null, 2)}\n`;
}
