// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The address bar as Xiao's one command entry:
// - up to three Library files under what you type, found in the same index
//   as the Library tab, never in private windows; nothing is sent anywhere
//   (Xiao's prefs already switch off search suggestions while typing);
// - Xiao's actions (Open the Library, a Tor tab, a new circuit, blocking on
//   this site) in Zen's own action list, so ">" and the command search show
//   them beside Zen's.
// Both are optional adapters on Zen's address bar: if a Zen update moves
// them, Xiao logs it once and the Library still opens from the Xiao panel.
import { lazy } from './mod.mjs';

const providers = lazy('browser/components/urlbar/UrlbarProvidersManager.sys.mjs', 'ProvidersManager');
const DYNAMIC = 'xiao-library';
const NAME = 'XiaoLibrary';

export function registerUrlbar(xiao) {
  try {
    const { UrlbarProvider } = ChromeUtils.importESModule('moz-src:///browser/components/urlbar/UrlbarUtils.sys.mjs');
    const { UrlbarShared } = ChromeUtils.importESModule('chrome://browser/content/urlbar/UrlbarShared.mjs');
    const { UrlbarResult } = ChromeUtils.importESModule('chrome://browser/content/urlbar/UrlbarResult.mjs');

    class XiaoLibraryProvider extends UrlbarProvider {
      get name() {
        return NAME;
      }

      get type() {
        return UrlbarShared.PROVIDER_TYPE.PROFILE;
      }

      async isActive(context) {
        const q = context.trimmedSearchString ?? '';
        return !context.isPrivate && !context.searchMode && q.length >= 2 && q.length <= 200
          && !/^[a-z][\w+.-]*:\/?\/?/i.test(q) && xiao.libraryOn === true;
      }

      async startQuery(context, add) {
        const found = await xiao.library.index.query(context.trimmedSearchString, { limit: 3 });
        const items = found.items.filter((item) => item.reason !== 'text'); // only names here; the Library searches the rest
        for (const [i, item] of items.entries()) {
          add(this, new UrlbarResult({
            type: UrlbarShared.RESULT_TYPE.DYNAMIC,
            source: UrlbarShared.RESULT_SOURCE.OTHER_LOCAL,
            suggestedIndex: i - items.length, // at the end of the list, best match first
            payload: { dynamicType: DYNAMIC, name: item.name, place: item.place ?? '', root: item.root, path: item.path, kind: item.kind },
          }));
        }
      }

      getViewTemplate() {
        return {
          attributes: { selectable: true },
          children: [
            { name: 'icon', tag: 'img', classList: ['urlbarView-favicon'] },
            { name: 'title', tag: 'span', classList: ['urlbarView-title'], children: [{ name: 'name', tag: 'strong' }] },
            { name: 'place', tag: 'span', classList: ['urlbarView-url', 'xiao-urlbar-place'] },
          ],
        };
      }

      getViewUpdate(result) {
        const { name, place, kind } = result.payload;
        return {
          icon: { attributes: { src: kind === 'directory' ? 'chrome://global/skin/icons/folder.svg' : 'moz-icon://.' + (name.split('.').pop() || 'txt') + '?size=16' } },
          name: { textContent: name },
          place: { textContent: place ? `Library · ${place}` : 'Library' },
        };
      }

      onEngagement(_context, _controller, details) {
        const { root, path, kind } = details.result.payload;
        const win = details.element.documentGlobal;
        win.gBrowser.selectedBrowser.focus();
        xiao.library.openItem({ root, path, kind }, win).catch(() => xiao.openLibrary(win));
      }
    }

    const manager = providers().getInstanceForSap('urlbar');
    if (!manager.getProvider(NAME)) manager.registerProvider(new XiaoLibraryProvider());
  } catch (e) {
    console.warn('Xiao: the address bar has changed; Library results are left out', e);
  }

  try {
    const { globalActions } = ChromeUtils.importESModule('resource:///modules/ZenUBGlobalActions.sys.mjs');
    const host = (win) => {
      const uri = win.gBrowser.selectedBrowser.currentURI;
      return /^https?$/.test(uri.scheme) ? uri.host : '';
    };
    const inTor = (win) => win.gBrowser.selectedTab.userContextId === xiao.tor.torId;
    const actions = [
      { id: 'library', label: 'Open the Library', icon: 'resource://xiao/icons/library-files.svg',
        isAvailable: (win) => xiao.libraryOn === true && !win.gBrowser.selectedBrowser.browsingContext.usePrivateBrowsing,
        command: (win) => xiao.openLibrary(win) },
      { id: 'notes', label: 'Open your notes', icon: 'chrome://browser/skin/zen-icons/edit.svg',
        isAvailable: (win) => !win.gBrowser.selectedBrowser.browsingContext.usePrivateBrowsing,
        command: (win) => xiao.notes.openFrom(win) },
      { id: 'all-tabs', label: 'All tabs: search, bulk actions, commands', icon: 'chrome://browser/skin/zen-icons/search-page.svg',
        isAvailable: (win) => !win.gBrowser.selectedBrowser.browsingContext.usePrivateBrowsing,
        command: (win) => xiao.tabCommands.open(win) },
      { id: 'pdf', label: 'PDF tools', icon: 'chrome://browser/skin/zen-icons/edit.svg',
        isAvailable: (win) => win.gBrowser.selectedBrowser.documentContentType !== 'application/pdf',
        command: (win) => xiao.aboutPdf.open(win) },
      { id: 'edit-pdf', label: 'More tools for this PDF', icon: 'chrome://browser/skin/zen-icons/edit.svg',
        isAvailable: (win) => win.gBrowser.selectedBrowser.documentContentType === 'application/pdf',
        command: (win) => xiao.aboutPdf.fromViewer(win).catch((e) => Services.prompt.alert(win, 'PDF tools', e.message)) },
      { id: 'tor-tab', label: 'Open a Tor tab', icon: 'chrome://browser/skin/zen-icons/plus.svg',
        isAvailable: () => xiao.tor.installed, command: (win) => xiao.openTor(win) },
      { id: 'tor-circuit', label: 'New Tor circuit for this site', icon: 'chrome://browser/skin/zen-icons/reload.svg',
        isAvailable: (win) => inTor(win) && !!host(win),
        command: (win) => {
          xiao.tor.newCircuit(host(win));
          win.gBrowser.selectedBrowser.reloadWithFlags(Ci.nsIWebNavigation.LOAD_FLAGS_BYPASS_CACHE);
        } },
      { id: 'pause-tab', label: 'Pause blocking in this tab', icon: 'chrome://browser/skin/zen-icons/security-broken.svg',
        isAvailable: (win) => !!host(win) && !xiao.blocker.paused.has(win.gBrowser.selectedBrowser.browserId),
        command: (win) => {
          xiao.blocker.pause(win.gBrowser.selectedBrowser.browserId, true);
          win.gBrowser.selectedBrowser.reload();
        } },
      { id: 'resume-tab', label: 'Block again in this tab', icon: 'chrome://browser/skin/zen-icons/security.svg',
        isAvailable: (win) => xiao.blocker.paused.has(win.gBrowser.selectedBrowser.browserId),
        command: (win) => {
          xiao.blocker.pause(win.gBrowser.selectedBrowser.browserId, false);
          win.gBrowser.selectedBrowser.reload();
        } },
      // Assist: reading this page only when asked; tidying this window's tabs, undoable
      { id: 'ask-page', label: 'Ask about this page', icon: 'chrome://browser/skin/zen-icons/search-page.svg',
        isAvailable: (win) => xiao.assist.on && !!host(win) && !inTor(win) && !win.gBrowser.selectedBrowser.browsingContext.usePrivateBrowsing,
        command: (win) => xiao.assist.open(win, win.gBrowser.selectedTab) },
      { id: 'tidy-titles', label: 'Tidy tab titles', icon: 'chrome://browser/skin/zen-icons/sparkles.svg',
        isAvailable: () => true, command: (win) => xiao.assist.tidyTitles(win) },
      { id: 'untidy-titles', label: 'Undo tidy tab titles', icon: 'chrome://browser/skin/zen-icons/reload.svg',
        isAvailable: (win) => win.gBrowser.tabs.some((t) => xiao.assist.titled.has(t)), command: (win) => xiao.assist.untidyTitles(win) },
      { id: 'group-tabs', label: 'Group tabs by site…', icon: 'chrome://browser/skin/zen-icons/folder.svg',
        isAvailable: (win) => xiao.assist.groups(win).length > 0,
        command: (win) => {
          const groups = xiao.assist.groups(win);
          const list = groups.map((g) => `• ${g.label}: ${g.tabs.length} tabs`).join('\n');
          if (Services.prompt.confirm(win, 'Group tabs by site', `Put these tabs into folders?\n\n${list}\n\n"Undo tab groups" in the command bar puts them back.`)) {
            xiao.assist.makeGroups(win, groups);
          }
        } },
      { id: 'ungroup-tabs', label: 'Undo tab groups', icon: 'chrome://browser/skin/zen-icons/reload.svg',
        isAvailable: () => xiao.assist.groupsMade.length > 0, command: (win) => xiao.assist.undoGroups(win) },
      { id: 'allow-site', label: 'Stop blocking on this site', icon: 'chrome://browser/skin/zen-icons/security-broken.svg',
        isAvailable: (win) => !!host(win) && !xiao.store.allow.has(host(win)),
        command: (win) => {
          xiao.setAllowed(host(win), true);
          win.gBrowser.selectedBrowser.reload();
        } },
      { id: 'block-site', label: 'Block ads and trackers on this site again', icon: 'chrome://browser/skin/zen-icons/security.svg',
        isAvailable: (win) => !!host(win) && xiao.store.allow.has(host(win)),
        command: (win) => {
          xiao.setAllowed(host(win), false);
          win.gBrowser.selectedBrowser.reload();
        } },
    ];
    for (const a of actions) {
      if (globalActions.some((g) => g.commandId === `xiao:${a.id}`)) continue;
      globalActions.push({ ...a, commandId: `xiao:${a.id}`, extraPayload: {} });
    }
  } catch (e) {
    console.warn('Xiao: Zen\'s action list has changed; Xiao\'s actions are left out', e);
  }
}
