// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// "Files" in Zen's own Library panel, so Xiao has one library: Zen's
// History, Downloads, Boosts and Spaces, and next to them the files the
// Library knows, searched with the same index as the Library tab, with the
// way into that tab.
//
// Zen's panel has no API for this: the section is added to the panel's
// list of sections (zenLibrarySections) when its element is defined. If a
// Zen update changes that, the section is simply not there, once noted in
// the console; the Xiao panel and the address bar still open the Library.
import { lazy } from './mod.mjs';

const privateBrowsing = lazy('toolkit/modules/PrivateBrowsingUtils.sys.mjs', 'PrivateBrowsingUtils');
const HTML = 'http://www.w3.org/1999/xhtml';
const FTL = 'xiao-library.ftl';

let registered = false;
function registerStrings() {
  if (registered) return;
  registered = true;
  // Served for every locale, so Zen's own strings never lose their language
  // because one of Xiao's files exists only in English.
  const source = new L10nFileSource('xiao', 'app', Services.locale.availableLocales, 'resource://xiao/locales/en-US/');
  const registry = L10nRegistry.getInstance();
  if (registry.hasSource('xiao')) registry.updateSources([source]);
  else registry.registerSources([source]);
}

export class ZenFilesSection {
  warned = false;

  constructor(xiao) {
    this.xiao = xiao;
  }

  async attach(win) {
    if (privateBrowsing().isWindowPrivate(win) || !(await this.xiao.packs.installed('library')) || !this.xiao.packOn('library')) return;
    registerStrings();
    win.document.l10n?.addResourceIds([{ path: FTL, optional: true }]);
    win.customElements.whenDefined('zen-library').then(() => this.add(win), () => {});
  }

  add(win) {
    const library = win.document.querySelector('zen-library');
    const sections = library?.zenLibrarySections;
    if (!sections || typeof library.requestUpdate !== 'function') {
      if (!this.warned) console.warn('Xiao: Zen\'s Library panel has changed; the Files section is left out');
      this.warned = true;
      return;
    }
    if (sections.files) return;
    const section = this.section(win);
    // after Downloads, where the panel's file-like things are
    const entries = Object.entries(sections);
    const at = entries.findIndex(([id]) => id === 'downloads') + 1 || entries.length;
    entries.splice(at, 0, ['files', section]);
    library.zenLibrarySections = Object.fromEntries(entries);
    library.requestUpdate();
  }

  // Zen renders a section by calling its render(); this one returns the same
  // element every time, built once per window.
  section(win) {
    const doc = win.document;
    const el = (tag, attrs = {}, text) => {
      const e = doc.createElementNS(HTML, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      if (text) e.textContent = text;
      return e;
    };
    const root = el('div', { class: 'zen-library-section xiao-files-section', 'data-section': 'files' });
    const input = el('input', { type: 'search', placeholder: 'Search the Library', 'aria-label': 'Search the Library' });
    const list = el('ul', { class: 'xiao-files-list', 'aria-label': 'Files' });
    const note = el('p', { class: 'xiao-files-note' });
    const open = el('button', { class: 'xiao-files-open' }, 'Open the Library');
    root.append(input, note, list, open);

    let generation = 0;
    const show = async () => {
      const mine = ++generation;
      let found;
      try {
        found = await this.xiao.library.index.query(input.value, { limit: 40 });
      } catch (e) {
        note.textContent = e.message;
        return;
      }
      if (mine !== generation) return; // a newer search is on its way
      note.textContent = found.total ? '' : input.value.trim() ? `Nothing matches “${input.value.trim()}”.` : 'Give the Library a folder, or download something, and it shows here.';
      list.replaceChildren(...found.items.map((item) => {
        const li = el('li');
        const b = el('button', { class: 'xiao-files-item', title: item.originalName && item.originalName !== item.name ? `Downloaded as ${item.originalName}` : '' });
        b.append(el('span', { class: 'xiao-files-name' }, item.name), el('span', { class: 'xiao-files-where' }, item.place ?? item.source));
        b.addEventListener('click', () => this.xiao.library.openItem(item, win).catch((e) => (note.textContent = e.message)));
        li.append(b);
        return li;
      }));
    };
    let timer;
    input.addEventListener('input', () => {
      win.clearTimeout(timer);
      timer = win.setTimeout(show, 120);
    });
    open.addEventListener('click', () => {
      win.document.querySelector('zen-library')?.constructor.close?.();
      this.xiao.openLibrary(win);
    });
    // Zen tells the section when it is shown; only then does it ask the index.
    root.onShown = show;
    root.onLibraryOpened = show;
    return { id: 'files', label: 'xiao-library-files-section-title', render: () => root };
  }
}
