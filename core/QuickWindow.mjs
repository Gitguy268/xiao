// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Quick window (Features → Quick window), like Little Arc: a link opened from
// another app gets a small window of its own, kept apart from your spaces,
// with Zen's "Move tabs to" button on its space indicator to keep it in a
// space. A link that matches one of the reader's routing rules still goes
// to that rule's space: routing rules win, as in Arc. Zen's "default space
// for links from other apps" is what the quick window replaces. Built on Zen's unsynced windows: Firefox opens external links in a
// new window (browser.link.open_newwindow.override.external = 2), and Xiao
// marks that window unsynced before Zen sets it up. If a Zen update changes
// either hook, the switch does nothing and says so once in the console.

const EXTERNAL = 'browser.link.open_newwindow.override.external';
const ROUTING = 'resource:///modules/zen/spacerouting/ZenSpaceRoutingManager.sys.mjs';
const SYNC = 'resource:///modules/zen/ZenWindowSync.sys.mjs';
const SIZE = [960, 720];

export class QuickWindow {
  on = false;
  pending = 0; // when Zen last placed a link from another app

  // The pref is cleared only when the switch goes from on to off, so a value
  // the reader set in about:config while it is off is left alone.
  set(on) {
    const was = this.on;
    this.on = !!on;
    if (this.on && !this.hooked) this.hook();
    if (this.on && this.hooked) Services.prefs.setIntPref(EXTERNAL, 2);
    else if (was) Services.prefs.clearUserPref(EXTERNAL);
  }

  hook() {
    let manager;
    try {
      manager = ChromeUtils.importESModule(ROUTING).gZenSpaceRoutingManager;
    } catch {}
    if (typeof manager?.getWindowForExternalUri !== 'function') {
      console.warn('Xiao: quick window is not available in this version of Zen');
      return;
    }
    const pick = manager.getWindowForExternalUri.bind(manager);
    manager.getWindowForExternalUri = (uri, win) => {
      if (this.on) {
        this.pending = Date.now();
        // a routing rule the reader made for this link (not Zen's default for links from other apps)
        const rule = manager.getAllRoutes?.().find((r) => manager.isRouteMatching(uri?.spec, r));
        this.route = rule && win.gZenWorkspaces.getWorkspaceFromId(rule.openIn) ? rule.openIn : null;
      }
      return pick(uri, win);
    };
    Services.ww.registerNotification(this);
    this.hooked = true;
  }

  // The first window opened right after Zen placed an external link is the one Firefox opens for it.
  observe(win, topic) {
    if (topic !== 'domwindowopened' || !this.on || Date.now() - this.pending > 3000) return;
    this.pending = 0;
    const route = this.route;
    this.route = null;
    win._zenStartupSyncFlag = 'unsynced';
    win.addEventListener('load', () => {
      win.document.documentElement.setAttribute('xiao-quick-window', 'true');
      if (!route) return void win.resizeTo(...SIZE);
      // routed: Zen's own "Move tabs to", once the window is set up, puts the link in its rule's space
      win.gZenWorkspaces.promiseInitialized.then(() => win.setTimeout(() => {
        ChromeUtils.importESModule(SYNC).ZenWindowSync.moveTabsToSyncedWorkspace(win, route);
      }, 300));
    }, { once: true });
  }
}
