import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkManifest, isNewer } from '../core/lib/updates.mjs';

const good = { version: '0.5.1', kit: { url: 'https://example.org/k.zip', sha256: 'a'.repeat(64), size: 10 } };

test('versions compare as numbers, and nonsense is never newer', () => {
  assert.equal(isNewer('0.10.0', '0.9.9'), true);
  assert.equal(isNewer('0.5.0', '0.5.0'), false);
  assert.equal(isNewer('0.4.9', '0.5.0'), false);
  assert.equal(isNewer('x', '0.5.0'), false);
});

test('a manifest needs a version, an https kit, a hash and a sensible size', () => {
  assert.equal(checkManifest(good), good);
  for (const bad of [{}, { ...good, version: 'latest' }, { ...good, kit: { ...good.kit, url: 'http://example.org/k.zip' } },
    { ...good, kit: { ...good.kit, sha256: 'abc' } }, { ...good, kit: { ...good.kit, size: 0 } }]) {
    assert.ok(checkManifest(bad) instanceof Error);
  }
});
