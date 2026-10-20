// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

const ENGINES = {
  ddg: 'https://duckduckgo.com/?q=%s',
  leta: 'https://leta.mullvad.net/search?q=%s',
  startpage: 'https://www.startpage.com/sp/search?query=%s',
  brave: 'https://search.brave.com/search?q=%s',
  searxng: 'http://127.0.0.1:8888/search?q=%s',
};
// In Tor tabs, DuckDuckGo's onion service keeps searches inside the Tor network.
const TOR_SEARCH = 'https://duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion/?q=%s';
const DEFAULTS = {
  search: 'ddg',
  custom: '',
  theme: 'auto',
  links: [
    { name: 'Wikipedia', url: 'https://en.wikipedia.org' },
    { name: 'GitHub', url: 'https://github.com' },
    { name: 'OpenStreetMap', url: 'https://www.openstreetmap.org' },
  ],
};

const $ = (id) => document.getElementById(id);
const ask = (xiao, extra = {}) => browser.runtime.sendMessage({ xiao, ...extra });

let settings = DEFAULTS;
let inTorTab = false;

export function toUrl(text, template) {
  const t = text.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return t;
  if (!/\s/.test(t) && /^[^/]+\.[a-z]{2,}(?::\d+)?(\/.*)?$/i.test(t)) return `https://${t}`;
  if (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/.*)?$/.test(t)) return `http://${t}`;
  return template.replace('%s', encodeURIComponent(t));
}

function greet() {
  const h = new Date().getHours();
  const part = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  $('greeting').textContent = inTorTab ? 'This tab goes through Tor.' : `${part}.`;
  $('clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function renderLinks() {
  const nav = $('links');
  nav.replaceChildren(...settings.links.map(({ name, url }) => {
    const a = document.createElement('a');
    a.href = url;
    a.textContent = name;
    return a;
  }));
  if (!settings.links.length) {
    const add = document.createElement('button');
    add.type = 'button';
    add.textContent = 'Add the sites you open most';
    add.addEventListener('click', openSettings);
    nav.append(add);
  }
}

function applyTheme() {
  if (settings.theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = settings.theme;
}

function sentence(s) {
  const parts = [];
  if (!s.ready) parts.push('Downloading filter lists; blocking starts in a moment.');
  else parts.push(`<strong>${s.total.toLocaleString()}</strong> ads and trackers blocked so far.`);
  parts.push(s.https === 'always' ? 'HTTPS-Only is on.' : 'HTTPS-Only is off.');
  if (s.tor.isTor) parts.push('Tor is connected.');
  else if (s.tor.running) parts.push('Tor answered, but not as a Tor exit.');
  else parts.push('Tor is not connected. It takes a few seconds after start, and needs xiao installed with Tor.');
  return parts.join(' ');
}

async function refreshStatus() {
  try {
    const s = await ask('status', { tabId: -1, host: '' });
    const status = $('status');
    status.innerHTML = sentence(s); // only numbers and fixed text, no page data
    $('tor-open').hidden = !s.tor.isTor || inTorTab;
  } catch (e) {
    $('status').textContent = `xiao's background is not answering: ${e.message}`;
  }
}

function openSettings() {
  const f = $('settings-form');
  f.search.value = settings.search;
  f.custom.value = settings.custom;
  f.theme.value = settings.theme;
  f.links.value = settings.links.map((l) => `${l.name} ${l.url}`).join('\n');
  $('custom-row').hidden = settings.search !== 'custom';
  $('settings').showModal();
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

async function init() {
  const tab = await browser.tabs.getCurrent();
  const { torStoreId, settings: saved } = await browser.storage.local.get(['torStoreId', 'settings']);
  inTorTab = !!tab && tab.cookieStoreId === torStoreId;
  document.body.classList.toggle('tor', inTorTab);
  settings = { ...DEFAULTS, ...saved };
  applyTheme();
  greet();
  renderLinks();
  setInterval(greet, 10_000);
  refreshStatus();

  $('search').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('q').value;
    if (!q.trim()) return;
    const template = inTorTab ? TOR_SEARCH : settings.search === 'custom' ? settings.custom : ENGINES[settings.search];
    location.href = toUrl(q, template || ENGINES.ddg);
  });
  $('edit').addEventListener('click', openSettings);
  $('tor-open').addEventListener('click', () => ask('openTor'));
  $('settings-form').search.addEventListener('change', (e) => {
    $('custom-row').hidden = e.target.value !== 'custom';
  });
  $('settings').addEventListener('close', async () => {
    if ($('settings').returnValue !== 'save') return;
    const f = $('settings-form');
    settings = {
      search: f.search.value,
      custom: f.custom.value.includes('%s') ? f.custom.value : '',
      theme: f.theme.value,
      links: parseLinks(f.links.value),
    };
    await browser.storage.local.set({ settings });
    applyTheme();
    renderLinks();
  });
}

if (globalThis.browser?.runtime) init();
