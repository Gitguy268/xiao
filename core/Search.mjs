// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The start page's search choice, carried to the address bar, and the
// default chain's failover: a search that searx.ononoki.org (or priv.au)
// refuses or cannot answer is loaded again on the next engine in CHAIN.
// Nothing is checked ahead of time: public SearXNG servers rate-limit
// scripted requests, so only the reader's own searches are ever sent.
import { lazy } from './mod.mjs';
import { CHAIN, ENGINES, failover } from './start/links.mjs';

// Services.search before Firefox 15x; its own module now.
const searchModule = lazy('toolkit/components/search/SearchService.sys.mjs', 'SearchService');
const searchService = () => Services.search ?? searchModule();

const HOSTS = new Set(CHAIN.map((t) => new URL(t.replace('%s', '')).host));

// The address bar's name for each start page choice.
const NAMES = {
  chain: 'SearXNG (ononoki)',
  ddg: 'DuckDuckGo',
  leta: 'Mullvad Leta',
  startpage: 'Startpage',
  brave: 'Brave Search',
  xiao: 'Xiao Search',
  custom: 'Custom search',
};

// Site shortcuts, typed in the address bar: "!w cats" searches Wikipedia.
// They are ordinary search engines with an alias, so they show in Firefox's
// search settings, where they can be changed or removed like any other.
export const SHORTCUTS = [
  ['!w', 'Wikipedia', 'https://en.wikipedia.org/w/index.php?search=%s'],
  ['!gh', 'GitHub', 'https://github.com/search?q=%s'],
  ['!osm', 'OpenStreetMap', 'https://www.openstreetmap.org/search?query=%s'],
  ['!mdn', 'MDN Web Docs', 'https://developer.mozilla.org/search?q=%s'],
  ['!yt', 'YouTube', 'https://www.youtube.com/results?search_query=%s'],
];

export class Search {
  start() {
    Services.obs.addObserver(this, 'http-on-examine-response');
    Services.obs.addObserver(this, 'http-on-stop-request');
  }

  observe(subject, topic) {
    let ch;
    try {
      ch = subject.QueryInterface(Ci.nsIHttpChannel);
      if (!HOSTS.has(ch.URI.host) || ch.loadInfo.externalContentPolicyType !== Ci.nsIContentPolicy.TYPE_DOCUMENT) return;
    } catch {
      return;
    }
    let status;
    if (topic === 'http-on-examine-response') {
      status = ch.responseStatus;
    } else {
      // Only a load that got no answer at all; answered ones were judged above.
      if (Components.isSuccessCode(ch.status) || ch.status === Cr.NS_BINDING_ABORTED) return;
      try {
        ch.responseStatus;
        return;
      } catch {
        status = 0;
      }
    }
    const next = failover(ch.URI.spec, status);
    const bc = ch.loadInfo.browsingContext;
    if (!next || !bc) return;
    if (status) ch.cancel(Cr.NS_BINDING_ABORTED);
    Services.tm.dispatchToMainThread(() => {
      bc.loadURI(Services.io.newURI(next), { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
    });
  }

  async shortcuts(on) {
    const service = searchService();
    await service.init();
    for (const [alias, site, url] of SHORTCUTS) {
      const name = `${site} (${alias})`;
      const engine = service.getEngineByName(name);
      if (on && !engine) await service.addUserEngine({ name, url: url.replace('%s', '{searchTerms}'), alias });
      if (!on && engine) await service.removeEngine(engine, service.CHANGE_REASON?.USER ?? 'user');
    }
  }

  // Make the start page's choice the address bar's default engine too.
  async apply({ search, custom }, local) {
    const template = { ...ENGINES, xiao: local, custom }[search];
    const name = NAMES[search];
    if (!name || !template?.includes('%s')) return;
    const service = searchService();
    await service.init();
    let engine = service.getEngineByName(name);
    // Xiao Search's port and the custom address can change: add those afresh.
    if (engine && (search === 'xiao' || search === 'custom')) {
      await service.removeEngine(engine, service.CHANGE_REASON?.USER ?? 'user');
      engine = null;
    }
    engine ??= await service.addUserEngine({ name, url: template.replace('%s', '{searchTerms}') });
    await service.setDefault(engine, service.CHANGE_REASON?.USER ?? 'user');
  }
}
