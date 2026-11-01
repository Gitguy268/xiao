// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Xiao's export file, kept pure so every rule is tested in node. One JSON
// file holds spaces (their tabs, folders and splits), Library collections and
// saved searches, and settings. It is made only when asked, saved where the
// reader chooses, and never uploaded.
//
// Never in it: cookies, passwords, folder paths, private or Tor tabs, the
// search index, note or file contents. A collection of files keeps only the
// names; on import each is looked up by name in the folders given to the
// Library on that computer. Addresses keep their query (it can be the page
// itself) but lose any user:password part, and only http(s) addresses go in.
//
// The format (version 1):
//   { format: 'xiao-export', version: 1, created: ISO date,
//     spaces: [{ name, icon, tabs: [{ url, title, pinned, essential, folder, split, container }] }],
//     collections: [{ name, query } | { name, items: [{ name, kind }] }],
//     settings: { start: {...}, features: {...}, allow: [host], packs: [id] } }

export const FORMAT = 'xiao-export';
export const VERSION = 1;
export const LIMITS = { spaces: 50, tabs: 2000, collections: 500, items: 5000, text: 300, url: 4096, bytes: 8 * 1024 * 1024 };

// Settings that go in, and their types. Anything else (the notes folder, the
// engine's state, counters) is left out.
const START = { search: 'string', custom: 'string', theme: 'string', links: 'links', newtab: 'string', launch: 'string' };
const FEATURES = { perSite: 'boolean', tabSleep: 'number', libraryDownloads: 'boolean', autoArchive: 'number', siteShortcuts: 'boolean', assist: 'boolean', boards: 'boolean', quickWindow: 'boolean' };

const text = (v, max = LIMITS.text) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, ' ').trim().slice(0, max) : '');

// An address that may go in or come back: http(s) only, no user:password,
// not too long. Returns the clean address or null.
export function cleanUrl(raw) {
  if (typeof raw !== 'string' || raw.length > LIMITS.url) return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.username = '';
  u.password = '';
  return u.href;
}

const host = (v) => (typeof v === 'string' && /^[a-z0-9.-]{1,253}$/i.test(v) ? v.toLowerCase() : null);

// tab: { url, title, pinned, essential, folder, split, container, tor, private }
function exportTab(tab) {
  if (!tab || tab.tor || tab.private) return null;
  const url = cleanUrl(tab.url);
  if (!url) return null;
  const out = { url, title: text(tab.title) };
  if (tab.pinned) out.pinned = true;
  if (tab.essential) out.essential = true;
  if (tab.folder) out.folder = text(tab.folder);
  if (Number.isInteger(tab.split)) out.split = tab.split;
  if (tab.container) out.container = text(tab.container, 60);
  return out;
}

function pick(source, shape) {
  const out = {};
  for (const [key, type] of Object.entries(shape)) {
    const v = source?.[key];
    if (type === 'links') {
      if (Array.isArray(v)) out[key] = v.slice(0, 100).map((l) => ({ name: text(l?.name), url: cleanUrl(l?.url) })).filter((l) => l.url);
    } else if (type === 'string' && typeof v === 'string') {
      out[key] = key === 'custom' ? (cleanUrl(v.replace('%s', 'XIAOQUERY'))?.replace('XIAOQUERY', '%s') ?? '') : text(v, 60);
    } else if (typeof v === type && (type !== 'number' || Number.isFinite(v))) {
      out[key] = v;
    }
  }
  return out;
}

// What the browser and the Library hold now → the export object.
// data: { spaces, collections, settings: { start, features, allow, packs } }
export function buildExport(data, now = new Date()) {
  const spaces = (Array.isArray(data.spaces) ? data.spaces : []).slice(0, LIMITS.spaces).map((s) => ({
    name: text(s.name) || 'Space',
    icon: text(s.icon, 16),
    tabs: (s.tabs ?? []).map(exportTab).filter(Boolean),
  }));
  const collections = (data.collections ?? []).slice(0, LIMITS.collections).map((c) => (typeof c.query === 'string'
    ? { name: text(c.name), query: text(c.query) }
    : { name: text(c.name), items: (c.items ?? []).slice(0, LIMITS.items).map((i) => ({ name: text(i.name), kind: text(i.kind, 20) })).filter((i) => i.name) }));
  const s = data.settings ?? {};
  return {
    format: FORMAT,
    version: VERSION,
    created: now.toISOString(),
    spaces,
    collections,
    settings: {
      start: pick(s.start, START),
      features: pick(s.features, FEATURES),
      allow: [...new Set((Array.isArray(s.allow) ? s.allow : []).map(host).filter(Boolean))],
      packs: (Array.isArray(s.packs) ? s.packs : []).filter((id) => typeof id === 'string' && /^[a-z0-9-]{1,40}$/.test(id)),
    },
  };
}

export class ImportError extends Error {}

// A file someone chose → a checked export object, or ImportError. Unknown
// fields are dropped, bad entries skipped, and the counts bounded, so what
// comes back is exactly what the preview shows.
export function parseImport(raw) {
  if (typeof raw !== 'string' || raw.length > LIMITS.bytes) throw new ImportError('This file is too large to be a Xiao export.');
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new ImportError('This file is not a Xiao export (it is not JSON).');
  }
  if (data?.format !== FORMAT) throw new ImportError('This file is not a Xiao export.');
  if (data.version !== VERSION) throw new ImportError(`This export is version ${data.version}; this Xiao reads version ${VERSION}.`);
  let room = LIMITS.tabs;
  const spaces = (Array.isArray(data.spaces) ? data.spaces : []).slice(0, LIMITS.spaces).map((s) => {
    const kept = [];
    for (const t of Array.isArray(s?.tabs) ? s.tabs : []) {
      const tab = room > 0 && t && typeof t === 'object' && exportTab({ ...t, tor: false, private: false });
      if (tab) kept.push(tab), room--;
    }
    return { name: text(s?.name) || 'Space', icon: text(s?.icon, 16), tabs: kept };
  });
  const parsed = buildExport({
    spaces: [],
    collections: (Array.isArray(data.collections) ? data.collections : []).filter((c) => c && typeof c === 'object' && text(c.name)),
    settings: data.settings && typeof data.settings === 'object' ? data.settings : {},
  }, new Date(Date.parse(data.created) || 0));
  return { ...parsed, spaces };
}

// A switch as the reader knows it from the start page's Features.
const FEATURE_NAMES = { perSite: 'Sticky note per site', tabSleep: 'Tab sleep', libraryDownloads: 'Remember my downloads', autoArchive: 'Auto-archive',
  siteShortcuts: 'Site shortcuts', assist: 'Assist', boards: 'Boards', quickWindow: 'Quick window' };
export function describeFeature(id, value) {
  const name = FEATURE_NAMES[id] ?? id;
  if (typeof value === 'boolean') return `${name} ${value ? 'on' : 'off'}`;
  if (!value) return `${name} off`;
  return `${name} after ${id === 'tabSleep' ? `${value} min` : `${value} h`}`;
}

// What the reader sees before anything is imported: every address, and what
// each part will do.
export function preview(exp) {
  const urls = [];
  for (const s of exp.spaces) for (const t of s.tabs) urls.push({ space: s.name, url: t.url, title: t.title });
  for (const l of exp.settings.start.links ?? []) urls.push({ space: 'Start page', url: l.url, title: l.name });
  return {
    urls,
    spaces: exp.spaces.map((s) => `${s.name} (${s.tabs.length} tab${s.tabs.length === 1 ? '' : 's'})`),
    collections: exp.collections.map((c) => (c.query !== undefined ? `${c.name} (saved search)` : `${c.name} (${c.items.length} file name${c.items.length === 1 ? '' : 's'})`)),
    settings: Object.keys(exp.settings.start).length,
    features: Object.entries(exp.settings.features).map(([id, value]) => describeFeature(id, value)),
    allow: exp.settings.allow,
    packs: exp.settings.packs, // listed, never downloaded by an import
  };
}

// Re-links a collection's file names to items in the Library on this
// computer. find(name) → [item] with that exact name. A name that matches
// nothing, or more than one file, is reported and left out.
export async function relink(items, find) {
  const found = [];
  const missing = [];
  const unclear = [];
  for (const { name } of items) {
    const hits = (await find(name)).filter((i) => i.name === name);
    if (hits.length === 1) found.push(hits[0]);
    else (hits.length ? unclear : missing).push(name);
  }
  return { found, missing, unclear };
}
