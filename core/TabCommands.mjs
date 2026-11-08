// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The tab page (resource://xiao/tabs/): every tab in every space and window,
// searchable, with bulk actions (Dia's tab search and bulk actions, D39), and
// tab commands in words (D33, core/lib/tabplan.mjs). A command only proposes
// a plan; nothing happens until the page sends it back as a confirmed action
// on those tabs. Tor tabs and private windows are never listed.
import { matchTabs, planFor } from './lib/tabplan.mjs';
import { mod } from './mod.mjs';
import { everyTab } from './tabs.mjs';

export const TABS_URL = 'resource://xiao/tabs/index.html';

export class TabCommands {
  constructor(xiao) {
    this.xiao = xiao;
    this.ids = new WeakMap();
    this.byId = new Map(); // id → WeakRef(tab)
    this.next = 1;
  }

  idOf(tab) {
    let id = this.ids.get(tab);
    if (!id) {
      id = this.next++;
      this.ids.set(tab, id);
      this.byId.set(id, new WeakRef(tab));
    }
    return id;
  }

  windows() {
    const { PrivateBrowsingUtils } = mod('toolkit/modules/PrivateBrowsingUtils.sys.mjs');
    return [...Services.wm.getEnumerator('navigator:browser')].filter((w) => !PrivateBrowsingUtils.isWindowPrivate(w));
  }

  // [{ win, tab }] for every listable tab
  entries() {
    const out = [];
    for (const win of this.windows()) {
      for (const tab of everyTab(win)) {
        if (tab.userContextId === this.xiao.tor.torId || tab.hasAttribute('zen-empty-tab') || tab.hasAttribute('zen-glance-tab')) continue;
        const url = tab.linkedBrowser?.currentURI?.spec ?? '';
        if (!url || url.startsWith(TABS_URL)) continue;
        out.push({ win, tab });
      }
    }
    return out;
  }

  list() {
    const spaces = new Map();
    for (const win of this.windows()) for (const s of win.gZenWorkspaces?.getWorkspaces?.() ?? []) spaces.set(s.uuid, s.name);
    return {
      spaces: [...spaces].map(([uuid, name]) => ({ uuid, name })),
      tabs: this.entries().map(({ win, tab }) => ({
        id: this.idOf(tab),
        url: tab.linkedBrowser.currentURI.spec,
        title: tab.label,
        lastAccessed: tab.lastAccessed,
        pinned: tab.pinned,
        essential: tab.hasAttribute('zen-essential'),
        selected: tab.selected && win === Services.wm.getMostRecentWindow('navigator:browser'),
        muted: tab.muted,
        space: spaces.get(tab.getAttribute('zen-workspace-id')) ?? '',
      })),
    };
  }

  plan(text) {
    const { tabs, spaces } = this.list();
    const plan = planFor(text, tabs);
    if (plan.error) return plan;
    if (plan.action === 'move') {
      const space = spaces.find((s) => s.name.toLowerCase() === plan.space);
      if (!space) return { error: `There is no space called "${plan.space}".` };
      plan.space = space.uuid;
      plan.spaceName = space.name;
    }
    return { ...plan, tabs: tabs.filter((t) => plan.ids.includes(t.id)) };
  }

  // A confirmed action on the tabs the page lists by id. Ids that are gone are skipped.
  async run({ action, ids = [], space, bySite }) {
    const found = ids.map((id) => this.byId.get(id)?.deref()).filter((t) => t?.isConnected || t?.linkedBrowser);
    const entries = this.entries().filter(({ tab }) => found.includes(tab) && !tab.pinned && !tab.hasAttribute('zen-essential'));
    if (action === 'group') {
      const byWin = new Map();
      for (const e of entries) byWin.set(e.win, [...(byWin.get(e.win) ?? []), e.tab]);
      let made = 0;
      for (const [win, tabs] of byWin) {
        const groups = bySite ? this.xiao.assist.groups(win).map((g) => ({ ...g, tabs: g.tabs.filter((t) => tabs.includes(t)) })).filter((g) => g.tabs.length > 1)
          : [{ label: 'Group', tabs }];
        made += this.xiao.assist.makeGroups(win, groups);
      }
      return { done: made, undo: 'Undo tab groups' };
    }
    let done = 0;
    for (const { win, tab } of entries) {
      if (action === 'close') {
        win.gBrowser.removeTab(tab, { animate: false, skipPermitUnload: false });
      } else if (action === 'archive') {
        if (!(await this.xiao.archive.archiveTab(tab, win))) continue;
      } else if (action === 'move') {
        if (!win.gZenWorkspaces?.getWorkspaceFromId?.(space)) throw new Error('That space is gone.');
        win.gZenWorkspaces.moveTabToWorkspace(tab, space);
      } else if (action === 'mute' || action === 'unmute') {
        if (tab.muted !== (action === 'mute')) tab.toggleMuteAudio();
      } else {
        throw new Error(`no action ${action}`);
      }
      done++;
    }
    if (action === 'archive' && done) {
      this.xiao.library.index.invalidate();
      this.xiao.library.changed();
    }
    return { done };
  }

  search(text) {
    return matchTabs(this.list().tabs, { text: String(text ?? '').toLowerCase().trim() || undefined });
  }

  open(win) {
    const tab = everyTab(win).find((t) => t.linkedBrowser.currentURI.spec.startsWith(TABS_URL));
    win.gBrowser.selectedTab = tab ?? win.gBrowser.addTab(TABS_URL, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
  }

  // The page's calls (XiaoParent: the tab page at the top of a normal tab only).
  async page(name, data) {
    if (name === 'tabs.list') return this.list();
    if (name === 'tabs.plan') return this.plan(String(data?.text ?? '').slice(0, 300));
    if (name === 'tabs.run') return this.run(data ?? {});
    if (name === 'tabs.undoGroups') return { done: await this.xiao.assist.undoGroups(Services.wm.getMostRecentWindow('navigator:browser')) };
    if (name === 'tabs.focus') {
      const tab = this.byId.get(data?.id)?.deref();
      const e = this.entries().find((x) => x.tab === tab);
      if (!e) return false;
      const ws = tab.getAttribute('zen-workspace-id');
      if (ws && e.win.gZenWorkspaces?.activeWorkspace !== ws) await e.win.gZenWorkspaces.changeWorkspaceWithID(ws);
      e.win.gBrowser.selectedTab = tab;
      e.win.focus();
      return true;
    }
    throw new Error(`unknown call ${name}`);
  }
}
