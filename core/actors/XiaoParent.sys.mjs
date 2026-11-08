// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The parent-process half of the Xiao actor: answers XiaoChild in each frame.
import { ASSIST_HOST_URL, ASSIST_URL, BOARD_URL, CLIPBOARD_URL, LIBRARY_ORIGIN, LIBRARY_URL, TABS_URL, Xiao } from 'resource://xiao/XiaoCore.sys.mjs';

export class XiaoParent extends JSWindowActorParent {
  async receiveMessage({ name, data }) {
    if (name === 'cosmetics') {
      await Xiao.ready;
      return Xiao.blocker.cosmetics(data, this.browsingContext.top.currentURI?.spec ?? '', this.browsingContext.top.browserId);
    }
    if (name === 'base') {
      await Xiao.ready;
      return Xiao.blocker.engine ? Xiao.blocker.baseSheet() : '';
    }
    // The start page's calls: only from Xiao's own start page, loaded at the top of a tab.
    // documentURI comes from this process, not from the page.
    if (name === 'page') {
      const uri = this.manager.documentURI?.spec ?? '';
      const bc = this.browsingContext;
      const ordinary = !bc.usePrivateBrowsing && bc.originAttributes.userContextId !== Xiao.tor.torId;
      const from = uri.startsWith(Xiao.START_URL) ? 'start' : uri.startsWith(Xiao.ORGANISE_URL) ? 'organise'
        : Xiao.send.origin && uri.startsWith(Xiao.send.origin) && ordinary ? 'send'
        : uri.startsWith(CLIPBOARD_URL) && ordinary ? 'clipboard'
        : Xiao.aboutPdf.isPage(uri) && ordinary ? 'pdf'
        : uri.split(/[?#]/)[0] === TABS_URL && ordinary ? 'tabs'
        : uri.startsWith(ASSIST_URL) && !bc.usePrivateBrowsing && bc.originAttributes.userContextId !== Xiao.tor.torId ? 'assist'
          : uri.split(/[?#]/)[0] === BOARD_URL && !bc.usePrivateBrowsing && bc.originAttributes.userContextId !== Xiao.tor.torId ? 'board'
          // the model's page, only in the hidden tab Xiao made for it
          : uri.startsWith(ASSIST_HOST_URL) && Xiao.assist.browser && bc.top.embedderElement === Xiao.assist.browser ? 'assist-host' : null;
      if (!from || bc.parent) throw new Error('not a Xiao page');
      if (from === 'assist') this.assistPage = bc.id;
      if (from === 'send') this.sendPage = bc.id;
      return Xiao.page(data.call, data.arg, this.browsingContext, from);
    }
    // The Library's calls: checked here on every message, from what this
    // process knows about the document, never from what the page says.
    if (name === 'library') {
      if (!this.isLibrary()) throw new Error('not the Library');
      await Xiao.ready;
      return Xiao.library.request(data?.request, {
        browsingContext: this.browsingContext,
        windowId: this.manager.innerWindowId,
        gesture: data?.gesture === true,
      });
    }
    if (name === 'library-watch' && this.isLibrary()) Xiao.library.watch(this);
    if (name === 'copied') Xiao.clipboard.copied(this.browsingContext);
    // the button XiaoChild adds to Firefox's about:pdf, at the top of a tab
    if (name === 'pdf-tools' && (this.manager.documentURI?.spec ?? '').split(/[?#]/)[0] === 'about:pdf' && !this.browsingContext.parent) {
      // the tools page runs only in normal tabs: from a private window or a Tor tab it opens in a normal window
      const bc = this.browsingContext;
      const ordinary = !bc.usePrivateBrowsing && bc.originAttributes.userContextId !== Xiao.tor.torId;
      const win = ordinary ? bc.topChromeWindow : Xiao.tabCommands.windows()[0];
      if (win) Xiao.aboutPdf.open(win);
    }
    return undefined;
  }

  // Xiao's Library pack, the document now showing at the top of a normal
  // tab: not in a frame, not a page that has since navigated away, not in a
  // private window and not in a Tor tab (the Library is the ordinary
  // profile's; Tor tabs must not reach it or add to it). It must also run in
  // the content process kept for the Library's origin alone (site
  // isolation), so a web page's process can never speak for it.
  isLibrary() {
    const wg = this.manager;
    const bc = this.browsingContext;
    return wg.documentPrincipal?.originNoSuffix === LIBRARY_ORIGIN
      && bc.currentRemoteType === `webIsolated=${LIBRARY_ORIGIN}`
      && (wg.documentURI?.spec ?? '').split(/[?#]/)[0] === LIBRARY_URL
      && wg.isCurrentGlobal && !bc.parent && bc.top === bc
      && !bc.usePrivateBrowsing && !bc.originAttributes.privateBrowsingId
      && bc.originAttributes.userContextId !== Xiao.tor.torId;
  }

  didDestroy() {
    Xiao.library?.unwatch(this);
    if (this.sendPage) Xiao.send.end(this.sendPage); // this computer's address goes back to hidden
    // Assist closed or navigated away: an answer still being written is stopped, never delivered later
    if (this.assistPage && Xiao.assistRunBy === this.assistPage) Xiao.assistRun?.abort();
  }
}
