import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEAD_END, TOR_HOST, TOR_PORT, torRoute } from '../core/lib/tor.mjs';

const ctx = { torId: 7, port: TOR_PORT };

test('tabs outside the Tor container are not proxied', () => {
  assert.equal(torRoute({ userContextId: 0, site: 'a.example' }, ctx), null);
  assert.equal(torRoute({ userContextId: 3, site: 'a.example' }, ctx), null, 'other containers');
});

test('Tor container requests go only to tor', () => {
  const r = torRoute({ userContextId: 7, site: 'a.example' }, ctx);
  assert.deepEqual([r.host, r.port], [TOR_HOST, TOR_PORT]);
});

test('each site gets its own circuit (SOCKS username = top site)', () => {
  assert.equal(torRoute({ userContextId: 7, site: 'news.example' }, ctx).username, 'news.example');
});

test('while the Tor container is unknown, every container tab fails closed', () => {
  assert.equal(torRoute({ userContextId: 7, site: 'a.example' }, { ...ctx, torId: null }), DEAD_END);
  assert.equal(torRoute({ userContextId: 0, site: 'a.example' }, { ...ctx, torId: null }), null, 'normal tabs still load');
  assert.equal(DEAD_END.port, 9);
});

test('only Xiao itself can send the Tor check through tor', () => {
  assert.ok(torRoute({ userContextId: 0, probe: true }, ctx));
  assert.equal(torRoute({ userContextId: 0, probe: false, site: 'check.torproject.org' }, ctx), null);
});

test('a new circuit for a site changes only that site\'s SOCKS password', () => {
  const circuits = new Map([['news.example', 'n1']]);
  const route = (site) => torRoute({ userContextId: 7, site }, { ...ctx, circuits });
  assert.equal(route('news.example').password, 'n1');
  assert.equal(route('other.example').password, 'xiao');
});

test('the installer can move tor to another port', () => {
  assert.equal(torRoute({ userContextId: 7, site: 'a.example' }, { ...ctx, port: 9170 }).port, 9170);
});
