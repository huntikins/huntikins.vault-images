#!/usr/bin/env node
// Regenerate index.json, index.html and sitemap.xml from images/.
//
//   build-image-site.mjs [root] [--base-url https://user.github.io/repo/]
import { buildSite, DEFAULT_BASE_URL } from './lib/image-site.mjs';

const args = process.argv.slice(2);
const root = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--base-url') ?? '.';
const baseIdx = args.indexOf('--base-url');
const baseUrl = baseIdx !== -1 ? args[baseIdx + 1] : DEFAULT_BASE_URL;

const { index, problems, files } = buildSite(root, baseUrl);
for (const p of problems) console.error(`  ✗ ${p}`);
console.log(`Wrote index.json, index.html, sitemap.xml — ${files} file(s), ${Object.keys(index).length} item(s)`);
process.exit(problems.length > 0 ? 1 : 0);
