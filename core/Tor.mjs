// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The "Tor" container: every request from its tabs (pages, frames, their
// service workers, favicons) goes to the kit's tor on 127.0.0.1 and nowhere
// else. If tor is not running the request fails; it never falls back to a
// direct connection. The filter is in place before the first window opens,
// so a restored Tor tab can't load before it.
import { DEAD_END, PROBE_URL, TOR_PORT, torRoute } from './lib/tor.mjs';
import { hostOf } from './lib/request.mjs';
import { lazy } from './mod.mjs';

const identities = lazy('toolkit/components/contextualidentity/ContextualIdentityService.sys.mjs', 'ContextualIdentityService');

const pps = Cc['@mozilla.org/network/protocol-proxy-service;1'].getService(Ci.nsIProtocolProxyService);

export class Tor {
  constructor() {
    this.torId = null;
    this.circuits = new Map();
    this.port = Services.prefs.getIntPref('xiao.tor.port', TOR_PORT);
    this.installed = Services.prefs.getBoolPref('xiao.tor.installed', false);
    this.probe = { at: 0, result: null };
  }

  start() {
    pps.registerChannelFilter(this, 0);
    this.findContainer();
    Services.obs.addObserver(this, 'contextual-identity-deleted');
  }

  findContainer() {
    const cis = identities();
    const saved = Services.prefs.getIntPref('xiao.tor.container', 0);
    const all = cis.getPublicIdentities();
    const tor = all.find((i) => i.userContextId === saved) ?? all.find((i) => cis.getUserContextLabel(i.userContextId) === 'Tor')
      ?? cis.create('Tor', 'fingerprint', 'purple');
    this.torId = tor.userContextId;
    Services.prefs.setIntPref('xiao.tor.container', this.torId);
    // The content processes read this to remove WebRTC from Tor pages (XiaoChild).
    Services.ppmm.sharedData.set('xiao:torId', this.torId);
    Services.ppmm.sharedData.flush();
  }

  observe(_subject, topic) {
    if (topic === 'contextual-identity-deleted') this.findContainer();
  }

  // nsIProtocolProxyChannelFilter
  applyFilter(channel, proxy, callback) {
    let route;
    try {
      const li = channel.loadInfo;
      const bc = li.browsingContext;
      const top = bc?.top?.currentURI?.spec;
      const page = li.externalContentPolicyType === Ci.nsIContentPolicy.TYPE_DOCUMENT && !bc?.parent
        ? channel.URI.spec : (top && /^https?:/.test(top) ? top : (li.loadingPrincipal ?? li.triggeringPrincipal)?.URI?.spec);
      route = torRoute({
        userContextId: li.originAttributes.userContextId,
        site: hostOf(page),
        probe: channel.URI.spec === PROBE_URL && li.triggeringPrincipal?.isSystemPrincipal && !bc,
      }, { torId: this.torId, port: this.port, circuits: this.circuits });
    } catch (e) {
      console.error('Xiao: Tor routing', e);
      route = channel.loadInfo?.originAttributes?.userContextId ? DEAD_END : null;
    }
    if (!route) return callback.onProxyFilterResult(proxy);
    // TRANSPARENT_PROXY_RESOLVES_HOST: tor looks up the name, not the local DNS.
    // The isolation key keeps Firefox from reusing a kept-alive connection
    // across sites or across "New Tor circuit", which would keep the old circuit.
    callback.onProxyFilterResult(pps.newProxyInfoWithAuth('socks', route.host, route.port, route.username, route.password,
      '', `${route.username}:${route.password}`, Ci.nsIProxyInfo.TRANSPARENT_PROXY_RESOLVES_HOST, 0xffffffff, null));
  }

  newCircuit(host) {
    this.circuits.set(host, crypto.randomUUID());
  }

  // Is tor up, and is it really Tor? Cached 30 s when yes, 5 s when no (it may still be starting).
  async status({ fresh = false } = {}) {
    if (!this.installed) return { installed: false, running: false, isTor: false };
    const p = this.probe;
    if (!fresh && Date.now() - p.at < (p.result?.isTor ? 30_000 : 5_000)) return p.result;
    let result;
    // AbortSignal.timeout() needs a window, which system modules don't have.
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), 15_000);
    try {
      const res = await fetch(PROBE_URL, { cache: 'no-store', credentials: 'omit', signal: stop.signal });
      const { IsTor, IP } = await res.json();
      result = { installed: this.installed, running: true, isTor: IsTor === true, ip: IP };
    } catch {
      result = { installed: this.installed, running: false, isTor: false };
    } finally {
      clearTimeout(timer);
    }
    this.probe = { at: Date.now(), result };
    return result;
  }
}
