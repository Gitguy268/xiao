import assert from 'node:assert/strict';
import { test } from 'node:test';
import { topResults } from '../core/lib/instant.mjs';
import { resolveBang } from '../core/lib/bangs.mjs';

test('instant links take the top distinct web pages only', () => {
  const json = { results: [
    { url: 'https://a.example/x', title: 'A' },
    { url: 'https://a.example/x/', title: 'A again' },
    { url: 'javascript:alert(1)', title: 'bad' },
    { url: 'https://user:pw@b.example/', title: 'login' },
    { url: 'not a url' },
    { url: 'http://c.example/', title: 'C' },
  ] };
  assert.deepEqual(topResults(json, 5), [{ url: 'https://a.example/x', title: 'A' }, { url: 'http://c.example/', title: 'C' }]);
  assert.deepEqual(topResults({}, 5), []);
  assert.equal(topResults({ results: Array.from({ length: 9 }, (_, i) => ({ url: `https://x.example/${i}` })) }, 3).length, 3);
});

test('!top is an action that keeps its query', () => {
  assert.deepEqual(resolveBang('!top cheap flights', {}), { key: 'top', query: 'cheap flights', action: 'top' });
});
