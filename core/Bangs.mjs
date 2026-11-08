// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// !bangs in the address bar and on the start page. The table is read the first
// time someone types a bang and nothing about it is ever fetched from anywhere.
import { parseBang, resolveBang } from './lib/bangs.mjs';
import { lazy } from './mod.mjs';

const providers = lazy('browser/components/urlbar/UrlbarProvidersManager.sys.mjs', 'ProvidersManager');
const TABLE = 'resource://xiao/bangs.json';
const NAME = 'XiaoBangs';
const ACTION = 'xiao-bang-action';

export class Bangs {
  constructor(xiao) {
    this.xiao = xiao;
  }

  get on() {
    return this.xiao.features.bangs !== false;
  }

  async load() {
    this.table ??= await (await fetch(TABLE)).json();
    return this.table;
  }

  async resolve(text) {
    if (!this.on || !parseBang(text)) return null;
    await this.load();
    return resolveBang(text, this.table, this.xiao.settings().bangs);
  }

  run(action, win) {
    if (action === 'library') return this.xiao.openLibrary(win);
    if (action === 'pdf') return this.xiao.aboutPdf.hub(win);
    return this.xiao.notes.openFrom(win);
  }

  register() {
    const bangs = this;
    try {
      const { UrlbarProvider } = ChromeUtils.importESModule('moz-src:///browser/components/urlbar/UrlbarUtils.sys.mjs');
      const { UrlbarShared } = ChromeUtils.importESModule('chrome://browser/content/urlbar/UrlbarShared.mjs');
      const { UrlbarResult } = ChromeUtils.importESModule('chrome://browser/content/urlbar/UrlbarResult.mjs');
      const LABEL = { notes: 'Open your notes', library: 'Open the Library', pdf: 'Open about:pdf' };

      class XiaoBangsProvider extends UrlbarProvider {
        get name() {
          return NAME;
        }

        get type() {
          return UrlbarShared.PROVIDER_TYPE.HEURISTIC;
        }

        // Answers before the query starts, so the table's first read can't lose
        // the race for the top result to the search engine.
        async isActive(context) {
          if (context.searchMode || !parseBang(context.searchString)) return false;
          this.found = await bangs.resolve(context.searchString);
          return !!this.found;
        }

        async startQuery(context, add) {
          const { found } = this;
          if (!found) return;
          add(this, found.url
            ? new UrlbarResult({
              type: UrlbarShared.RESULT_TYPE.URL,
              source: UrlbarShared.RESULT_SOURCE.OTHER_LOCAL,
              heuristic: true,
              payload: { url: found.url, title: found.query ? `${found.query} on ${new URL(found.url).hostname}` : new URL(found.url).hostname },
            })
            : new UrlbarResult({
              type: UrlbarShared.RESULT_TYPE.DYNAMIC,
              source: UrlbarShared.RESULT_SOURCE.OTHER_LOCAL,
              heuristic: true,
              payload: { dynamicType: ACTION, action: found.action, label: LABEL[found.action] },
            }));
        }

        getViewTemplate() {
          return {
            attributes: { selectable: true },
            children: [{ name: 'title', tag: 'span', classList: ['urlbarView-title'] }],
          };
        }

        getViewUpdate(result) {
          return { title: { textContent: result.payload.label } };
        }

        onEngagement(_context, _controller, details) {
          if (details.result.payload.action) bangs.run(details.result.payload.action, details.element.documentGlobal);
        }
      }

      const manager = providers().getInstanceForSap('urlbar');
      if (!manager.getProvider(NAME)) manager.registerProvider(new XiaoBangsProvider());
      const { UrlbarView } = ChromeUtils.importESModule('moz-src:///browser/components/urlbar/UrlbarView.sys.mjs');
      UrlbarView.addDynamicViewTemplate?.(ACTION, new XiaoBangsProvider().getViewTemplate());
    } catch (e) {
      console.warn('Xiao: the address bar has changed; bangs work from the start page only', e);
    }
  }
}
