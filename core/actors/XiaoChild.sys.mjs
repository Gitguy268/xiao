// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The content-process half of the Xiao actor, one per frame:
// - web pages: Ghostery's cosmetic filtering (hide ad slots, run scriptlets);
// - Tor tabs: no WebRTC, which would bypass tor;
// - the start page: window.xiao.call(), its only way to reach Xiao;
// - the Library (resource://xiao-library/): window.xiao.request(), checked
//   again in XiaoParent and decoded in core/lib/library-protocol.mjs.
import { handlePseudoDirective, querySelectorAll } from '@ghostery/adblocker-extended-selectors';
import { DOMMonitor } from '@ghostery/adblocker-content';

const START_URL = 'resource://xiao/start/';
const ORGANISE_URL = 'resource://xiao-notes-ai/organise.html';
const LIBRARY_URL = 'resource://xiao-library/index.html';
const ASSIST_URL = 'resource://xiao/assist/index.html';
const ASSIST_HOST_URL = 'resource://xiao-notes-ai/assist-host.html';
const BOARD_URL = 'resource://xiao/board/index.html';
const USER_SHEET = Ci.nsIStyleSheetService.USER_SHEET;
const sss = Cc['@mozilla.org/content/style-sheet-service;1'].getService(Ci.nsIStyleSheetService);
const cssUri = (css) => Services.io.newURI(`data:text/css;charset=utf-8,${encodeURIComponent(css)}`);

// The generic hiding sheet, parsed once per content process and shared by every page in it.
let base = null;

export class XiaoChild extends JSWindowActorChild {
  handleEvent(event) {
    const doc = this.document;
    const uri = doc?.documentURI ?? '';
    try {
      switch (event.type) {
        case 'DOMWindowCreated':
          if (this.inTor()) this.removeWebRTC();
          if ([START_URL, ORGANISE_URL, ASSIST_URL, ASSIST_HOST_URL, BOARD_URL].some((u) => uri.startsWith(u)) && !this.browsingContext.parent) this.exposeApi();
          if (uri.split(/[?#]/)[0] === LIBRARY_URL && !this.browsingContext.parent) this.exposeLibrary();
          break;
        case 'DOMDocElementInserted':
          if (this.inTor()) this.removeWebRTC(); // an about:blank frame becoming a page
          if (/^https?:/.test(uri)) this.started = this.cosmeticsStart(uri).catch(() => false);
          break;
        case 'DOMContentLoaded':
          // The start answer can arrive after the page has loaded.
          this.started?.then((active) => active && this.document?.documentURI === uri && this.watchDom());
          break;
        case 'pagehide':
          this.monitor?.stop();
          this.monitor = null;
          break;
      }
    } catch (e) {
      if (!/NS_ERROR_NOT_AVAILABLE|destroyed/.test(String(e))) console.error('Xiao child', e);
    }
  }

  inTor() {
    const torId = Services.cpmm.sharedData.get('xiao:torId');
    return !!torId && this.browsingContext.originAttributes.userContextId === torId;
  }

  removeWebRTC() {
    const page = this.contentWindow.wrappedJSObject;
    for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'mozRTCPeerConnection', 'RTCDataChannel']) {
      try {
        delete page[name];
      } catch {}
    }
  }

  exposeApi() {
    const win = this.contentWindow;
    const api = Cu.createObjectIn(win, { defineAs: 'xiao' });
    Cu.exportFunction((call, arg) => new win.Promise((resolve, reject) => {
      this.sendQuery('page', { call, arg: arg === undefined ? undefined : JSON.parse(JSON.stringify(arg)) })
        .then((v) => resolve(Cu.cloneInto(v, win)), (e) => reject(new win.Error(String(e?.message ?? e))));
    }), api, { defineAs: 'call' });
  }

  // The Library's one call. The page says whether it was a click or key
  // press only through the browser's own record of user activation.
  exposeLibrary() {
    const win = this.contentWindow;
    const api = Cu.createObjectIn(win, { defineAs: 'xiao' });
    Cu.exportFunction((request) => new win.Promise((resolve, reject) => {
      let plain;
      try {
        plain = JSON.parse(JSON.stringify(request ?? null));
      } catch {
        return reject(new win.Error('the request is not plain data'));
      }
      const gesture = !!this.document?.hasValidTransientUserGestureActivation;
      this.sendQuery('library', { request: plain, gesture })
        .then((v) => resolve(Cu.cloneInto(v, win)), (e) => reject(new win.Error(String(e?.message ?? e))));
    }), api, { defineAs: 'request' });
    this.sendAsyncMessage('library-watch');
  }

  receiveMessage({ name, data }) {
    const win = this.contentWindow;
    if (name === 'library-changed') {
      win?.dispatchEvent(new win.CustomEvent('xiao-library-changed', { detail: Cu.cloneInto(data, win) }));
    } else if (name === 'extract') {
      return this.extract();
    } else if (name === 'show') {
      // the passage the reader clicked in Assist, found and selected in the page
      return !!win?.find(String(data?.text ?? '').slice(0, 120), false, false, true, false, false, false);
    }
    return undefined;
  }

  // What Assist reads when asked about this page, and only then: the
  // selection if there is one, otherwise the text a person sees. innerText
  // leaves out hidden elements and what is typed in fields, passwords too.
  extract() {
    const doc = this.document;
    const selection = this.contentWindow.getSelection()?.toString().trim() ?? '';
    const text = selection || doc.body?.innerText || '';
    return { title: doc.title.slice(0, 300), text: text.slice(0, 60_000), selection: !!selection };
  }

  // --- cosmetic filtering ---

  async cosmeticsStart(url) {
    const r = await this.sendQuery('cosmetics', { url, lifecycle: 'start' });
    if (!r?.active) return false;
    if (r.base) {
      const gen = Services.cpmm.sharedData.get('xiao:engineGen') ?? 0;
      if (base?.gen !== gen) {
        const css = await this.sendQuery('base');
        base = { gen, sheet: css ? sss.preloadSheet(cssUri(css), USER_SHEET) : null };
      }
      if (base.sheet) this.contentWindow.windowUtils.addSheet(base.sheet, USER_SHEET);
    }
    this.apply(r);
    return true;
  }

  apply({ styles, scripts, extended }) {
    const win = this.contentWindow;
    if (styles) win.windowUtils.loadSheet(cssUri(styles), USER_SHEET);
    for (const script of scripts ?? []) {
      // Scriptlets patch the page's own objects: run them with the page's
      // principal and without Xray vision, outside the page's CSP.
      try {
        Cu.evalInSandbox(script, Cu.Sandbox(win, { sandboxPrototype: win, wantXrays: false, sameZoneAs: win }));
      } catch {}
    }
    if (extended?.length) {
      this.extended ??= new Map();
      for (const selector of extended) this.extended.set(selector.id, selector);
      this.queueExtended([this.document.documentElement]);
    }
  }

  watchDom() {
    this.monitor = new DOMMonitor((update) => {
      if (update.type === 'elements') {
        if (update.elements.length) this.queueExtended(update.elements);
      } else {
        this.sendQuery('cosmetics', { ...update, url: this.document.documentURI, lifecycle: 'dom-update' })
          .then((r) => r?.active && this.apply(r), () => {});
      }
    });
    this.monitor.queryAll(this.contentWindow);
    this.monitor.start(this.contentWindow);
  }

  // Procedural selectors (:has-text and the like) can't be CSS: match them
  // in the page, at most once a second, and mark what they hide.
  queueExtended(elements) {
    if (!this.extended?.size) return;
    this.pending ??= new Set();
    for (const e of elements) this.pending.add(e);
    this.timer ??= this.contentWindow.setTimeout(() => {
      this.timer = null;
      try {
        this.updateExtended();
      } catch {}
    }, 1000);
  }

  updateExtended() {
    this.hidden ??= new Map();
    const roots = [...this.pending].filter((e) => e.isConnected);
    this.pending.clear();
    for (const root of roots) {
      for (const selector of this.extended.values()) {
        for (const element of querySelectorAll(root, selector.ast)) {
          if (selector.directive !== undefined) handlePseudoDirective(element, selector.directive);
          else if (selector.attribute !== undefined && !this.hidden.has(element)) {
            element.setAttribute(selector.attribute, '');
            this.hidden.set(element, { selector, root });
          }
        }
      }
    }
    for (const [element, { selector, root }] of [...this.hidden]) {
      if (!root.isConnected || !element.isConnected || !querySelectorAll(root, selector.ast).includes(element)) {
        this.hidden.delete(element);
        element.removeAttribute(selector.attribute);
      }
    }
  }

  didDestroy() {
    this.monitor?.stop();
  }
}
