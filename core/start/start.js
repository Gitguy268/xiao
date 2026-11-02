// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The start page. Xiao's browser code gives this page (and only this page)
// window.xiao.call(name, data); the website's demo gives it a stand-in.
import { ownBangsText, parseBang } from '../lib/bangs.mjs';
import { parseLinks, searchTemplate, toUrl } from './links.mjs';
import { runCommand } from './terminal.mjs';
import { paintDesktop } from './wallpaper.mjs';

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
  const { theme, style } = state.settings;
  const root = document.documentElement;
  if (theme === 'auto') delete root.dataset.theme;
  else root.dataset.theme = theme;
  root.dataset.style = style;
  $('style-sheet').href = style === 'normal' ? 'data:text/css,' : `styles/${style}.css`;
  const sky = style === 'glass' || style === 'retrofind';
  $('desktop').hidden = !sky;
  if (sky) paintDesktop($('desktop'));
  $('q').placeholder = style === 'terminal' ? 'Type help, or search' : 'Search or enter an address';
}

function sentence(s) {
  const parts = [`<strong>${s.total.toLocaleString()}</strong> ads and trackers blocked so far.`];
  parts.push(s.https ? 'HTTPS-Only is on.' : 'HTTPS-Only is off.');
  if (s.tor.silent) parts.push('Silent mode is on, so Tor stays off.');
  else if (s.tor.unknown) return parts.join(' '); // not asked: the check is a connection out
  else if (s.tor.isTor) parts.push('Tor is connected.');
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

async function go(q) {
  const bang = parseBang(q) ? await ask('bang', { text: q }).catch(() => null) : null;
  if (bang?.action) return void ask('bang.run', { action: bang.action });
  location.href = bang?.url ?? toUrl(q, searchTemplate(state.settings, state));
}

// The Terminal style's prompt. True when the line was a command, not a search.
async function command(line) {
  const r = runCommand(line, state.settings.links);
  if (r.search) return false;
  const log = $('term-log');
  $('q').value = '';
  log.textContent += `xiao ~ $ ${line}\n${(r.print ?? []).map((l) => `${l}\n`).join('')}`;
  if (r.clear) log.textContent = '';
  if (r.action) await ask('bang.run', { action: r.action });
  if (r.open === 'features') await openFeatures();
  if (r.open === 'settings') openSettings();
  if (r.go) location.href = toUrl(r.go, searchTemplate(state.settings, state));
  if (r.style || r.theme) {
    state.settings = await ask('save', { ...state.settings, bangs: ownBangsText(state.settings.bangs), ...choices(), ...(r.style && { style: r.style }), ...(r.theme && { theme: r.theme }) });
    applyTheme();
  }
  return true;
}

// The two choices that live in prefs, as the save call expects them.
const choices = () => ({ newtab: state.settings.newtab, launch: state.settings.launch });

function openSettings() {
  const f = $('settings-form');
  const s = state.settings;
  for (const name of ['search', 'custom', 'theme', 'style', 'newtab', 'launch']) f[name].value = s[name];
  f.glass.checked = s.glass;
  f.links.value = s.links.map((l) => `${l.name} ${l.url}`).join('\n');
  f.bangs.value = ownBangsText(s.bangs);
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
  if (state.inTor && !state.status.tor.isTor && state.status.tor.installed) setTimeout(refreshStatus, 6_000);

  addEventListener('resize', () => {
    if (!$('desktop').hidden) paintDesktop($('desktop'));
  });
  $('search').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = $('q').value;
    if (!q.trim()) return;
    if (state.settings.style === 'terminal' && await command(q)) return;
    go(q);
  });
  $('open-notes').addEventListener('click', () => ask('bang.run', { action: 'notes' }));
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
      style: f.style.value,
      glass: f.glass.checked,
      newtab: f.newtab.value,
      launch: f.launch.value,
      links: parseLinks(f.links.value),
      bangs: f.bangs.value,
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
  $('silent-more').hidden = !f.silent;
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
    line.textContent = p.error ? `Download stopped: ${p.error}.`
      : p.total ? `Downloading… ${Math.floor((100 * p.done) / p.total)}%` : '';
    const box = dlg.querySelector(`input[data-feature="${p.id}"]`);
    if (box) box.disabled = !!p.missing;
    if (p.error) {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'remove';
      retry.textContent = 'Try again';
      retry.addEventListener('click', async () => renderFeatures(await ask('feature', { id: p.id, on: true })));
      line.append(' ', retry);
    }
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
  $('updates-check').addEventListener('click', async () => {
    $('updates-note').textContent = 'Asking…';
    const u = await ask('updates.check');
    $('updates-note').textContent = u.state === 'ready' ? `Xiao ${u.version} will install at the next start.`
      : u.state === 'current' ? `Xiao ${u.running} is the latest.`
        : u.state === 'none' ? 'This copy of Xiao does not update itself.'
          : 'Could not check right now. Try again later.';
  });
  $('drm-install').addEventListener('click', async () => {
    $('drm-note').textContent = 'Downloading…';
    try {
      $('drm-note').textContent = `Widevine ${await ask('drm.install')} is ready.`;
    } catch {
      $('drm-note').textContent = 'Could not download it. Check your connection and try again.';
    }
  });
  $('filters-update').addEventListener('click', async () => {
    $('filters-note').textContent = 'Asking…';
    const { changed } = await ask('filters.update');
    $('filters-note').textContent = changed ? 'Filters updated.' : 'No newer filters could be fetched.';
  });
  $('folder-choose').addEventListener('click', async () => renderFeatures(await ask('notes.folder', { choose: true })));
  $('folder-reset').addEventListener('click', async () => renderFeatures(await ask('notes.folder', { choose: false })));
}

if (window.xiao) {
  init();
  wireFeatures();
}
