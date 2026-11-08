// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// SearXNG's JSON answer → the top distinct web pages, in its order: http(s)
// addresses only, no login in them, one per address. Pure, node-tested.
export function topResults(json, count = 5) {
  const out = [];
  const seen = new Set();
  for (const r of Array.isArray(json?.results) ? json.results : []) {
    let url;
    try {
      url = new URL(r?.url);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) continue;
    const key = url.href.replace(/#.*$/, '').replace(/\/$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ url: url.href, title: String(r.title ?? url.hostname).slice(0, 200) });
    if (out.length === count) break;
  }
  return out;
}
