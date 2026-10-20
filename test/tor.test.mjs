import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PROBE_URL, proxyFor, TOR, torRoute } from '../extension/tor.js';

const ctx = { torStoreId: 'firefox-container-7', extOrigin: 'moz-extension://abc' };

test('tabs outside the Tor container are not proxied', () => {
  assert.equal(torRoute({ url: 'https://a.example/', type: 'main_frame', cookieStoreId: 'firefox-default' }, ctx), null);
});

test('Tor container requests go only to tor, DNS included', () => {
  const r = torRoute({ url: 'https://a.example/', type: 'main_frame', cookieStoreId: 'firefox-container-7' }, ctx);
  assert.deepEqual([r.type, r.host, r.port, r.proxyDNS], ['socks', TOR.host, TOR.port, true]);
});

test('each site gets its own circuit (SOCKS username = top site)', () => {
  const sub = torRoute({
    url: 'https://cdn.other.example/x.js', type: 'script', cookieStoreId: 'firefox-container-7',
    documentUrl: 'https://frame.example/', frameAncestors: [{ url: 'https://news.example/' }],
  }, ctx);
  assert.equal(sub.username, 'news.example');
});

test('while the Tor container is still unknown, requests wait for it instead of going direct', async () => {
  let id = null;
  let resolve;
  const ready = new Promise((r) => { resolve = r; });
  const answer = proxyFor({ url: 'https://a.example/', type: 'main_frame', cookieStoreId: 'firefox-container-7' },
    { ...ctx, torStoreId: null, ready, currentId: () => id });
  assert.ok(answer instanceof Promise, 'must not answer synchronously');
  id = 'firefox-container-7';
  resolve();
  assert.equal((await answer).type, 'socks');
});

test('if the Tor container cannot be found, container tabs fail closed', async () => {
  const failed = { ...ctx, torStoreId: null, ready: Promise.reject(new Error('no containers')), currentId: () => null };
  failed.ready.catch(() => {});
  const tab = await proxyFor({ url: 'https://a.example/', cookieStoreId: 'firefox-container-3' }, failed);
  assert.equal(tab.port, 9, 'dead end, not direct');
  const normal = await proxyFor({ url: 'https://a.example/', cookieStoreId: 'firefox-default' }, failed);
  assert.equal(normal.type, 'direct');
});

test('once known, routing answers synchronously', () => {
  assert.equal(proxyFor({ url: 'https://a.example/', cookieStoreId: 'firefox-default' }, ctx).type, 'direct');
});

test('only xiao itself can send the Tor check through tor', () => {
  assert.ok(torRoute({ url: PROBE_URL, originUrl: 'moz-extension://abc/_generated_background_page.html' }, ctx));
  assert.equal(torRoute({ url: PROBE_URL, originUrl: 'https://evil.example/' }, ctx), null);
});

test('a new circuit for a site changes only that site\'s SOCKS password', () => {
  const circuits = new Map([['news.example', 'n1']]);
  const route = (url) => torRoute({ url, type: 'main_frame', cookieStoreId: 'firefox-container-7' }, { ...ctx, circuits });
  assert.equal(route('https://news.example/').password, 'n1');
  assert.equal(route('https://other.example/').password, 'xiao');
});
