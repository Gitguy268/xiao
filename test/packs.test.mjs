import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkPack, safePath, sizeLabel, sourceOf, totalSize, downloadProblem, isMissing } from '../core/lib/packs.mjs';

const sha = 'a'.repeat(64);
const file = (over = {}) => ({ path: 'lib/organise.js', url: 'https://example.org/x', sha256: sha, size: 10, ...over });

test('a pack path stays inside the pack', () => {
  assert.equal(safePath('models/minicpm5-2b/MiniCPM5-2B-Q4_K_M.part1'), true);
  assert.equal(safePath('vendor/wllama/wllama (compat).wasm'), true);
  for (const bad of ['../x', 'a/../../x', '/etc/passwd', 'a//b', 'a/./b', '', 'C:\\x', '.hidden', 'a/', 42, undefined]) {
    assert.equal(safePath(bad), false, String(bad));
  }
});

test('a catalogue entry is checked before anything is fetched', () => {
  const ok = { id: 'notes-ai', files: [file(), file({ path: 'm/p1', range: [0, 9] })] };
  assert.equal(checkPack(ok), ok);
  assert.equal(totalSize(ok), 20);
  assert.match(checkPack({ id: 'Bad Id', files: [file()] }).message, /no usable id/);
  assert.match(checkPack({ id: 'x1', files: [] }).message, /lists no files/);
  assert.match(checkPack({ id: 'x1', files: [file({ path: '../x' })] }).message, /not a plain path/);
  assert.match(checkPack({ id: 'x1', files: [file({ url: 'http://example.org/x' })] }).message, /no https/);
  assert.match(checkPack({ id: 'x1', files: [file({ sha256: 'nope' })] }).message, /SHA-256/);
  assert.match(checkPack({ id: 'x1', files: [file({ range: [0, 5] })] }).message, /byte range/);
});

test('a mirror serves files by their hash, the network by their address and range', () => {
  const f = file({ range: [10, 19] });
  assert.deepEqual(sourceOf(f, ''), { url: 'https://example.org/x', range: [10, 19] });
  assert.deepEqual(sourceOf(f, 'http://127.0.0.1:9/m'), { url: `http://127.0.0.1:9/m/${sha}` });
  assert.equal(sizeLabel(1_561_318_368), '1.6 GB');
  assert.equal(sizeLabel(458_000_000), '458 MB');
  assert.equal(sizeLabel(900), '1 KB');
});

test('a failed download is explained in words, with no status code', () => {
  for (const status of [0, 403, 404, 410, 429, 500, 502]) {
    const said = downloadProblem(status);
    assert.doesNotMatch(said, /\d{3}|error|HTTP/i, String(status));
    assert.ok(said.length > 20);
  }
  assert.match(downloadProblem(404), /not available/);
  assert.match(downloadProblem(0), /connection/);
  assert.equal(isMissing(404), true);
  assert.equal(isMissing(500), false);
});
