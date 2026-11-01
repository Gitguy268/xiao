// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The pure half of packs (see ../Packs.mjs): which catalogue entries and
// which file paths are acceptable. Everything a pack writes comes from the
// network or a zip, so nothing here trusts a path or a size it is handed.

const SEGMENT = /^[\w][\w .()+@-]*$/;

// A relative path inside a pack folder: plain segments only, so neither a
// catalogue entry nor a zip entry can write outside the pack.
export function safePath(path) {
  if (typeof path !== 'string' || !path || path.length > 300) return false;
  return path.split('/').every((s) => SEGMENT.test(s) && s !== '.' && s !== '..');
}

// A catalogue entry as Xiao will act on it, or an Error saying why not.
export function checkPack(pack) {
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(pack?.id ?? '')) return new Error('a pack has no usable id');
  if (!Array.isArray(pack.files) || !pack.files.length) return new Error(`${pack.id} lists no files`);
  for (const f of pack.files) {
    const where = `${pack.id}: ${f?.path}`;
    if (!safePath(f?.path)) return new Error(`${where} is not a plain path inside the pack`);
    if (!/^https:\/\//.test(f.url ?? '')) return new Error(`${where} has no https address`);
    if (!/^[0-9a-f]{64}$/.test(f.sha256 ?? '')) return new Error(`${where} has no SHA-256`);
    if (!Number.isInteger(f.size) || f.size <= 0) return new Error(`${where} has no size`);
    if (f.range && !(Array.isArray(f.range) && f.range.length === 2 && f.range[1] - f.range[0] + 1 === f.size)) {
      return new Error(`${where} has a byte range that does not match its size`);
    }
  }
  return pack;
}

// Where a file is fetched from: its own address, or the mirror's copy, which
// is named by its SHA-256 (the e2e serves one; the hash is checked either way).
export function sourceOf(file, mirror) {
  return mirror ? { url: `${mirror.replace(/\/?$/, '/')}${file.sha256}` } : { url: file.url, range: file.range };
}

export const totalSize = (pack) => pack.files.reduce((n, f) => n + f.size, 0);

export function sizeLabel(bytes) {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : bytes >= 1e6 ? `${Math.round(bytes / 1e6)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

// What went wrong with a download, in words: never a status code or an exception.
// status is the HTTP status, or 0 when nothing answered.
export function downloadProblem(status) {
  if (status === 0) return 'Xiao could not reach the download site. Check your connection and try again';
  if (status === 404 || status === 410) return 'this download is not available for this version of Xiao yet';
  if (status === 403 || status === 429) return 'the download site is refusing for now. Try again later';
  return 'the download site is having trouble. Try again later';
}

export const isMissing = (status) => status === 404 || status === 410;
