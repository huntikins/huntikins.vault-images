#!/usr/bin/env node
// Publish everything in intake/: scrub metadata, hash-name, file under images/<INV>/,
// drop replaced views, regenerate index.json / index.html / sitemap.xml. Idempotent.
//
//   ingest-intake.mjs [--root .] [--base-url URL] [--raw-base-url URL] [--report-md file] [--report-json file] [--pr-body-file file]
//
// Exit 1 (and no changes) if any intake file is invalid.
import { readFileSync, writeFileSync } from 'node:fs';
import { ingest, renderReport } from './lib/ingest.mjs';
import { DEFAULT_BASE_URL, DEFAULT_RAW_BASE_URL } from './lib/image-site.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : fallback;
};
const root = opt('root', '.');
const baseUrl = opt('base-url', DEFAULT_BASE_URL);
const rawBaseUrl = opt('raw-base-url', DEFAULT_RAW_BASE_URL);

const bodyPath = opt('pr-body-file');
const prBody = bodyPath ? readFileSync(bodyPath, 'utf8') : '';
const outcome = ingest(root, { baseUrl, prBody });
const md = renderReport(outcome, { baseUrl, rawBaseUrl });
const mdPath = opt('report-md');
if (mdPath) writeFileSync(mdPath, md);
const jsonPath = opt('report-json');
if (jsonPath) writeFileSync(jsonPath, `${JSON.stringify(outcome, null, 2)}\n`);

if (outcome.ok) {
  console.log(`Ingested ${outcome.results.length} image(s).`);
  for (const r of outcome.results) console.log(`  ${r.id} ${r.view} -> ${r.path}${r.replaced.length ? ` (replaced ${r.replaced.join(', ')})` : ''}`);
} else {
  console.error('Intake failed:');
  for (const p of outcome.problems) console.error(`  ✗ ${p}`);
}
for (const w of outcome.warnings) console.warn(`  ! ${w}`);
process.exit(outcome.ok ? 0 : 1);
