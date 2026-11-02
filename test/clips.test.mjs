import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addClip, MOST } from '../core/lib/clips.mjs';
import { allTags, tagsOf } from '../core/lib/notes.mjs';
import { rewriteMessages, WRITE_TOOLS } from '../core/lib/write.mjs';

test('the newest clip goes first, and copying again moves it up', () => {
  let c = addClip([], 'a', 1);
  c = addClip(c, 'b', 2);
  c = addClip(c, 'a', 3);
  assert.deepEqual(c.map((x) => x.text), ['a', 'b']);
  assert.equal(c[0].at, 3);
});

test('blank and overlong text is left out, and the list stays short', () => {
  assert.deepEqual(addClip([], '   ', 1), []);
  assert.deepEqual(addClip([], 'x'.repeat(20_001), 1), []);
  let c = [];
  for (let i = 0; i < MOST + 10; i++) c = addClip(c, `t${i}`, i);
  assert.equal(c.length, MOST);
  assert.equal(c[0].text, `t${MOST + 9}`);
});

test('tags are found in text, once, and a heading is not one', () => {
  assert.deepEqual(tagsOf('# Title\nbuy #Milk and #milk, see #trip-2026'), ['#milk', '#trip-2026']);
  assert.deepEqual(tagsOf('price#1 is not a tag'), []);
  assert.deepEqual(allTags([{ text: '#b' }, { text: '#a #b' }]), ['#a', '#b']);
});

test('each writing tool asks for the finished text only, and a note is capped', () => {
  for (const t of WRITE_TOOLS) assert.match(rewriteMessages(t.id, 'x')[0].content, /finished text only/);
  assert.ok(rewriteMessages('fix', 'x'.repeat(30_000))[1].content.length < 24_100);
  assert.throws(() => rewriteMessages('nope', 'x'));
});
