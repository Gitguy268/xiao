// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// What the Library searches: file names (and earlier names, tags and
// collections) of the folders the reader gave it, the downloads Xiao
// recorded, and the notes. Names only; no file is opened to index it.
//
// A folder is scanned when it is given to the Library and again when the
// Library page is opened, at most every ten minutes, in small batches that
// give the browser back control in between, and never while the Library is
// closed. The search index lives in memory only while it is used and is
// let go after five idle minutes.
import { kindOf, prepare, search } from './lib/library.mjs';

// Folders a scan does not enter: other programs' caches, version control,
// dependencies and build output. Shown in the Library's settings.
export const SKIP = new Set(['node_modules', 'bower_components', '.git', '.svn', '.hg', '__pycache__', '.venv', 'venv', 'target',
  'build', 'dist', '.next', '.cache', '$RECYCLE.BIN', 'System Volume Information']);
const DEPTH = 12;
const PER_ROOT = 100_000;
const BATCH = 400;
const RESCAN = 10 * 60_000;
const IDLE = 5 * 60_000;

const nsFile = (path) => {
  const f = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
  f.initWithPath(path);
  return f;
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class LibraryIndex {
  scanning = new Map(); // root id → { stop, seen, done }
  scannedAt = new Map();

  pauseMs = 0; // between batches of a scan; tests slow it down to act while it runs

  constructor(library) {
    this.library = library;
    this.store = library.store;
  }

  // Scans every folder root not scanned in the last ten minutes. Returns at once.
  refresh(force = false) {
    this.store.roots().then((roots) => {
      for (const r of roots) {
        if (r.kind !== 'folder') continue;
        if (!force && Date.now() - (this.scannedAt.get(r.id) ?? 0) < RESCAN) continue;
        this.scan(r);
      }
    }, (e) => console.error('Xiao Library: roots', e));
  }

  scan(root) {
    if (this.scanning.has(root.id)) return this.scanning.get(root.id).done;
    const state = { stop: new AbortController(), seen: 0 };
    this.scanning.set(root.id, state);
    this.library.changed(); // so an open page can show the scan, and stop it
    state.done = this.#scan(root, state).then((complete) => {
      if (complete) this.scannedAt.set(root.id, Date.now());
    }, (e) => {
      if (e.name !== 'AbortError') console.error('Xiao Library: scan', e.name);
    }).finally(() => {
      this.scanning.delete(root.id);
      this.invalidate();
      this.library.changed();
    });
    return state.done;
  }

  stop(rootId) {
    for (const [id, s] of this.scanning) if (!rootId || id === rootId) s.stop.abort();
  }

  // Breadth first, so the top of a large folder is searchable first.
  async #scan(root, state) {
    const stamp = Date.now();
    const queue = [[root.path, '']];
    let batch = [];
    const flush = async () => {
      if (batch.length) await this.store.putItems(batch, stamp);
      batch = [];
      this.invalidate();
      await pause(this.pauseMs);
    };
    while (queue.length) {
      if (state.stop.signal.aborted) return false;
      const [dir, rel] = queue.shift();
      let children;
      try {
        children = await IOUtils.getChildren(dir);
      } catch {
        continue; // unreadable or gone; the rest of the folder is still scanned
      }
      for (const child of children) {
        const name = PathUtils.filename(child);
        if (name.startsWith('.') || state.seen >= PER_ROOT) continue;
        let stat;
        try {
          stat = await IOUtils.stat(child);
        } catch {
          continue;
        }
        const path = rel ? `${rel}/${name}` : name;
        const folder = stat.type === 'directory';
        // links are listed but never followed
        if (folder && nsFile(child).isSymlink()) {
          batch.push({ root: root.id, rel: path, name, kind: 'link', size: null, modified: Math.round(stat.lastModified ?? 0), source: root.source });
          continue;
        }
        batch.push({ root: root.id, rel: path, name, kind: folder ? 'folder' : kindOf(name), size: folder ? null : stat.size,
          modified: Math.round(stat.lastModified ?? 0), source: root.source });
        state.seen++;
        if (folder && !SKIP.has(name) && path.split('/').length < DEPTH) queue.push([child, path]);
        if (batch.length >= BATCH) await flush();
      }
    }
    await flush();
    if (state.seen < PER_ROOT) await this.store.dropUnseen(root.id, stamp);
    return true;
  }

  // --- searching ---

  // A load still running when something changes must not be kept: the
  // generation tells records() its answer is already out of date.
  invalidate() {
    this.prepared = null;
    this.generation = (this.generation ?? 0) + 1;
  }

  async records() {
    clearTimeout(this.idle);
    this.idle = setTimeout(() => (this.prepared = null), IDLE);
    if (this.prepared) return this.prepared;
    const generation = this.generation;
    const [roots, items, downloads, tags, members, archive] = await Promise.all([
      this.store.roots(), this.store.items(), this.store.downloads(), this.store.tags(), this.store.memberships(), this.store.archive(),
    ]);
    const byRoot = new Map(roots.map((r) => [r.id, r]));
    const key = (root, rel) => `${root}:${rel}`;
    const tagsOf = new Map();
    for (const t of tags) tagsOf.set(key(t.root, t.rel), [...(tagsOf.get(key(t.root, t.rel)) ?? []), t.tag]);
    const within = new Map();
    for (const m of members) within.set(key(m.root, m.rel), [...(within.get(key(m.root, m.rel)) ?? []), m.collection]);
    const records = [];
    for (const i of items) {
      const r = byRoot.get(i.root);
      if (!r) continue;
      const k = key(i.root, i.rel);
      const parts = i.rel.split('/');
      records.push({ id: k, root: i.root, path: parts, place: [r.name, ...parts.slice(0, -1)].join(' › '), name: i.name, originalName: i.original_name ?? undefined, kind: i.kind === 'folder' ? 'folder' : i.kind,
        isFolder: i.kind === 'folder', size: i.size, modified: i.modified, source: r.source, tags: tagsOf.get(k) ?? [],
        within: [i.root, ...(within.get(k) ?? [])] });
    }
    // Downloads are single files: their name and date come from the disk now, their first name from the record.
    await Promise.all(downloads.map(async (d) => {
      const k = key(d.root, '');
      let stat = null;
      try {
        stat = await IOUtils.stat(d.path);
      } catch {}
      records.push({ id: k, root: d.root, path: [], place: this.library.placeOf(PathUtils.parent(d.path)), name: PathUtils.filename(d.path), originalName: d.original_name,
        kind: kindOf(d.path), size: stat?.size ?? null, modified: Math.round(stat?.lastModified ?? d.finished), missing: !stat,
        source: 'downloads', origin: d.origin, tags: tagsOf.get(k) ?? [], within: [d.root, ...(within.get(k) ?? [])] });
    }));
    // Archived tabs: found by title and address; opening one restores it.
    for (const a of archive) {
      let host = '';
      try {
        host = new URL(a.url).host;
      } catch {}
      records.push({ id: `archive:${a.id}`, root: a.id, path: [], place: host, name: a.title || host || a.url, originalName: a.url,
        kind: 'tab', size: null, modified: a.archived, source: 'archive', tags: [], within: [] });
    }
    const prepared = records.map(prepare);
    if (generation === this.generation) this.prepared = prepared;
    return prepared;
  }

  // view: a part of the Library; scope: a root or collection id.
  async query(q, { view = 'all', scope, offset = 0, limit = 100 } = {}) {
    let prepared = await this.records();
    const source = { downloads: 'downloads', files: 'files', notes: 'notes', archive: 'archive' }[view];
    if (source) prepared = prepared.filter((p) => p.record.source === source);
    if (scope) prepared = prepared.filter((p) => p.record.within.includes(scope));
    const found = search(prepared, q, { offset, limit });
    return {
      ...found,
      items: found.items.map(({ root, path, place, name, isFolder, kind, size, modified, source: from, originalName, tags, reason, missing }) => ({
        root, path, place, name, kind: isFolder ? 'directory' : kind === 'link' || kind === 'tab' ? kind : 'file', size, modified, source: from, originalName, tags, reason, missing,
      })),
    };
  }
}
