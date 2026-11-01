// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The start page's search and links, kept free of the page so node can test them.

export const ENGINES = {
  chain: 'https://searx.ononoki.org/search?q=%s',
  ddg: 'https://duckduckgo.com/?q=%s',
  leta: 'https://leta.mullvad.net/search?q=%s',
  startpage: 'https://www.startpage.com/sp/search?query=%s',
  brave: 'https://search.brave.com/search?q=%s',
};
// In Tor tabs, DuckDuckGo's onion service keeps searches inside the Tor network.
export const TOR_SEARCH = 'https://duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion/?q=%s';

export function toUrl(text, template) {
  const t = text.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return t;
  if (!/\s/.test(t) && /^[^/]+\.[a-z]{2,}(?::\d+)?(\/.*)?$/i.test(t)) return `https://${t}`;
  if (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/.*)?$/.test(t)) return `http://${t}`;
  return template.replace('%s', encodeURIComponent(t));
}

export function parseLinks(text) {
  return text.split('\n').map((line) => line.trim()).filter(Boolean).flatMap((line) => {
    const m = line.match(/^(.*?)\s*(\S+)$/);
    if (!m) return [];
    const url = toUrl(m[2], '%s');
    if (!/^https?:\/\//.test(url)) return [];
    return [{ name: m[1] || new URL(url).hostname, url }];
  });
}

// Which address a search goes to. `local` is Xiao Search's address when it
// is installed (`--search`), else empty.
export function searchTemplate(settings, { inTor, local }) {
  if (inTor) return TOR_SEARCH;
  if (settings.search === 'xiao' && local) return local;
  if (settings.search === 'custom' && settings.custom.includes('%s')) return settings.custom;
  return ENGINES[settings.search] ?? (local || ENGINES.chain);
}

// The default search: public SearXNG at searx.ononoki.org, then priv.au, then
// Brave Search. A search the first one refuses (blocked, rate-limited, down)
// is sent on to the next, with the same words.
export const CHAIN = [ENGINES.chain, 'https://priv.au/search?q=%s', ENGINES.brave];

// The next address in CHAIN for a top-level load of `url` that ended with
// HTTP `status` (0: no answer at all), or null when it did not fail or there
// is nothing left to try. It only ever moves forward, so it cannot loop.
export function failover(url, status) {
  if (!(status === 0 || status === 403 || status === 429 || status >= 500)) return null;
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const at = CHAIN.findIndex((t) => {
    const e = new URL(t.replace('%s', ''));
    return e.host === u.host && e.pathname === u.pathname;
  });
  const q = u.searchParams.get('q');
  if (at < 0 || at === CHAIN.length - 1 || !q) return null;
  return CHAIN[at + 1].replace('%s', encodeURIComponent(q));
}
