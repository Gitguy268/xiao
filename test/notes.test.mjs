import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nameFor, safeName, siteName, splitNote } from '../core/lib/notes.mjs';

test('textarea’s front matter is kept apart from the text, byte for byte', () => {
  const head = '---\nid: abc\ncreated: 1\nupdated: 2\n---\n';
  assert.deepEqual(splitNote(`${head}# Groceries\n- milk`), { head, text: '# Groceries\n- milk' });
  assert.deepEqual(splitNote('plain note'), { head: '', text: 'plain note' });
  assert.deepEqual(splitNote('---\nnot closed'), { head: '', text: '---\nnot closed' });
  assert.equal(splitNote('﻿---\r\na: 1\r\n---\r\nx').text, 'x', 'BOM and CRLF from other editors');
});

test('a new note is named by its first line, safely and uniquely', () => {
  assert.equal(nameFor('# Groceries\n- milk', new Set()), 'Groceries.md');
  assert.equal(nameFor('\n\nTo do: a/b?', new Set()), 'To do- a-b-.md');
  assert.equal(nameFor('', new Set()), 'Note.md');
  assert.equal(nameFor('...hidden', new Set()), 'hidden.md');
  assert.equal(nameFor('Groceries', new Set(['groceries.md', 'Groceries (2).md'])), 'Groceries (3).md');
});

test('only plain note names reach the disk', () => {
  for (const ok of ['Groceries.md', 'Groceries (2).md', 'news.example.org.md']) assert.equal(safeName(ok), true, ok);
  for (const bad of ['../x.md', 'a/b.md', 'x.txt', '.md', '.hidden.md', 'C:x.md', null]) assert.equal(safeName(bad), false, String(bad));
  assert.equal(siteName('news.example.org'), 'news.example.org.md');
  assert.equal(siteName(''), null);
  assert.equal(siteName('a/b'), null);
});
