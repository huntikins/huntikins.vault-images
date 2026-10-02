// Turn a folder of intake photos into published, scrubbed, hash-named images.
//
// Used by the private intake in huntikins.vault (photos are uploaded there, never
// here), which vendors this directory. Raw photos therefore never reach this
// public repository: only the cleaned bytes this function writes do.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import { parseMapping } from './mapping.mjs';
import { checkImage, kindOf, scrub } from './image-metadata.mjs';
import { compareIds, compareViews, hash8, isStandardView, parseIntakeName, parsePublishedName, publishedPath, REQUIRED_VIEWS } from './image-naming.mjs';
import { buildSite, DEFAULT_BASE_URL, DEFAULT_RAW_BASE_URL, withSlash } from './image-site.mjs';

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function pruneEmptyDirs(dir, keep) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) pruneEmptyDirs(full, false);
  }
  if (!keep && readdirSync(dir).length === 0) rmSync(dir, { recursive: true });
}

/**
 * Ingest the intake folder into root/images/. All-or-nothing: if any file is
 * invalid, nothing on disk changes and the problems are returned.
 *
 * Options:
 * - intakeDir: where the raw photos are (default root/intake).
 * - transform(bytes, {rel, kind}): re-encode the pixels (resize, drop every
 *   container byte) before scrubbing. Must return a JPEG or PNG Buffer.
 * - consume: delete each intake file once published (default true).
 *
 * Whatever comes out of the transform is strictly scrubbed and then checked
 * independently; a file that is not cleanly parsed is rejected, never passed.
 *
 * @returns {{ok: boolean, problems: string[], warnings: string[], results: Array<{id: string, view: string, path: string, replaced: string[]}>}}
 */
export function ingest(root, { baseUrl = DEFAULT_BASE_URL, prBody = '', intakeDir = join(root, 'intake'), transform = null, consume = true } = {}) {
  const problems = [];
  const warnings = [];
  const planned = new Map();

  const mapping = parseMapping(prBody);
  problems.push(...mapping.problems);
  const files = walk(intakeDir).sort();
  const byStem = new Map();
  for (const file of files) {
    const stem = basename(file, extname(file)).toLowerCase();
    byStem.set(stem, [...(byStem.get(stem) ?? []), file]);
  }
  const intakeName = basename(intakeDir);
  const relName = (f) => `${intakeName}/${relative(intakeDir, f)}`;
  for (const [stem, entry] of mapping.entries) {
    const matches = byStem.get(stem) ?? [];
    if (matches.length === 0) problems.push(`PR description: '${entry.stem}' is mapped to ${entry.id} but no file in ${intakeName}/ has that name`);
    if (matches.length > 1) problems.push(`PR description: '${entry.stem}' matches more than one file (${matches.map(relName).join(', ')})`);
  }

  for (const file of files) {
    const rel = relName(file);
    const stem = basename(file, extname(file)).toLowerCase();
    const mapped = mapping.entries.get(stem);
    let parsed;
    if (mapped) {
      parsed = { ok: true, id: mapped.id, view: mapped.view };
    } else {
      parsed = parseIntakeName(basename(file));
      if (!parsed.ok) {
        problems.push(`${rel}: ${parsed.error} — or list it in the pull request description`);
        continue;
      }
    }
    let bytes = readFileSync(file);
    if (bytes.length === 0) {
      problems.push(`${rel}: file is empty`);
      continue;
    }
    const kind = kindOf(bytes);
    if (kind !== 'jpeg' && kind !== 'png') {
      problems.push(`${rel}: this is a ${kind} file, not a JPEG or PNG — it cannot be checked for hidden location data. Convert it to JPEG first`);
      continue;
    }
    if (transform) {
      try {
        bytes = transform(bytes, { rel, kind });
      } catch (err) {
        problems.push(`${rel}: could not be re-encoded (${String(err?.message ?? err).split('\n')[0].slice(0, 200)})`);
        continue;
      }
    }
    const result = scrub(bytes);
    if (result.unsupported || result.rejected) {
      problems.push(`${rel}: rejected — ${result.rejected ?? `${result.kind} output`}; nothing from this file is published`);
      continue;
    }
    const check = checkImage(result.out);
    if (!check.clean) {
      problems.push(`${rel}: metadata could not be fully removed (${check.problems.join('; ')})`);
      continue;
    }
    const ext = result.kind === 'png' ? 'png' : 'jpg';
    const key = `${parsed.id}/${parsed.view}`;
    if (planned.has(key)) {
      problems.push(`${rel}: duplicate of ${planned.get(key).rel} — only one ${parsed.view} photo per ${parsed.id}`);
      continue;
    }
    if (!isStandardView(parsed.view)) {
      warnings.push(`${rel}: '${parsed.view}' is not a standard view — published anyway, ordered last`);
    }
    planned.set(key, { rel, file, id: parsed.id, view: parsed.view, ext, out: result.out, hash: hash8(result.out), stripped: result.removed });
  }

  const ids = [...new Set([...planned.values()].map((p) => p.id))];
  for (const id of ids) {
    const existing = existsSync(join(root, 'images', id)) ? readdirSync(join(root, 'images', id)).map((f) => parsePublishedName(f)?.view) : [];
    const views = new Set([...existing, ...[...planned.values()].filter((p) => p.id === id).map((p) => p.view)]);
    for (const req of REQUIRED_VIEWS) {
      if (!views.has(req)) problems.push(`${id}: no '${req}' photo — every item needs INV-NNNN-${req}.jpg (add it to this upload)`);
    }
  }

  if (problems.length > 0) return { ok: false, problems, warnings, results: [] };

  const results = [];
  for (const p of [...planned.values()].sort((a, b) => compareIds(a.id, b.id) || compareViews(a.view, b.view))) {
    const dir = join(root, 'images', p.id);
    mkdirSync(dir, { recursive: true });
    const dest = publishedPath(p.id, p.view, p.hash, p.ext);
    const replaced = [];
    for (const f of readdirSync(dir)) {
      const old = parsePublishedName(f);
      const oldPath = `images/${p.id}/${f}`;
      if (old?.view === p.view && oldPath !== dest) {
        rmSync(join(dir, f));
        replaced.push(oldPath);
      }
    }
    writeFileSync(join(root, dest), p.out);
    if (consume) rmSync(p.file);
    results.push({ id: p.id, view: p.view, path: dest, replaced, stripped: p.stripped });
  }
  if (consume && existsSync(intakeDir)) pruneEmptyDirs(intakeDir, true);

  const site = buildSite(root, baseUrl);
  return { ok: site.problems.length === 0, problems: site.problems, warnings, results };
}

const cell = (s) => String(s).replaceAll('|', '\\|').replaceAll('`', "'");

export function renderReport({ ok, problems, warnings, results }, { baseUrl = DEFAULT_BASE_URL, rawBaseUrl = DEFAULT_RAW_BASE_URL } = {}) {
  const lines = [];
  if (!ok) {
    lines.push('### Intake failed — nothing was published', '');
    for (const p of problems) lines.push(`- ${cell(p)}`);
    lines.push('', 'Fix the files in this pull request (rename or replace them) and push again.');
    return `${lines.join('\n')}\n`;
  }
  const pages = withSlash(baseUrl);
  const raw = withSlash(rawBaseUrl);
  lines.push(`### Published ${results.length} image(s)`, '', '| Item | View | URL |', '|---|---|---|');
  for (const r of results) lines.push(`| ${r.id} | ${r.view} | ${pages}${r.path} |`);
  lines.push('', '<details><summary>raw.githubusercontent.com URLs</summary>', '');
  for (const r of results) lines.push(`- ${raw}${r.path}`);
  lines.push('', '</details>');
  const replaced = results.flatMap((r) => r.replaced);
  if (replaced.length > 0) {
    lines.push('', 'Replaced (old URLs are no longer served):');
    for (const r of replaced) lines.push(`- ${cell(r)}`);
  }
  const stripped = results.filter((r) => r.stripped.length > 0).length;
  if (stripped > 0) lines.push('', `Hidden metadata (location, camera) was removed from ${stripped} photo(s).`);
  if (warnings.length > 0) {
    lines.push('', 'Notes:');
    for (const w of warnings) lines.push(`- ${cell(w)}`);
  }
  return `${lines.join('\n')}\n`;
}
