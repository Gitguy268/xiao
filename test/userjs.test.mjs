import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildUserJs, merge, readPrefs, toUserJs } from '../scripts/userjs.mjs';

const prefsOf = (js) => new Map([...js.matchAll(/^user_pref\("([^"]+)", (.*)\);$/gm)].map(([, n, v]) => [n, JSON.parse(v)]));

test('each YAML file names a pref once', () => {
  for (const name of ['balanced', 'speed', 'look', 'strict', 'kit', 'zero']) {
    const names = readPrefs(name).map((p) => p.name);
    assert.deepEqual(names.filter((n, i) => names.indexOf(n) !== i), [], name);
  }
});

test('the fork prefs and the hardening prefs never name the same pref', async () => {
  const { parse } = await import('yaml');
  const { readFileSync } = await import('node:fs');
  const fork = parse(readFileSync(new URL('../fork/prefs/fork.yaml', import.meta.url), 'utf8')).map((p) => p.name);
  const balanced = new Set(readPrefs('balanced').map((p) => p.name));
  assert.deepEqual(fork.filter((n) => balanced.has(n)), []);
});

test('balanced keeps Zen usable and Safe Browsing on', () => {
  const p = prefsOf(buildUserJs('balanced'));
  assert.equal(p.get('privacy.resistFingerprinting'), undefined);
  assert.equal(p.get('privacy.fingerprintingProtection'), true);
  assert.equal(p.get('browser.safebrowsing.malware.enabled'), true);
  assert.equal(p.get('browser.safebrowsing.downloads.remote.enabled'), false);
  assert.equal(p.get('network.trr.mode'), 2);
  assert.equal(p.get('browser.shell.checkDefaultBrowser'), false, 'kit prefs included');
  assert.equal(p.get('xpinstall.signatures.required'), undefined, 'no add-on signing exceptions: Xiao has no extension');
  assert.equal(p.get('dom.ipc.processPrelaunch.fission.number'), 1, 'speed prefs included');
  assert.equal(p.get('zen.theme.accent-color'), '#e70923', 'look prefs included');
});

test('speed prefs never raise memory limits or loosen site isolation', () => {
  const names = readPrefs('speed').map((p) => p.name);
  for (const n of names) assert.doesNotMatch(n, /fission\.autostart|webIsolated|cache\.memory|readahead|max-connections$/, n);
});

test('the start page choices are defaults, not user.js prefs, so they survive a restart', () => {
  const p = prefsOf(buildUserJs('balanced'));
  for (const n of ['zen.urlbar.replace-newtab', 'browser.startup.page', 'browser.startup.homepage']) assert.equal(p.get(n), undefined, n);
});

test('strict overrides balanced', () => {
  const p = prefsOf(buildUserJs('strict'));
  assert.equal(p.get('privacy.resistFingerprinting'), true);
  assert.equal(p.get('network.trr.mode'), 3);
  assert.equal(p.get('media.peerconnection.ice.relay_only'), true);
});

test('values are written as JS literals', () => {
  assert.equal(toUserJs(merge([{ name: 'a', value: 'x"y' }, { name: 'b', value: 0 }])),
    'user_pref("a", "x\\"y");\nuser_pref("b", 0);\n');
  assert.throws(() => toUserJs(merge([{ name: 'c', value: null }])), /unsupported/);
});
