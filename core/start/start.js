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

// The clock changes once a minute, so it wakes once a minute, on the
// minute, and not at all while the tab is in the background.
let clockTimer;
function clock() {
  clearTimeout(clockTimer);
  if (document.hidden) return;
  greet();
  clockTimer = setTimeout(clock, 60_000 - (Date.now() % 60_000) + 50);
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
  clock();
  document.addEventListener('visibilitychange', clock);
  // Tor takes a few seconds to connect after Xiao starts.
  if (!state.status.tor.isTor && state.status.tor.installed) setTimeout(refreshStatus, 6_000);

  $('search').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('q').value;
    if (q.trim()) location.href = toUrl(q, searchTemplate(state.settings, state));
  });
  $('edit').addEventListener('click', openSettings);
  $('shortcuts').addEventListener('click', () => ask('shortcuts'));
  $('export').addEventListener('click', async () => {
    const r = await ask('export');
    if (r) $('portable-note').textContent = `Saved ${r.saved}: ${r.spaces.length} spaces, ${r.urls.length} addresses, ${r.collections.length} collections.`;
  });
  $('import').addEventListener('click', showImport);
  wireImport();
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

// --- Import: everything in the file is shown before anything changes ---

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

async function showImport() {
  const r = await ask('import.pick');
  if (!r) return;
  if (r.error) {
    $('portable-note').textContent = r.error;
    return;
  }
  const parts = [
    r.spaces.length && `new spaces: ${r.spaces.join(', ')}`,
    r.collections.length && `collections: ${r.collections.join(', ')}`,
    r.settings && plural(r.settings, 'start page setting'),
    r.features.length && `switches: ${r.features.join(', ')}`,
    r.allow.length && `blocking off for ${r.allow.join(', ')}`,
    r.packs.length && `downloads it used (not downloaded now): ${r.packs.join(', ')}`,
  ].filter(Boolean);
  $('import-title').textContent = `Import ${r.file}`;
  $('import-summary').textContent = parts.length ? `This adds ${parts.join('; ')}.` : 'This file holds nothing to import.';
  $('import-count').textContent = `${plural(r.urls.length, 'address')} it will open or list`;
  $('import-urls').replaceChildren(...r.urls.map((u) => {
    const li = document.createElement('li');
    li.textContent = `${u.space}: ${u.title ? `${u.title} — ` : ''}${u.url}`;
    return li;
  }));
  $('import-result').textContent = '';
  $('import-apply').hidden = !parts.length;
  $('import-preview').showModal();
}

function wireImport() {
  $('import-preview').addEventListener('close', async () => {
    if ($('import-preview').returnValue !== 'apply') return;
    const r = await ask('import.apply');
    const lost = [...r.missing, ...r.unclear];
    $('portable-note').textContent = [
      `Imported ${plural(r.spaces, 'space')} with ${plural(r.tabs, 'tab')} and ${plural(r.collections, 'collection')}.`,
      lost.length && `Not found on this computer: ${lost.join(', ')}.`,
      r.skipped,
      r.packs.length && `Switch on in Features to download: ${r.packs.join(', ')}.`,
    ].filter(Boolean).join(' ');
    state.settings = (await ask('get')).settings;
    applyTheme();
    renderLinks();
  });
}

// --- Features: switches, and the downloads behind some of them ---

let polling = null;

function renderFeatures(f) {
  const dlg = $('features');
  for (const input of dlg.querySelectorAll('[data-feature]')) {
    const id = input.dataset.feature;
    const pack = f.packs.find((p) => p.id === id);
    if (input.type === 'checkbox') input.checked = pack ? pack.on && (pack.installed || (pack.total && !pack.error)) : !!f[id];
    else input.value = String(f[id]);
  }
  $('sticky-more').hidden = !f.sticky;
  const library = f.packs.find((p) => p.id === 'library');
  $('library-more').hidden = !library?.installed;
  $('folder-line').textContent = f.folder ? `Notes are kept in ${f.folder}.` : 'Notes are kept in Xiao. Choose a folder to share them with textarea or another app.';
  $('folder-reset').hidden = !f.folder;
  for (const p of f.packs) {
    const size = dlg.querySelector(`[data-size="${p.id}"]`);
    if (size) {
      // switching off keeps the download; removing it is its own button
      size.textContent = p.installed ? `Downloaded (${p.size}).` : `Downloads ${p.size}.`;
      if (p.installed) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'remove';
        remove.textContent = 'Remove download';
        remove.addEventListener('click', async () => renderFeatures(await ask('feature', { id: p.id, remove: true })));
        size.append(' ', remove);
      }
    }
    const line = dlg.querySelector(`[data-progress="${p.id}"]`);
    if (!line) continue;
    line.classList.toggle('error', !!p.error);
    line.textContent = p.error ? `Download stopped: ${p.error}. Turn it off and on to try again.`
      : p.total ? `Downloading… ${Math.floor((100 * p.done) / p.total)}%` : '';
  }
  const busy = f.packs.some((p) => p.total && !p.error);
  if (busy && !polling) polling = setInterval(() => ask('features').then(renderFeatures), 1000);
  if (!busy && polling) {
    clearInterval(polling);
    polling = null;
  }
}

async function openFeatures() {
  renderFeatures(await ask('features'));
  $('features').showModal();
}

function wireFeatures() {
  $('open-features').addEventListener('click', openFeatures);
  for (const input of $('features').querySelectorAll('[data-feature]')) {
    input.addEventListener('change', async () => {
      const id = input.dataset.feature;
      try {
        renderFeatures(await ask('feature', input.type === 'checkbox' ? { id, on: input.checked } : { id, value: Number(input.value) }));
      } catch (e) {
        $('features').querySelector(`[data-progress="${id}"]`)?.replaceChildren(e.message);
      }
    });
  }
  $('folder-choose').addEventListener('click', async () => renderFeatures(await ask('notes.folder', { choose: true })));
  $('folder-reset').addEventListener('click', async () => renderFeatures(await ask('notes.folder', { choose: false })));
}

if (window.xiao) {
  init();
  wireFeatures();
}
