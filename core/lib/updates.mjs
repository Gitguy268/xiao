// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The pure half of updates (see ../Updater.mjs). updates.json comes from the
// network, so nothing in it is believed until its signature has been checked,
// and even then only an https kit with a hash is accepted.

// The public half of the release signing key, base64. Empty: this build has
// none, so it never updates itself.
export const UPDATE_KEY = '';

// True when a is a later version than b, comparing x.y.z as numbers.
export function isNewer(a, b) {
  const parts = (v) => String(v).split('.').map(Number);
  const [x, y] = [parts(a), parts(b)];
  if ([...x, ...y].some(Number.isNaN)) return false;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d > 0;
  }
  return false;
}

// A manifest as Xiao will act on it, or an Error saying why not.
export function checkManifest(m) {
  if (!/^\d+\.\d+\.\d+$/.test(m?.version ?? '')) return new Error('the update has no usable version');
  if (!/^https:\/\//.test(m.kit?.url ?? '')) return new Error('the update has no https address');
  if (!/^[0-9a-f]{64}$/.test(m.kit?.sha256 ?? '')) return new Error('the update has no SHA-256');
  if (!Number.isInteger(m.kit?.size) || m.kit.size <= 0 || m.kit.size > 200e6) return new Error('the update has no usable size');
  return m;
}

export const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
export const hexOf = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
