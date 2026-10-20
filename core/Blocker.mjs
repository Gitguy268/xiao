// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Ad and tracker blocking inside the browser: Ghostery's engine (MPL-2.0)
// matched against every request in the parent process, before it leaves.
//
// The engine ships prebuilt (engine.bin, made by scripts/build.mjs from
// EasyList, EasyPrivacy and uBlock Origin's lists), so the browser never
// downloads or parses raw lists. Once a day Xiao looks for a newer prebuilt
// engine in the repository's "engine" release on GitHub (rebuilt daily by
// .github/workflows/engine.yml), checks its SHA-256 and keeps it in the profile.
import { ENGINE_VERSION, FiltersEngine, Request } from '@ghostery/adblocker';
import { fromWeb, ghosteryDetails, hostOf, pageOf, typeNames } from './lib/request.mjs';

const DAY = 24 * 60 * 60 * 1000;
const BUILT_IN = 'resource://xiao/engine.bin';
const UPDATE = `https://github.com/Gitguy268/xiao/releases/download/engine/engine-${ENGINE_VERSION}.bin`;

export class Blocker {
  constructor(store) {
    this.store = store; // { allow: Set, total, engineAt, save() }
    this.engine = null;
    this.perBrowser = new Map(); // browserId → blocked on the current page
    this.typeName = typeNames(Ci.nsIContentPolicy);
    this.listeners = new Set();
  }

  async start() {
    const saved = PathUtils.join(PathUtils.profileDir, 'xiao-engine.bin');
    try {
      if (this.store.engineAt && await IOUtils.exists(saved)) this.engine = FiltersEngine.deserialize(await IOUtils.read(saved));
    } catch (e) {
      console.warn('Xiao: saved engine unreadable, using the built-in one', e);
    }
    if (!this.engine) {
      this.engine = FiltersEngine.deserialize(new Uint8Array(await (await fetch(BUILT_IN)).arrayBuffer()));
      this.store.engineAt = 0;
    }
    Services.obs.addObserver(this, 'http-on-opening-request');
    Services.obs.addObserver(this, 'http-on-examine-response');
    this.timer = setInterval(() => this.update(), 60 * 60 * 1000);
    this.update();
  }

  // A newer prebuilt engine, if the engine release has one for this engine version.
  async update() {
    if (Date.now() - (this.store.engineAt || this.store.checkedAt || 0) < DAY) return;
    this.store.checkedAt = Date.now();
    try {
      const [bin, sum] = await Promise.all([fetch(UPDATE, { cache: 'no-store' }), fetch(`${UPDATE}.sha256`, { cache: 'no-store' })]);
      if (!bin.ok || !sum.ok) return;
      const bytes = new Uint8Array(await bin.arrayBuffer());
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      const hex = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
      if (hex !== (await sum.text()).trim().split(/\s+/)[0]) throw new Error('engine update does not match its SHA-256');
      this.engine = FiltersEngine.deserialize(bytes);
      await IOUtils.write(PathUtils.join(PathUtils.profileDir, 'xiao-engine.bin'), bytes);
      this.store.engineAt = Date.now();
      this.cosmeticBase = null;
      // Content processes re-read the shared hiding sheet when this changes (XiaoChild).
      Services.ppmm.sharedData.set('xiao:engineGen', this.store.engineAt);
      Services.ppmm.sharedData.flush();
    } catch (e) {
      console.warn('Xiao: engine update failed', e);
    } finally {
      this.store.save();
    }
  }

  // What a channel is, in plain values (see lib/request.mjs).
  describe(channel) {
    const li = channel.loadInfo;
    const bc = li.browsingContext;
    const by = li.loadingPrincipal ?? li.triggeringPrincipal;
    return {
      url: channel.URI.spec,
      type: this.typeName(li.externalContentPolicyType),
      frameUrl: by?.isContentPrincipal ? by.URI?.spec : undefined,
      topUrl: bc?.top?.currentURI?.spec,
      system: !!by?.isSystemPrincipal && !bc,
      browserId: bc?.top?.browserId ?? 0,
    };
  }

  allowed(url) {
    return this.store.allow.has(hostOf(url));
  }

  observe(subject, topic) {
    if (!this.engine) return;
    try {
      this.check(subject.QueryInterface(Ci.nsIHttpChannel), topic);
    } catch (e) {
      // A request Xiao can't read (an odd URL, a channel already gone) is left alone.
      if (!/NS_ERROR_(NOT_AVAILABLE|NO_INTERFACE)/.test(String(e))) console.warn('Xiao: blocking', e);
    }
  }

  check(channel, topic) {
    const info = this.describe(channel);
    if (!fromWeb(info) || this.allowed(pageOf(info))) return;
    const request = Request.fromRawDetails(ghosteryDetails(info));
    if (topic === 'http-on-examine-response') {
      const csp = this.engine.getCSPDirectives(request);
      if (csp) channel.setResponseHeader('Content-Security-Policy', csp, true);
      return;
    }
    if (info.type === 'main_frame' && info.browserId) this.perBrowser.set(info.browserId, 0);
    const { match, redirect } = this.engine.match(request);
    if (!match && !redirect) return;
    if (redirect) {
      try {
        channel.redirectTo(Services.io.newURI(redirect.dataUrl));
      } catch {
        channel.cancel(Cr.NS_ERROR_BLOCKED_BY_POLICY);
      }
    } else {
      channel.cancel(Cr.NS_ERROR_BLOCKED_BY_POLICY);
    }
    this.count(info.browserId);
  }

  count(browserId) {
    this.store.total++;
    this.store.save();
    if (browserId) this.perBrowser.set(browserId, (this.perBrowser.get(browserId) ?? 0) + 1);
    for (const fn of this.listeners) fn(browserId);
  }

  blockedOn(browserId) {
    return this.perBrowser.get(browserId) ?? 0;
  }

  forget(browserId) {
    this.perBrowser.delete(browserId);
  }

  // Cosmetic filtering, asked for by XiaoChild in each frame. The generic
  // hiding sheet (the same for every site) is sent once per content process
  // and shared; only what is particular to this page travels with each ask.
  cosmetics({ url, lifecycle, classes = [], ids = [], hrefs = [] }, topUrl) {
    if (!this.engine || this.allowed(topUrl) || !/^https?:/.test(url)) return { active: false };
    let host;
    let domain;
    try {
      host = new URL(url).hostname;
      domain = Services.eTLD.getBaseDomainFromHost(host);
    } catch {
      domain = host ?? '';
    }
    const start = lifecycle === 'start';
    const r = this.engine.getCosmeticsFilters({
      url, hostname: host, domain, classes, ids, hrefs,
      getBaseRules: start, getInjectionRules: start, getExtendedRules: start,
      getRulesFromHostname: start, getRulesFromDOM: !start,
    });
    if (!r.active) return { active: false };
    let base = false;
    let styles = r.styles;
    const shared = this.baseSheet();
    if (start && shared && styles.startsWith(shared)) {
      base = true;
      styles = styles.slice(shared.length);
    }
    return { active: true, base, styles, scripts: r.scripts, extended: r.extended };
  }

  baseSheet() {
    this.cosmeticBase ??= this.engine.cosmetics.getBaseStylesheet();
    return this.cosmeticBase;
  }
}
