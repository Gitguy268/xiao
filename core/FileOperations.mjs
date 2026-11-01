// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Renames, undo and trash: the only places the Library changes files.
//
// Every rename is written in the journal before the disk is touched, checked
// again just before, done with a move that never overwrites, then recorded as
// done (see lib/journal.mjs for what happens after a crash). Renames in one
// folder or of one download wait for each other. Undo only puts back the same
// file and never replaces another. There is no permanent delete: trash uses
// the system's own Trash (macOS /usr/bin/trash, `gio trash` on Linux), run
// with its arguments as a list, never through a shell; without one, the
// Library offers no trash at all.
import { LibraryError } from './lib/library-protocol.mjs';
import { canUndo, identityOf, OPEN, recover, sameFile } from './lib/journal.mjs';
import { checkName, suggestName, uniqueName } from './lib/naming.mjs';
import { lazy } from './mod.mjs';

const downloadHistory = lazy('toolkit/components/downloads/DownloadHistory.sys.mjs', 'DownloadHistory');
const places = lazy('toolkit/components/places/PlacesUtils.sys.mjs', 'PlacesUtils');
const subprocess = lazy('toolkit/modules/subprocess/Subprocess.sys.mjs', 'Subprocess');
const revisionOf = (stat) => `${stat.size ?? 0}-${Math.round(stat.lastModified ?? 0)}`;

async function statOrNull(path) {
  try {
    return await IOUtils.stat(path);
  } catch {
    return null;
  }
}

// The system's Trash, or null where there is none Xiao can use safely.
function trashCommand() {
  const os = Services.appinfo.OS;
  const exists = (p) => {
    try {
      const f = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
      f.initWithPath(p);
      return f.exists();
    } catch {
      return false;
    }
  };
  if (os === 'Darwin' && exists('/usr/bin/trash')) return (path) => ({ command: '/usr/bin/trash', arguments: [path] });
  if (os === 'Linux') {
    const gio = ['/usr/bin/gio', '/bin/gio'].find(exists);
    if (gio) return (path) => ({ command: gio, arguments: ['trash', '--', path] });
  }
  return null;
}

export class FileOperations {
  locks = new Map(); // a folder or download → the last operation queued on it

  constructor(library) {
    this.library = library;
    this.store = library.store;
    this.trashWith = trashCommand();
  }

  // Where a journal entry's names are on the disk now. A download is a root
  // of its own (one file), so its names are names in its folder.
  locate(root, rel) {
    return root.kind === 'file' ? PathUtils.join(PathUtils.parent(root.path), rel) : PathUtils.join(root.path, ...rel.split('/'));
  }

  // Operations on the same folder (or download) run one at a time.
  serial(key, fn) {
    const run = (this.locks.get(key) ?? Promise.resolve()).then(fn, fn);
    this.locks.set(key, run.catch(() => {}));
    return run;
  }

  async proposals(items) {
    return Promise.all(items.map(async (item) => {
      try {
        const { root, path } = await this.library.resolve(item);
        const stat = await this.library.statOf(path);
        const name = PathUtils.filename(path);
        const suggestion = stat.type === 'regular' ? suggestName(name) : null;
        let proposed = suggestion?.name ?? null;
        const warnings = [];
        if (proposed) {
          const taken = (await IOUtils.getChildren(PathUtils.parent(path))).map((p) => PathUtils.filename(p)).filter((n) => n !== name);
          const free = uniqueName(proposed, taken);
          if (free !== proposed) warnings.push(`“${proposed}” is taken here, so it would be “${free}”`);
          proposed = free;
        }
        return { item: { root: item.root, path: item.path, revision: revisionOf(stat) }, originalName: name, proposedName: proposed,
          reasons: suggestion?.reasons ?? [], warnings, canWrite: !!root.can_write };
      } catch (e) {
        return { item, originalName: item.path.at(-1) ?? '', proposedName: null, reasons: [], warnings: [e.message], canWrite: false };
      }
    }));
  }

  async rename(item, newName, { key, batch } = {}) {
    const { root, path } = await this.library.resolve(item, { write: true });
    return this.serial(root.kind === 'file' ? root.id : `${root.id}:${item.path.slice(0, -1).join('/')}`, () => this.#rename(root, item, path, newName, { key, batch }));
  }

  async #rename(root, item, path, newName, { key, batch }) {
    const stat = await this.library.statOf(path);
    if (item.revision && item.revision !== revisionOf(stat)) throw new LibraryError('STALE_ITEM', 'This file changed since the Library showed it. Look again, then rename.');
    const name = PathUtils.filename(path);
    const problem = checkName(name, newName);
    if (problem) throw new LibraryError('INVALID', problem);
    if (newName === name) return { unchanged: true, item: { root: root.id, path: item.path } };
    const target = PathUtils.join(PathUtils.parent(path), newName);
    // "a.pdf" → "A.pdf" is the same file on macOS and Windows; anything else must be free
    const caseOnly = newName.normalize('NFC').toLowerCase() === name.normalize('NFC').toLowerCase();
    if (!caseOnly && await IOUtils.exists(target)) throw new LibraryError('CONFLICT', `“${newName}” already exists here. Choose another name.`);
    const before = root.kind === 'file' ? name : item.path.join('/');
    const after = root.kind === 'file' ? newName : [...item.path.slice(0, -1), newName].join('/');
    const id = crypto.randomUUID().replaceAll('-', '');
    const identity = identityOf(stat);
    await this.store.addOp({ id, key, batch, kind: 'rename', state: 'prepared', root: root.id, before, after, identity });
    try {
      if (!sameFile(identityOf(await statOrNull(path)), identity)) throw new LibraryError('STALE_ITEM', 'This file changed a moment ago, so it was left as it is.');
      if (caseOnly) {
        const step = `${path}.xiao-${id.slice(0, 8)}`;
        await IOUtils.move(path, step, { noOverwrite: true });
        await IOUtils.move(step, target, { noOverwrite: true });
      } else {
        await IOUtils.move(path, target, { noOverwrite: true });
      }
    } catch (e) {
      await this.store.setOp(id, 'failed', e.code ?? e.name);
      if (e instanceof LibraryError) throw e;
      throw new LibraryError(e.name === 'NoModificationAllowedError' ? 'CONFLICT' : 'IO_ERROR',
        e.name === 'NoModificationAllowedError' ? `“${newName}” appeared here just now. Choose another name.` : 'The file could not be renamed. Is it open in another app, or on a disk that cannot be written to?');
    }
    await this.store.setOp(id, 'applied');
    await this.#follow(root, before, after, path, target);
    await this.store.setOp(id, 'committed');
    this.library.index.invalidate();
    this.library.changed();
    return { operation: id, name: newName, item: { root: root.id, path: root.kind === 'file' ? [] : after.split('/') } };
  }

  // The Library's records, and Firefox's own download list, follow the file.
  async #follow(root, before, after, fromPath, toPath) {
    if (root.kind === 'file') await this.store.setRootPath(root.id, toPath, PathUtils.filename(toPath));
    await this.store.moveRecords(root.id, before, after);
    // Firefox keeps a finished download twice: in this session's list, and in
    // history ("downloads/destinationFileURI"), which the Downloads panel
    // reads after a restart. Both learn the new name, so neither says "file moved".
    try {
      const list = await downloadHistory().getList();
      for (const d of await list.getAll()) {
        if (d.target?.path !== fromPath) continue;
        d.target.path = toPath;
        if (typeof d.refresh === 'function') await d.refresh();
        const page = await places().history.fetch(d.source.originalUrl || d.source.url);
        if (page) {
          const file = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
          file.initWithPath(toPath);
          await places().history.update({ guid: page.guid, url: page.url, annotations: new Map([['downloads/destinationFileURI', Services.io.newFileURI(file).spec]]) });
        }
      }
    } catch (e) {
      console.warn('Xiao Library: Firefox\'s download list kept the old name', e.name);
    }
  }

  async undo(id) {
    const op = await this.store.op(id);
    if (!op || op.kind !== 'rename') throw new LibraryError('NOT_FOUND', 'There is no such change to undo.');
    const root = await this.store.root(op.root);
    if (!root || root.revoked) throw new LibraryError('PERMISSION_REVOKED', 'The Library no longer has access to this folder.');
    return this.serial(root.kind === 'file' ? root.id : `${root.id}:${op.before_rel.split('/').slice(0, -1).join('/')}`, async () => {
      const beforePath = this.locate(root, op.before_rel);
      const afterPath = this.locate(root, op.after_rel);
      const why = canUndo(op, identityOf(await statOrNull(beforePath)), identityOf(await statOrNull(afterPath)));
      if (why) throw new LibraryError(/old name/.test(why) ? 'CONFLICT' : 'STALE_ITEM', why);
      await this.store.setOp(id, 'undoing');
      try {
        await IOUtils.move(afterPath, beforePath, { noOverwrite: true });
      } catch {
        await this.store.setOp(id, 'committed');
        throw new LibraryError('CONFLICT', 'The file could not be given its old name back; nothing was changed.');
      }
      await this.#follow(root, op.after_rel, op.before_rel, afterPath, beforePath);
      await this.store.setOp(id, 'undone');
      this.library.index.invalidate();
      this.library.changed();
      return { operation: id, item: { root: root.id, path: root.kind === 'file' ? [] : op.before_rel.split('/') } };
    });
  }

  // After a restart: finish or close what a crash interrupted, from what the
  // disk shows. Anything unclear is left for the reader, never redone.
  async recover() {
    for (const op of await this.store.ops(`state IN (${OPEN.map((s) => `'${s}'`).join(', ')})`)) {
      const root = await this.store.root(op.root);
      if (!root) continue;
      const before = identityOf(await statOrNull(this.locate(root, op.before_rel)));
      const after = identityOf(await statOrNull(this.locate(root, op.after_rel)));
      const state = recover(op, before, after);
      if (state === 'committed' && op.state !== 'undoing') await this.#follow(root, op.before_rel, op.after_rel, this.locate(root, op.before_rel), this.locate(root, op.after_rel));
      if (state === 'undone') await this.#follow(root, op.after_rel, op.before_rel, this.locate(root, op.after_rel), this.locate(root, op.before_rel));
      await this.store.setOp(op.id, state, state === 'review' ? 'interrupted; both names checked, nothing moved' : null);
    }
  }

  get canTrash() {
    return !!this.trashWith;
  }

  async trash(item) {
    if (!this.trashWith) throw new LibraryError('UNSUPPORTED', 'This system has no Trash Xiao can use, so the Library does not delete files.');
    const { root, path } = await this.library.resolve(item, { write: true });
    const stat = await this.library.statOf(path);
    if (item.revision && item.revision !== revisionOf(stat)) throw new LibraryError('STALE_ITEM', 'This file changed since the Library showed it. Look again first.');
    const rel = root.kind === 'file' ? '' : item.path.join('/');
    const id = crypto.randomUUID().replaceAll('-', '');
    await this.store.addOp({ id, kind: 'trash', state: 'prepared', root: root.id, before: rel || PathUtils.filename(path), after: '', identity: identityOf(stat) });
    const proc = await subprocess().call({ ...this.trashWith(path), stderr: 'pipe', stdout: 'pipe' });
    const { exitCode } = await proc.wait();
    if (exitCode !== 0 || await IOUtils.exists(path)) {
      await this.store.setOp(id, 'failed', `exit ${exitCode}`);
      throw new LibraryError('IO_ERROR', 'The file could not be moved to the Trash.');
    }
    await this.store.setOp(id, 'committed');
    if (root.kind === 'file') await this.store.revoke(root.id);
    else await this.store.dropRecords(root.id, rel);
    this.library.index.invalidate();
    this.library.changed();
    return { operation: id };
  }
}
