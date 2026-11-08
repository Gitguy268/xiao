// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// "Always mute this site" (Dia's site mute, D43): tabs showing a muted site
// start muted, in every space and window, until the site is unmuted. Xiao
// only unmutes tabs it muted itself, so a tab you muted by hand stays muted.
// The list is kept in xiao.json; Tor tabs and private windows never add to it.
const MARK = 'xiao-site-muted';

export function siteOf(uri) {
  try {
    return /^https?$/.test(uri.scheme) ? uri.host.replace(/^www\./, '') : '';
  } catch {
    return '';
  }
}

export class SiteMute {
  constructor(xiao) {
    this.xiao = xiao;
  }

  get sites() {
    return this.xiao.store.muted;
  }

  isMuted(uri) {
    const site = siteOf(uri);
    return !!site && this.sites.has(site);
  }

  set(uri, on) {
    const site = siteOf(uri);
    if (!site) return;
    if (on) this.sites.add(site);
    else this.sites.delete(site);
    this.xiao.store.save();
    for (const win of Services.wm.getEnumerator('navigator:browser')) {
      for (const tab of win.gBrowser.tabs) this.apply(win, tab.linkedBrowser);
    }
  }

  apply(win, browser) {
    const tab = win.gBrowser.getTabForBrowser(browser);
    if (!tab) return;
    const want = this.isMuted(browser.currentURI);
    if (want && !tab.muted) {
      tab.toggleMuteAudio();
      tab.setAttribute(MARK, 'true');
    } else if (!want && tab.muted && tab.hasAttribute(MARK)) {
      tab.toggleMuteAudio();
      tab.removeAttribute(MARK);
    } else if (!tab.muted) {
      tab.removeAttribute(MARK);
    }
  }

  attach(win) {
    if (win.xiaoSiteMute) return;
    win.xiaoSiteMute = true;
    for (const tab of win.gBrowser.tabs) this.apply(win, tab.linkedBrowser);
    win.gBrowser.addTabsProgressListener({
      onLocationChange: (browser, progress) => {
        if (progress.isTopLevel) this.apply(win, browser);
      },
    });
  }
}
