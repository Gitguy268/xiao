// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// about:pdf-tools, Xiao's PDF tools page, next to Firefox's own about:pdf
// (Firefox 159, so Zen 1.24): about:pdf opens a PDF in Firefox's viewer, which
// reorders, merges, signs and annotates; about:pdf-tools adds what the viewer
// doesn't do (booklets, pages per sheet, page numbers, passwords, attachments,
// keeping or turning some pages) and the PDFs downloaded lately. XiaoChild
// puts a link to it on about:pdf.
//
// The address stays about:pdf-tools while the page underneath is one of two:
// - the PDF tools pack's page (resource://xiao-pdf/index.html) when that pack
//   is downloaded and switched on;
// - otherwise a small page built into Xiao (resource://xiao/pdf/index.html)
//   that offers the download and the viewer.
// Either page keeps the principal of its resource:// address, the same as
// Xiao's start page, so it never runs with the browser's own privileges.
// Web pages can't link to it (no URI_SAFE_FOR_UNTRUSTED_CONTENT); typing it,
// about:pdf, the Xiao panel, bangs and the command bar open it.
import { mod } from './mod.mjs';

export const PDF_ABOUT = 'about:pdf-tools';
export const FIREFOX_PDF = 'about:pdf';
export const PDF_HOME_URL = 'resource://xiao/pdf/index.html';
export const PDF_PACK_URL = 'resource://xiao-pdf/index.html';
const CONTRACT = '@mozilla.org/network/protocol/about;1?what=pdf-tools';
const PROCESS_SCRIPT = 'resource://xiao/pdf/process.js';
const CID = Components.ID('{5b0b7c38-1d1e-4d0e-9c55-5f1f2b0e8a61}');
const res = () => Services.io.getProtocolHandler('resource').QueryInterface(Ci.nsIResProtocolHandler);
const registrar = () => Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
const TEMP = () => PathUtils.join(PathUtils.tempDir, 'xiao-pdf');
const MAX = 200 * 1024 * 1024; // the largest PDF handed over in one piece

export class AboutPdf {
  constructor(xiao) {
    this.xiao = xiao;
    this.handoffs = new Map(); // browsing context id → { name, bytes }, waiting for that about:pdf-tools tab
  }

  // The page under about:pdf-tools right now.
  target() {
    return res().hasSubstitution('xiao-pdf') ? PDF_PACK_URL : PDF_HOME_URL;
  }

  register() {
    if (registrar().isContractIDRegistered(CONTRACT)) return;
    const about = this;
    this.factory = {
      createInstance(iid) {
        return about.module.QueryInterface(iid);
      },
      QueryInterface: ChromeUtils.generateQI(['nsIFactory']),
    };
    this.module = {
      newChannel(uri, loadInfo) {
        const channel = Services.io.newChannelFromURIWithLoadInfo(Services.io.newURI(about.target()), loadInfo);
        channel.originalURI = uri;
        return channel;
      },
      getURIFlags() {
        return Ci.nsIAboutModule.ALLOW_SCRIPT | Ci.nsIAboutModule.URI_MUST_LOAD_IN_CHILD | Ci.nsIAboutModule.HIDE_FROM_ABOUTABOUT;
      },
      getChromeURI() {
        return Services.io.newURI(about.target());
      },
      QueryInterface: ChromeUtils.generateQI(['nsIAboutModule']),
    };
    registrar().registerFactory(CID, 'Xiao about:pdf-tools', CONTRACT, this.factory);
    this.publish();
    Services.ppmm.loadProcessScript(PROCESS_SCRIPT, true); // the same module in every content process
    IOUtils.remove(TEMP(), { recursive: true, ignoreAbsent: true }).catch(() => {}); // last session's viewer copies
  }

  // The content processes read which page is under the address from here.
  publish() {
    Services.ppmm.sharedData.set('xiao:pdfTarget', this.target());
  }

  unregister() {
    Services.ppmm.removeDelayedProcessScript(PROCESS_SCRIPT);
    if (this.factory) registrar().unregisterFactory(CID, this.factory);
    this.factory = null;
  }

  // Firefox's about:pdf where this Zen has it (Firefox 159 and later), else Xiao's page.
  hub(win) {
    if (!Cc['@mozilla.org/network/protocol/about;1?what=pdf']) return this.open(win);
    const tab = win.gBrowser.addTab(FIREFOX_PDF, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
    win.gBrowser.selectedTab = tab;
    return tab;
  }

  // Opens about:pdf-tools in a new tab of win. bytes, when given, wait there for the page to ask.
  open(win, handoff) {
    const tab = win.gBrowser.addTab(PDF_ABOUT, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
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
    let bytes;
    if (uri.schemeIs('file')) {
      bytes = await IOUtils.read(uri.QueryInterface(Ci.nsIFileURL).file.path, { maxBytes: MAX });
    } else if (uri.schemeIs('https') || uri.schemeIs('http')) {
      if (PrivateBrowsingUtils.isWindowPrivate(win) || tab.userContextId === this.xiao.tor.torId) {
        throw new Error('Save the PDF first: Xiao does not fetch it again from a private window or a Tor tab.');
      }
      bytes = await this.fetchAs(uri, browser.contentPrincipal);
    } else {
      throw new Error('Save the PDF first, then open it in about:pdf-tools.');
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

  // The page's calls (XiaoParent: only a top-level about:pdf-tools, never in a Tor tab or a private window).
  async page(name, data, browsingContext) {
    if (name === 'pdf.state') {
      const p = (await this.xiao.packs.list()).find((x) => x.id === 'pdf');
      return { pack: this.target() === PDF_PACK_URL, installed: !!p?.installed, on: !!p?.on, size: p?.size ?? '', busy: p?.done !== undefined && !p?.installed, error: p?.error ?? '' };
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
        if (!ArrayBuffer.isView(data?.bytes) || data.bytes.byteLength > MAX) throw new Error('Choose a PDF first.');
        const safe = String(data.name ?? 'document.pdf').replace(/[^\w .()-]+/g, '_').slice(0, 100).replace(/(\.pdf)?$/i, '.pdf');
        await IOUtils.makeDirectory(TEMP(), { ignoreExisting: true });
        path = PathUtils.join(TEMP(), `${Date.now()}-${safe}`);
        await IOUtils.write(path, data.bytes);
      }
      const tab = win.gBrowser.addTab(PathUtils.toFileURI(path), { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
      win.gBrowser.selectedTab = tab;
      return true;
    }
    throw new Error(`unknown call ${name}`);
  }
}
