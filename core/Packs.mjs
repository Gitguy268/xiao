// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Packs: the optional features too big to ship with Xiao (the voice
// organiser's models, the file converter, the PDF tools). Nothing is fetched
// until a feature is switched on in the start page's settings.
//
// Each pack is a list of files in packs.json, pinned by size and SHA-256, so
// a download can only ever be the bytes this version of Xiao was built with.
// Files land in <app>/xiao-packs/<id>/ and are served as resource://xiao-<id>/.
// They live in the app folder, not the profile, because Firefox's content
// sandbox lets web content processes read only the app folder (a page mapped
// to the profile fails with fileAccessDenied). make-app.sh carries the folder
// over when it rebuilds Xiao after a Zen update.
import { checkPack, downloadProblem, isMissing, safePath, sizeLabel, sourceOf, totalSize } from './lib/packs.mjs';

const CATALOGUE = 'resource://xiao/packs.json';
const root = () => PathUtils.join(Services.dirsvc.get('GreD', Ci.nsIFile).path, 'xiao-packs');
const DONE = '.complete';
const res = () => Services.io.getProtocolHandler('resource').QueryInterface(Ci.nsIResProtocolHandler);
const nsFile = (path) => {
  const f = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
  f.initWithPath(path);
  return f;
};

export class Packs {
  busy = new Map(); // id → { done, total, error, stop }

  async start() {
    const list = await (await fetch(CATALOGUE)).json();
    this.catalogue = new Map(list.map((p) => [p.id, p]));
    for (const id of this.catalogue.keys()) if (await this.installed(id)) this.map(id);
  }

  installed(id) {
    return IOUtils.exists(PathUtils.join(root(), id, DONE));
  }

  map(id) {
    res().setSubstitution(`xiao-${id}`, Services.io.newFileURI(nsFile(PathUtils.join(root(), id))));
  }

  // A pack switched off stays on disk but is no longer served, so none of its pages can run.
  unmap(id) {
    res().setSubstitution(`xiao-${id}`, null);
  }

  async list() {
    return Promise.all([...this.catalogue.values()].map(async (p) => {
      const b = this.busy.get(p.id);
      return {
        id: p.id,
        size: sizeLabel(totalSize(p)),
        on: this.isOn?.(p.id) ?? true,
        licence: p.licence,
        installed: await this.installed(p.id),
        done: b?.done,
        total: b?.total,
        error: b?.error,
        missing: b?.missing,
      };
    }));
  }

  // Starts the download and returns at once; list() reports how it is going.
  install(id) {
    const pack = checkPack(this.catalogue.get(id) ?? { id });
    if (pack instanceof Error) throw pack;
    if (this.busy.get(id)?.done !== undefined && !this.busy.get(id)?.error) return;
    const state = { done: 0, total: totalSize(pack), stop: new AbortController() };
    this.busy.set(id, state);
    this.download(pack, state).then(() => {
      this.busy.delete(id);
      this.map(id);
      Services.obs.notifyObservers(null, 'xiao-pack-installed', id);
    }, (e) => {
      if (state.stop.signal.aborted) return; // switched off: remove() cleans up
      console.error(`Xiao: pack ${id}`, e);
      state.error = e.message;
      state.missing = e.missing === true;
    });
  }

  async download(pack, state) {
    const dir = PathUtils.join(root(), pack.id);
    try {
      await IOUtils.makeDirectory(dir, { createAncestors: true });
    } catch {
      throw new Error('this copy of Xiao is installed where it cannot be written to, so it cannot take downloads');
    }
    await IOUtils.remove(PathUtils.join(dir, DONE), { ignoreAbsent: true });
    const mirror = Services.prefs.getStringPref('xiao.packs.mirror', '');
    await this.ask(sourceOf(pack.files[0], mirror), state);
    for (const f of pack.files) {
      const target = PathUtils.join(dir, ...f.path.split('/'));
      if (!f.unzip && await this.matches(target, f)) {
        state.done += f.size;
        continue;
      }
      await IOUtils.makeDirectory(PathUtils.parent(target), { createAncestors: true });
      const part = `${target}.part`;
      await this.fetchTo(sourceOf(f, mirror), f, part, state);
      if (f.unzip) {
        this.unzip(part, dir);
        await IOUtils.remove(part);
      } else {
        await IOUtils.move(part, target);
      }
    }
    await IOUtils.writeUTF8(PathUtils.join(dir, DONE), `${pack.files.length} files\n`);
  }

  // Before a byte is written: is the download there at all? Otherwise a pack
  // with no release would look like a broken download part way through.
  async ask({ url }, state) {
    const status = await this.silent.asking([new URL(url).host], () => fetch(url, { method: 'HEAD', signal: state.stop.signal }))
      .then((r) => r.status, (e) => {
        if (state.stop.signal.aborted) throw e;
        return 0;
      });
    if (status < 200 || status >= 400) this.refuse(status);
  }

  refuse(status) {
    const e = new Error(downloadProblem(status));
    e.missing = isMissing(status);
    throw e;
  }

  // A file left by an interrupted download counts if its size is right; its
  // hash was checked before it got its name.
  async matches(path, f) {
    try {
      return (await IOUtils.stat(path)).size === f.size;
    } catch {
      return false;
    }
  }

  async fetchTo({ url, range }, f, path, state) {
    const r = await this.silent.asking([new URL(url).host], () => fetch(url, { signal: state.stop.signal, ...(range && { headers: { Range: `bytes=${range[0]}-${range[1]}` } }) }))
      .catch((e) => {
        if (state.stop.signal.aborted) throw e;
        return this.refuse(0);
      });
    if (!r.ok) this.refuse(r.status);
    const hash = Cc['@mozilla.org/security/hash;1'].createInstance(Ci.nsICryptoHash);
    hash.init(Ci.nsICryptoHash.SHA256);
    await IOUtils.write(path, new Uint8Array(0));
    const reader = r.body.getReader();
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.byteLength;
      if (got > f.size) throw new Error('the download came out damaged, so it was not kept. Try again');
      hash.update(value, value.length);
      await IOUtils.write(path, value, { mode: 'append' });
      state.done += value.byteLength;
    }
    const hex = [...hash.finish(false)].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
    if (got !== f.size || hex !== f.sha256) {
      await IOUtils.remove(path, { ignoreAbsent: true });
      throw new Error('the download came out damaged, so it was not kept. Try again');
    }
  }

  unzip(zipPath, dir) {
    const zip = Cc['@mozilla.org/libjar/zip-reader;1'].createInstance(Ci.nsIZipReader);
    zip.open(nsFile(zipPath));
    try {
      const names = zip.findEntries('*');
      while (names.hasMore()) {
        const name = names.getNext();
        if (name.endsWith('/')) continue;
        if (!safePath(name)) throw new Error(`the pack holds a file outside its folder (${name})`);
        const target = nsFile(PathUtils.join(dir, ...name.split('/')));
        if (!target.parent.exists()) target.parent.create(Ci.nsIFile.DIRECTORY_TYPE, 0o755);
        zip.extract(name, target);
      }
    } finally {
      zip.close();
    }
  }

  async remove(id) {
    if (!this.catalogue.has(id)) throw new Error(`no pack ${id}`);
    this.busy.get(id)?.stop.abort();
    this.busy.delete(id);
    res().setSubstitution(`xiao-${id}`, null);
    await IOUtils.remove(PathUtils.join(root(), id), { recursive: true, ignoreAbsent: true });
  }
}
