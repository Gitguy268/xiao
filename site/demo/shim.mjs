// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The website's live start page: the real page from core/start, with this
// stand-in for Xiao's browser code. Settings stay in this browser
// (localStorage), the counts are made up, and searches and links open in a
// new tab, because most sites refuse to load inside a frame.
import { searchTemplate, toUrl } from './links.mjs';

const KEY = 'xiao-demo-settings';
const defaults = {
  search: 'ddg',
  custom: '',
  theme: 'auto',
  newtab: 'start',
  launch: 'start',
  links: [
    { name: 'Wikipedia', url: 'https://en.wikipedia.org' },
    { name: 'GitHub', url: 'https://github.com' },
    { name: 'OpenStreetMap', url: 'https://www.openstreetmap.org' },
  ],
};

function load() {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return defaults;
  }
}

window.xiao = {
  async call(name, data) {
    if (name === 'save') {
      try {
        localStorage.setItem(KEY, JSON.stringify(data));
      } catch {}
      return load();
    }
    return {
      settings: load(),
      status: { total: 12408, ready: true, https: true, tor: { installed: true, running: true, isTor: true } },
      inTor: false,
      local: '',
    };
  },
};

const open = (url) => window.open(url, '_blank', 'noopener');
document.addEventListener('submit', (e) => {
  if (e.target.id !== 'search') return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const q = document.getElementById('q').value;
  if (q.trim()) open(toUrl(q, searchTemplate(load(), { inTor: false, local: '' })));
}, true);
document.addEventListener('click', (e) => {
  const a = e.target.closest?.('#links a');
  if (!a) return;
  e.preventDefault();
  open(a.href);
}, true);
// The page asks the parent page's theme, so the demo matches the site.
window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || !['light', 'dark', 'auto'].includes(e.data?.theme)) return;
  if (e.data.theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = e.data.theme;
});
