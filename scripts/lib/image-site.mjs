// Generate index.json, index.html and sitemap.xml at the repo root.
//
// Pages serves the repo root directly — there is deliberately no dist/ copy,
// which would double the repository size since every file is already static.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanImages, serializeIndex } from './image-index.mjs';

export const DEFAULT_BASE_URL = 'https://huntikins.github.io/huntikins.vault-images/';
export const DEFAULT_RAW_BASE_URL = 'https://raw.githubusercontent.com/huntikins/huntikins.vault-images/main/';

export function withSlash(url) {
  return url.endsWith('/') ? url : `${url}/`;
}

export function buildSite(root, baseUrl = DEFAULT_BASE_URL) {
  const base = withSlash(baseUrl);
  const { index, problems } = scanImages(root);
  const paths = Object.values(index).flatMap((views) => Object.values(views));

  writeFileSync(join(root, 'index.json'), serializeIndex(index));
  writeFileSync(
    join(root, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      paths.map((p) => `  <url><loc>${base}${p}</loc></url>\n`).join('') +
      `</urlset>\n`,
  );
  writeFileSync(
    join(root, 'index.html'),
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Listing images</title>
<style>body{font:14px/1.6 system-ui,sans-serif;margin:3rem auto;max-width:34rem;padding:0 1rem;color:#222}code{background:#f4f4f4;padding:.1rem .3rem;border-radius:3px}</style>
</head>
<body>
<h1>Listing images</h1>
<p>Static image host for marketplace listings. Nothing to see here.</p>
<p>Paths: <code>/images/&lt;INV&gt;/&lt;view&gt;-&lt;hash&gt;.jpg</code>. Lookup: <code>/index.json</code>.</p>
<p>${paths.length} file(s) across ${Object.keys(index).length} item folder(s).</p>
</body>
</html>
`,
  );
  return { index, problems, files: paths.length };
}
