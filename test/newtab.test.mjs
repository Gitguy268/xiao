import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ENGINES, parseLinks, searchTemplate, toUrl, TOR_SEARCH } from '../core/start/links.mjs';

const T = 'https://duckduckgo.com/?q=%s';

test('addresses open, words search', () => {
  assert.equal(toUrl('example.org', T), 'https://example.org');
  assert.equal(toUrl('example.org/path?q=1', T), 'https://example.org/path?q=1');
  assert.equal(toUrl('http://plain.example', T), 'http://plain.example');
  assert.equal(toUrl('localhost:8080', T), 'http://localhost:8080');
  assert.equal(toUrl('how to bake bread', T), 'https://duckduckgo.com/?q=how%20to%20bake%20bread');
  assert.equal(toUrl('node.js', T), 'https://node.js');
});

test('link lines are "name address"', () => {
  assert.deepEqual(parseLinks('My mail https://mail.example\nwiki.example\n\njavascript:alert(1)'), [
    { name: 'My mail', url: 'https://mail.example' },
    { name: 'wiki.example', url: 'https://wiki.example' },
  ]);
});

test('searches go to Xiao Search when installed, onion DuckDuckGo in Tor tabs', () => {
  const local = 'http://127.0.0.1:8890/search?q=%s';
  assert.equal(searchTemplate({ search: 'xiao' }, { inTor: false, local }), local);
  assert.equal(searchTemplate({ search: 'xiao' }, { inTor: false, local: '' }), ENGINES.ddg, 'not installed');
  assert.equal(searchTemplate({ search: 'xiao' }, { inTor: true, local }), TOR_SEARCH);
  assert.equal(searchTemplate({ search: 'custom', custom: 'https://s.example/?q=%s' }, { local }), 'https://s.example/?q=%s');
  assert.equal(searchTemplate({ search: 'brave' }, { local }), ENGINES.brave);
});
