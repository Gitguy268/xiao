// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Xiao's PDF tools page, next to Firefox's own about:pdf (Firefox 159, so
// Zen 1.24). about:pdf opens a PDF in Firefox's viewer, which reorders,
// merges, signs and annotates. Xiao's page adds what the viewer doesn't do
// (booklets, pages per sheet, page numbers, passwords, attachments, keeping
// or turning some pages) and the PDFs downloaded lately. XiaoChild puts a
// button to it on about:pdf.
//
// The page is one of two:
// - the PDF tools pack's page (resource://xiao-pdf/index.html) when that pack
//   is downloaded and switched on;
// - otherwise a small page built into Xiao (resource://xiao/pdf/index.html)
//   that offers the download and the viewer.
// It has no about: address of its own: a page with an about: principal may
// not load resource:// files, and giving it a resource:// principal under an
// about: address makes Firefox drop the load. Web pages can't open
// resource:// addresses; about:pdf, the Xiao panel, !pdf and the command bar do.
import { mod } from './mod.mjs';

export const FIREFOX_PDF = 'about:pdf';
export const PDF_HOME_URL = 'resource://xiao/pdf/index.html';
export const PDF_PACK_URL = 'resource://xiao-pdf/index.html';
const res = () => Services.io.getProtocolHandler('resource').QueryInterface(Ci.nsIResProtocolHandler);
const TEMP = () => PathUtils.join(PathUtils.tempDir, 'xiao-pdf');
const MAX = 200 * 1024 * 1024; // the largest PDF handed over in one piece

export class AboutPdf {
  constructor(xiao) {
    this.xiao = xiao;
    this.handoffs = new Map(); // browsing context id → { name, bytes }, waiting for that tools tab
    IOUtils.remove(TEMP(), { recursive: true, ignoreAbsent: true }).catch(() => {}); // last session's viewer copies
  }

  // Xiao's page right now: the tools when served, else the page that offers them.
  target() {
    return res().hasSubstitution('xiao-pdf') ? PDF_PACK_URL : PDF_HOME_URL;
  }

  isPage(uri) {
    const bare = String(uri).split(/[?#]/)[0];
    return bare === PDF_HOME_URL || bare === PDF_PACK_URL;
  }

  // Firefox's about:pdf where this Zen has it (Firefox 159 and later), else Xiao's page.
  hub(win) {
    if (!Cc['@mozilla.org/network/protocol/about;1?what=pdf']) return this.open(win);
    const tab = win.gBrowser.addTab(FIREFOX_PDF, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
    win.gBrowser.selectedTab = tab;
    return tab;
  }

  // Opens Xiao's PDF tools in a new tab of win. bytes, when given, wait there for the page to ask.
  open(win, handoff) {
    const tab = win.gBrowser.addTab(this.target(), { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
    win.gBrowser.selectedTab = tab;
    if (handoff) this.handoffs.set(tab.linkedBrowser.browsingContext.id, handoff);
    return tab;
  }

  // "More PDF tools" from a PDF open in Firefox's viewer. A local file is
  // read from disk; a web PDF is fetched again in the tab's own container and
  // never from a private window or a Tor tab, where a second request would
  // leave the tab's identity.
  async fromViewer(win) {
    const tab = win.gBrowser.selectedTab;
    const browser = tab.linkedBrowser;
    if (browser.documentContentType !== 'application/pdf') throw new Error('This tab is not showing a PDF.');
    const uri = browser.currentURI;
    const name = decodeURIComponent(uri.filePath.split('/').pop() || 'document.pdf');
    const { PrivateBrowsingUtils } = mod('toolkit/modules/PrivateBrowsingUtils.sys.mjs');
    if (PrivateBrowsingUtils.isWindowPrivate(win)) throw new Error('Xiao\'s PDF tools don\'t open in private windows. Save the PDF and open it in a normal window.');
    let bytes;
    if (uri.schemeIs('file')) {
      bytes = await IOUtils.read(uri.QueryInterface(Ci.nsIFileURL).file.path, { maxBytes: MAX });
    } else if (uri.schemeIs('https') || uri.schemeIs('http')) {
      if (tab.userContextId === this.xiao.tor.torId) {
        throw new Error('Save the PDF first: Xiao does not fetch it again from a Tor tab.');
      }
      bytes = await this.fetchAs(uri, browser.contentPrincipal);
    } else {
      throw new Error('Save the PDF first, then open it in Xiao\'s PDF tools.');
    }
    return this.open(win, { name: /\.pdf$/i.test(name) ? name : `${name}.pdf`, bytes });
  }

  // The PDF again, with the cookies of the tab's own container.
  fetchAs(uri, principal) {
    const { NetUtil } = mod('netwerk/base/NetUtil.sys.mjs');
    const channel = NetUtil.newChannel({ uri, loadingPrincipal: principal, securityFlags: Ci.nsILoadInfo.SEC_ALLOW_CROSS_ORIGIN_SEC_CONTEXT_IS_NULL, contentPolicyType: Ci.nsIContentPolicy.TYPE_OTHER });
    return new Promise((resolve, reject) => {
      NetUtil.asyncFetch(channel, (stream, status) => {
        if (!Components.isSuccessCode(status)) return reject(new Error('Could not fetch the PDF again.'));
        try {
          const n = stream.available();
          if (n > MAX) throw new Error('This PDF is too large to hand over.');
          resolve(new Uint8Array(NetUtil.readInputStream(stream, n)));
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  // PDFs from Firefox's downloads that are still on disk, newest first.
  async recent() {
    const { Downloads } = mod('toolkit/components/downloads/Downloads.sys.mjs');
    const list = await (await Downloads.getList(Downloads.PUBLIC)).getAll();
    const found = [];
    for (const d of list.slice().reverse()) {
      const path = d.target?.path;
      if (!d.succeeded || !path || !/\.pdf$/i.test(path) || found.some((f) => f.path === path)) continue;
      const info = await IOUtils.stat(path).catch(() => null);
      if (!info) continue;
      found.push({ name: PathUtils.filename(path), path, size: info.size, when: d.endTime ? new Date(d.endTime).getTime() : info.lastModified });
      if (found.length === 12) break;
    }
    return found;
  }

  // The page's calls (XiaoParent: only Xiao's PDF page at the top of a tab, never in a Tor tab or a private window).
  async page(name, data, browsingContext) {
    if (name === 'pdf.state') {
      const p = (await this.xiao.packs.list()).find((x) => x.id === 'pdf');
      return { pack: this.target() === PDF_PACK_URL, url: this.target(), installed: !!p?.installed, on: !!p?.on, size: p?.size ?? '', busy: p?.done !== undefined && !p?.installed, error: p?.error ?? '' };
    }
    if (name === 'pdf.get') return void await this.xiao.setFeature({ id: 'pdf', on: true });
    if (name === 'pdf.recent') return this.recent();
    if (name === 'pdf.read') {
      // only a file from the recent list: the page can't name any other path
      const known = (await this.recent()).find((f) => f.path === data?.path);
      if (!known) throw new Error('That PDF is no longer in your downloads.');
      return { name: known.name, bytes: await IOUtils.read(known.path, { maxBytes: MAX }) };
    }
    if (name === 'pdf.handoff') {
      const h = this.handoffs.get(browsingContext.id);
      this.handoffs.delete(browsingContext.id);
      return h ?? null;
    }
    if (name === 'pdf.view') {
      // Firefox's viewer, for highlighting, signing and forms. A recent file opens where it is;
      // dropped bytes go to a temporary copy, removed at the next start.
      const win = browsingContext.topChromeWindow;
      let path = (await this.recent()).find((f) => f.path === data?.path)?.path;
      if (!path) {
        // the page bridge carries JSON only, so the bytes come as base64
        if (typeof data?.base64 !== 'string' || data.base64.length > MAX * 1.4) throw new Error('Choose a PDF first.');
        const bytes = Uint8Array.fromBase64(data.base64);
        const safe = String(data.name ?? 'document.pdf').replace(/[^\w .()-]+/g, '_').slice(0, 100).replace(/(\.pdf)?$/i, '.pdf');
        await IOUtils.makeDirectory(TEMP(), { ignoreExisting: true });
        path = PathUtils.join(TEMP(), `${Date.now()}-${safe}`);
        await IOUtils.write(path, bytes);
      }
      const tab = win.gBrowser.addTab(PathUtils.toFileURI(path), { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
      win.gBrowser.selectedTab = tab;
      return true;
    }
    throw new Error(`unknown call ${name}`);
  }
}
