import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FiltersEngine, Request } from '@ghostery/adblocker';
import { fromWeb, ghosteryDetails, pageOf, typeNames } from '../core/lib/request.mjs';

// Ci.nsIContentPolicy's numbers, as far as these tests need them.
const POLICY = { TYPE_OTHER: 1, TYPE_SCRIPT: 2, TYPE_IMAGE: 3, TYPE_DOCUMENT: 6, TYPE_SUBDOCUMENT: 7, TYPE_XMLHTTPREQUEST: 11 };
const type = typeNames(POLICY);

// The contract Blocker.mjs relies on: match() says block, and the prebuilt engine survives serialization.
test('Ghostery engine blocks a matching request and survives serialization', () => {
  const engine = FiltersEngine.deserialize(FiltersEngine.parse('||ads.example^\nnews.example##.ad').serialize());
  const block = (url) => engine.match(Request.fromRawDetails(ghosteryDetails({
    url, type: type(POLICY.TYPE_SCRIPT), frameUrl: 'https://news.example/', topUrl: 'https://news.example/',
  }))).match;
  assert.equal(block('https://ads.example/banner.js'), true);
  assert.equal(block('https://cdn.example/app.js'), false);
});

test('content policy types map to the names filter lists use', () => {
  assert.equal(type(POLICY.TYPE_DOCUMENT), 'main_frame');
  assert.equal(type(POLICY.TYPE_SUBDOCUMENT), 'sub_frame');
  assert.equal(type(POLICY.TYPE_XMLHTTPREQUEST), 'xmlhttprequest');
  assert.equal(type(999), 'other');
});

test('pageOf finds the page a request belongs to', () => {
  assert.equal(pageOf({ type: 'main_frame', url: 'https://a.example/x' }), 'https://a.example/x');
  assert.equal(pageOf({ type: 'image', url: 'https://cdn.example/i.png', topUrl: 'https://b.example/', frameUrl: 'https://f.example/' }), 'https://b.example/');
  // A service worker has no tab: the site that registered it.
  assert.equal(pageOf({ type: 'xmlhttprequest', url: 'https://ads.example/', frameUrl: 'https://c.example/sw.js' }), 'https://c.example/sw.js');
});

test('only what web pages ask for is filtered, not the browser\'s own requests', () => {
  assert.equal(fromWeb({ type: 'script', topUrl: 'https://news.example/' }), true);
  assert.equal(fromWeb({ type: 'xmlhttprequest', frameUrl: 'https://news.example/sw.js' }), true, 'service worker');
  assert.equal(fromWeb({ type: 'other', system: true, url: 'https://gitguy268.github.io/xiao/engine/x.bin' }), false);
  assert.equal(fromWeb({ type: 'main_frame', system: true, url: 'https://typed.example/' }), true, 'pages typed in the address bar');
  assert.equal(fromWeb({ type: 'image', topUrl: 'resource://xiao/start/index.html' }), false, 'Xiao\'s own start page');
});

test('main frames are matched without a source, everything else against its frame', () => {
  assert.deepEqual(ghosteryDetails({ url: 'https://a.example/', type: 'main_frame', frameUrl: 'https://x/' }), { url: 'https://a.example/', type: 'main_frame' });
  assert.equal(ghosteryDetails({ url: 'https://t.example/p.gif', type: 'image', frameUrl: 'https://f.example/', topUrl: 'https://a.example/' }).sourceUrl, 'https://f.example/');
});
