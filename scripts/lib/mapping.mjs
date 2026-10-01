// Parse the photo-to-item mapping from a pull request body.
//
// The body is untrusted text. It is only ever matched against strict regexes:
// never evaluated, never put in a shell command.
//
//   INV-0010: IMG_6513 IMG_6514                       first = front, second = back, then detail-1, detail-2 ...
//   INV-0010 front=IMG_6513 back=IMG_6514 corner-tl=IMG_6520
//
// Lines are read only inside fenced code blocks, and only lines starting with INV-.

const FENCE = /^\s{0,3}(```|~~~)/;
const LINE_START = /^\s*INV-/i;
const LINE = /^\s*(INV-\d{4,})\s*:?\s+((?:[A-Za-z0-9_.()-]+(?:=[A-Za-z0-9_.()-]+)?)(?:\s+[A-Za-z0-9_.()-]+(?:=[A-Za-z0-9_.()-]+)?)*)\s*$/i;
const VIEW_SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function positionalView(index) {
  if (index === 0) return 'front';
  if (index === 1) return 'back';
  return `detail-${index - 1}`;
}

/**
 * @param {string} body
 * @returns {{entries: Map<string, {id: string, view: string, stem: string}>, problems: string[]}}
 *   entries is keyed by lower-cased filename stem (basename without extension).
 */
export function parseMapping(body) {
  const entries = new Map();
  const problems = [];
  const seenViews = new Map();
  let inFence = false;

  for (const raw of String(body ?? '').split(/\r?\n/)) {
    if (FENCE.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence || !LINE_START.test(raw)) continue;
    const m = LINE.exec(raw);
    if (!m) {
      problems.push(`PR description: could not read the line '${raw.trim().slice(0, 80).replaceAll('`', "'")}' — use 'INV-0010: IMG_1 IMG_2' or 'INV-0010 front=IMG_1 back=IMG_2'`);
      continue;
    }
    const id = m[1].toUpperCase();
    let positional = 0;
    for (const token of m[2].split(/\s+/)) {
      let view;
      let stem;
      if (token.includes('=')) {
        const [v, s] = token.split('=');
        view = v.toLowerCase();
        stem = s;
        if (!VIEW_SHAPE.test(view)) {
          problems.push(`PR description: '${view}' in the ${id} line is not a valid view name`);
          continue;
        }
      } else {
        view = positionalView(positional++);
        stem = token;
      }
      const key = stem.toLowerCase();
      const viewKey = `${id}/${view}`;
      if (seenViews.has(viewKey)) {
        problems.push(`PR description: ${id} has two photos for view '${view}' (${seenViews.get(viewKey)} and ${stem})`);
        continue;
      }
      if (entries.has(key)) {
        problems.push(`PR description: '${stem}' is listed more than once`);
        continue;
      }
      seenViews.set(viewKey, stem);
      entries.set(key, { id, view, stem });
    }
  }
  return { entries, problems };
}
