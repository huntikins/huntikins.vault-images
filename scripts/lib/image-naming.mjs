// Canonical image naming for the public image repo.
//
//   intake/INV-0001-front.jpg                    (what the owner uploads)
//   images/<INV>/<view>-<hash8>.<ext>            (what is published)
//
// hash8 is the first 8 hex chars of the sha256 of the final, metadata-scrubbed
// bytes, so a URL is derivable from the file and a replaced photo gets a new URL.

import { createHash } from 'node:crypto';

export const ID_PATTERN = /^INV-\d{4,}$/;
export const ALLOWED_EXTENSIONS = ['jpg', 'png'];
export const INTAKE_EXTENSIONS = ['jpg', 'jpeg', 'png'];

// Order matters: it is the order images are attached to an eBay listing, and
// index 0 becomes the gallery image.
export const VIEW_ORDER = [
  'front',
  'back',
  'corner-tl',
  'corner-tr',
  'corner-bl',
  'corner-br',
  'edge-top',
  'edge-bottom',
  'edge-left',
  'edge-right',
  'surface',
  'slab-front',
  'slab-back',
  'label',
];

export const REQUIRED_VIEWS = ['front'];

const DETAIL = /^detail-[1-9]\d?$/;
const VIEW_SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const INTAKE_NAME = /^(INV-\d{4,})-([A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)\.([A-Za-z0-9]+)$/i;
const PUBLISHED_NAME = /^([a-z0-9]+(?:-[a-z0-9]+)*)-([0-9a-f]{8})\.(jpg|png)$/;

export function isStandardView(view) {
  return VIEW_ORDER.includes(view) || DETAIL.test(view);
}

export function viewSortKey(view) {
  const i = VIEW_ORDER.indexOf(view);
  if (i !== -1) return [0, i, ''];
  if (DETAIL.test(view)) return [1, Number(view.split('-')[1]), ''];
  return [2, 0, view];
}

export function compareViews(a, b) {
  const ka = viewSortKey(a);
  const kb = viewSortKey(b);
  return ka[0] - kb[0] || ka[1] - kb[1] || String(ka[2]).localeCompare(String(kb[2]));
}

export function compareIds(a, b) {
  const na = Number(a.slice(4));
  const nb = Number(b.slice(4));
  return na - nb || a.localeCompare(b);
}

export function hash8(bytes) {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 8);
}

/**
 * Parse an intake filename (`INV-0001-front.jpg`).
 * @returns {{ok: true, id: string, view: string, ext: 'jpg'|'png'} | {ok: false, error: string}}
 */
export function parseIntakeName(filename) {
  const m = INTAKE_NAME.exec(filename);
  if (!m) {
    return {
      ok: false,
      error: `is not named INV-NNNN-<view>.jpg (for example INV-0001-front.jpg)`,
    };
  }
  const id = m[1].toUpperCase();
  const view = m[2].toLowerCase();
  const rawExt = m[3].toLowerCase();
  if (!INTAKE_EXTENSIONS.includes(rawExt)) {
    return {
      ok: false,
      error: `'.${rawExt}' is not accepted — use .jpg or .png (HEIC and other formats cannot be checked for hidden location data)`,
    };
  }
  if (!ID_PATTERN.test(id) || !VIEW_SHAPE.test(view)) {
    return { ok: false, error: `is not named INV-NNNN-<view>.jpg` };
  }
  return { ok: true, id, view, ext: rawExt === 'png' ? 'png' : 'jpg' };
}

/** Parse a published filename (`front-1a2b3c4d.jpg`) inside images/<INV>/. */
export function parsePublishedName(filename) {
  const m = PUBLISHED_NAME.exec(filename);
  return m ? { view: m[1], hash: m[2], ext: m[3] } : null;
}

export function publishedPath(id, view, hash, ext) {
  return `images/${id}/${view}-${hash}.${ext}`;
}
