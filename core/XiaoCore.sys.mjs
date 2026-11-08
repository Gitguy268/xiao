// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Xiao's browser code. xiao.cfg (Firefox's AutoConfig, read from the app
// folder) loads this module at startup, in the kit's copy of Zen and in the
// fork alike. There is no extension to disable: blocking, Tor routing, the
// start page and the toolbar panel all live here.
import { AboutPdf } from './AboutPdf.mjs';
import { Archive, CHOICES as ARCHIVE_HOURS } from './Archive.mjs';
import { InstantLinks } from './InstantLinks.mjs';
import { Bangs } from './Bangs.mjs';
import { Calendar, checkSource } from './Calendar.mjs';
import { Clipboard, CLIPBOARD_URL } from './Clipboard.mjs';
import { Send } from './Send.mjs';
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
import { Shield } from './Shield.mjs';
import { Silent } from './Silent.mjs';
import { SiteMute } from './SiteMute.mjs';
import { Tor } from './Tor.mjs';
import { applyChoices, choicesFromPrefs, setDefaults, START_URL } from './StartPage.mjs';
import { TabCommands, TABS_URL } from './TabCommands.mjs';
import { Toolbar } from './Toolbar.mjs';
import { Updater } from './Updater.mjs';
import { everyTab } from './tabs.mjs';
import { ZenFilesSection } from './ZenLibrarySection.mjs';
import { parseOwnBangs } from './lib/bangs.mjs';
import { rewriteMessages } from './lib/write.mjs';
import { mod } from './mod.mjs';

export { ASSIST_HOST_URL, ASSIST_URL, BOARD_URL, CLIPBOARD_URL, LIBRARY_ORIGIN, LIBRARY_URL, TABS_URL };

const STORE = () => PathUtils.join(PathUtils.profileDir, 'xiao.json');

const DEFAULT_LINKS = [
  { name: 'Wikipedia', url: 'https://en.wikipedia.org' },
  { name: 'GitHub', url: 'https://github.com' },
  { name: 'OpenStreetMap', url: 'https://www.openstreetmap.org' },
];

// Everything Xiao remembers, in <profile>/xiao.json, written 5 s after a change.
class Store {
  allow = new Set();
  shieldOff = new Set(); // sites where fingerprint noise is off
  cameraSites = new Set(); // sites given the fake camera
  muted = new Set(); // sites whose tabs start muted
  total = 0;
  engineAt = 0;
  checkedAt = 0;
  updateAt = 0;
  settings = {};
  engine = ''; // the search choice last given to the address bar
  features = {}; // the switches in the start page's Features section
  assistStyle = ''; // the reader's style wishes for Assist's answers

  async load() {
    try {
      const saved = await IOUtils.readJSON(STORE());
      Object.assign(this, saved, { allow: new Set(saved.allow ?? []), shieldOff: new Set(saved.shieldOff ?? []), cameraSites: new Set(saved.cameraSites ?? []), muted: new Set(saved.muted ?? []) });
    } catch {} // first start
  }

  save() {
    this.saving ??= setTimeout(() => {
      this.saving = null;
      const { allow, shieldOff, cameraSites, muted, total, engineAt, checkedAt, updateAt, settings, engine, features, assistStyle } = this;
      IOUtils.writeJSON(STORE(), { allow: [...allow], shieldOff: [...shieldOff], cameraSites: [...cameraSites], muted: [...muted], total, engineAt, checkedAt, updateAt, settings, engine, features, assistStyle }, { tmpPath: `${STORE()}.tmp` })
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
    this.silent = new Silent();
    this.silent.start();
    this.store = new Store();
    this.shield = new Shield(this);
    this.tor = new Tor();
    this.tor.silent = this.silent;
    this.blocker = new Blocker(this.store, this.silent);
    this.bangs = new Bangs(this);
    this.search = new Search();
    this.search.start();
    this.packs = new Packs();
    this.packs.silent = this.silent;
    this.packs.isOn = (id) => this.packOn(id);
    this.packsReady = this.packs.start().catch((e) => console.error('Xiao: packs', e));
    this.notes = new Notes(this);
    this.library = new Library(this); // opens nothing until the Library page or a download asks
    this.archive = new Archive(this);
    this.assist = new Assist(this);
    this.portable = new Portable(this);
    this.boards = new Boards(this);
    this.quickWindow = new QuickWindow();
    this.updater = new Updater(this);
    this.send = new Send();
    this.clipboard = new Clipboard(this);
    this.aboutPdf = new AboutPdf(this);
    this.siteMute = new SiteMute(this);
    this.tabCommands = new TabCommands(this);
    this.instantLinks = new InstantLinks(this);
    this.calendar = new Calendar(this);
    this.searchUrl = Services.prefs.getStringPref('xiao.search.url', '');
    setDefaults();
    this.tor.start();
    ChromeUtils.registerWindowActor('Xiao', {
      parent: { esModuleURI: 'resource://xiao/actors/XiaoParent.sys.mjs' },
      child: {
        esModuleURI: 'resource://xiao/actors/XiaoChild.sys.mjs',
        events: { DOMWindowCreated: {}, DOMDocElementInserted: {}, DOMContentLoaded: {}, pagehide: {}, copy: { mozSystemGroup: true }, cut: { mozSystemGroup: true } },
      },
      allFrames: true,
      messageManagerGroups: ['browsers'],
      // Runs in web pages' processes. XiaoParent trusts nothing a child sends:
      // cosmetics only read the engine, and start page calls are checked
      // against the document the parent itself sees.
      safeForUntrustedWebProcess: true,
    });
    this.ready = this.store.load()
      .then(() => {
        this.shield.publish();
        this.clipboard.start().catch((e) => console.error('Xiao: clipboard', e));
        return this.blocker.start();
      })
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
    this.bangs.register();
    this.ready.then(() => {
      this.updater.started().catch((e) => console.error('Xiao: update marker', e));
      this.updater.atLaunch();
      this.applySearch();
      // 0.4's five shortcuts were search engines; bangs replace them.
      if (this.store.features.siteShortcuts !== undefined) {
        const { siteShortcuts, ...rest } = this.store.features;
        this.store.features = rest;
        this.store.save();
        if (siteShortcuts) this.search.shortcuts(false).catch((e) => console.error('Xiao: old shortcuts', e));
      }
      this.notes.show(this.features.sticky);
      this.sleepTabs(this.features.tabSleep);
      this.archive.start(this.features.autoArchive);
      this.quickWindow.set(this.features.quickWindow);
      this.calendar.start();
      // The download hook loads Firefox's download list: not while Xiao is still starting.
      this.packsReady.then(async () => {
        await this.servePacks();
        this.libraryOn = (await this.packs.installed('library')) && this.packOn('library');
        if (this.libraryOn) setTimeout(() => this.syncLibrary(), 10_000);
      });
    });
  },

  // Every switch is off until the reader turns it on, but for the fingerprint
  // noise, which costs nothing, needs nothing downloaded and has a per-site switch.
  get features() {
    // libraryDownloads only matters while the Library is on; it starts on with it.
    return { updates: true, shield: true, fakeCamera: false, sendDevice: false, noteWriting: false, clipboard: false, reader: false, sticky: false, perSite: false, tabSleep: 0, newTabCleanup: 0, libraryDownloads: true, autoArchive: 0, bangs: true, assist: false, boards: false, quickWindow: false, calendar: '', assistChats: false, ...this.store.features, silent: this.silent.on };
  },

  async featureState() {
    await this.packsReady;
    return { ...this.features, folder: this.notes.folderLabel(), packs: await this.packs.list() };
  },

  async setFeature({ id, on, value, remove }) {
    if (id === 'silent') {
      await this.silent.set(!!on);
      return;
    }
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
    } else if (id === 'updates' || id === 'sendDevice' || id === 'noteWriting' || id === 'reader') {
      this.store.features = { ...this.store.features, [id]: !!on };
    } else if (id === 'clipboard') {
      this.store.features = { ...this.store.features, clipboard: !!on };
      await this.clipboard.set(!!on);
    } else if (id === 'shield' || id === 'fakeCamera') {
      this.store.features = { ...this.store.features, [id]: !!on };
      this.shield.publish();
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
    } else if (id === 'bangs') {
      this.store.features = { ...this.store.features, bangs: !!on };
    } else if (id === 'calendar') {
      this.store.features = { ...this.store.features, calendar: checkSource(value) };
      this.calendar.start();
    } else if (id === 'newTabCleanup') {
      const minutes = [0, 5, 15, 60].includes(value) ? value : 0;
      this.store.features = { ...this.store.features, newTabCleanup: minutes };
      this.sleepTabs(this.features.tabSleep);
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
    if (minutes || this.features.newTabCleanup) this.sleepTimer = setInterval(() => this.sweepTabs(minutes), 60_000);
  },

  sweepTabs(minutes) {
    this.closeEmptyTabs(this.features.newTabCleanup);
    if (!minutes) return;
    const cutoff = Date.now() - minutes * 60_000;
    for (const win of Services.wm.getEnumerator('navigator:browser')) {
      for (const tab of everyTab(win)) {
        if (tab.selected || tab.pinned || tab.hasAttribute('zen-empty-tab') || !tab.linkedPanel || tab.soundPlaying || tab.lastAccessed > cutoff) continue;
        win.gBrowser.discardBrowser(tab);
      }
    }
  },

  // New tabs left as they opened (Dia's empty-new-tab cleanup, D42): a tab
  // still on the start page or a new tab page, never navigated, not selected,
  // not pinned and untouched for N minutes, is closed. Zen's own empty tab
  // (zen-empty-tab) is Zen's to manage.
  closeEmptyTabs(minutes) {
    if (!minutes) return 0;
    const cutoff = Date.now() - minutes * 60_000;
    const blank = (spec) => [START_URL, 'about:newtab', 'about:home', 'about:blank'].includes(spec.split(/[?#]/)[0]);
    let closed = 0;
    for (const win of Services.wm.getEnumerator('navigator:browser')) {
      for (const tab of everyTab(win)) {
        const b = tab.linkedBrowser;
        if (tab.selected || tab.pinned || tab.hasAttribute('zen-empty-tab') || tab.hasAttribute('zen-essential') || tab.lastAccessed > cutoff) continue;
        if (!blank(b.currentURI?.spec ?? '') || b.canGoBack || b.canGoForward) continue;
        win.gBrowser.removeTab(tab, { animate: false });
        closed++;
      }
    }
    return closed;
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
      style: 'normal',
      glass: false,
      links: DEFAULT_LINKS,
      bangs: {},
      ...this.store.settings,
      ...choicesFromPrefs(),
    };
  },

  async status(inTor = false) {
    return {
      total: this.store.total,
      ready: !!this.blocker.engine,
      https: Services.prefs.getBoolPref('dom.security.https_only_mode', false),
      tor: await this.tor.status({ known: !inTor }),
    };
  },

  // The start page's calls (see XiaoParent: only Xiao's own start page, top level),
  // and the voice organiser's, which may only read and write sticky notes.
  async page(name, data, browsingContext, from = 'start') {
    await this.ready;
    if (from === 'assist-host') return this.assist.host(name, data);
    if (from === 'assist') return this.assistPage(name, data ?? {}, browsingContext?.id);
    if (from === 'board') return this.boardPage(name, data ?? {});
    if (from === 'clipboard') return this.clipboard.page(name, data);
    if (from === 'pdf') return this.aboutPdf.page(name, data ?? {}, browsingContext);
    if (from === 'tabs') return this.tabCommands.page(name, data ?? {});
    if (from === 'send') {
      if (!this.features.sendDevice) throw new Error('Send to a device is off (start page → Features).');
      if (name === 'send.begin') return void this.send.begin(browsingContext.id);
    }
    if (name === 'notes.list') return this.notes.list();
    if (name === 'notes.save') return this.notes.save(data ?? {});
    if (from !== 'start') throw new Error(`unknown call ${name}`);
    if (name === 'features') return this.featureState();
    if (name === 'calendar.next') {
      if (data?.refresh) await this.calendar.refresh();
      return this.calendar.next();
    }
    if (name === 'shortcuts') return void this.openShortcuts(browsingContext.topChromeWindow);
    if (name === 'export') return this.portable.export(browsingContext.topChromeWindow);
    if (name === 'import.pick') return this.portable.pick(browsingContext.topChromeWindow);
    if (name === 'import.apply') return this.portable.apply(browsingContext.topChromeWindow);
    // Zen's importer (Zen 1.24 reads Arc's and Dia's spaces and profiles); it reads files on this computer only
    if (name === 'import.browser') return void mod('browser/components/migration/MigrationUtils.sys.mjs').MigrationUtils.showMigrationWizard(browsingContext.topChromeWindow, {});
    if (name === 'feature') {
      await this.setFeature(data ?? {});
      return this.featureState();
    }
    if (name === 'notes.folder') {
      if (data?.choose) await this.notes.chooseFolder(browsingContext.topChromeWindow);
      else this.notes.useProfile();
      return this.featureState();
    }
    if (name === 'bang') return this.bangs.resolve(data?.text);
    if (name === 'bang.run') return void await this.bangs.run(data?.action, browsingContext.topChromeWindow, String(data?.query ?? ''));
    if (name === 'drm.install') return this.silent.installDrm();
    if (name === 'updates.check') return this.updater.check();
    if (name === 'filters.update') return { changed: await this.blocker.update({ asked: true }) };
    if (name === 'get') {
      const inTor = browsingContext.originAttributes.userContextId === this.tor.torId;
      return {
        settings: this.settings(),
        status: await this.status(inTor),
        inTor,
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
        style: pick(s.style, ['normal', 'glass', 'terminal', 'retrofind'], 'normal'),
        glass: s.glass === true,
        bangs: parseOwnBangs(s.bangs),
        links: (Array.isArray(s.links) ? s.links : []).slice(0, 40)
          .filter((l) => typeof l?.name === 'string' && /^https?:\/\//.test(l?.url))
          .map(({ name, url }) => ({ name: name.slice(0, 80), url })),
      };
      applyChoices({ newtab: pick(s.newtab, ['start', 'floating'], 'start'), launch: pick(s.launch, ['start', 'restore'], 'start') });
      this.store.settings = settings;
      this.store.save();
      this.toolbar?.applyGlass();
      await this.applySearch();
      return this.settings();
    }
    throw new Error(`unknown call ${name}`);
  },

  // The Assist page's calls (resource://xiao/assist/), about the tab it was opened for.
  // The sticky note's rewrite tools, on the same local model as Assist.
  async rewriteNote({ tool, text }) {
    if (!this.features.noteWriting) throw new Error('Writing tools are off (start page → Features).');
    return this.assist.run(rewriteMessages(tool, text));
  },

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
    const extra = Array.isArray(data.tabs) ? data.tabs.filter(Number.isSafeInteger).slice(0, 5) : [];
    if (name === 'assist.evidence') return this.assist.evidence(tab, String(data.question ?? '').slice(0, 500), extra);
    if (name === 'assist.mentions') return this.assist.mentionable(tab);
    if (name === 'assist.skills') return (await this.assist.skills()).map(({ name, prompt }) => ({ name, prompt }));
    if (name === 'assist.skill.new') return this.assist.newSkill(String(data.name ?? ''), String(data.does ?? ''));
    if (name === 'assist.style') {
      if (typeof data.text === 'string') {
        this.store.assistStyle = data.text.slice(0, 500);
        this.store.save();
      }
      return { text: this.store.assistStyle, chats: !!this.features.assistChats };
    }
    if (name === 'assist.chats') {
      this.store.features = { ...this.store.features, assistChats: !!data.on };
      this.store.save();
      return { chats: !!data.on };
    }
    if (name === 'assist.ask') {
      this.assistRun?.abort();
      this.assistRun = new AbortController();
      this.assistRunBy = page;
      return this.assist.ask(tab, String(data.question ?? '').slice(0, 500), { signal: this.assistRun.signal, extra });
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

  // Zen 1.24 moved its shortcut list to about:keyboard (Firefox's own, with
  // Zen's added); older Zens keep it in Settings.
  openShortcuts(win) {
    if (Cc['@mozilla.org/network/protocol/about;1?what=keyboard']) {
      win.gBrowser.selectedTab = win.gBrowser.addTab('about:keyboard', { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
    } else {
      win.openPreferences('paneZenCKS');
    }
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
