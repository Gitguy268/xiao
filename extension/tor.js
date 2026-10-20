// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The "Tor" container: every request from its tabs goes to the kit's tor
// (started by the launcher on 127.0.0.1:9160) and nowhere else. If tor is
// not running the request fails; it never falls back to a direct connection.
import { topHost } from './site.js';

export const TOR = { host: '127.0.0.1', port: 9160 };
export const PROBE_URL = 'https://check.torproject.org/api/ip';

// Pure routing decision, unit-tested in test/tor.test.mjs.
export function torRoute(info, { torStoreId, extOrigin, circuits }) {
  const fromTorTab = torStoreId && info.cookieStoreId === torStoreId;
  const isProbe = info.url === PROBE_URL && info.originUrl?.startsWith(extOrigin);
  if (!fromTorTab && !isProbe) return null;
  // A SOCKS username per site makes tor use a separate circuit per site,
  // the same idea as Tor Browser's TorDomainIsolator. A new password for the
  // site ("New Tor circuit") gives it a new circuit.
  const site = topHost(info) || 'xiao';
  return {
    type: 'socks', host: TOR.host, port: TOR.port, proxyDNS: true,
    username: site, password: circuits?.get(site) ?? 'xiao', failoverTimeout: 1,
  };
}

// Nothing reachable on port 9: used whenever a request might be from a Tor tab but routing can't decide.
const DEAD_END = { type: 'socks', host: TOR.host, port: 9, proxyDNS: true };
const DIRECT = { type: 'direct' };

// What proxy.onRequest answers. Until the Tor container is known (browser
// starting and restoring tabs, extension reloading) it waits instead of
// guessing, so a restored Tor tab can't load directly. If finding the
// container fails, every container tab fails closed.
export function proxyFor(info, ctx) {
  if (!ctx.torStoreId) {
    return ctx.ready.then(
      () => proxyFor(info, { ...ctx, torStoreId: ctx.currentId(), ready: null }),
      () => (info.cookieStoreId?.startsWith('firefox-container-') ? DEAD_END : DIRECT),
    );
  }
  try {
    return torRoute(info, ctx) ?? DIRECT;
  } catch (e) {
    console.error('xiao tor routing', e);
    return info.cookieStoreId === ctx.torStoreId ? DEAD_END : DIRECT;
  }
}

let torStoreId = null;
let probe = { at: 0, result: null };
const circuits = new Map();

export function newCircuit(host) {
  circuits.set(host, crypto.randomUUID());
}

async function ensureContainer() {
  const { torStoreId: saved } = await browser.storage.local.get('torStoreId');
  const all = await browser.contextualIdentities.query({});
  const found = all.find((c) => c.cookieStoreId === saved) ?? all.find((c) => c.name === 'Tor');
  const tor = found ?? await browser.contextualIdentities.create({ name: 'Tor', color: 'purple', icon: 'fingerprint' });
  torStoreId = tor.cookieStoreId;
  await browser.storage.local.set({ torStoreId });
  return torStoreId;
}

let guard = null;
async function guardWebRTC() {
  // WebRTC does not go through the proxy API, so Tor tabs get no RTCPeerConnection.
  await guard?.unregister();
  guard = await browser.contentScripts.register({
    matches: ['<all_urls>'], js: [{ file: 'webrtc-guard.js' }], runAt: 'document_start',
    allFrames: true, matchAboutBlank: true, cookieStoreId: torStoreId,
  });
}

export async function torStatus({ fresh = false } = {}) {
  // Cache a success for 30 s, a failure for 5 s (tor may still be starting).
  if (!fresh && Date.now() - probe.at < (probe.result?.isTor ? 30_000 : 5_000)) return probe.result;
  let result;
  try {
    const res = await fetch(PROBE_URL, { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(15_000) });
    const { IsTor, IP } = await res.json();
    result = { running: true, isTor: IsTor === true, ip: IP };
  } catch {
    result = { running: false, isTor: false };
  }
  probe = { at: Date.now(), result };
  return result;
}

export const torContainerId = () => torStoreId;

export function startTor() {
  const extOrigin = new URL(browser.runtime.getURL('')).origin;
  // The WebRTC guard is part of "ready": a restored Tor page must not load before it is registered.
  const ready = ensureContainer().then(guardWebRTC);
  // Registered synchronously so it is in place before the first request.
  browser.proxy.onRequest.addListener(
    (info) => proxyFor(info, { torStoreId, extOrigin, circuits, ready, currentId: () => torStoreId }),
    { urls: ['<all_urls>'] },
  );
  browser.proxy.onError.addListener((e) => console.warn('xiao proxy', e.message));
  browser.contextualIdentities.onRemoved.addListener(({ contextualIdentity }) => {
    if (contextualIdentity.cookieStoreId === torStoreId) ensureContainer().then(guardWebRTC);
  });
  return ready;
}
