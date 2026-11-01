// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Xiao's browser code. xiao.cfg (Firefox's AutoConfig, read from the app
// folder) loads this module at startup, in the kit's copy of Zen and in the
// fork alike. There is no extension to disable: blocking, Tor routing, the
// start page and the toolbar panel all live here.
import { Archive, CHOICES as ARCHIVE_HOURS } from './Archive.mjs';
import { Assist, ASSIST_URL, HOST_URL as ASSIST_HOST_URL } from './Assist.mjs';
import { Blocker } from './Blocker.mjs';
import { BOARD_URL, Boards } from './Boards.mjs';
import { Library, LIBRARY_ORIGIN, LIBRARY_URL } from './Library.mjs';
import { registerUrlbar } from './LibraryUrlbar.mjs';
import { Notes, ORGANISE_URL } from './Notes.mjs';
import { Packs } from './Packs.mjs';
import { Portable } from './Portable.mjs';
import { QuickWindow } from './QuickWindow.mjs';
import { Search } from './Search.mjs';
import { Tor } from './Tor.mjs';
import { applyChoices, choicesFromPrefs, setDefaults, START_URL } from './StartPage.mjs';
import { Toolbar } from './Toolbar.mjs';
import { everyTab } from './tabs.mjs';
import { ZenFilesSection } from './ZenLibrarySection.mjs';
import { mod } from './mod.mjs';

export { ASSIST_HOST_URL, ASSIST_URL, BOARD_URL, LIBRARY_ORIGIN, LIBRARY_URL };

const STORE = () => PathUtils.join(PathUtils.profileDir, 'xiao.json');

const DEFAULT_LINKS = [
  { name: 'Wikipedia', url: 'https://en.wikipedia.org' },
  { name: 'GitHub', url: 'https://github.com' },
  { name: 'OpenStreetMap', url: 'https://www.openstreetmap.org' },
];

// Everything Xiao remembers, in <profile>/xiao.json, written 5 s after a change.
class Store {
  allow = new Set();
  total = 0;
  engineAt = 0;
  checkedAt = 0;
  settings = {};
  engine = ''; // the search choice last given to the address bar
  features = {}; // the switches in the start page's Features section

  async load() {
    try {
      const saved = await IOUtils.readJSON(STORE());
      Object.assign(this, saved, { allow: new Set(saved.allow ?? []) });
    } catch {} // first start
  }

  save() {
    this.saving ??= setTimeout(() => {
      this.saving = null;
      const { allow, total, engineAt, checkedAt, settings, engine, features } = this;
      IOUtils.writeJSON(STORE(), { allow: [...allow], total, engineAt, checkedAt, settings, engine, features }, { tmpPath: `${STORE()}.tmp` })
        .catch((e) => console.error('Xiao: could not save', e));
    }, 5_000);
  }
}

export const Xiao = {
  START_URL,
  ORGANISE_URL,
  started: false,

  // Called by xiao.cfg once the profile is known, before any window or tab.
  init() {
    if (this.started) return;
    this.started = true;
    this.store = new Store();
    this.tor = new Tor();
    this.blocker = new Blocker(this.store);
    this.search = new Search();
    this.search.start();
    this.packs = new Packs();
    this.packs.isOn = (id) => this.packOn(id);
    this.packsReady = this.packs.start().catch((e) => console.error('Xiao: packs', e));
    this.notes = new Notes(this);
    this.library = new Library(this); // opens nothing until the Library page or a download asks
    this.archive = new Archive(this);
    this.assist = new Assist(this);
    this.portable = new Portable(this);
    this.boards = new Boards(this);
    this.quickWindow = new QuickWindow();
    this.searchUrl = Services.prefs.getStringPref('xiao.search.url', '');
    setDefaults();
    this.tor.start();
    ChromeUtils.registerWindowActor('Xiao', {
      parent: { esModuleURI: 'resource://xiao/actors/XiaoParent.sys.mjs' },
      child: {
        esModuleURI: 'resource://xiao/actors/XiaoChild.sys.mjs',
        events: { DOMWindowCreated: {}, DOMDocElementInserted: {}, DOMContentLoaded: {}, pagehide: {} },
      },
      allFrames: true,
      messageManagerGroups: ['browsers'],
      // Runs in web pages' processes. XiaoParent trusts nothing a child sends:
      // cosmetics only read the engine, and start page calls are checked
      // against the document the parent itself sees.
      safeForUntrustedWebProcess: true,
    });
    this.ready = this.store.load()
      .then(() => this.blocker.start())
      .catch((e) => console.error('Xiao: blocking did not start', e));
    Services.obs.addObserver(this, 'final-ui-startup');
    Services.obs.addObserver(this, 'xiao-pack-installed');
  },

  observe(subject, topic, data) {
    if (topic === 'xiao-pack-installed' && data === 'library') {
      this.syncLibrary();
      for (const win of Services.wm.getEnumerator('navigator:browser')) this.zenFiles.attach(win);
      return;
    }
    if (topic !== 'final-ui-startup') return;
    this.zenFiles = new ZenFilesSection(this);
    const { AboutNewTab } = mod('browser/modules/AboutNewTab.sys.mjs');
    AboutNewTab.newTabURL = START_URL;
    this.toolbar = new Toolbar(this);
    this.toolbar.start();
    registerUrlbar(this);
    this.ready.then(() => {
      this.applySearch();
      this.notes.show(this.features.sticky);
      this.sleepTabs(this.features.tabSleep);
      this.archive.start(this.features.autoArchive);
      this.quickWindow.set(this.features.quickWindow);
      // The download hook loads Firefox's download list: not while Xiao is still starting.
      this.packsReady.then(async () => {
        await this.servePacks();
        this.libraryOn = (await this.packs.installed('library')) && this.packOn('library');
        if (this.libraryOn) setTimeout(() => this.syncLibrary(), 10_000);
      });
    });
  },

  // Every switch is off until the reader turns it on.
  get features() {
    // libraryDownloads only matters while the Library is on; it starts on with it.
    return { sticky: false, perSite: false, tabSleep: 0, libraryDownloads: true, autoArchive: 0, siteShortcuts: false, assist: false, boards: false, quickWindow: false, ...this.store.features };
  },

  async featureState() {
    await this.packsReady;
    return { ...this.features, folder: this.notes.folderLabel(), packs: await this.packs.list() };
  },

  async setFeature({ id, on, value, remove }) {
    if (this.packs.catalogue?.has(id) && remove) {
      // the separate "Remove download": switched off first, then deleted
      await this.setFeature({ id, on: false });
      await this.packs.remove(id);
      return;
    }
    if (this.packs.catalogue?.has(id)) {
      // Off stops the pack and stops serving it; its download stays until removed.
      this.store.features = { ...this.store.features, [`pack:${id}`]: !!on };
      if (id === 'library' && !on) {
        this.libraryOn = false;
        await this.library.setEnabled(false);
      }
      if (id === 'notes-ai' && !on && !this.features.assist) this.assist.stopHost();
      if (on && !(await this.packs.installed(id))) this.packs.install(id);
      await this.servePacks();
      if (id === 'library' && on) {
        this.store.features = { ...this.store.features, libraryDownloadsSince: Date.now() };
        await this.library.setEnabled(true, { downloads: this.features.libraryDownloads });
      }
    } else if (id === 'libraryDownloads') {
      // downloads from before this moment stay out, even those still in Firefox's list
      this.store.features = { ...this.store.features, libraryDownloads: !!on, ...(on && { libraryDownloadsSince: Date.now() }) };
      await this.syncLibrary();
    } else if (id === 'quickWindow') {
      this.store.features = { ...this.store.features, quickWindow: !!on };
      this.quickWindow.set(!!on);
    } else if (id === 'sticky' || id === 'perSite' || id === 'boards') {
      this.store.features = { ...this.store.features, [id]: !!on };
      if (id === 'sticky') this.notes.show(!!on);
    } else if (id === 'autoArchive') {
      const hours = ARCHIVE_HOURS.includes(value) ? value : 0;
      this.store.features = { ...this.store.features, autoArchive: hours };
      this.archive.start(hours);
    } else if (id === 'assist') {
      this.store.features = { ...this.store.features, assist: !!on };
      if (!on) this.assist.stopHost(); // off stops the model at once; its download stays
      else if (this.packs.catalogue?.has('notes-ai') && !(await this.packs.installed('notes-ai'))) this.packs.install('notes-ai');
      await this.servePacks();
    } else if (id === 'siteShortcuts') {
      this.store.features = { ...this.store.features, siteShortcuts: !!on };
      await this.search.shortcuts(!!on);
    } else if (id === 'tabSleep') {
      const minutes = [0, 15, 30, 60, 120].includes(value) ? value : 0;
      this.store.features = { ...this.store.features, tabSleep: minutes };
      this.sleepTabs(minutes);
    } else {
      throw new Error(`no feature ${id}`);
    }
    this.store.save();
  },

  // A pack is on unless the reader switched it off. The voice organiser's
  // download also serves Assist, so it stays served while either is on.
  packOn(id) {
    return this.features[`pack:${id}`] !== false || (id === 'notes-ai' && this.features.assist === true);
  },

  async servePacks() {
    for (const id of this.packs.catalogue?.keys() ?? []) {
      if (!(await this.packs.installed(id))) continue;
      if (this.packOn(id)) this.packs.map(id);
      else this.packs.unmap(id);
    }
  },

  // The Library's download hook runs only while its pack is there (or downloading).
  async syncLibrary() {
    const on = ((await this.packs.installed('library')) || this.packs.busy.has('library')) && this.packOn('library');
    this.libraryOn = on; // read synchronously by the address bar
    await this.library.setEnabled(on, { downloads: this.features.libraryDownloads });
  },

  // Tab sleep: a tab left alone for N minutes gives back its memory, the way
  // Zen's old tab unloader did. The selected tab, pinned tabs and tabs
  // playing sound are never put to sleep; a sleeping tab reloads when opened.
  sleepTabs(minutes) {
    clearInterval(this.sleepTimer);
    if (minutes) this.sleepTimer = setInterval(() => this.sweepTabs(minutes), 60_000);
  },

  sweepTabs(minutes) {
    const cutoff = Date.now() - minutes * 60_000;
    for (const win of Services.wm.getEnumerator('navigator:browser')) {
      for (const tab of everyTab(win)) {
        if (tab.selected || tab.pinned || tab.hasAttribute('zen-empty-tab') || !tab.linkedPanel || tab.soundPlaying || tab.lastAccessed > cutoff) continue;
        win.gBrowser.discardBrowser(tab);
      }
    }
  },

  // The address bar follows the start page's search choice, set once per
  // change so a default picked later in Zen's own settings is left alone.
  async applySearch() {
    const s = this.settings();
    const key = `${s.search}|${s.search === 'custom' ? s.custom : s.search === 'xiao' ? this.searchUrl : ''}`;
    if (this.store.engine === key) return;
    try {
      await this.search.apply(s, this.searchUrl);
      this.store.engine = key;
      this.store.save();
    } catch (e) {
      console.error('Xiao: could not set the search engine', e);
    }
  },

  settings() {
    return {
      search: 'chain',
      custom: '',
      theme: 'auto',
      links: DEFAULT_LINKS,
      ...this.store.settings,
      ...choicesFromPrefs(),
    };
  },

  async status() {
    return {
      total: this.store.total,
      ready: !!this.blocker.engine,
      https: Services.prefs.getBoolPref('dom.security.https_only_mode', false),
      tor: await this.tor.status(),
    };
  },

  // The start page's calls (see XiaoParent: only Xiao's own start page, top level),
  // and the voice organiser's, which may only read and write sticky notes.
  async page(name, data, browsingContext, from = 'start') {
    await this.ready;
    if (from === 'assist-host') return this.assist.host(name, data);
    if (from === 'assist') return this.assistPage(name, data ?? {}, browsingContext?.id);
    if (from === 'board') return this.boardPage(name, data ?? {});
    if (name === 'notes.list') return this.notes.list();
    if (name === 'notes.save') return this.notes.save(data ?? {});
    if (from !== 'start') throw new Error(`unknown call ${name}`);
    if (name === 'features') return this.featureState();
    if (name === 'shortcuts') return void browsingContext.topChromeWindow.openPreferences('paneZenCKS'); // Zen's list, rebindable and searchable
    if (name === 'export') return this.portable.export(browsingContext.topChromeWindow);
    if (name === 'import.pick') return this.portable.pick(browsingContext.topChromeWindow);
    if (name === 'import.apply') return this.portable.apply(browsingContext.topChromeWindow);
    if (name === 'feature') {
      await this.setFeature(data ?? {});
      return this.featureState();
    }
    if (name === 'notes.folder') {
      if (data?.choose) await this.notes.chooseFolder(browsingContext.topChromeWindow);
      else this.notes.useProfile();
      return this.featureState();
    }
    if (name === 'get') {
      return {
        settings: this.settings(),
        status: await this.status(),
        inTor: browsingContext.originAttributes.userContextId === this.tor.torId,
        local: this.searchUrl,
      };
    }
    if (name === 'save') {
      const s = data ?? {};
      const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
      const settings = {
        search: pick(s.search, ['chain', 'xiao', 'ddg', 'leta', 'startpage', 'brave', 'custom'], 'chain'),
        custom: typeof s.custom === 'string' && /^https?:\/\/.*%s/.test(s.custom) ? s.custom : '',
        theme: pick(s.theme, ['auto', 'light', 'dark'], 'auto'),
        links: (Array.isArray(s.links) ? s.links : []).slice(0, 40)
          .filter((l) => typeof l?.name === 'string' && /^https?:\/\//.test(l?.url))
          .map(({ name, url }) => ({ name: name.slice(0, 80), url })),
      };
      applyChoices({ newtab: pick(s.newtab, ['start', 'floating'], 'start'), launch: pick(s.launch, ['start', 'restore'], 'start') });
      this.store.settings = settings;
      this.store.save();
      await this.applySearch();
      return this.settings();
    }
    throw new Error(`unknown call ${name}`);
  },

  // The Assist page's calls (resource://xiao/assist/), about the tab it was opened for.
  // The board page's calls (resource://xiao/board/), while Boards is on.
  async boardPage(name, data) {
    if (!this.features.boards) throw new Error('Boards is off (start page → Features).');
    if (name === 'board.list') return this.boards.list();
    if (name === 'board.create') return this.boards.create(data.title);
    if (name === 'board.add') return this.boards.add(data.board, data.topic, data.text);
    if (name === 'board.save') return this.boards.save(data.board, data.text);
    if (name === 'board.html') return this.boards.html(data.board);
    throw new Error(`unknown call ${name}`);
  },

  // page: the browsing context of the Assist page asking, so closing one page
  // stops only the answer that page asked for.
  async assistPage(name, data, page) {
    const tab = Number.isSafeInteger(data.tab) ? data.tab : 0;
    if (name === 'assist.state') {
      const t = this.assist.tabFor(tab);
      return { on: this.assist.on, model: await this.assist.model(), title: t.label, ...this.assist.status() };
    }
    if (name === 'assist.status') return this.assist.status();
    if (name === 'assist.evidence') return this.assist.evidence(tab, String(data.question ?? '').slice(0, 500));
    if (name === 'assist.ask') {
      this.assistRun?.abort();
      this.assistRun = new AbortController();
      this.assistRunBy = page;
      return this.assist.ask(tab, String(data.question ?? '').slice(0, 500), { signal: this.assistRun.signal });
    }
    if (name === 'assist.summarize') {
      this.assistRun?.abort();
      this.assistRun = new AbortController();
      this.assistRunBy = page;
      return this.assist.summarize(String(data.url ?? ''), { signal: this.assistRun.signal });
    }
    if (name === 'assist.cancel') {
      this.assistRun?.abort();
      return true;
    }
    if (name === 'assist.show') return this.assist.show(tab, data.text);
    throw new Error(`unknown call ${name}`);
  },

  // The Library is one tab: focus it where it is open in a normal window,
  // or open it in this one (or in a normal window, from a private one).
  openLibrary(win) {
    const { PrivateBrowsingUtils } = mod('toolkit/modules/PrivateBrowsingUtils.sys.mjs');
    for (const w of Services.wm.getEnumerator('navigator:browser')) {
      if (PrivateBrowsingUtils.isWindowPrivate(w)) continue;
      const tab = everyTab(w).find((t) => t.linkedBrowser.currentURI?.spec.split(/[?#]/)[0] === LIBRARY_URL
        && t.userContextId !== this.tor.torId);
      if (tab) {
        w.gBrowser.selectedTab = tab;
        w.focus();
        return tab;
      }
    }
    let target = win;
    if (!target || PrivateBrowsingUtils.isWindowPrivate(target)) {
      target = [...Services.wm.getEnumerator('navigator:browser')].find((w) => !PrivateBrowsingUtils.isWindowPrivate(w));
    }
    if (!target) return null;
    const tab = target.gBrowser.addTab(LIBRARY_URL, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
    target.gBrowser.selectedTab = tab;
    target.focus();
    return tab;
  },

  openTor(win, url) {
    const tab = win.gBrowser.addTab(url ?? START_URL, {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
      userContextId: this.tor.torId,
    });
    win.gBrowser.selectedTab = tab;
    return tab;
  },

  setAllowed(host, on) {
    if (on) this.store.allow.add(host);
    else this.store.allow.delete(host);
    this.store.save();
  },
};
