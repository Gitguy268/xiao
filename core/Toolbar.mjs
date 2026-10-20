// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Xiao's one toolbar button and its panel (blocked count, the per-site
// switch, Tor), plus chrome.css in every browser window: Xiao's typefaces on
// Zen's UI, and no extensions button while there are no extensions.
import { lazy } from './mod.mjs';

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

  dress(win) {
    win.windowUtils.loadSheetUsingURIString('resource://xiao/chrome.css', win.windowUtils.AUTHOR_SHEET);
    win.gBrowser.tabContainer.addEventListener('TabSelect', () => this.badge(win.gBrowser.selectedBrowser.browserId, win));
    this.checkAddons();
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
  }
}
