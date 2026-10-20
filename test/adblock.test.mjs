import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WebExtensionBlocker } from '@ghostery/adblocker-webextension';
import { topHost } from '../extension/site.js';
import { fromWeb } from '../extension/adblock.js';

// The contract adblock.js relies on: onBeforeRequest returns { cancel } for a match.
test('Ghostery engine cancels a matching request and survives serialization', () => {
  const engine = WebExtensionBlocker.deserialize(WebExtensionBlocker.parse('||ads.example^\nnews.example##.ad').serialize());
  const req = (url) => engine.onBeforeRequest(undefined, {
    url, type: 'script', tabId: 1, requestId: '1', documentUrl: 'https://news.example/', originUrl: 'https://news.example/',
  });
  assert.equal(req('https://ads.example/banner.js').cancel, true);
  assert.equal(req('https://cdn.example/app.js').cancel, undefined);
});

test('topHost finds the page a request belongs to', () => {
  assert.equal(topHost({ type: 'main_frame', url: 'https://a.example/x' }), 'a.example');
  assert.equal(topHost({ type: 'image', url: 'https://cdn.example/i.png', documentUrl: 'https://b.example/' }), 'b.example');
  assert.equal(topHost({ type: 'xmlhttprequest', url: 'https://x/', frameAncestors: [] , documentUrl: 'https://c.example/' }), 'c.example');
  assert.equal(topHost({ type: 'image', url: 'nonsense' }), '');
});

test('requests outside a tab are filtered only when a web page or service worker made them', () => {
  assert.equal(fromWeb({ tabId: 3 }), true);
  assert.equal(fromWeb({ tabId: -1, originUrl: 'https://news.example/sw.js' }), true);
  assert.equal(fromWeb({ tabId: -1, originUrl: 'moz-extension://abc/_generated_background_page.html' }), false);
  assert.equal(fromWeb({ tabId: -1 }), false);
});
