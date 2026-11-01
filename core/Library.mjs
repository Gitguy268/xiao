// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The Library: Xiao's side of OpenFinder, the file library served from the
// "library" pack as resource://xiao-library/index.html. The page never sees
// or sends a full path: it names a root it was granted (an opaque id) and
// plain names below it, and every call is decoded again here (see
// lib/library-protocol.mjs). Only XiaoParent calls in, and only for that
// page at the top of a normal, non-Tor tab.
//
// Nothing runs until the page or the download hook asks: no scan at startup,
// no database until first use.
import { decode, failure, LibraryError, LIMITS, METHODS, ok, PROTOCOL } from './lib/library-protocol.mjs';
import { isProgram, previewKind } from './lib/library.mjs';
import { uniqueName } from './lib/naming.mjs';
import { LibraryDownloads } from './Downloads.mjs';
import { FileOperations } from './FileOperations.mjs';
import { LibraryIndex } from './LibraryIndex.mjs';
import { LibraryStore } from './LibraryStore.mjs';

export const LIBRARY_ORIGIN = 'resource://xiao-library';
export const LIBRARY_URL = `${LIBRARY_ORIGIN}/index.html`;
const PAGE = 200;
const PREVIEW_TEXT = 256 * 1024;

const nsFile = (path) => {
  const f = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
  f.initWithPath(path);
  return f;
};
const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const revisionOf = (stat) => `${stat.size ?? 0}-${Math.round(stat.lastModified ?? 0)}`;

// Folders Xiao itself runs from or keeps its own data in, which would let
// the page read the profile (cookies, passwords) or rewrite the browser.
const SEP = Services.appinfo.OS === 'WINNT' ? '\\' : '/';
const inside = (child, parent) => child === parent || child.startsWith(parent.endsWith(SEP) ? parent : parent + SEP);
function forbidden(path) {
  const own = [PathUtils.profileDir, Services.dirsvc.get('GreD', Ci.nsIFile).path, Services.dirsvc.get('XCurProcD', Ci.nsIFile).path];
  return PathUtils.split(path).length <= 1 || own.some((o) => inside(path, o) || inside(o, path));
}

export class Library {
  pending = new Map(); // `${window id}:${request id}` → AbortController

  done = new Map(); // idempotency key → reply data, so a change sent twice is made once

  constructor(xiao, store = new LibraryStore()) {
    this.xiao = xiao;
    this.store = store;
    this.index = new LibraryIndex(this);
    this.downloads = new LibraryDownloads(this);
    this.files = new FileOperations(this);
  }

  // Unfinished renames from before a crash are settled once, before the
  // first change or when the Library page opens.
  recovered() {
    return (this.recovering ??= this.files.recover().catch((e) => {
      this.recovering = null;
      console.error('Xiao Library: recovery', e);
    }));
  }

  // Switched with the Library feature (and its "Remember my downloads").
  // Off stops scans and the download hook and closes the database; nothing
  // the reader made (tags, collections, the journal) is deleted.
  async setEnabled(on, { downloads = true } = {}) {
    if (on && downloads) await this.downloads.start();
    else await this.downloads.stop();
    if (!on) {
      this.index.stop();
      this.index.invalidate();
      await this.store.close();
    }
  }

  // The notes folder (Xiao's own, or the one picked for the sticky note) is
  // part of the Library; when the sticky note moves to another folder, so does
  // this. Xiao's own notes folder is inside the profile, which grantRoot
  // refuses: exactly that folder is granted here, never anything around it.
  // A problem here must not stop the Library from opening.
  async ensureNotes() {
    try {
      const dir = this.xiao.notes.dir();
      if (!(await IOUtils.exists(dir))) return;
      const real = nsFile(dir);
      real.normalize(); // roots are kept by their real path (on macOS /var is /private/var)
      for (const r of await this.store.roots()) if (r.source === 'notes' && r.path !== real.path) await this.store.revoke(r.id);
      if (await this.store.rootAt(real.path)) return;
      if (real.isSymlink() || !real.isDirectory()) return;
      const root = await this.store.addRoot({ kind: 'folder', path: real.path, name: 'Notes', canWrite: true, source: 'notes' });
      this.index.scan(root);
    } catch (e) {
      if (!this.notesWarned) console.warn('Xiao Library: the notes folder is left out', e.name);
      this.notesWarned = true;
    }
  }

  // One request from the Library page. ctx: { browsingContext, gesture, windowId }.
  async request(raw, ctx) {
    let decoded;
    try {
      decoded = decode(raw);
    } catch (e) {
      return failure(raw?.requestId, e);
    }
    const { requestId, method, payload, spec } = decoded;
    const slot = `${ctx.windowId}:${requestId}`;
    const stop = new AbortController();
    this.pending.set(slot, stop);
    try {
      if (spec.gesture && !ctx.gesture) throw new LibraryError('INVALID', 'this needs a click or a key press first');
      const handler = this.handlers[method];
      if (!handler) throw new LibraryError('UNSUPPORTED', `${method} is not available in this version of Xiao`);
      if (spec.mutates && this.done.has(decoded.key)) return ok(requestId, this.done.get(decoded.key), this.revision ?? 0);
      if (spec.mutates || method === 'capabilities') await this.recovered();
      const data = await handler.call(this, payload, { ...ctx, signal: stop.signal, key: decoded.key });
      if (spec.mutates) {
        this.done.set(decoded.key, data);
        if (this.done.size > 500) this.done.delete(this.done.keys().next().value);
      } else if (stop.signal.aborted) {
        throw new LibraryError('CANCELLED', 'cancelled'); // a change that started is reported as it ended, never as cancelled
      }
      return ok(requestId, data, this.revision ?? 0);
    } catch (e) {
      if (!(e instanceof LibraryError)) console.error(`Xiao Library: ${method}`, e);
      return failure(requestId, e);
    } finally {
      this.pending.delete(slot);
    }
  }

  // Calls from Xiao itself or the e2e test, never from a page.
  async grantRoot(path, { canWrite = false, source = 'files' } = {}) {
    const real = nsFile(path);
    real.normalize();
    if (!real.isDirectory()) throw new LibraryError('INVALID', 'not a folder');
    if (forbidden(real.path)) throw new LibraryError('INVALID', 'Xiao keeps its own files there, so it cannot be given to the Library');
    const root = await this.store.addRoot({ kind: 'folder', path: real.path, name: real.leafName, canWrite, source });
    this.index.scan(root);
    return root;
  }

  // root + names → a real path, after checking the grant, that the root is
  // still there, and that no part of the way is a link (a link could lead
  // anywhere on the disk). `write` also needs a grant that allows changes.
  async resolve(ref, { write = false } = {}) {
    const root = await this.store.root(ref.root);
    if (!root || root.revoked) throw new LibraryError('PERMISSION_REVOKED', 'the Library no longer has access to this folder');
    if (write && !root.can_write) throw new LibraryError('PERMISSION_REVOKED', 'the Library may look at this folder but not change it');
    if (root.kind === 'file' && ref.path.length) throw new LibraryError('NOT_FOUND', 'a single file has nothing inside it');
    let path = root.path;
    const check = (p) => {
      const f = nsFile(p);
      if (f.isSymlink()) throw new LibraryError('INVALID', 'links are not followed, so the Library stays inside the folders it was given');
    };
    if (!(await IOUtils.exists(path))) {
      if (root.kind === 'file') throw new LibraryError('NOT_FOUND', `“${root.name}” is no longer where it was downloaded`);
      throw new LibraryError('UNAVAILABLE', `“${root.name}” is not available. Is its drive connected?`);
    }
    check(path);
    for (const name of ref.path) {
      path = PathUtils.join(path, name);
      if (await IOUtils.exists(path)) check(path);
    }
    return { root, path };
  }

  async statOf(path) {
    try {
      return await IOUtils.stat(path);
    } catch {
      throw new LibraryError('NOT_FOUND', 'this file is no longer there');
    }
  }

  async describe(path, name) {
    const stat = await IOUtils.stat(path);
    const link = nsFile(path).isSymlink();
    return {
      name,
      kind: link ? 'link' : stat.type === 'directory' ? 'directory' : 'file',
      size: stat.type === 'regular' ? stat.size : null,
      modified: Math.round(stat.lastModified ?? 0),
      revision: revisionOf(stat),
    };
  }

  // What the folder looks like in the page's location line, home as ~.
  placeOf(path) {
    const home = Services.dirsvc.get('Home', Ci.nsIFile).path;
    return path === home ? '~' : path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
  }

  async rootInfo(r) {
    return { id: r.id, kind: r.kind, name: r.name, place: this.placeOf(r.path), canWrite: !!r.can_write, source: r.source,
      available: await IOUtils.exists(r.path), scanning: this.index.scanning.has(r.id) };
  }

  // A note saved while a Library page is open shows there at once; with no
  // page open, the next opening catches up, as for any folder.
  async notesChanged() {
    if (!this.pages?.size) return;
    const root = (await this.store.roots()).find((r) => r.source === 'notes');
    if (root) await this.index.scan(root);
  }

  handlers = {
    // The page opening is when the Library catches up: notes folder, downloads, folder scans.
    async capabilities() {
      await this.ensureNotes();
      this.index.refresh();
      const methods = Object.keys(METHODS).filter((m) => this.handlers[m] && (m !== 'trash' || this.files.canTrash));
      const archive = this.xiao.features.autoArchive > 0 || (await this.store.archive()).length > 0;
      const views = ['all', ...(this.xiao.features.libraryDownloads === false ? [] : ['downloads']), 'files', 'notes', ...(archive ? ['archive'] : []), 'collections'];
      return { protocol: PROTOCOL, methods, views, platform: Services.appinfo.OS, theme: this.xiao.settings().theme, assist: await this.xiao.assist.model() };
    },

    async 'search.query'({ q, view = 'all', scope, cursor = 0, limit = 100 }) {
      if (view === 'collections' && scope) {
        const saved = (await this.store.collections()).find((c) => c.id === scope);
        if (saved?.query) return this.page(await this.index.query(`${saved.query} ${q}`, { offset: cursor, limit }), cursor);
      }
      return this.page(await this.index.query(q, { view, scope, offset: cursor, limit: Math.min(limit, PAGE) }), cursor);
    },

    async 'tags.set'({ item, tags }) {
      await this.resolve(item);
      await this.store.setTags(item.root, item.path.join('/'), tags);
      this.index.invalidate();
      this.changed();
      return tags;
    },

    // Suggested tidier names, for the reader to accept, edit or skip.
    // ai: ask the local AI (Assist) too, for at most ten files; what it
    // writes is checked like a typed name and only ever shown for review.
    async 'rename.preview'({ items, ai }) {
      const proposals = await this.files.proposals(items);
      if (!ai || !(await this.xiao.assist.model())) return proposals;
      const origins = new Map((await this.store.downloads()).map((d) => [d.root, d.origin]));
      let asked = 0;
      for (const p of proposals) {
        if (asked >= 10 || !p.canWrite) continue;
        asked++;
        try {
          const name = await this.xiao.assist.suggestName(p.originalName, origins.get(p.item.root) ?? '');
          if (!name) continue;
          const { path } = await this.resolve(p.item);
          const taken = (await IOUtils.getChildren(PathUtils.parent(path))).map((c) => PathUtils.filename(c)).filter((n) => n !== p.originalName);
          p.proposedName = uniqueName(name, taken);
          p.reasons = ['suggested by the local AI from the name and the site'];
          p.source = 'local-model';
        } catch (e) {
          p.warnings.push(`the local AI could not suggest one: ${e.message}`);
        }
      }
      return proposals;
    },

    // Each rename on its own: one that fails leaves the others done, and the
    // reply says what happened to each.
    async 'rename.apply'({ renames }, { key }) {
      const batch = renames.length > 1 ? key : null;
      const results = [];
      for (const [i, { item, name }] of renames.entries()) {
        try {
          results.push({ ok: true, ...(await this.files.rename(item, name, { key: `${key}-${i}`, batch })) });
        } catch (e) {
          results.push({ ok: false, item, code: e.code ?? 'IO_ERROR', message: e instanceof LibraryError ? e.message : 'The file could not be renamed.' });
        }
      }
      return { batch, results, done: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
    },

    async 'operations.list'() {
      const roots = new Map((await this.store.roots()).map((r) => [r.id, r]));
      return (await this.store.ops()).map((op) => ({
        id: op.id, kind: op.kind, state: op.state, batch: op.batch, at: op.updated, error: op.error,
        before: op.before_rel.split('/').pop(), after: op.after_rel.split('/').pop(), where: roots.get(op.root)?.name ?? '',
        canUndo: op.kind === 'rename' && op.state === 'committed',
      }));
    },

    'operations.undo'({ operation }) {
      return this.files.undo(operation);
    },

    async trash({ items }) {
      const results = [];
      for (const item of items) {
        try {
          results.push({ ok: true, item, ...(await this.files.trash(item)) });
        } catch (e) {
          results.push({ ok: false, item, code: e.code ?? 'IO_ERROR', message: e instanceof LibraryError ? e.message : 'The file could not be moved to the Trash.' });
        }
      }
      return { results, done: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
    },

    async 'archive.restore'({ entry }, { browsingContext }) {
      const tab = await this.xiao.archive.restore(entry, browsingContext.topChromeWindow);
      if (!tab) throw new LibraryError('NOT_FOUND', 'This tab is no longer in the Archive.');
      return true;
    },

    async 'archive.clear'() {
      await this.store.clearArchive();
      this.index.invalidate();
      this.changed();
      return true;
    },

    'collections.list'() {
      return this.store.collections();
    },

    // A collection holds references, never copies: removing one, or a file
    // from one, leaves every file where it is.
    async 'collections.update'({ op, collection, name, items = [] }) {
      const refs = items.map((i) => ({ root: i.root, rel: i.path.join('/') }));
      const named = () => (name?.trim() ? name.trim().slice(0, 80) : (() => { throw new LibraryError('INVALID', 'a collection needs a name'); })());
      let id = collection;
      if (op === 'create') id = await this.store.addCollection(named());
      else if (!id) throw new LibraryError('INVALID', 'which collection?');
      else if (op === 'rename') await this.store.renameCollection(id, named());
      else if (op === 'delete') await this.store.deleteCollection(id);
      if (op === 'create' || op === 'add') await this.store.addMembers(id, refs);
      if (op === 'remove') await this.store.removeMembers(id, refs);
      this.index.invalidate();
      this.changed();
      return { id };
    },

    async 'searches.save'({ name, q }) {
      if (!name.trim() || !q.trim()) throw new LibraryError('INVALID', 'a saved search needs a name and words');
      const id = await this.store.addCollection(name.trim().slice(0, 80), q.trim());
      this.changed();
      return { id };
    },

    // Stops a folder's scan; what it found so far stays searchable, and the
    // next opening of the Library scans it again.
    async 'roots.stopScan'({ root }) {
      this.index.stop(root);
      return true;
    },

    async 'roots.list'() {
      return Promise.all((await this.store.roots()).map((r) => this.rootInfo(r)));
    },

    async 'roots.choose'(_payload, { browsingContext }) {
      const picker = Cc['@mozilla.org/filepicker;1'].createInstance(Ci.nsIFilePicker);
      picker.init(browsingContext, 'Give the Library a folder', Ci.nsIFilePicker.modeGetFolder);
      const result = await new Promise((resolve) => picker.open(resolve));
      if (result !== Ci.nsIFilePicker.returnOK) return null;
      return this.rootInfo(await this.grantRoot(picker.file.path, { canWrite: true }));
    },

    async 'roots.revoke'({ root }) {
      await this.store.revoke(root);
      this.changed();
      return true;
    },

    async 'items.list'({ root, path, cursor = 0, limit = PAGE }, { signal }) {
      const { path: dir } = await this.resolve({ root, path });
      let children;
      try {
        children = await IOUtils.getChildren(dir);
      } catch (e) {
        throw new LibraryError(e.name === 'NotFoundError' ? 'NOT_FOUND' : 'IO_ERROR', e.name === 'NotFoundError' ? 'this folder no longer exists' : 'this folder could not be read');
      }
      // names starting with a dot stay hidden, as in Finder
      const names = children.map((c) => PathUtils.filename(c)).filter((n) => !n.startsWith('.')).sort(byName.compare);
      const page = names.slice(cursor, cursor + Math.min(limit, PAGE));
      const items = [];
      for (const name of page) {
        if (signal.aborted) break;
        try {
          items.push(await this.describe(PathUtils.join(dir, name), name));
        } catch {} // gone between the listing and now
      }
      return { items, total: names.length, next: cursor + page.length < names.length ? cursor + page.length : null };
    },

    async 'items.stat'({ item }) {
      const { path } = await this.resolve(item);
      if (!(await IOUtils.exists(path))) throw new LibraryError('NOT_FOUND', 'this file is no longer there');
      return this.describe(path, PathUtils.filename(path));
    },

    // Bounded bytes for the page to show from a Blob: content processes
    // cannot read the reader's folders by URL, and should not.
    async 'preview.open'({ item }) {
      const { path } = await this.resolve(item);
      const stat = await this.statOf(path);
      if (stat.type !== 'regular') return { kind: 'none', note: 'Folders have no preview.' };
      const name = PathUtils.filename(path);
      const what = previewKind(name);
      if (what.kind === 'pdf') return { kind: 'none', note: 'Open shows this PDF in Xiao\'s own viewer.' };
      if (what.kind === 'none') return { kind: 'none', note: 'There is no preview for this kind of file.' };
      if (what.kind === 'text') {
        const bytes = await IOUtils.read(path, { maxBytes: PREVIEW_TEXT });
        if (bytes.includes(0)) return { kind: 'none', note: 'This file is not text.' };
        return { kind: 'text', text: new TextDecoder().decode(bytes), truncated: stat.size > PREVIEW_TEXT };
      }
      if (stat.size > LIMITS.previewBytes) return { kind: 'none', note: 'This file is too large to preview. Open shows it.' };
      return { kind: what.kind, mime: what.mime, bytes: (await IOUtils.read(path)).buffer };
    },

    // Opens a file the way the system would, after a click, except programs
    // and installers: those are only shown in the file manager. PDFs open in
    // Xiao's own viewer.
    'items.open'({ item }, { browsingContext }) {
      return this.openItem(item, browsingContext.topChromeWindow);
    },

    async 'items.reveal'({ item }) {
      const { path } = await this.resolve(item);
      await this.statOf(path);
      nsFile(path).reveal();
      return true;
    },

    async 'request.cancel'({ request }, { windowId }) {
      this.pending.get(`${windowId}:${request}`)?.abort();
      return true;
    },
  };

  // Opens a file the way the system would, except programs and installers:
  // those are only shown in the file manager. PDFs open in Xiao's own viewer,
  // folders in the Library. Used by the Library page (after a click) and by
  // the Files section of Zen's Library panel.
  async openItem(item, win) {
    if (item.kind === 'directory') return !!this.xiao.openLibrary(win);
    const { path } = await this.resolve(item);
    const stat = await this.statOf(path);
    const name = PathUtils.filename(path);
    const file = nsFile(path);
    if (stat.type === 'directory' || isProgram(name) || (file.isExecutable() && !/\.(pdf|txt|md)$/i.test(name))) {
      throw new LibraryError('UNSUPPORTED', 'Xiao does not open programs or folders from the Library. Use Show in Finder instead.');
    }
    if (previewKind(name).kind === 'pdf') {
      win.gBrowser.selectedTab = win.gBrowser.addTab(Services.io.newFileURI(file).spec, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
      return true;
    }
    file.launch();
    return true;
  }

  page(found, cursor) {
    const next = cursor + found.items.length;
    return { ...found, next: next < found.total ? next : null };
  }

  // Tells open Library pages that something changed, so they ask again.
  changed() {
    this.revision = (this.revision ?? 0) + 1;
    for (const actor of this.pages ?? []) {
      try {
        actor.sendAsyncMessage('library-changed', { revision: this.revision });
      } catch {
        this.pages.delete(actor);
      }
    }
  }

  watch(actor) {
    (this.pages ??= new Set()).add(actor);
  }

  unwatch(actor) {
    this.pages?.delete(actor);
  }
}
