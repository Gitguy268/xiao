// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The Library's wire contract: what the Library page (OpenFinder, served as
// resource://xiao-library/) may ask Xiao for, and how every request is
// checked before Xiao acts on it. Nothing here trusts the page: names,
// paths, ids and sizes are all decoded from scratch for each call.
//
// OpenFinder keeps a copy of this file (src/fs/contract/); its
// scripts/sync-contract.mjs copies it, never the other way round.

export const PROTOCOL = 1;

export const ERRORS = {
  INVALID: 'INVALID', // the request itself is malformed
  UNKNOWN_METHOD: 'UNKNOWN_METHOD',
  UNSUPPORTED: 'UNSUPPORTED', // a real method this Xiao cannot do here
  PERMISSION_REVOKED: 'PERMISSION_REVOKED',
  NOT_FOUND: 'NOT_FOUND',
  STALE_ITEM: 'STALE_ITEM', // the file changed since the page last saw it
  CONFLICT: 'CONFLICT', // something already sits where a file would go
  UNAVAILABLE: 'UNAVAILABLE', // folder offline, drive missing
  TOO_LARGE: 'TOO_LARGE',
  CANCELLED: 'CANCELLED',
  BUSY: 'BUSY',
  IO_ERROR: 'IO_ERROR',
};

const RETRYABLE = new Set([ERRORS.UNAVAILABLE, ERRORS.BUSY, ERRORS.IO_ERROR]);

export class LibraryError extends Error {
  constructor(code, message) {
    super(message);
    this.code = ERRORS[code] ?? ERRORS.IO_ERROR;
    this.retryable = RETRYABLE.has(this.code);
  }
}

export const LIMITS = {
  request: 64 * 1024, // JSON bytes of one request
  name: 255, // UTF-8 bytes of one file name, as on most file systems
  depth: 64, // folders below a root
  query: 500, // characters of a search
  page: 200, // results per reply
  batch: 500, // items in one rename or trash batch
  tags: 32,
  previewBytes: 32 * 1024 * 1024,
};

// Names that Windows refuses whatever the extension (CON, CON.txt, ...).
const DEVICE = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/;
const utf8 = (s) => new TextEncoder().encode(s).length;

// One file or folder name, NFC-normalised, or null. No separators, no
// traversal, no control or bidi-override characters, no device names, and
// no trailing dot or space (Windows and some network shares drop them).
export function safeName(name) {
  if (typeof name !== 'string') return null;
  const n = name.normalize('NFC');
  if (!n || n === '.' || n === '..' || utf8(n) > LIMITS.name) return null;
  if (/[/\\:\0]/.test(n) || CONTROL.test(n) || DEVICE.test(n) || /[. ]$/.test(n) || /^\s/.test(n)) return null;
  return n;
}

// A path below a root, as a list of names, or null.
export function safeRelative(path) {
  if (!Array.isArray(path) || path.length > LIMITS.depth) return null;
  const out = [];
  for (const segment of path) {
    const n = safeName(segment);
    if (n === null) return null;
    out.push(n);
  }
  return out;
}

// The parts of the Library a search can be limited to (OpenFinder's sidebar).
export const VIEWS = ['all', 'downloads', 'files', 'notes', 'tabs', 'archive', 'collections'];

// The kinds of field a payload may hold. Each returns the decoded value or
// throws; `?` after a field's type in a schema makes it optional.
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const fields = {
  id: (v) => (typeof v === 'string' && ID.test(v) ? v : bad('an id')),
  ids: (v) => (Array.isArray(v) && v.length <= LIMITS.batch ? v.map(fields.id) : bad('a list of ids')),
  path: (v) => safeRelative(v) ?? bad('a path inside the folder'),
  name: (v) => safeName(v) ?? bad('a usable file name'),
  text: (v) => (typeof v === 'string' && v.length <= LIMITS.query ? v : bad('short text')),
  int: (v) => (Number.isSafeInteger(v) && v >= 0 ? v : bad('a whole number')),
  bool: (v) => (typeof v === 'boolean' ? v : bad('true or false')),
  item: (v) => item(v),
  items: (v) => (Array.isArray(v) && v.length && v.length <= LIMITS.batch ? v.map(item) : bad('a list of items')),
  tags: (v) => (Array.isArray(v) && v.length <= LIMITS.tags ? [...new Set(v.map(tag))] : bad('a list of tags')),
  renames: (v) => (Array.isArray(v) && v.length && v.length <= LIMITS.batch
    ? v.map((r) => ({ item: item(r?.item), name: fields.name(r?.name) })) : bad('a list of new names')),
  collectionOp: (v) => (['create', 'rename', 'delete', 'add', 'remove'].includes(v) ? v : bad('a collection change')),
  view: (v) => (VIEWS.includes(v) ? v : bad('a part of the Library')),
};
function bad(what) {
  throw new LibraryError('INVALID', `expected ${what}`);
}
function tag(v) {
  if (typeof v !== 'string') bad('a tag');
  const t = v.normalize('NFC').trim();
  return t && t.length <= 40 && !CONTROL.test(t) ? t : bad('a short tag');
}
// A file or folder the page is pointing at: a granted root and a path in it.
// `revision` is what the page last saw, so a change in between is caught.
function item(v) {
  if (!v || typeof v !== 'object') bad('an item');
  const out = { root: fields.id(v.root), path: fields.path(v.path ?? []) };
  if (v.revision !== undefined) out.revision = typeof v.revision === 'string' && v.revision.length <= 64 ? v.revision : bad('a revision');
  return out;
}

// Every method the Library page may call. `mutates` calls take an
// idempotency key; `gesture` calls only run after a click or key press in
// the page; nothing outside this table is ever dispatched.
export const METHODS = {
  'capabilities': { payload: {} },
  'roots.list': { payload: {} },
  'roots.choose': { payload: {}, gesture: true },
  'roots.revoke': { payload: { root: 'id' }, mutates: true },
  'roots.stopScan': { payload: { root: 'id' } },
  'items.list': { payload: { root: 'id', path: 'path', cursor: 'int?', limit: 'int?' } },
  'items.stat': { payload: { item: 'item' } },
  'items.open': { payload: { item: 'item' }, gesture: true },
  'items.reveal': { payload: { item: 'item' }, gesture: true },
  'search.query': { payload: { q: 'text', view: 'view?', scope: 'id?', cursor: 'int?', limit: 'int?', generation: 'int?' } },
  'preview.open': { payload: { item: 'item' } },
  'preview.close': { payload: { item: 'item?' } },
  'tags.set': { payload: { item: 'item', tags: 'tags' }, mutates: true },
  'collections.list': { payload: {} },
  'collections.update': { payload: { op: 'collectionOp', collection: 'id?', name: 'text?', items: 'items?' }, mutates: true },
  'searches.save': { payload: { name: 'text', q: 'text' }, mutates: true },
  'rename.preview': { payload: { items: 'items', ai: 'bool?' } },
  'rename.apply': { payload: { renames: 'renames' }, mutates: true },
  'trash': { payload: { items: 'items' }, mutates: true, gesture: true },
  'operations.list': { payload: {} },
  'operations.undo': { payload: { operation: 'id' }, mutates: true },
  'archive.restore': { payload: { entry: 'id' }, mutates: true },
  'archive.clear': { payload: {}, mutates: true, gesture: true },
  'request.cancel': { payload: { request: 'id' } },
};

// Decodes one request from the page into { requestId, method, payload, key },
// or throws a LibraryError. Unknown payload fields are dropped, not passed on.
export function decode(request) {
  let size;
  try {
    size = JSON.stringify(request)?.length ?? 0;
  } catch {
    bad('plain data');
  }
  if (size > LIMITS.request) throw new LibraryError('TOO_LARGE', 'the request is too large');
  if (!request || typeof request !== 'object') bad('a request');
  if (request.protocol !== PROTOCOL) throw new LibraryError('UNSUPPORTED', `this Xiao speaks Library protocol ${PROTOCOL}`);
  const requestId = fields.id(request.requestId);
  const spec = Object.hasOwn(METHODS, request.method) ? METHODS[request.method] : null;
  if (!spec) throw new LibraryError('UNKNOWN_METHOD', `no method ${String(request.method).slice(0, 40)}`);
  const given = request.payload ?? {};
  if (typeof given !== 'object' || Array.isArray(given)) bad('a payload object');
  const payload = {};
  for (const [field, type] of Object.entries(spec.payload)) {
    const optional = type.endsWith('?');
    const value = given[field];
    if (value === undefined || value === null) {
      if (!optional) bad(`${field}`);
      continue;
    }
    payload[field] = fields[optional ? type.slice(0, -1) : type](value);
  }
  const key = spec.mutates ? fields.id(request.key) : undefined;
  return { requestId, method: request.method, payload, key, spec };
}

export const ok = (requestId, data, revision = 0) => ({ requestId, ok: true, revision, data });

export function failure(requestId, error) {
  const e = error instanceof LibraryError ? error : new LibraryError('IO_ERROR', 'Xiao could not do that');
  return { requestId: typeof requestId === 'string' ? requestId : '', ok: false, code: e.code, message: e.message, retryable: e.retryable };
}
