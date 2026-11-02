import assert from 'node:assert/strict';
import { test } from 'node:test';
import { engage, isBackground, release } from '../core/lib/silent.mjs';
import { buildUserJs, readPrefs } from '../scripts/userjs.mjs';

const fake = (start = {}) => {
  const held = new Map(Object.entries(start));
  return { held, read: (n) => held.get(n), write: (n, v) => held.set(n, v), clear: (n) => held.delete(n) };
};
const list = [{ name: 'a', value: false }, { name: 'b', value: '' }];

test('engage sets every pref and remembers what it held', () => {
  const prefs = fake({ a: true });
  assert.deepEqual(engage(list, prefs), { a: true, b: undefined });
  assert.equal(prefs.read('a'), false);
  assert.equal(prefs.read('b'), '');
});

test('release restores values and clears what only had a default', () => {
  const prefs = fake({ a: true });
  release(list, engage(list, prefs), prefs);
  assert.deepEqual([...prefs.held], [['a', true]]);
});

test('release leaves a pref the reader changed while silent', () => {
  const prefs = fake({ a: true });
  const saved = engage(list, prefs);
  prefs.write('b', 'mine');
  release(list, saved, prefs);
  assert.equal(prefs.read('b'), 'mine');
});

test('a request is background only if the browser made it for itself', () => {
  const r = { system: true, content: false, host: 'firefox.settings.services.mozilla.com', redirectedFrom: [] };
  assert.equal(isBackground(r, new Set()), true);
  assert.equal(isBackground({ ...r, content: true }, new Set()), false, 'a tab loading a page');
  assert.equal(isBackground({ ...r, system: false }, new Set()), false, 'a request a page made');
  assert.equal(isBackground({ ...r, host: 'localhost' }, new Set()), false);
  assert.equal(isBackground({ ...r, host: '127.0.0.1' }, new Set()), false);
  assert.equal(isBackground({ ...r, host: '[::1]' }, new Set()), false);
});

test('only what the reader asked for gets through, redirects included', () => {
  const r = { system: true, content: false, host: 'github.com', redirectedFrom: [] };
  assert.equal(isBackground(r, new Set(['github.com'])), false);
  assert.equal(isBackground({ ...r, host: 'github.com.example' }, new Set(['github.com'])), true);
  assert.equal(isBackground({ ...r, host: 'objects.githubusercontent.com', redirectedFrom: ['github.com'] }, new Set(['github.com'])), false);
  assert.equal(isBackground({ ...r, host: 'objects.githubusercontent.com', redirectedFrom: ['evil.example'] }, new Set(['github.com'])), true);
});

test('only the browser\'s own requests count as background', () => {
  const own = { system: true, content: false, host: 'example.org' };
  assert.equal(isBackground(own, new Set()), true);
  assert.equal(isBackground({ ...own, content: true }, new Set()), false);
  assert.equal(isBackground({ ...own, saveAs: true }, new Set()), false);
  assert.equal(isBackground({ ...own, host: '127.0.0.1' }, new Set()), false);
  assert.equal(isBackground(own, new Set(['example.org'])), false);
  assert.equal(isBackground({ ...own, host: 'cdn.example', redirectedFrom: ['example.org'] }, new Set(['example.org'])), false);
});

test('silent prefs are never in user.js, so off really is off', () => {
  const inUserJs = buildUserJs('balanced');
  const only = ['network.captive-portal-service.enabled', 'services.settings.poll_interval', 'media.gmp-manager.updateEnabled', 'dom.push.enabled'];
  for (const name of only) {
    assert.ok(readPrefs('zero').some((p) => p.name === name), name);
    assert.ok(!inUserJs.includes(`"${name}"`), name);
  }
});

test('Firefox Accounts stay off, so data stays local', () => {
  assert.match(buildUserJs('balanced'), /user_pref\("identity\.fxaccounts\.enabled", false\)/);
});
