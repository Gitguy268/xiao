// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Where a request goes: the pure part of Tor.sys.mjs, tested in node.

export const TOR_HOST = '127.0.0.1';
export const TOR_PORT = 9160;
export const PROBE_URL = 'https://check.torproject.org/api/ip';

// Port 9 has nothing listening: the answer whenever a request might belong
// to a Tor tab but the route can't be worked out. It fails, never goes direct.
export const DEAD_END = { host: TOR_HOST, port: 9, username: '', password: '' };

// info: { userContextId, site (the tab's top host), probe (Xiao's own
// "is Tor up?" check) }. ctx: { torId (null while unknown), port, circuits }.
// Returns null for a direct connection, or the SOCKS proxy to use.
export function torRoute(info, ctx) {
  const inContainer = info.userContextId > 0;
  if (inContainer && !ctx.torId) return DEAD_END; // can't tell yet whether this is the Tor container
  if (!info.probe && !(inContainer && info.userContextId === ctx.torId)) return null;
  // A SOCKS username per site gives each site its own circuit (Tor
  // Browser's TorDomainIsolator idea); a new password for the site, from
  // "New Tor circuit", gives it a new one.
  const site = info.site || 'xiao';
  return { host: TOR_HOST, port: ctx.port ?? TOR_PORT, username: site, password: ctx.circuits?.get(site) ?? 'xiao' };
}
