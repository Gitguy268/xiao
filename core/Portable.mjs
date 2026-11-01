// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Export and import: spaces with their tabs, folders and splits; Library
// collections and saved searches; settings. The rules for what goes in the
// file are in lib/portable.mjs. Both start only from a click on the start
// page; an import is shown in full and applied only once confirmed.

import { buildExport, ImportError, parseImport, preview, relink } from './lib/portable.mjs';
import { lazy } from './mod.mjs';
import { everyTab } from './tabs.mjs';

const identities = lazy('toolkit/components/contextualidentity/ContextualIdentityService.sys.mjs', 'ContextualIdentityService');
const privacy = lazy('toolkit/modules/PrivateBrowsingUtils.sys.mjs', 'PrivateBrowsingUtils');

const sys = () => Services.scriptSecurityManager.getSystemPrincipal();

function pickFile(win, mode, title) {
  const picker = Cc['@mozilla.org/filepicker;1'].createInstance(Ci.nsIFilePicker);
  picker.init(win.browsingContext, title, mode);
  picker.appendFilter('Xiao export', '*.json');
  if (mode === Ci.nsIFilePicker.modeSave) picker.defaultString = `Xiao ${new Date().toISOString().slice(0, 10)}.json`;
  return new Promise((resolve) => picker.open((r) => resolve(r === Ci.nsIFilePicker.returnCancel ? null : picker.file.path)));
}

export class Portable {
  constructor(xiao) {
    this.xiao = xiao;
  }

  // The tabs of one browser window, by space. Private windows give nothing.
  spacesOf(win) {
    if (privacy().isWindowPrivate(win) || !win.gZenWorkspaces?.getWorkspaces) return [];
    const torId = this.xiao.tor.torId;
    const splits = win.gZenViewSplitter?._data ?? [];
    const containerName = (id) => (id ? identities().getUserContextLabel(id) : '');
    const spaces = new Map(win.gZenWorkspaces.getWorkspaces().map((w) => [w.uuid, { name: w.name, icon: w.icon ?? '', tabs: [] }]));
    for (const tab of everyTab(win)) {
      if (tab.hasAttribute('zen-empty-tab') || tab.hasAttribute('zen-glance-tab')) continue;
      const essential = tab.hasAttribute('zen-essential');
      const space = spaces.get(tab.getAttribute('zen-workspace-id')) ?? (essential ? spaces.values().next().value : null);
      if (!space) continue;
      const split = splits.findIndex((g) => g.tabs.includes(tab));
      space.tabs.push({
        url: tab.linkedBrowser.currentURI.spec,
        title: tab.zenStaticLabel || tab.label,
        pinned: tab.pinned,
        essential,
        folder: tab.group?.isZenFolder ? tab.group.label : '',
        split: split < 0 ? undefined : split,
        container: tab.userContextId === torId ? '' : containerName(tab.userContextId),
        tor: tab.userContextId === torId,
      });
    }
    return [...spaces.values()];
  }

  async collections() {
    const lib = this.xiao.library;
    if (!this.xiao.libraryOn) return [];
    const roots = new Map((await lib.store.roots()).map((r) => [r.id, r]));
    const members = await lib.store.memberships();
    return (await lib.store.collections()).map((c) => (c.query
      ? { name: c.name, query: c.query }
      : { name: c.name, items: members.filter((m) => m.collection === c.id).map((m) => ({ name: m.rel ? m.rel.split('/').at(-1) : roots.get(m.root)?.name ?? '', kind: '' })) }));
  }

  async gather(win) {
    const features = this.xiao.features;
    const packs = (await this.xiao.packs.list()).filter((p) => p.installed && features[`pack:${p.id}`] !== false).map((p) => p.id);
    return buildExport({
      spaces: this.spacesOf(win),
      collections: await this.collections(),
      settings: { start: this.xiao.settings(), features, allow: [...this.xiao.store.allow], packs },
    });
  }

  // Asks where to save, then writes the file. Returns { saved, counts } or null if cancelled.
  async export(win) {
    const path = await pickFile(win, Ci.nsIFilePicker.modeSave, 'Export from Xiao');
    return path && this.exportTo(win, path);
  }

  async exportTo(win, path) {
    const data = await this.gather(win);
    await IOUtils.writeJSON(path, data, { tmpPath: `${path}.tmp` });
    return { saved: PathUtils.filename(path), ...preview(data) };
  }

  // Asks for a file and shows what it holds; nothing changes yet.
  async pick(win) {
    const path = await pickFile(win, Ci.nsIFilePicker.modeOpen, 'Import into Xiao');
    return path && this.load(path);
  }

  async load(path) {
    try {
      const stat = await IOUtils.stat(path);
      if (stat.size > 8 * 1024 * 1024) throw new ImportError('This file is too large to be a Xiao export.');
      this.pending = parseImport(await IOUtils.readUTF8(path));
    } catch (e) {
      this.pending = null;
      return { error: e instanceof ImportError ? e.message : 'This file could not be read.' };
    }
    return { file: PathUtils.filename(path), ...preview(this.pending) };
  }

  // Applies the file last shown by pick(). Spaces are added (never replacing
  // one), collections added, settings and switches set; packs are listed only.
  async apply(win) {
    const data = this.pending;
    this.pending = null;
    if (!data) throw new Error('nothing to import');
    const report = { spaces: 0, tabs: 0, collections: 0, missing: [], unclear: [] };
    for (const space of data.spaces) await this.addSpace(win, space, report);
    if (this.xiao.libraryOn) {
      const lib = this.xiao.library;
      for (const c of data.collections) {
        if (c.query !== undefined) {
          await lib.store.addCollection(c.name, c.query);
        } else {
          const r = await relink(c.items, async (name) => (await lib.index.query(`"${name}"`, { limit: 20 })).items);
          const id = await lib.store.addCollection(c.name);
          await lib.store.addMembers(id, r.found.map((i) => ({ root: i.root, rel: i.path.join('/') })));
          report.missing.push(...r.missing);
          report.unclear.push(...r.unclear);
        }
        report.collections++;
      }
      lib.index.invalidate();
      lib.changed();
    } else if (data.collections.length) {
      report.skipped = 'Collections need the Library switched on; they were left out.';
    }
    const start = data.settings.start;
    if (Object.keys(start).length) await this.xiao.page('save', { ...this.xiao.settings(), ...start }, win.browsingContext, 'start');
    const packs = new Set(data.settings.packs);
    const aiReady = await this.xiao.packs.installed('notes-ai');
    for (const [id, value] of Object.entries(data.settings.features)) {
      if (id === 'assist' && value && !aiReady) { // Assist on would fetch its model: left for the reader to switch on
        packs.add('notes-ai');
        continue;
      }
      await this.xiao.setFeature(typeof value === 'boolean' ? { id, on: value } : { id, value });
    }
    for (const host of data.settings.allow) this.xiao.setAllowed(host, true);
    report.packs = [];
    for (const id of packs) if (!(await this.xiao.packs.installed(id))) report.packs.push(id); // listed, never fetched by an import
    return report;
  }

  async addSpace(win, space, report) {
    const zen = win.gZenWorkspaces;
    const created = await zen.createAndSaveWorkspace(space.name, space.icon || undefined, true);
    if (!created) return;
    // Zen moves a tab only into a space it has drawn, so the tabs are opened
    // while the new space is on screen, and the previous one comes back after.
    const before = zen.activeWorkspace;
    await zen.changeWorkspaceWithID(created.uuid);
    report.spaces++;
    const containers = new Map(identities().getPublicIdentities()
      .filter((i) => i.userContextId !== this.xiao.tor.torId)
      .map((i) => [identities().getUserContextLabel(i.userContextId), i.userContextId]));
    const folders = new Map();
    const splits = new Map();
    for (const t of space.tabs) {
      const tab = win.gBrowser.addTab(t.url, { triggeringPrincipal: sys(), createLazyBrowser: true, title: t.title, userContextId: containers.get(t.container) ?? 0 });
      // a lazy tab lands in the space on screen without Zen's mark, and Zen's move skips a tab already in place
      if (!tab.hasAttribute('zen-workspace-id')) tab.setAttribute('zen-workspace-id', created.uuid);
      if (t.essential) win.gZenPinnedTabManager.addToEssentials(tab);
      else if (t.pinned) win.gBrowser.pinTab(tab);
      if (t.folder) (folders.get(t.folder) ?? folders.set(t.folder, []).get(t.folder)).push(tab);
      if (Number.isInteger(t.split)) (splits.get(t.split) ?? splits.set(t.split, []).get(t.split)).push(tab);
      report.tabs++;
    }
    for (const tabs of splits.values()) if (tabs.length > 1) win.gZenViewSplitter.splitTabs(tabs, undefined, 0, { activate: false });
    for (const [label, tabs] of folders) win.gZenFolders.createFolder(tabs, { label, workspaceId: created.uuid });
    await zen.changeWorkspaceWithID(before);
  }
}
