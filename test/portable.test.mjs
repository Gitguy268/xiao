// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildExport, cleanUrl, ImportError, LIMITS, parseImport, preview, relink } from '../core/lib/portable.mjs';

const browser = {
  spaces: [
    { name: 'Trip', icon: '🏔', tabs: [
      { url: 'https://example.org/hotels?city=bern', title: 'Hotels', pinned: true },
      { url: 'https://user:hunter2@example.org/private', title: 'With a password' },
      { url: 'http://tor-only.example/', title: 'A Tor tab', tor: true },
      { url: 'https://example.org/secret', title: 'Private', private: true },
      { url: 'file:///Users/me/Documents/passport.pdf', title: 'A local file' },
      { url: 'about:preferences', title: 'Settings' },
      { url: 'https://example.org/a', title: 'Left', split: 0, folder: 'Reading', container: 'Work' },
      { url: 'https://example.org/b', title: 'Right', split: 0 },
    ] },
  ],
  collections: [
    { name: 'Big PDFs', query: 'type:pdf invoice' },
    { name: 'Tax 2026', items: [{ name: 'Report 2026.pdf', kind: 'pdf', path: ['/Users/me/Taxes'], root: 'r1' }] },
  ],
  settings: {
    start: { search: 'chain', theme: 'dark', custom: 'https://search.example/?q=%s', links: [{ name: 'Mail', url: 'https://mail.example/' }, { name: 'x', url: 'javascript:alert(1)' }], folder: '/Users/me/Notes' },
    features: { tabSleep: 30, assist: true, autoArchive: 24, sticky: true, 'pack:notes-ai': true },
    allow: ['news.example', 'not a host', 'NEWS.example'],
    packs: ['library', '../evil'],
  },
};

test('an export holds addresses and names, never paths, passwords, private or Tor tabs', () => {
  const exp = buildExport(browser, new Date('2026-10-25T12:00:00Z'));
  const urls = exp.spaces[0].tabs.map((t) => t.url);
  assert.deepEqual(urls, ['https://example.org/hotels?city=bern', 'https://example.org/private', 'https://example.org/a', 'https://example.org/b']);
  const json = JSON.stringify(exp);
  for (const leak of ['hunter2', 'tor-only', '/secret', 'passport', '/Users/me', 'about:', 'javascript:']) assert.ok(!json.includes(leak), leak);
  assert.deepEqual(exp.spaces[0].tabs[2], { url: 'https://example.org/a', title: 'Left', folder: 'Reading', split: 0, container: 'Work' });
  assert.deepEqual(exp.collections[1], { name: 'Tax 2026', items: [{ name: 'Report 2026.pdf', kind: 'pdf' }] });
  assert.deepEqual(exp.settings.features, { tabSleep: 30, autoArchive: 24, assist: true });
  assert.equal(exp.settings.start.custom, 'https://search.example/?q=%s');
  assert.deepEqual(exp.settings.start.links, [{ name: 'Mail', url: 'https://mail.example/' }]);
  assert.deepEqual(exp.settings.allow, ['news.example']);
  assert.deepEqual(exp.settings.packs, ['library']);
  assert.equal(exp.created, '2026-10-25T12:00:00.000Z');
});

test('an export reads back as itself, and the preview lists every address', () => {
  const exp = buildExport(browser);
  const back = parseImport(JSON.stringify(exp));
  assert.deepEqual(back, exp);
  const p = preview(back);
  assert.deepEqual(p.urls.map((u) => u.url), [...exp.spaces[0].tabs.map((t) => t.url), 'https://mail.example/']);
  assert.deepEqual(p.spaces, ['Trip (4 tabs)']);
  assert.deepEqual(p.collections, ['Big PDFs (saved search)', 'Tax 2026 (1 file name)']);
  assert.deepEqual(p.packs, ['library']);
  assert.deepEqual(p.features, ['Tab sleep after 30 min', 'Auto-archive after 24 h', 'Assist on']);
});

test('an import that is not ours, too new, or too big is refused with a reason', () => {
  for (const [raw, why] of [['not json', /not JSON/], ['{"format":"other"}', /not a Xiao export/], ['{"format":"xiao-export","version":2}', /version 2/],
    ['x'.repeat(LIMITS.bytes + 1), /too large/], [42, /too large/]]) {
    assert.throws(() => parseImport(raw), (e) => e instanceof ImportError && why.test(e.message), String(raw).slice(0, 30));
  }
});

test('an import keeps only what an export may hold, within limits', () => {
  const hostile = {
    format: 'xiao-export', version: 1, created: 'yesterday',
    spaces: [{ name: 'A‮B', tabs: [{ url: 'file:///etc/passwd' }, { url: 'https://a.example/', title: 'x'.repeat(1000), tor: true, cookie: 'k=v' }, null, 'str'] },
      { name: 'Big', tabs: Array.from({ length: LIMITS.tabs + 10 }, (_, i) => ({ url: `https://b.example/${i}` })) }],
    collections: [{ name: '', query: 'x' }, { name: 'C', items: [{ name: 'a.txt', path: '/x' }, { name: '' }] }, null],
    settings: { start: { theme: { evil: 1 } }, features: { tabSleep: Infinity, assist: 'yes' }, allow: 'news.example' },
    extra: 'dropped',
  };
  const back = parseImport(JSON.stringify(hostile));
  assert.equal(back.spaces[0].name, 'A B');
  assert.deepEqual(back.spaces[0].tabs, [{ url: 'https://a.example/', title: 'x'.repeat(LIMITS.text) }]);
  assert.equal(back.spaces[0].tabs.length + back.spaces[1].tabs.length, LIMITS.tabs);
  assert.deepEqual(back.collections, [{ name: 'C', items: [{ name: 'a.txt', kind: '' }] }]);
  assert.deepEqual(back.settings, { start: {}, features: {}, allow: [], packs: [] });
  assert.equal(back.created, '1970-01-01T00:00:00.000Z');
  assert.ok(!('extra' in back));
});

test('only plain web addresses survive, without user:password', () => {
  assert.equal(cleanUrl('https://u:p@example.org:8443/x?y=1#z'), 'https://example.org:8443/x?y=1#z');
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'file:///x', 'resource://xiao/start/', 'about:blank', 'moz-extension://x/', 'not a url', 7]) {
    assert.equal(cleanUrl(bad), null, String(bad));
  }
});

test('a collection comes back by file name; a name with no file or several stays out and is reported', async () => {
  const library = [{ name: 'a.pdf', root: 'r1' }, { name: 'twice.txt', root: 'r1' }, { name: 'twice.txt', root: 'r2' }, { name: 'a.pdf.bak', root: 'r1' }];
  const find = async (name) => library.filter((i) => i.name.includes(name));
  const r = await relink([{ name: 'a.pdf' }, { name: 'twice.txt' }, { name: 'gone.md' }], find);
  assert.deepEqual(r.found, [{ name: 'a.pdf', root: 'r1' }]);
  assert.deepEqual(r.unclear, ['twice.txt']);
  assert.deepEqual(r.missing, ['gone.md']);
});
