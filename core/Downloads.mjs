// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Downloads in the Library. While the Library is on (and "Remember my
// downloads" is), each finished download of the normal profile is given to
// the Library as that one file: its name as downloaded and the site it came
// from (host only). The Downloads folder itself is never handed over.
//
// Private windows' downloads are on a list of their own that this never
// reads, and downloads made in Tor tabs are skipped. A file saved into a
// folder the reader also gave the Library is still a file in that folder,
// though: docs/library-architecture.md says so.
import { lazy } from './mod.mjs';

const downloads = lazy('toolkit/components/downloads/Downloads.sys.mjs', 'Downloads');

export class LibraryDownloads {
  constructor(library) {
    this.library = library;
  }

  async start() {
    if (this.list) return;
    this.list = await downloads().getList(downloads().PUBLIC);
    // onDownloadAdded is called for every download already in the list first:
    // that is the catch-up for what finished while the Library was closed.
    this.view = {
      onDownloadAdded: (d) => this.consider(d),
      onDownloadChanged: (d) => this.consider(d),
    };
    await this.list.addView(this.view);
  }

  async stop() {
    if (!this.list) return;
    await this.list.removeView(this.view);
    this.list = null;
  }

  // Only finished, still present, non-Tor downloads; a partial or failed one
  // never. Nor one started before the Library or "Remember my downloads" was
  // last switched on: catching up must not undo the reader's choice.
  consider(d) {
    if (!d.succeeded || d.target?.exists === false || !d.target?.path || d.source?.isPrivate) return;
    const since = this.library.xiao.features.libraryDownloadsSince ?? 0;
    if (d.startTime && new Date(d.startTime).getTime() < since) return;
    const torId = this.library.xiao.tor?.torId;
    if (torId && d.source?.userContextId === torId) return;
    let origin = null;
    try {
      origin = Services.io.newURI(d.source.url).host || null;
    } catch {}
    this.library.store.addDownload({
      path: d.target.path,
      name: PathUtils.filename(d.target.path),
      origin,
      finished: d.startTime ? new Date(d.startTime).getTime() : Date.now(), // downloads keep a start time only
    }).then(() => {
      this.library.index?.invalidate();
      this.library.changed();
    }, (e) => console.error('Xiao Library: download', e.name));
  }
}
