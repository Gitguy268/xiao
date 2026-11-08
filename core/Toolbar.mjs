// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Xiao's one toolbar button and its panel (blocked count, the per-site
// switch, Tor), plus chrome.css in every browser window: Xiao's typefaces on
// Zen's UI, and no extensions button while there are no extensions.
import { linkMarkdown, quoteMarkdown } from './lib/markdown-link.mjs';
import { BOARD_URL } from './Boards.mjs';
import { linkItem, quoteItem } from './board/model.mjs';
import { lazy } from './mod.mjs';
import { everyTab } from './tabs.mjs';

const addons = lazy('toolkit/mozapps/extensions/AddonManager.sys.mjs', 'AddonManager');
const customizable = lazy('browser/components/customizableui/CustomizableUI.sys.mjs', 'CustomizableUI');

const XUL = 'http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul';
const VIEW = 'PanelUI-xiao';

const siteOf = (browser) => {
  const uri = browser.currentURI;
  return /^https?$/.test(uri.scheme) ? uri.host : '';
};

export class Toolbar {
  constructor(xiao) {
    this.xiao = xiao;
  }

  start() {
    customizable().createWidget({
      id: 'xiao-button',
      type: 'view',
      viewId: VIEW,
      label: 'Xiao',
      tooltiptext: 'Xiao: blocking and Tor',
      defaultArea: customizable().AREA_NAVBAR,
      onBeforeCreated: (doc) => {
        if (!doc.getElementById(VIEW)) {
          const view = doc.createXULElement('panelview');
          view.id = VIEW;
          view.className = 'PanelUI-subView';
          doc.getElementById('appMenu-viewCache')?.append(view);
        }
        return true;
      },
      onCreated: (node) => node.setAttribute('badged', 'true'),
      onViewShowing: (event) => this.fill(event.target),
    });
    for (const win of Services.wm.getEnumerator('navigator:browser')) this.dress(win);
    Services.obs.addObserver(this, 'browser-delayed-startup-finished');
    this.xiao.blocker.listeners.add((browserId) => this.badge(browserId));
    addons().addAddonListener(this);
  }

  observe(win) {
    this.dress(win);
  }

  // Choosing the Liquid glass style counts as asking for the glass toolbars too.
  glassOn(win) {
    win.document.documentElement.toggleAttribute('xiao-glass', this.wantsGlass());
  }

  wantsGlass() {
    const { glass, style } = this.xiao.settings();
    return glass || style === 'glass';
  }

  // Zen's own translucent sidebar and address bar do the toolbars; chrome.css does the panels.
  applyGlass() {
    for (const name of ['zen.theme.acrylic-sidebar', 'zen.theme.acrylic-urlbar']) Services.prefs.setBoolPref(name, this.wantsGlass());
    for (const win of Services.wm.getEnumerator('navigator:browser')) this.glassOn(win);
  }

  dress(win) {
    win.windowUtils.loadSheetUsingURIString('resource://xiao/chrome.css', win.windowUtils.AUTHOR_SHEET);
    this.glassOn(win);
    this.xiao.zenFiles?.attach(win).catch((e) => console.error('Xiao: Files section', e));
    win.gBrowser.tabContainer.addEventListener('TabSelect', () => this.badge(win.gBrowser.selectedBrowser.browserId, win));
    this.addClipItem(win);
    this.addMarkdownItem(win);
    this.xiao.siteMute.attach(win);
    this.addSummaryItem(win);
    this.addBoardMenu(win);
    // a closed tab's count, and any pause of blocking in it, go with it
    win.gBrowser.tabContainer.addEventListener('TabClose', (e) => this.xiao.blocker.forget(e.target.linkedBrowser?.browserId));
    this.checkAddons();
  }

  // "Save to Clippings" in the page's context menu, for selected text, while
  // the sticky note is on. Never in private windows or Tor tabs, so what is
  // read there is not written down. The link kept is the page without its
  // query, fragment or login, which can carry personal details.
  addClipItem(win) {
    const menu = win.document.getElementById('contentAreaContextMenu');
    if (!menu || win.document.getElementById('xiao-clip')) return;
    const item = win.document.createXULElement('menuitem');
    item.id = 'xiao-clip';
    item.setAttribute('label', 'Save to Clippings');
    win.document.getElementById('context-copy')?.after(item) ?? menu.append(item);
    menu.addEventListener('popupshowing', (e) => {
      if (e.target !== menu) return;
      const ctx = win.gContextMenu;
      const browser = ctx?.browser;
      const torTab = browser && browser.contentPrincipal?.originAttributes?.userContextId === this.xiao.tor.torId;
      item.hidden = !ctx?.isTextSelected || !this.xiao.features.sticky || !browser || ctx.isPrivate
        || browser.browsingContext?.usePrivateBrowsing || torTab || !/^https?$/.test(browser.currentURI.scheme);
    });
    item.addEventListener('command', () => {
      const ctx = win.gContextMenu;
      const text = ctx?.selectionInfo?.fullText || ctx?.textSelected || '';
      const browser = ctx?.browser;
      if (!text.trim() || !browser) return;
      const url = browser.currentURI.mutate().setUserPass('').setQuery('').setRef('').finalize().spec;
      this.xiao.notes.clip({ text, title: browser.contentTitle, url }).catch((err) => console.error('Xiao: clipping', err));
    });
  }

  // "Copy as Markdown" (Arc's Super Copy, A30): the link under the pointer,
  // else the selected words as a quote linking to those words on the page,
  // else the page. Addresses lose any login; the clipboard is the only place
  // it goes, so it works in private windows and Tor tabs too.
  addMarkdownItem(win) {
    const doc = win.document;
    const menu = doc.getElementById('contentAreaContextMenu');
    if (!menu || doc.getElementById('xiao-markdown')) return;
    const item = doc.createXULElement('menuitem');
    item.id = 'xiao-markdown';
    item.setAttribute('label', 'Copy as Markdown');
    (doc.getElementById('context-copylink') ?? doc.getElementById('context-copy'))?.after(item) ?? menu.append(item);
    menu.addEventListener('popupshowing', (e) => {
      if (e.target !== menu) return;
      const browser = win.gContextMenu?.browser;
      item.hidden = !browser || !/^(https?|file)$/.test(browser.currentURI.scheme);
    });
    item.addEventListener('command', () => {
      const text = this.markdownFor(win.gContextMenu);
      if (text) Cc['@mozilla.org/widget/clipboardhelper;1'].getService(Ci.nsIClipboardHelper).copyString(text);
    });
  }

  markdownFor(ctx) {
    const browser = ctx?.browser;
    if (!browser) return '';
    const clean = (uri) => uri.mutate().setUserPass('').finalize().spec;
    if (ctx.onLink && /^(https?|file):/.test(ctx.linkURL ?? '')) return linkMarkdown(ctx.linkTextStr || ctx.linkURL, clean(Services.io.newURI(ctx.linkURL)));
    const words = ctx.isTextSelected && (ctx.selectionInfo?.fullText || ctx.textSelected);
    return words ? quoteMarkdown(words, browser.contentTitle, clean(browser.currentURI)) : linkMarkdown(browser.contentTitle, clean(browser.currentURI));
  }

  // "Add to Board" in the page's context menu, while Boards is on: the link
  // under the pointer, else the selected words with their page, else the
  // page itself. Never in private windows or Tor tabs. Addresses keep their
  // query (it can be the page itself) but lose any login.
  addBoardMenu(win) {
    const doc = win.document;
    const menu = doc.getElementById('contentAreaContextMenu');
    if (!menu || doc.getElementById('xiao-board')) return;
    const item = doc.createXULElement('menu');
    item.id = 'xiao-board';
    item.setAttribute('label', 'Add to Board');
    const popup = doc.createXULElement('menupopup');
    item.append(popup);
    (doc.getElementById('xiao-clip') ?? doc.getElementById('context-copy'))?.after(item) ?? menu.append(item);
    const clean = (uri) => uri.mutate().setUserPass('').finalize().spec;
    const what = () => {
      const ctx = win.gContextMenu;
      const browser = ctx?.browser;
      if (ctx?.onLink && /^https?:/.test(ctx.linkURL)) return { topic: 'Links', text: linkItem({ title: ctx.linkTextStr || ctx.linkURL, url: clean(Services.io.newURI(ctx.linkURL)) }) };
      const page = { title: browser.contentTitle, url: clean(browser.currentURI) };
      const words = ctx?.isTextSelected && (ctx.selectionInfo?.fullText || ctx.textSelected);
      return words ? { topic: 'Quotes', text: quoteItem({ text: words, ...page }) } : { topic: 'Links', text: linkItem(page) };
    };
    menu.addEventListener('popupshowing', (e) => {
      if (e.target !== menu) return;
      const ctx = win.gContextMenu;
      const browser = ctx?.browser;
      const torTab = browser && browser.contentPrincipal?.originAttributes?.userContextId === this.xiao.tor.torId;
      item.hidden = !this.xiao.features.boards || !browser || ctx.isPrivate || browser.browsingContext?.usePrivateBrowsing || torTab
        || !/^https?$/.test(browser.currentURI.scheme);
      if (item.hidden) return;
      popup.replaceChildren();
      this.xiao.boards.list().then((boards) => {
        for (const b of boards.slice(0, 12)) {
          const entry = doc.createXULElement('menuitem');
          entry.setAttribute('label', b.title);
          entry.addEventListener('command', () => {
            const { topic, text } = what();
            this.xiao.boards.add(b.name, topic, text).catch((err) => console.error('Xiao: board', err));
          });
          popup.append(entry);
        }
        if (boards.length) popup.append(doc.createXULElement('menuseparator'));
        const open = doc.createXULElement('menuitem');
        open.setAttribute('label', boards.length ? 'Open Boards' : 'Make a Board…');
        open.addEventListener('command', () => this.openBoards(win));
        popup.append(open);
      });
    });
  }

  openBoards(win) {
    const tab = everyTab(win).find((t) => t.linkedBrowser.currentURI.spec.split(/[?#]/)[0] === BOARD_URL);
    win.gBrowser.selectedTab = tab ?? win.gBrowser.addTab(BOARD_URL, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
  }

  // "Summarize Link" on a link, while Assist is on: the link is fetched
  // only when chosen, never on hover. Not in private windows or Tor tabs.
  addSummaryItem(win) {
    const menu = win.document.getElementById('contentAreaContextMenu');
    if (!menu || win.document.getElementById('xiao-summarize')) return;
    const item = win.document.createXULElement('menuitem');
    item.id = 'xiao-summarize';
    item.setAttribute('label', 'Summarize Link');
    win.document.getElementById('context-copylink')?.after(item) ?? menu.append(item);
    menu.addEventListener('popupshowing', (e) => {
      if (e.target !== menu) return;
      const ctx = win.gContextMenu;
      const tab = win.gBrowser.getTabForBrowser(ctx?.browser);
      item.hidden = !this.xiao.assist.on || !ctx?.onLink || !/^https?:/.test(ctx.linkURL ?? '') || ctx.isPrivate
        || !tab || tab.userContextId === this.xiao.tor.torId || win.gBrowser.selectedBrowser.browsingContext.usePrivateBrowsing;
    });
    item.addEventListener('command', () => {
      const ctx = win.gContextMenu;
      const tab = win.gBrowser.getTabForBrowser(ctx?.browser);
      if (tab && ctx?.linkURL) this.xiao.assist.open(win, tab, { summarize: ctx.linkURL });
    });
  }

  // Firefox's puzzle-piece button only lists extensions; with none installed it would only list nothing.
  async checkAddons() {
    const all = await addons().getAddonsByTypes(['extension']);
    const any = all.some((a) => !a.isBuiltin && !a.isSystem && !a.hidden);
    for (const win of Services.wm.getEnumerator('navigator:browser')) {
      win.document.documentElement.toggleAttribute('xiao-no-addons', !any);
    }
  }

  onInstalled() { this.checkAddons(); }

  onUninstalled() { this.checkAddons(); }

  badge(browserId, only) {
    for (const win of only ? [only] : Services.wm.getEnumerator('navigator:browser')) {
      if (win.gBrowser.selectedBrowser.browserId !== browserId) continue;
      const button = customizable().getWidget('xiao-button')?.forWindow(win)?.node;
      const n = this.xiao.blocker.blockedOn(browserId);
      if (button) button.setAttribute('badge', n ? String(n) : '');
    }
  }

  async fill(view) {
    const doc = view.ownerDocument;
    const win = doc.defaultView;
    const browser = win.gBrowser.selectedBrowser;
    const host = siteOf(browser);
    const inTor = browser.contentPrincipal?.originAttributes?.userContextId === this.xiao.tor.torId
      || win.gBrowser.selectedTab.getAttribute('usercontextid') === String(this.xiao.tor.torId);
    const el = (tag, attrs = {}, text) => {
      const e = tag.includes(':') ? doc.createElementNS('http://www.w3.org/1999/xhtml', tag.split(':')[1]) : doc.createElementNS(XUL, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      if (text) e.textContent = text;
      return e;
    };
    const blocked = this.xiao.blocker.blockedOn(browser.browserId);
    const total = this.xiao.store.total.toLocaleString();
    const body = el('vbox', { class: 'panel-subview-body xiao-panel' });
    body.append(
      el('html:h2', { class: 'xiao-host' }, host || 'This page'),
      el('html:p', { id: 'xiao-count' }, host ? `${blocked} blocked on this page, ${total} in total.` : `${total} ads and trackers blocked in total.`),
    );
    if (host) {
      const box = el('checkbox', { id: 'xiao-block', label: 'Block ads and trackers on this site' });
      box.checked = !this.xiao.store.allow.has(host);
      box.addEventListener('command', () => {
        this.xiao.setAllowed(host, !box.checked);
        browser.reload();
      });
      body.append(box);
      if (box.checked) {
        const pause = el('checkbox', { id: 'xiao-pause', label: 'Pause blocking in this tab until it closes' });
        pause.checked = this.xiao.blocker.paused.has(browser.browserId);
        pause.addEventListener('command', () => {
          this.xiao.blocker.pause(browser.browserId, pause.checked);
          browser.reload();
        });
        body.append(pause);
      }
      const site = browser.contentPrincipal?.baseDomain || host;
      const siteBox = (id, label, checked, change) => {
        const b = el('checkbox', { id, label });
        b.checked = checked;
        b.addEventListener('command', () => {
          change(b.checked);
          browser.reload();
        });
        body.append(b);
      };
      if (this.xiao.features.shield) siteBox('xiao-shield', 'Vary my fingerprint on this site', this.xiao.shield.isOn(site), (on) => this.xiao.shield.setSite(site, on));
      if (this.xiao.features.fakeCamera) siteBox('xiao-camera', 'Show this site a blank camera', this.xiao.shield.hasCamera(site), (on) => this.xiao.shield.setCamera(site, on));
    }
    body.append(el('toolbarseparator'));
    const torLine = el('html:p', { id: 'xiao-tor' }, 'Checking Tor…');
    body.append(torLine);
    view.replaceChildren(body);

    const tor = await this.xiao.tor.status();
    torLine.textContent = !tor.installed ? 'Tor tabs need Xiao installed with Tor.'
      : !tor.isTor ? 'Tor is not connected yet.'
        : inTor ? 'This tab goes through Tor.' : 'Tor is connected.';
    torLine.classList.toggle('on', tor.isTor);
    const action = (label, fn) => {
      const b = el('toolbarbutton', { class: 'subviewbutton', label });
      b.addEventListener('command', () => {
        fn();
        customizable().hidePanelForNode(b);
      });
      body.append(b);
    };
    if (tor.isTor && !inTor) action('Open a Tor tab', () => this.xiao.openTor(win));
    // tor picks a new exit for the site; the reload uses it.
    if (inTor && host) {
      action('New Tor circuit for this site', () => {
        this.xiao.tor.newCircuit(host);
        browser.reloadWithFlags(Ci.nsIWebNavigation.LOAD_FLAGS_BYPASS_CACHE);
      });
    }
    const site = /^https?$/.test(browser.currentURI.scheme);
    const openPage = (url) => {
      win.gBrowser.selectedTab = win.gBrowser.addTab(url, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
    };
    if (site) {
      body.append(el('toolbarseparator'));
      const muted = this.xiao.siteMute.isMuted(browser.currentURI);
      if (!muted && !inTor && !browser.browsingContext.usePrivateBrowsing) action('Always mute this site', () => this.xiao.siteMute.set(browser.currentURI, true));
      if (muted) action('Stop muting this site', () => this.xiao.siteMute.set(browser.currentURI, false));
      action(this.xiao.silent.on ? 'Translate: needs its language files, which silent mode won\'t fetch' : 'Translate this page', () => win.FullPageTranslationsPanel?.open(new win.Event('command'), false));
    }
    if (this.xiao.features.reader) action('Reader', () => openPage('resource://xiao/reader/index.html'));
    if (this.xiao.features.clipboard) action('Clipboard history', () => openPage('resource://xiao/clipboard/index.html'));
    if (this.xiao.features.sendDevice) action('Send to a device', () => this.xiao.send.open(win));
    action('Notes', () => this.xiao.notes.openFrom(win));
    if (!browser.browsingContext.usePrivateBrowsing) action('All tabs', () => this.xiao.tabCommands.open(win));
    // Firefox's about:pdf (Zen 1.24), which links to Xiao's PDF tools; on a PDF, those tools.
    if (browser.documentContentType === 'application/pdf') {
      action('More tools for this PDF', () => this.xiao.aboutPdf.fromViewer(win).catch((e) => Services.prompt.alert(win, 'PDF tools', e.message)));
    } else {
      action('PDF', () => this.xiao.aboutPdf.hub(win));
    }
    // The downloaded features, each once it is installed.
    const tools = [
      ['library', 'Library', () => this.xiao.openLibrary(win)],
      ['convert', 'Convert a file', 'resource://xiao-convert/index.html'],
      ['notes-ai', 'Sort my notes by voice', this.xiao.ORGANISE_URL],
    ];
    let first = true;
    if (this.xiao.features.boards) {
      body.append(el('toolbarseparator'));
      first = false;
      action('Boards', () => this.openBoards(win));
    }
    for (const [id, label, url] of tools) {
      if (!(await this.xiao.packs.installed(id)) || !this.xiao.packOn(id)) continue;
      if (first) body.append(el('toolbarseparator'));
      first = false;
      action(label, typeof url === 'function' ? url : () => {
        win.gBrowser.selectedTab = win.gBrowser.addTab(url, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
      });
    }
  }
}
