import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { bangUrl, ownBangsText, parseBang, parseOwnBangs, resolveBang } from '../core/lib/bangs.mjs';

const table = JSON.parse(readFileSync(new URL('../core/bangs.json', import.meta.url), 'utf8'));

test('a bang can come first, last or alone, in any case', () => {
  assert.deepEqual(parseBang('!GH cats and dogs'), { key: 'gh', query: 'cats and dogs' });
  assert.deepEqual(parseBang('cats and dogs !gh'), { key: 'gh', query: 'cats and dogs' });
  assert.deepEqual(parseBang('  !gh  '), { key: 'gh', query: '' });
});

test('ordinary text and addresses are not bangs', () => {
  for (const t of ['cats', 'wow! cats', 'https://example.org/!x', 'a!b', '', '!']) assert.equal(parseBang(t), null, t);
});

test('the words are encoded, with spaces as plus by default', () => {
  assert.equal(resolveBang('!gh c++ & more', table).url, 'https://github.com/search?q=c%2B%2B+%26+more');
  assert.equal(bangUrl(['https://x.example/%s', 's'], 'a b'), 'https://x.example/a%20b');
  assert.equal(bangUrl(['https://x.example/%s', 'r'], 'a/b'), 'https://x.example/a/b');
});

test('with no words a bang opens the site', () => {
  assert.equal(resolveBang('!gh', table).url, 'https://github.com/');
  assert.equal(bangUrl(['https://x.example/s?q=%s', 'dsn', 'snap.example'], ''), 'https://snap.example/');
  assert.equal(bangUrl(['https://x.example/s?q=%s', 'n'], ''), 'https://x.example/s?q=');
});

test('Xiao keeps every name its five old shortcuts had, and adds Open Library', () => {
  for (const [bang, host] of [['w', 'wikipedia.org'], ['gh', 'github.com'], ['osm', 'www.openstreetmap.org'], ['mdn', 'developer.mozilla.org'], ['yt', 'www.youtube.com'], ['ol', 'openlibrary.org']]) {
    assert.equal(new URL(resolveBang(`!${bang} x`, table).url).host, host, bang);
  }
});

test('an unknown bang is left alone, so it can still be searched for', () => {
  assert.equal(resolveBang('!nosuchbangexists x', table), null);
});

test('Xiao\'s own actions need no address; your own bangs win over the list', () => {
  assert.equal(resolveBang('!note', table).action, 'notes');
  assert.equal(resolveBang('!lib', table).action, 'library');
  assert.equal(resolveBang('!gh cats', table, { gh: 'https://mine.example/?q=%s' }).url, 'https://mine.example/?q=cats');
});

test('your own bangs must be a name and a web address with %s, and survive a round trip', () => {
  const own = parseOwnBangs('!news https://n.example/?q=%s\nbad line\n!x javascript:alert(%s)\nplain https://p.example/%s');
  assert.deepEqual(own, { news: 'https://n.example/?q=%s', plain: 'https://p.example/%s' });
  assert.deepEqual(parseOwnBangs(ownBangsText(own)), own);
});

test('every entry in the table can only ever open a web address', () => {
  const names = Object.keys(table);
  assert.ok(names.length > 10_000, `${names.length} names`);
  for (const name of names) {
    const template = typeof table[name] === 'string' ? table[name] : table[name][0];
    assert.match(template, /^https?:\/\//, name);
    assert.ok(template.includes('%s'), name);
  }
});
