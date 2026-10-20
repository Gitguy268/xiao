// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Xiao's browser code. xiao.cfg (Firefox's AutoConfig, read from the app
// folder) loads this module at startup, in the kit's copy of Zen and in the
// fork alike. There is no extension to disable: blocking, Tor routing, the
// start page and the toolbar panel all live here.
import { Blocker } from './Blocker.mjs';
import { Tor } from './Tor.mjs';
import { applyChoices, choicesFromPrefs, setDefaults, START_URL } from './StartPage.mjs';
import { Toolbar } from './Toolbar.mjs';
import { mod } from './mod.mjs';

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

  async load() {
    try {
      const saved = await IOUtils.readJSON(STORE());
      Object.assign(this, saved, { allow: new Set(saved.allow ?? []) });
    } catch {} // first start
  }

  save() {
    this.saving ??= setTimeout(() => {
      this.saving = null;
      const { allow, total, engineAt, checkedAt, settings } = this;
      IOUtils.writeJSON(STORE(), { allow: [...allow], total, engineAt, checkedAt, settings }, { tmpPath: `${STORE()}.tmp` })
        .catch((e) => console.error('Xiao: could not save', e));
    }, 5_000);
  }
}

export const Xiao = {
  START_URL,
  started: false,

  // Called by xiao.cfg once the profile is known, before any window or tab.
  init() {
    if (this.started) return;
    this.started = true;
    this.store = new Store();
    this.tor = new Tor();
    this.blocker = new Blocker(this.store);
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
  },

  observe(_subject, topic) {
    if (topic !== 'final-ui-startup') return;
    const { AboutNewTab } = mod('browser/modules/AboutNewTab.sys.mjs');
    AboutNewTab.newTabURL = START_URL;
    this.toolbar = new Toolbar(this);
    this.toolbar.start();
  },

  settings() {
    return {
      search: this.searchUrl ? 'xiao' : 'ddg',
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

  // The start page's calls (see XiaoParent: only Xiao's own start page, top level).
  async page(name, data, browsingContext) {
    await this.ready;
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
        search: pick(s.search, ['xiao', 'ddg', 'leta', 'startpage', 'brave', 'custom'], 'ddg'),
        custom: typeof s.custom === 'string' && /^https?:\/\/.*%s/.test(s.custom) ? s.custom : '',
        theme: pick(s.theme, ['auto', 'light', 'dark'], 'auto'),
        links: (Array.isArray(s.links) ? s.links : []).slice(0, 40)
          .filter((l) => typeof l?.name === 'string' && /^https?:\/\//.test(l?.url))
          .map(({ name, url }) => ({ name: name.slice(0, 80), url })),
      };
      applyChoices({ newtab: pick(s.newtab, ['start', 'floating'], 'start'), launch: pick(s.launch, ['start', 'restore'], 'start') });
      this.store.settings = settings;
      this.store.save();
      return this.settings();
    }
    throw new Error(`unknown call ${name}`);
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
