// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The start page. Xiao's browser code gives this page (and only this page)
// window.xiao.call(name, data); the website's demo gives it a stand-in.
import { parseLinks, searchTemplate, toUrl } from './links.mjs';

const $ = (id) => document.getElementById(id);
const ask = (name, data) => window.xiao.call(name, data);

let state;

function greet() {
  const h = new Date().getHours();
  const part = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  $('greeting').textContent = state.inTor ? 'This tab goes through Tor.' : `${part}.`;
  $('clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function renderLinks() {
  const { links } = state.settings;
  const nav = $('links');
  nav.replaceChildren(...links.map(({ name, url }) => {
    const a = document.createElement('a');
    a.href = url;
    a.textContent = name;
    return a;
  }));
  if (!links.length) {
    const add = document.createElement('button');
    add.type = 'button';
    add.textContent = 'Add the sites you open most';
    add.addEventListener('click', openSettings);
    nav.append(add);
  }
}

function applyTheme() {
  const { theme } = state.settings;
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

function sentence(s) {
  const parts = [`<strong>${s.total.toLocaleString()}</strong> ads and trackers blocked so far.`];
  parts.push(s.https ? 'HTTPS-Only is on.' : 'HTTPS-Only is off.');
  if (s.tor.isTor) parts.push('Tor is connected.');
  else if (s.tor.running) parts.push('Tor answered, but not as a Tor exit.');
  else if (s.tor.installed) parts.push('Tor is not connected yet; it takes a few seconds after Xiao starts.');
  return parts.join(' ');
}

async function refreshStatus() {
  try {
    state = { ...state, ...(await ask('get')) };
    $('status').innerHTML = sentence(state.status); // only numbers and fixed text, no page data
  } catch (e) {
    $('status').textContent = `Xiao is not answering: ${e.message}`;
  }
}

function openSettings() {
  const f = $('settings-form');
  const s = state.settings;
  for (const name of ['search', 'custom', 'theme', 'newtab', 'launch']) f[name].value = s[name];
  f.links.value = s.links.map((l) => `${l.name} ${l.url}`).join('\n');
  $('custom-row').hidden = s.search !== 'custom';
  $('settings').showModal();
}

async function init() {
  state = await ask('get');
  $('xiao-search').hidden = !state.local;
  document.body.classList.toggle('tor', state.inTor);
  applyTheme();
  greet();
  renderLinks();
  $('status').innerHTML = sentence(state.status);
  setInterval(greet, 10_000);
  // Tor takes a few seconds to connect after Xiao starts.
  if (!state.status.tor.isTor && state.status.tor.installed) setTimeout(refreshStatus, 6_000);

  $('search').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('q').value;
    if (q.trim()) location.href = toUrl(q, searchTemplate(state.settings, state));
  });
  $('edit').addEventListener('click', openSettings);
  $('settings-form').search.addEventListener('change', (e) => {
    $('custom-row').hidden = e.target.value !== 'custom';
  });
  $('settings').addEventListener('close', async () => {
    if ($('settings').returnValue !== 'save') return;
    const f = $('settings-form');
    const settings = {
      search: f.search.value,
      custom: f.custom.value.includes('%s') ? f.custom.value : '',
      theme: f.theme.value,
      newtab: f.newtab.value,
      launch: f.launch.value,
      links: parseLinks(f.links.value),
    };
    state.settings = await ask('save', settings);
    applyTheme();
    renderLinks();
  });
}

if (window.xiao) init();
