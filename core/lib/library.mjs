// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Library search: one query language for the Library page, Zen's Library
// panel and the address bar, and one deterministic ranking. Pure, so node
// tests run it on a 10,000-item fixture.
//
//   invoice                 words, in any order
//   "tax return"            words together
//   type:pdf   type:image   an extension or a kind (see KINDS)
//   tag:research            a tag
//   source:downloads        downloads, files, notes, tabs or archive
//   in:collection-id        one collection or folder
//   before:2026-10-01  after:2026-09   a date (day or month), by last change
//
// A filter Xiao knows with a value it can't read (before:soon) is searched
// as plain words, with a warning. Unknown prefixes (re:meeting) are words.

export const SOURCES = ['downloads', 'files', 'notes', 'tabs', 'archive'];

export const KINDS = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'heic', 'heif', 'bmp', 'tif', 'tiff', 'svg', 'ico'],
  video: ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi'],
  audio: ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus'],
  document: ['pdf', 'doc', 'docx', 'odt', 'rtf', 'pages', 'xls', 'xlsx', 'ods', 'csv', 'numbers', 'ppt', 'pptx', 'odp', 'key', 'epub'],
  text: ['txt', 'md', 'markdown', 'log', 'json', 'yaml', 'yml', 'toml', 'xml', 'ini'],
  code: ['js', 'mjs', 'ts', 'tsx', 'jsx', 'py', 'rs', 'go', 'c', 'h', 'cpp', 'java', 'kt', 'swift', 'rb', 'sh', 'css', 'html'],
  archive: ['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'dmg', 'iso'],
};
const KIND_OF = new Map(Object.entries(KINDS).flatMap(([kind, exts]) => exts.map((e) => [e, kind])));

// The extension Xiao treats as the file's type: the last one, or the last
// two for the compound ones (report.tar.gz → tar.gz).
const COMPOUND = /\.(tar\.(gz|bz2|xz|zst)|user\.js)$/i;
export function extensionOf(name) {
  const compound = COMPOUND.exec(name);
  if (compound) return compound[1].toLowerCase();
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : '';
}

export function kindOf(name, isFolder = false) {
  if (isFolder) return 'folder';
  const ext = extensionOf(name);
  return KIND_OF.get(ext.split('.').at(-1)) ?? 'other';
}

// Programs, installers and scripts: the Library never opens or renames
// these by itself; it shows them in the file manager instead.
const PROGRAM = /\.(app|exe|msi|msix|com|bat|cmd|ps1|vbs|js|jse|wsf|scr|pif|cpl|jar|sh|bash|zsh|command|tool|pkg|mpkg|dmg|deb|rpm|appimage|run|bin|apk|scpt|workflow|action|terminal|desktop|lnk|url|webloc|inetloc)$/i;
export const isProgram = (name) => PROGRAM.test(name);

// What a preview may show, by extension: pictures, sound and video as
// themselves, everything text-like as plain text (pages and SVGs too, so
// they never run), anything else not at all.
export const MEDIA = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac',
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
};
const TEXTUAL = new Set([...KINDS.text, ...KINDS.code, 'csv', 'tsv', 'svg', 'htm', 'xhtml', 'srt', 'vtt', 'rtf', 'tex', 'conf', 'cfg', 'env']);
export function previewKind(name) {
  const ext = extensionOf(name).split('.').at(-1);
  const mime = MEDIA[ext];
  if (mime) return { kind: mime.split('/')[0], mime };
  if (TEXTUAL.has(ext) || !ext) return { kind: 'text' };
  if (ext === 'pdf') return { kind: 'pdf' };
  return { kind: 'none' };
}

const fold = (s) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
const words = (s) => fold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

// "2026-10-01" or "2026-10" → the first millisecond of that day or month
// (local time), and the first one after it; null when it isn't a date.
function dateRange(value) {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, m[3] ? Number(m[3]) : null];
  const start = new Date(y, mo, d ?? 1);
  if (start.getFullYear() !== y || start.getMonth() !== mo || (d && start.getDate() !== d)) return null;
  const end = d ? new Date(y, mo, d + 1) : new Date(y, mo + 1, 1);
  return [start.getTime(), end.getTime()];
}

// Splits a query into words and "quoted phrases"; a filter's value may be quoted.
function tokens(q) {
  const out = [];
  const re = /(\S+?:)?"([^"]*)"?|(\S+)/g;
  let m;
  while ((m = re.exec(q))) out.push(m[1] ? { key: m[1].slice(0, -1).toLowerCase(), value: m[2], quoted: true } : m[2] !== undefined
    ? { phrase: m[2] } : { raw: m[3] });
  return out;
}

export function parse(q) {
  const query = { words: [], phrases: [], types: [], tags: [], sources: [], within: [], before: null, after: null, warnings: [] };
  for (const t of tokens(String(q ?? '').slice(0, 500))) {
    if (t.phrase !== undefined) {
      if (t.phrase.trim()) query.phrases.push(fold(t.phrase.trim()));
      continue;
    }
    let key = t.key;
    let value = t.value;
    if (t.raw !== undefined) {
      const colon = t.raw.indexOf(':');
      key = colon > 0 ? t.raw.slice(0, colon).toLowerCase() : null;
      value = colon > 0 ? t.raw.slice(colon + 1) : null;
    }
    const text = t.raw ?? `${t.key}:${t.value}`;
    const asWords = (warn) => {
      if (warn) query.warnings.push(warn);
      query.words.push(...words(text));
    };
    if (key === null || !['type', 'tag', 'source', 'in', 'before', 'after'].includes(key)) {
      asWords();
      continue;
    }
    if (!value) {
      asWords(`${key}: needs a value`);
      continue;
    }
    const v = value.normalize('NFC');
    if (key === 'type') {
      const type = v.toLowerCase().replace(/^\./, '');
      if (KINDS[type] || type === 'folder' || /^[a-z0-9]{1,10}(\.[a-z0-9]{1,5})?$/.test(type)) query.types.push(type);
      else asWords(`type:${v} is not a file type`);
    } else if (key === 'tag') {
      query.tags.push(fold(v));
    } else if (key === 'source') {
      const s = v.toLowerCase();
      if (SOURCES.includes(s)) query.sources.push(s);
      else asWords(`source:${v} is not one of ${SOURCES.join(', ')}`);
    } else if (key === 'in') {
      query.within.push(v);
    } else {
      const range = dateRange(v);
      if (!range) asWords(`${key}:${v} is not a date like 2026-10-01`);
      else if (key === 'before') query.before = Math.min(query.before ?? Infinity, range[0]);
      else query.after = Math.max(query.after ?? -Infinity, range[1]);
    }
  }
  return query;
}

// A record as search sees it, with its text folded once. Records come from
// the Library's index: { id, name, originalName?, title?, text?, tags?,
// source, kind?, modified?, within?: [ids] }.
export function prepare(r) {
  const name = r.name ?? '';
  const ext = extensionOf(name);
  const base = ext ? name.slice(0, -(ext.length + 1)) : name;
  return {
    record: r,
    name: fold(name),
    base: fold(base),
    nameWords: words(base),
    other: [r.originalName, r.title].filter(Boolean).map((o) => ({ name: fold(o), base: fold(o), nameWords: words(o) })),
    text: r.text ? fold(r.text) : '',
    tags: (r.tags ?? []).map(fold),
    ext,
    kind: r.kind ?? kindOf(name),
    collator: name,
  };
}

// a's letters appear in b in order (a loose match for typos and shorthand).
function subsequence(a, b) {
  let i = 0;
  for (let j = 0; j < b.length && i < a.length; j++) if (a[i] === b[j]) i++;
  return i === a.length;
}

// How well the words match one field, in tiers: exact name, name prefix,
// every word starting a word of the name, every word inside it, letters in
// order. 0 when they don't.
function nameScore(p, needle, qWords) {
  if (p.name === needle || p.base === needle) return 1000;
  if (p.name.startsWith(needle)) return 800;
  if (qWords.every((w) => p.nameWords.some((n) => n.startsWith(w)))) return 600;
  if (qWords.every((w) => p.name.includes(w))) return 400;
  if (needle.length >= 3 && subsequence(needle.replace(/\s+/g, ''), p.name)) return 200;
  return 0;
}

function passes(p, q) {
  const r = p.record;
  if (q.types.length && !q.types.some((t) => t === p.ext || t === p.kind || (t === 'folder' && p.kind === 'folder'))) return false;
  if (q.tags.length && !q.tags.every((t) => p.tags.includes(t))) return false;
  if (q.sources.length && !q.sources.includes(r.source)) return false;
  if (q.within.length && !q.within.some((id) => r.within?.includes(id))) return false;
  if (q.before !== null && !(r.modified < q.before)) return false;
  if (q.after !== null && !(r.modified >= q.after)) return false;
  return true;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

// Scores one prepared record: { score, reason } or null.
export function score(p, q) {
  if (!passes(p, q)) return null;
  const needle = q.words.join(' ');
  for (const phrase of q.phrases) {
    if (!p.name.includes(phrase) && !p.other.some((o) => o.name.includes(phrase)) && !p.text.includes(phrase)) return null;
  }
  if (!q.words.length) return { score: q.phrases.length ? 500 : 100, reason: q.phrases.length ? 'name' : 'filter' };
  const best = nameScore(p, needle, q.words);
  if (best) return { score: best, reason: 'name' };
  for (const other of p.other) {
    const s = nameScore(other, needle, q.words);
    if (s >= 400) return { score: s - 150, reason: 'earlier name or title' };
  }
  if (q.words.every((w) => p.tags.some((t) => t.startsWith(w)))) return { score: 300, reason: 'tag' };
  if (p.text && q.words.every((w) => p.text.includes(w))) return { score: 150, reason: 'text' };
  return null;
}

// The ranked page of results: best score first, then the most recently
// changed, then by name, then by id, so the same query always gives the
// same order.
export function search(prepared, q, { offset = 0, limit = 50 } = {}) {
  const query = typeof q === 'string' ? parse(q) : q;
  const hits = [];
  for (const p of prepared) {
    const s = score(p, query);
    if (s) hits.push({ p, ...s });
  }
  hits.sort((a, b) => b.score - a.score || (b.p.record.modified ?? 0) - (a.p.record.modified ?? 0)
    || collator.compare(a.p.collator, b.p.collator) || String(a.p.record.id).localeCompare(String(b.p.record.id)));
  return {
    total: hits.length,
    warnings: query.warnings,
    items: hits.slice(offset, offset + limit).map((h) => ({ ...h.p.record, reason: h.reason })),
  };
}
