// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Auto-archive, as Arc does it, and off until switched on: an ordinary tab
// left alone for the chosen time is written down in the Library's Archive
// (its address, title, space and container), then closed. The Archive keeps
// it 30 days; opening it from the Library brings it back in its space and
// container.
//
// Tab sleep is different: it frees a tab's memory and keeps the tab. These
// never close: the tab on screen, pinned tabs and Essentials, tabs playing
// sound or in picture-in-picture, tabs using the camera, microphone or
// screen, tabs asking for attention, tabs with unsaved work (a page that
// would ask "leave page?"), Glance previews, and any tab in a private window
// or a Tor tab, which the Archive must never record.
import { lazy } from './mod.mjs';
import { everyTab } from './tabs.mjs';

const privateBrowsing = lazy('toolkit/modules/PrivateBrowsingUtils.sys.mjs', 'PrivateBrowsingUtils');
export const KEEP_DAYS = 30;
export const CHOICES = [0, 12, 24, 72, 168]; // hours; 0 is off

export class Archive {
  constructor(xiao) {
    this.xiao = xiao;
  }

  start(hours) {
    clearInterval(this.timer);
    this.hours = CHOICES.includes(hours) ? hours : 0;
    if (this.hours) this.timer = setInterval(() => this.sweep().catch((e) => console.error('Xiao: archive', e)), 15 * 60_000);
  }

  // Why a tab stays open, or null when it may be archived.
  // manual: archived by hand from the tab page, where the tab being selected is no reason to keep it
  keeps(tab, win, { manual = false } = {}) {
    const b = tab.linkedBrowser;
    if ((tab.selected && !manual) || tab.pinned || tab.hasAttribute('zen-essential') || tab.hasAttribute('zen-glance-tab') || tab.hasAttribute('zen-empty-tab')) return 'kept in place';
    if (tab.soundPlaying || tab.hasAttribute('pictureinpicture') || tab.hasAttribute('sharing') || tab.hasAttribute('attention')) return 'busy';
    if (privateBrowsing().isWindowPrivate(win) || tab.userContextId === this.xiao.tor.torId) return 'not recorded';
    if (!/^https?:/.test(b?.currentURI?.spec ?? '')) return 'not a web page';
    // a tab whose page is not loaded (never shown, or put to sleep) has no unsaved work to lose
    let unsaved = false;
    try {
      unsaved = b.hasBeforeUnload;
    } catch {}
    if (unsaved) return 'unsaved work';
    return null;
  }

  async sweep(hours = this.hours, now = Date.now()) {
    if (!hours) return 0;
    const store = this.xiao.library.store;
    await store.pruneArchive(now - KEEP_DAYS * 86_400_000);
    const cutoff = now - hours * 3_600_000;
    let archived = 0;
    for (const win of Services.wm.getEnumerator('navigator:browser')) {
      for (const tab of everyTab(win)) {
        if (tab.lastAccessed > cutoff || this.keeps(tab, win)) continue;
        await this.archiveTab(tab, win, { checked: true });
        archived++;
      }
    }
    if (archived) {
      this.xiao.library.index.invalidate();
      this.xiao.library.changed();
    }
    return archived;
  }

  // Closes one tab into the archive, from the sweep or the tab page; false
  // when the tab must stay (the reasons in keeps(), but for the selected tab,
  // which a reader may archive by hand from the tab page).
  async archiveTab(tab, win, { checked = false } = {}) {
    if (!checked && this.keeps(tab, win, { manual: true })) return false;
    const b = tab.linkedBrowser;
    await this.xiao.library.store.addArchive({
      url: b.currentURI.spec,
      title: tab.label || b.contentTitle || '',
      workspace: tab.getAttribute('zen-workspace-id') || null,
      userContext: tab.userContextId || 0,
    });
    win.gBrowser.removeTab(tab, { animate: false, skipPermitUnload: false });
    return true;
  }

  // Opens an archived tab again in a normal window, in its space and container.
  async restore(id, win) {
    const entry = await this.xiao.library.store.archiveEntry(id);
    if (!entry) return null;
    let target = win && !privateBrowsing().isWindowPrivate(win) ? win
      : [...Services.wm.getEnumerator('navigator:browser')].find((w) => !privateBrowsing().isWindowPrivate(w));
    if (!target) return null;
    const tab = target.gBrowser.addTab(entry.url, {
      // the page's own principal, as when the address is typed: never the system's
      triggeringPrincipal: Services.scriptSecurityManager.createContentPrincipal(Services.io.newURI(entry.url), { userContextId: entry.user_context }),
      userContextId: entry.user_context,
    });
    const spaces = target.gZenWorkspaces;
    if (entry.workspace && spaces?.getWorkspaceFromId?.(entry.workspace)) {
      spaces.moveTabToWorkspace(tab, entry.workspace);
      await spaces.changeWorkspaceWithID(entry.workspace);
    }
    target.gBrowser.selectedTab = tab;
    await this.xiao.library.store.markRestored(id);
    this.xiao.library.index.invalidate();
    this.xiao.library.changed();
    return tab;
  }
}
