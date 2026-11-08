// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Instant Links (Arc's A37, adapted): "!top cheap flights to Lisbon" opens
// the top results of the search in a new Zen folder. The results come from
// Xiao Search, the SearXNG running on this computer (install with --search),
// as JSON. Public search engines refuse scripted requests, so without Xiao
// Search the bang says so instead of scraping one.
import { topResults } from './lib/instant.mjs';

export class InstantLinks {
  constructor(xiao) {
    this.xiao = xiao;
  }

  get available() {
    return /^http:\/\/127\.0\.0\.1:\d+\/?$/.test(this.xiao.searchUrl ?? '');
  }

  async results(query, count = 5) {
    if (!this.available) throw new Error('Instant links need Xiao Search, the search engine on this computer (install Xiao with --search).');
    const base = this.xiao.searchUrl.replace(/\/$/, '');
    const r = await fetch(`${base}/search?q=${encodeURIComponent(query)}&format=json`, { credentials: 'omit' });
    if (!r.ok) throw new Error(`Xiao Search answered ${r.status}.`);
    return topResults(await r.json(), count);
  }

  async open(win, query) {
    const q = String(query ?? '').trim().slice(0, 300);
    if (!q) throw new Error('Write what to look for after !top.');
    const results = await this.results(q);
    if (!results.length) throw new Error(`Xiao Search found nothing for "${q}".`);
    const tabs = results.map((r) => win.gBrowser.addTab(r.url, {
      // each result's own principal, as when its address is typed
      triggeringPrincipal: Services.scriptSecurityManager.createContentPrincipal(Services.io.newURI(r.url), {}),
    }));
    let folder = null;
    try {
      folder = win.gZenFolders?.createFolder(tabs, { label: q.slice(0, 60) }) ?? null;
    } catch (e) {
      console.warn('Xiao: instant links folder', e);
    }
    win.gBrowser.selectedTab = tabs[0];
    return { opened: tabs.length, folder: folder?.label ?? tabs[0].group?.label ?? null, tabs };
  }
}
