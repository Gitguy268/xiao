// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { addItem, boardFile, boardTitle, isBoard, linkItem, newBoard, parseBoard, parts, quoteItem, toHtml } from '../core/board/model.mjs';

test('a board is a note named "Board <title>.md"', () => {
  assert.equal(boardFile('Trip to Bern'), 'Board Trip to Bern.md');
  assert.equal(boardFile('  a/b:c?  '), 'Board a b c.md');
  for (const bad of ['', '   ', '..', null]) assert.equal(boardFile(bad), null, String(bad));
  assert.ok(isBoard('Board Trip.md') && !isBoard('Clippings.md') && !isBoard('Board Trip.txt'));
  assert.equal(boardTitle('Board Trip.md'), 'Trip');
});

test('items go to the end of their topic; a missing topic is added', () => {
  let md = newBoard('Trip');
  md = addItem(md, 'Links', linkItem({ title: 'Hotels [cheap]', url: 'https://example.org/h' }));
  md = addItem(md, 'links', 'second');
  md = addItem(md, 'Quotes', quoteItem({ text: 'Open\n  late', title: 'A page', url: 'https://example.org/p' }));
  md = addItem(md, 'Packing', '- [ ] passport');
  const board = parseBoard(md);
  assert.deepEqual(board.map((t) => [t.topic, t.items.map((i) => i.text)]), [
    ['Links', ['[Hotels cheap](https://example.org/h)', 'second']],
    ['Quotes', ['“Open late” — [A page](https://example.org/p)']],
    ['Packing', ['- [ ] passport']],
  ]);
  assert.ok(md.startsWith('# Trip\n'), 'the title stays first');
});

test('only http(s) links become links; everything else stays text', () => {
  assert.deepEqual(parts('see [a](https://x.org/1) and [b](javascript:alert(1)) end'), [
    { text: 'see ' }, { text: 'a', href: 'https://x.org/1' }, { text: ' and [b](javascript:alert(1)) end' },
  ]);
});

test('the HTML export runs nothing and escapes what the note says', () => {
  const md = addItem(addItem(newBoard('<b>Trip</b>'), 'Links', '[x"><script>alert(1)</script>](https://x.org/?a=1&b=2)'), 'Notes', '<img src=x onerror=alert(1)>');
  const html = toHtml(md, '<b>Trip</b>');
  assert.ok(!/<script>|<img|onerror=/.test(html.replace(/&lt;[^&]*&gt;/g, '')), 'no live markup from the note');
  assert.match(html, /<a href="https:\/\/x.org\/\?a=1&amp;b=2">/);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /<title>&lt;b&gt;Trip&lt;\/b&gt;<\/title>/);
});

test('organise.js is textarea\'s, byte for byte (when a textarea checkout is here)', (t) => {
  const theirs = join(process.env.TEXTAREA ?? join(homedir(), 'textarea/textarea-master-claude'), 'lib/organise.js');
  if (!existsSync(theirs)) return t.skip('no textarea checkout');
  assert.equal(readFileSync(new URL('../core/board/organise.js', import.meta.url), 'utf8'), readFileSync(theirs, 'utf8'));
});
