// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The content-process half of the Xiao actor, one per frame:
// - web pages: Ghostery's cosmetic filtering (hide ad slots, run scriptlets);
// - Tor tabs: no WebRTC, which would bypass tor;
// - web pages: fingerprint noise and the fake camera (see ../Shield.mjs);
// - the start page: window.xiao.call(), its only way to reach Xiao;
// - the Library (resource://xiao-library/): window.xiao.request(), checked
//   again in XiaoParent and decoded in core/lib/library-protocol.mjs.
import { handlePseudoDirective, querySelectorAll } from '@ghostery/adblocker-extended-selectors';
import { DOMMonitor } from '@ghostery/adblocker-content';
import { farblePixels, farbleSamples, pickCores, siteSalt } from '../lib/farble.mjs';

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
          this.shield();
          if (this.inTor()) this.removeWebRTC();
          if ([START_URL, ORGANISE_URL, ASSIST_URL, ASSIST_HOST_URL, BOARD_URL].some((u) => uri.startsWith(u)) && !this.browsingContext.parent) this.exposeApi();
          if (uri.split(/[?#]/)[0] === LIBRARY_URL && !this.browsingContext.parent) this.exposeLibrary();
          break;
        case 'DOMDocElementInserted':
          this.shield(); // an about:blank frame becoming a page
          if (this.inTor()) this.removeWebRTC();
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

  // Which site this frame counts as, or null for Xiao's and Firefox's own pages.
  // A sandboxed frame has no origin of its own, so it counts as the site that made it.
  siteOf() {
    let p = this.document?.nodePrincipal;
    if (p?.isNullPrincipal) p = p.precursorPrincipal;
    if (!p?.isContentPrincipal || !(p.schemeIs('http') || p.schemeIs('https'))) return null;
    return p.baseDomain || p.host;
  }

  // Before the page's own scripts: each frame has its own copy of these APIs,
  // so a page can't reach a clean one by making a frame. Workers aren't covered.
  shield() {
    if (this.shielded) return;
    const s = Services.cpmm.sharedData.get('xiao:shield');
    const site = s && this.siteOf();
    if (!site) return;
    this.shielded = true;
    const win = this.contentWindow;
    const page = win.wrappedJSObject;
    if (s.on && !s.off.includes(site)) this.addNoise(win, page, siteSalt(s.seed, `${site}|${this.browsingContext.originAttributes.userContextId}`));
    if (s.camera.includes(site)) this.fakeCamera(win, page);
  }

  addNoise(win, page, salt) {
    const cores = pickCores(salt, win.navigator.hardwareConcurrency);
    Object.defineProperty(page.Navigator.prototype, 'hardwareConcurrency', {
      get: Cu.exportFunction(() => cores, win), configurable: true, enumerable: true,
    });
    const nudge = (proto, name) => {
      const real = proto?.[name];
      if (!real) return;
      proto[name] = Cu.exportFunction(function (target, ...rest) {
        Reflect.apply(real, Cu.waiveXrays(this), [target, ...rest]);
        farbleSamples(Cu.waiveXrays(target), salt);
      }, win);
    };
    // getChannelData hands out the buffer's own array, so it is nudged only once.
    const buffer = page.AudioBuffer?.prototype;
    const getChannelData = buffer?.getChannelData;
    if (getChannelData) {
      const done = new WeakSet();
      buffer.getChannelData = Cu.exportFunction(function (channel) {
        const samples = Reflect.apply(getChannelData, Cu.waiveXrays(this), [channel]);
        const raw = Cu.waiveXrays(samples);
        if (!done.has(raw)) {
          done.add(raw);
          farbleSamples(raw, salt);
        }
        return samples;
      }, win);
    }
    nudge(buffer, 'copyFromChannel');
    nudge(page.AnalyserNode?.prototype, 'getFloatFrequencyData');
    nudge(page.AnalyserNode?.prototype, 'getFloatTimeDomainData');
    // Firefox's own canvas noise covers toDataURL. Its setting for image data
    // hands back random colours, which would break real canvas apps.
    for (const proto of [page.CanvasRenderingContext2D?.prototype, page.OffscreenCanvasRenderingContext2D?.prototype]) {
      const real = proto?.getImageData;
      if (!real) continue;
      proto.getImageData = Cu.exportFunction(function (...args) {
        const image = Reflect.apply(real, Cu.waiveXrays(this), Cu.cloneInto(args, win));
        farblePixels(Cu.waiveXrays(image).data, salt);
        return image;
      }, win);
    }
    for (const proto of [page.WebGLRenderingContext?.prototype, page.WebGL2RenderingContext?.prototype]) {
      const real = proto?.readPixels;
      if (!real) continue;
      proto.readPixels = Cu.exportFunction(function (...args) {
        const raw = args.map((v) => Cu.waiveXrays(v));
        Reflect.apply(real, Cu.waiveXrays(this), raw);
        const out = raw[6];
        // Only RGBA bytes read into an array; a read into a bound buffer has no array to change.
        if (raw[4] === this.RGBA && raw[5] === this.UNSIGNED_BYTE && out?.length) farblePixels(out, salt);
      }, win);
    }
  }

  // The site asks for the camera and gets a blank moving picture; a microphone
  // it asked for is still the real one, behind Firefox's own permission prompt.
  fakeCamera(win, page) {
    const proto = page.MediaDevices?.prototype;
    const real = proto?.getUserMedia;
    if (!real) return;
    proto.getUserMedia = Cu.exportFunction(function (constraints) {
      const self = Cu.waiveXrays(this);
      const wants = Cu.waiveXrays(constraints);
      if (!wants?.video) return Reflect.apply(real, self, [constraints]);
      return new win.Promise((resolve, reject) => {
        const canvas = win.document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 480;
        const paint = () => {
          const g = canvas.getContext('2d');
          g.fillStyle = '#16181d';
          g.fillRect(0, 0, canvas.width, canvas.height);
        };
        paint();
        win.setInterval(paint, 500); // a stream with no new frames looks like a broken camera
        const video = canvas.captureStream(2);
        if (!wants.audio) return resolve(video);
        const audio = Cu.cloneInto({ audio: wants.audio }, win);
        return Reflect.apply(real, self, [audio]).then(Cu.exportFunction((mic) => {
          for (const track of mic.getAudioTracks()) video.addTrack(track);
          resolve(video);
        }, win), reject);
      });
    }, win);
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
