// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The Library's own database, <profile>/xiao-library.sqlite, opened only
// once the Library is used. It holds folder grants, tags, collections,
// downloads, the tab archive and the rename journal. The file index in it is
// derived and can be rebuilt; tags, collections and the journal cannot, so
// a migration is always preceded by a backup, and a database written by a
// newer Xiao is left untouched rather than "repaired".
import { LibraryError } from './lib/library-protocol.mjs';
import { lazy } from './mod.mjs';

const sqlite = lazy('toolkit/modules/Sqlite.sys.mjs', 'Sqlite');
export const DB_NAME = 'xiao-library.sqlite';

// One list of statements per schema version; never edit a shipped one.
export const MIGRATIONS = [
  [
    `CREATE TABLE roots (id TEXT PRIMARY KEY, kind TEXT NOT NULL, path TEXT NOT NULL, name TEXT NOT NULL,
      can_write INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'files', added INTEGER NOT NULL, revoked INTEGER)`,
    'CREATE UNIQUE INDEX roots_live ON roots(path) WHERE revoked IS NULL',
    `CREATE TABLE items (root TEXT NOT NULL, rel TEXT NOT NULL, name TEXT NOT NULL, original_name TEXT, kind TEXT NOT NULL,
      size INTEGER, modified INTEGER, source TEXT NOT NULL, missing INTEGER NOT NULL DEFAULT 0, seen INTEGER NOT NULL,
      PRIMARY KEY (root, rel))`,
    `CREATE TABLE downloads (id TEXT PRIMARY KEY, root TEXT NOT NULL, original_name TEXT NOT NULL, origin TEXT,
      finished INTEGER NOT NULL, dismissed INTEGER NOT NULL DEFAULT 0)`,
    'CREATE TABLE collections (id TEXT PRIMARY KEY, name TEXT NOT NULL, query TEXT, created INTEGER NOT NULL)',
    `CREATE TABLE memberships (collection TEXT NOT NULL, root TEXT NOT NULL, rel TEXT NOT NULL, added INTEGER NOT NULL,
      PRIMARY KEY (collection, root, rel))`,
    'CREATE TABLE tags (root TEXT NOT NULL, rel TEXT NOT NULL, tag TEXT NOT NULL, PRIMARY KEY (root, rel, tag))',
    `CREATE TABLE archive (id TEXT PRIMARY KEY, url TEXT NOT NULL, title TEXT, workspace TEXT, user_context INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL, restored INTEGER)`,
    `CREATE TABLE operations (id TEXT PRIMARY KEY, key TEXT UNIQUE, batch TEXT, kind TEXT NOT NULL, state TEXT NOT NULL,
      root TEXT NOT NULL, before_rel TEXT NOT NULL, after_rel TEXT NOT NULL, identity TEXT, error TEXT,
      created INTEGER NOT NULL, updated INTEGER NOT NULL)`,
    'CREATE INDEX operations_open ON operations(state)',
  ],
];
export const VERSION = MIGRATIONS.length;

const rowsOf = (rows, cols) => rows.map((r) => Object.fromEntries(cols.map((c) => [c, r.getResultByName(c)])));

export class LibraryStore {
  static MIGRATIONS = MIGRATIONS;

  // migrations: the real list, or another for the upgrade tests
  constructor(path = PathUtils.join(PathUtils.profileDir, DB_NAME), migrations = MIGRATIONS) {
    this.path = path;
    this.migrations = migrations;
  }

  open() {
    return (this.opening ??= this.#open().catch((e) => {
      this.opening = null;
      throw e;
    }));
  }

  async #open() {
    const existed = await IOUtils.exists(this.path);
    const db = await sqlite().openConnection({ path: this.path });
    try {
      const version = await db.getSchemaVersion();
      const latest = this.migrations.length;
      if (version > latest) {
        throw new LibraryError('UNSUPPORTED', `the Library was last used by a newer Xiao (database version ${version}); open it with that version, or restore a backup`);
      }
      if (version < latest) {
        if (existed && version > 0) await db.backup(`${this.path}.v${version}.bak`);
        await db.executeTransaction(async () => {
          for (const statements of this.migrations.slice(version)) for (const sql of statements) await db.execute(sql);
          await db.setSchemaVersion(latest);
        });
      }
      await db.execute('PRAGMA foreign_keys = ON');
    } catch (e) {
      await db.close();
      throw e;
    }
    this.db = db;
    return db;
  }

  async all(sql, params, cols) {
    return rowsOf(await (await this.open()).executeCached(sql, params), cols);
  }

  async run(sql, params) {
    await (await this.open()).executeCached(sql, params);
  }

  async transaction(fn) {
    const db = await this.open();
    return db.executeTransaction(() => fn(this));
  }

  async close() {
    const db = this.db;
    this.db = null;
    this.opening = null;
    await db?.close();
  }

  // --- roots: the folders and single files the reader has given the Library ---

  static ROOT = ['id', 'kind', 'path', 'name', 'can_write', 'source', 'added', 'revoked'];

  roots() {
    return this.all('SELECT * FROM roots WHERE revoked IS NULL ORDER BY added', null, LibraryStore.ROOT);
  }

  async root(id) {
    return (await this.all('SELECT * FROM roots WHERE id = :id', { id }, LibraryStore.ROOT))[0] ?? null;
  }

  async rootAt(path) {
    return (await this.all('SELECT * FROM roots WHERE path = :path AND revoked IS NULL', { path }, LibraryStore.ROOT))[0] ?? null;
  }

  async addRoot({ kind, path, name, canWrite, source }) {
    const known = await this.rootAt(path);
    if (known) return known;
    const id = crypto.randomUUID().replaceAll('-', '');
    await this.run('INSERT INTO roots (id, kind, path, name, can_write, source, added) VALUES (:id, :kind, :path, :name, :w, :source, :at)',
      { id, kind, path, name, w: canWrite ? 1 : 0, source, at: Date.now() });
    return this.root(id);
  }

  async setRootPath(id, path, name) {
    await this.run('UPDATE roots SET path = :path, name = :name WHERE id = :id', { id, path, name });
  }

  // --- the file index: derived, rebuilt by scanning ---

  static ITEM = ['root', 'rel', 'name', 'original_name', 'kind', 'size', 'modified', 'source', 'missing', 'seen'];

  items() {
    return this.all('SELECT * FROM items WHERE missing = 0', null, LibraryStore.ITEM);
  }

  // One batch of what a scan saw, in one transaction.
  putItems(rows, seen) {
    return this.transaction(async () => {
      for (const r of rows) {
        await this.run(`INSERT INTO items (root, rel, name, kind, size, modified, source, missing, seen)
          VALUES (:root, :rel, :name, :kind, :size, :modified, :source, 0, :seen)
          ON CONFLICT (root, rel) DO UPDATE SET name = :name, kind = :kind, size = :size, modified = :modified, missing = 0, seen = :seen`,
        { ...r, seen });
      }
    });
  }

  // After a complete scan: what it did not see is gone from the disk.
  dropUnseen(root, seen) {
    return this.run('DELETE FROM items WHERE root = :root AND seen < :seen', { root, seen });
  }

  // --- downloads: one file each, granted one by one (never the whole folder) ---

  static DOWNLOAD = ['id', 'root', 'original_name', 'origin', 'finished', 'dismissed'];

  downloads() {
    return this.all(`SELECT d.*, r.path, r.name FROM downloads d JOIN roots r ON r.id = d.root WHERE r.revoked IS NULL ORDER BY d.finished DESC`,
      null, [...LibraryStore.DOWNLOAD, 'path', 'name']);
  }

  async addDownload({ path, name, origin, finished }) {
    return this.transaction(async () => {
      const known = await this.rootAt(path);
      if (known) return known;
      const root = await this.addRoot({ kind: 'file', path, name, canWrite: true, source: 'downloads' });
      await this.run('INSERT OR IGNORE INTO downloads (id, root, original_name, origin, finished) VALUES (:id, :root, :name, :origin, :finished)',
        { id: root.id, root: root.id, name, origin, finished });
      return root;
    });
  }

  // --- tags, collections and saved searches: the reader's own, kept as references ---

  tags() {
    return this.all('SELECT root, rel, tag FROM tags', null, ['root', 'rel', 'tag']);
  }

  setTags(root, rel, tags) {
    return this.transaction(async () => {
      await this.run('DELETE FROM tags WHERE root = :root AND rel = :rel', { root, rel });
      for (const tag of tags) await this.run('INSERT INTO tags (root, rel, tag) VALUES (:root, :rel, :tag)', { root, rel, tag });
    });
  }

  collections() {
    return this.all(`SELECT c.id, c.name, c.query, c.created, COUNT(m.rel) AS size FROM collections c
      LEFT JOIN memberships m ON m.collection = c.id GROUP BY c.id ORDER BY c.name COLLATE NOCASE`, null, ['id', 'name', 'query', 'created', 'size']);
  }

  memberships() {
    return this.all('SELECT collection, root, rel FROM memberships', null, ['collection', 'root', 'rel']);
  }

  async addCollection(name, query = null) {
    const id = crypto.randomUUID().replaceAll('-', '');
    await this.run('INSERT INTO collections (id, name, query, created) VALUES (:id, :name, :query, :at)', { id, name, query, at: Date.now() });
    return id;
  }

  renameCollection(id, name) {
    return this.run('UPDATE collections SET name = :name WHERE id = :id', { id, name });
  }

  // Removes the collection, never the files in it.
  deleteCollection(id) {
    return this.transaction(async () => {
      await this.run('DELETE FROM memberships WHERE collection = :id', { id });
      await this.run('DELETE FROM collections WHERE id = :id', { id });
    });
  }

  addMembers(id, refs) {
    return this.transaction(async () => {
      for (const { root, rel } of refs) {
        await this.run('INSERT OR IGNORE INTO memberships (collection, root, rel, added) VALUES (:id, :root, :rel, :at)', { id, root, rel, at: Date.now() });
      }
    });
  }

  removeMembers(id, refs) {
    return this.transaction(async () => {
      for (const { root, rel } of refs) await this.run('DELETE FROM memberships WHERE collection = :id AND root = :root AND rel = :rel', { id, root, rel });
    });
  }

  // --- the tab archive (auto-archive) ---

  static ARCHIVE = ['id', 'url', 'title', 'workspace', 'user_context', 'archived', 'restored'];

  async addArchive({ url, title, workspace, userContext }) {
    const id = crypto.randomUUID().replaceAll('-', '');
    await this.run('INSERT INTO archive (id, url, title, workspace, user_context, archived) VALUES (:id, :url, :title, :workspace, :uc, :at)',
      { id, url, title, workspace, uc: userContext, at: Date.now() });
    return id;
  }

  archive() {
    return this.all('SELECT * FROM archive WHERE restored IS NULL ORDER BY archived DESC', null, LibraryStore.ARCHIVE);
  }

  async archiveEntry(id) {
    return (await this.all('SELECT * FROM archive WHERE id = :id AND restored IS NULL', { id }, LibraryStore.ARCHIVE))[0] ?? null;
  }

  markRestored(id) {
    return this.run('UPDATE archive SET restored = :at WHERE id = :id', { id, at: Date.now() });
  }

  pruneArchive(before) {
    return this.run('DELETE FROM archive WHERE archived < :before OR restored IS NOT NULL', { before });
  }

  clearArchive() {
    return this.run('DELETE FROM archive');
  }

  // --- the journal of changes made to files ---

  static OP = ['id', 'key', 'batch', 'kind', 'state', 'root', 'before_rel', 'after_rel', 'identity', 'error', 'created', 'updated'];

  async addOp({ id, key, batch, kind, state, root, before, after, identity }) {
    const at = Date.now();
    await this.run(`INSERT INTO operations (id, key, batch, kind, state, root, before_rel, after_rel, identity, created, updated)
      VALUES (:id, :key, :batch, :kind, :state, :root, :before, :after, :identity, :at, :at)`,
    { id, key: key ?? null, batch: batch ?? null, kind, state, root, before, after, identity: JSON.stringify(identity), at });
  }

  setOp(id, state, error = null) {
    return this.run('UPDATE operations SET state = :state, error = :error, updated = :at WHERE id = :id', { id, state, error, at: Date.now() });
  }

  async op(id) {
    const row = (await this.all('SELECT * FROM operations WHERE id = :id', { id }, LibraryStore.OP))[0];
    return row && { ...row, identity: JSON.parse(row.identity) };
  }

  async ops(where = "state NOT IN ('prepared')", limit = 100) {
    return (await this.all(`SELECT * FROM operations WHERE ${where} ORDER BY updated DESC LIMIT ${limit}`, null, LibraryStore.OP))
      .map((row) => ({ ...row, identity: JSON.parse(row.identity) }));
  }

  // A file or folder that moved: its records, its tags and its collection
  // entries move with it, folders with everything below them. Safe to run
  // twice (recovery may).
  moveRecords(root, before, after) {
    // (named "below", not "like": Sqlite.sys.mjs refuses any SQL where the word LIKE is followed by a space and no binding)
    const below = `${before.replace(/[\\%_]/g, (c) => `\\${c}`)}/%`;
    return this.transaction(async () => {
      for (const table of ['items', 'tags', 'memberships']) {
        await this.run(`UPDATE OR IGNORE ${table} SET rel = :after || substr(rel, length(:before) + 1)
          WHERE root = :root AND (rel = :before OR rel LIKE :below ESCAPE '\\')`, { root, before, after, below });
      }
      // the first name a file had stays searchable after any number of renames
      await this.run('UPDATE items SET original_name = COALESCE(original_name, :was), name = :name WHERE root = :root AND rel = :after',
        { root, after, name: after.split('/').pop(), was: before.split('/').pop() });
    });
  }

  dropRecords(root, rel) {
    const below = `${rel.replace(/[\\%_]/g, (c) => `\\${c}`)}/%`;
    return this.run(`DELETE FROM items WHERE root = :root AND (rel = :rel OR rel LIKE :below ESCAPE '\\')`, { root, rel, below });
  }

  // The grant goes, and so does everything derived from it. Tags and
  // collection entries stay, shown as "access removed", until removed.
  revoke(id) {
    return this.transaction(async () => {
      await this.run('UPDATE roots SET revoked = :at WHERE id = :id AND revoked IS NULL', { id, at: Date.now() });
      await this.run('DELETE FROM items WHERE root = :id', { id });
    });
  }
}
