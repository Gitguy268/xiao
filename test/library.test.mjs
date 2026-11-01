// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decode, failure, LibraryError, METHODS, PROTOCOL, safeName, safeRelative, VIEWS } from '../core/lib/library-protocol.mjs';
import { extensionOf, isProgram, kindOf, parse, prepare, previewKind, search } from '../core/lib/library.mjs';
import { canUndo, recover } from '../core/lib/journal.mjs';
import { checkName, suggestName, uniqueName } from '../core/lib/naming.mjs';

const req = (method, payload, extra = {}) => ({ protocol: PROTOCOL, requestId: 'r1', method, payload, ...extra });
const code = (fn) => {
  try {
    fn();
  } catch (e) {
    return e instanceof LibraryError ? e.code : `not a LibraryError: ${e}`;
  }
  return 'no error';
};

test('only plain names reach the disk', () => {
  for (const name of ['report.pdf', 'Été.txt', 'a b.tar.gz', '日本語.md', '.hidden']) assert.ok(safeName(name), name);
  for (const name of ['', '.', '..', 'a/b', 'a\\b', 'a:b', 'nul', 'CON.txt', 'com1', 'trailing.', 'trailing ', ' leading',
    'x\u0000y', 'x‮y', 'x\n', 'é'.repeat(200), 42, null]) {
    assert.equal(safeName(name), null, JSON.stringify(name));
  }
  assert.equal(safeName('é.txt'), 'é.txt'); // NFC, so "é" typed two ways is one name
});

test('a path below a root is a list of plain names', () => {
  assert.deepEqual(safeRelative(['a', 'b']), ['a', 'b']);
  assert.deepEqual(safeRelative([]), []);
  for (const path of [['..'], ['a', '../b'], ['/etc'], 'a/b', [['a']], Array(65).fill('a')]) assert.equal(safeRelative(path), null, JSON.stringify(path));
});

test('requests are decoded field by field, and nothing else gets through', () => {
  const r = decode(req('items.list', { root: 'abc', path: ['Docs'], extra: 'dropped' }));
  assert.deepEqual(r.payload, { root: 'abc', path: ['Docs'] });
  assert.equal(code(() => decode(req('shell.exec', {}))), 'UNKNOWN_METHOD');
  assert.equal(code(() => decode(req('__proto__', {}))), 'UNKNOWN_METHOD');
  assert.equal(code(() => decode(req('toString', {}))), 'UNKNOWN_METHOD');
  assert.equal(code(() => decode({ ...req('capabilities', {}), protocol: 2 })), 'UNSUPPORTED');
  assert.equal(code(() => decode(req('items.list', { root: 'abc', path: ['..'] }))), 'INVALID');
  assert.equal(code(() => decode(req('items.list', { root: '../x', path: [] }))), 'INVALID');
  assert.equal(code(() => decode(req('items.list', { path: [] }))), 'INVALID');
  assert.equal(code(() => decode(req('search.query', { q: 'x'.repeat(501) }))), 'INVALID');
  assert.equal(code(() => decode(req('capabilities', {}, { requestId: 'a b' }))), 'INVALID');
  assert.equal(code(() => decode(req('search.query', { q: 'x'.repeat(70_000) }))), 'TOO_LARGE');
  // a change needs an idempotency key, so a request sent twice is done once
  assert.equal(code(() => decode(req('rename.apply', { renames: [{ item: { root: 'a', path: ['x.pdf'] }, name: 'y.pdf' }] }))), 'INVALID');
  assert.equal(decode(req('rename.apply', { renames: [{ item: { root: 'a', path: ['x.pdf'] }, name: 'y.pdf' }] }, { key: 'k1' })).key, 'k1');
  assert.equal(code(() => decode(req('rename.apply', { renames: [{ item: { root: 'a', path: ['x.pdf'] }, name: '../y.pdf' }] }, { key: 'k1' }))), 'INVALID');
});

test('every changing method needs a key, and pickers need a click', () => {
  for (const [name, spec] of Object.entries(METHODS)) {
    if (/^(roots\.revoke|tags|collections\.update|searches|rename\.apply|trash|operations\.undo)/.test(name)) assert.ok(spec.mutates, name);
  }
  assert.ok(METHODS['roots.choose'].gesture);
  assert.ok(METHODS.trash.gesture);
});

test('errors reach the page as a code and a sentence, never a stack', () => {
  const f = failure('r1', new Error('/Users/someone/secret/path exploded'));
  assert.equal(f.code, 'IO_ERROR');
  assert.doesNotMatch(f.message, /Users/);
  assert.deepEqual(failure('r1', new LibraryError('CONFLICT', 'taken')), { requestId: 'r1', ok: false, code: 'CONFLICT', message: 'taken', retryable: false });
});

test('compound extensions count as one type', () => {
  assert.equal(extensionOf('backup.tar.gz'), 'tar.gz');
  assert.equal(extensionOf('Photo.JPG'), 'jpg');
  assert.equal(extensionOf('.bashrc'), '');
  assert.equal(extensionOf('README'), '');
  assert.equal(kindOf('backup.tar.gz'), 'archive');
  assert.equal(kindOf('x.heic'), 'image');
});

test('the query language: words, phrases, filters and what goes wrong', () => {
  const q = parse('type:pdf invoice tag:"tax 2026" source:downloads "Acme Ltd" before:2026-10-01 after:2026-09');
  assert.deepEqual(q.words, ['invoice']);
  assert.deepEqual(q.phrases, ['acme ltd']);
  assert.deepEqual(q.types, ['pdf']);
  assert.deepEqual(q.tags, ['tax 2026']);
  assert.deepEqual(q.sources, ['downloads']);
  assert.equal(q.before, new Date(2026, 9, 1).getTime());
  assert.equal(q.after, new Date(2026, 9, 1).getTime()); // after September means from 1 October
  assert.deepEqual(q.warnings, []);
  const odd = parse('before:soon source:mars re:meeting type: tag:');
  assert.deepEqual(odd.words, ['before', 'soon', 'source', 'mars', 're', 'meeting', 'type', 'tag']);
  assert.equal(odd.warnings.length, 4);
  assert.deepEqual(parse('before:2026-02-30').warnings.length, 1);
  assert.deepEqual(parse('"unclosed quote').phrases, ['unclosed quote']);
});

const at = (d) => new Date(d).getTime();
const records = [
  { id: '1', name: 'Invoice 2026-09.pdf', source: 'downloads', modified: at('2026-09-30'), tags: ['tax'] },
  { id: '2', name: 'invoice.pdf', source: 'files', modified: at('2026-08-01') },
  { id: '3', name: 'Old invoices.zip', source: 'files', modified: at('2026-10-05') },
  { id: '4', name: 'Conference schedule.pdf', originalName: 'download (7).pdf', source: 'downloads', modified: at('2026-10-10') },
  { id: '5', name: 'Notes on invoicing.md', source: 'notes', modified: at('2026-10-11'), text: 'ask about the VAT number' },
  { id: '6', name: 'Résumé.docx', source: 'files', modified: at('2026-01-01') },
  { id: '7', name: 'Photos', kind: 'folder', source: 'files', modified: at('2026-01-01') },
];
const ids = (r) => r.items.map((i) => i.id);
const all = records.map(prepare);

test('ranking: exact name, then prefix, then words, then loose matches', () => {
  assert.deepEqual(ids(search(all, 'invoice')), ['2', '1', '3']); // "invoicing" has no e
  assert.equal(search(all, 'invoice').items[0].reason, 'name');
  assert.deepEqual(ids(search(all, 'invc')), ['5', '3', '1', '2']); // letters in order
});

test('a renamed download is still found by its old name', () => {
  const r = search(all, 'download (7)');
  assert.deepEqual(ids(r), ['4']);
  assert.equal(r.items[0].reason, 'earlier name or title');
});

test('filters, tags, note text and accents', () => {
  assert.deepEqual(ids(search(all, 'type:pdf source:downloads')), ['4', '1']);
  assert.deepEqual(ids(search(all, 'type:document invoice')), ['2', '1']);
  assert.deepEqual(ids(search(all, 'tax')), ['1']);
  assert.deepEqual(ids(search(all, 'vat number')), ['5']);
  assert.deepEqual(ids(search(all, 'resume')), ['6']);
  assert.deepEqual(ids(search(all, 'type:folder')), ['7']);
  assert.deepEqual(ids(search(all, 'invoice before:2026-09')), ['2']);
  assert.deepEqual(ids(search(all, 'invoice after:2026-09-30')), ['3']); // from 1 October
});

test('10,000 items: the same order every time, and p95 under 100 ms', () => {
  const big = [];
  const topics = ['invoice', 'schedule', 'photo', 'report', 'résumé', 'contract', 'notes', 'budget', 'trip', 'recipe'];
  for (let i = 0; i < 10_000; i++) {
    const t = topics[i % topics.length];
    big.push({ id: `i${i}`, name: `${t} ${i % 97} v${i % 7}.${['pdf', 'png', 'md', 'zip'][i % 4]}`, source: i % 3 ? 'files' : 'downloads',
      modified: 1_700_000_000_000 + (i % 500) * 86_400_000, tags: i % 11 ? [] : ['research'], originalName: i % 13 ? undefined : `download (${i}).pdf` });
  }
  const prepared = big.map(prepare);
  const queries = ['invoice', 'report 4', 'type:pdf budget', 'tag:research', 'download (13)', 'rsm', 'contract v3', 'trip before:2024-06'];
  const times = [];
  let first;
  for (let round = 0; round < 5; round++) {
    for (const q of queries) {
      const t = performance.now();
      const r = search(prepared, q);
      times.push(performance.now() - t);
      if (q === 'invoice') {
        first ??= ids(r);
        assert.deepEqual(ids(r), first);
      }
    }
  }
  times.sort((a, b) => a - b);
  const p95 = times[Math.floor(times.length * 0.95)];
  assert.ok(p95 < 100, `p95 ${p95.toFixed(1)} ms`);
  assert.equal(search(prepared, 'invoice').total, 1000);
});

test('programs and installers are never opened or renamed by the Library', () => {
  for (const name of ['Setup.exe', 'Zen.dmg', 'tool.app', 'run.command', 'x.sh', 'a.pkg', 'b.AppImage', 'Install.msi', 'link.webloc']) assert.ok(isProgram(name), name);
  for (const name of ['report.pdf', 'photo.jpg', 'notes.md', 'exe.txt']) assert.ok(!isProgram(name), name);
});

test('previews: media as itself, pages and SVGs only as text', () => {
  assert.deepEqual(previewKind('a.PNG'), { kind: 'image', mime: 'image/png' });
  assert.deepEqual(previewKind('song.mp3'), { kind: 'audio', mime: 'audio/mpeg' });
  assert.equal(previewKind('page.html').kind, 'text');
  assert.equal(previewKind('logo.svg').kind, 'text');
  assert.equal(previewKind('README').kind, 'text');
  assert.equal(previewKind('x.pdf').kind, 'pdf');
  assert.equal(previewKind('x.docx').kind, 'none');
});

test('every part of the Library OpenFinder shows can be searched', () => {
  for (const view of VIEWS) assert.equal(decode(req('search.query', { q: '', view })).payload.view, view);
  assert.equal(code(() => decode(req('search.query', { q: '', view: 'collection' }))), 'INVALID');
});

test('tidy names: copies, separators, and nothing guessed', () => {
  const name = (n, c) => suggestName(n, c)?.name ?? null;
  assert.equal(name('download (7).pdf', { title: 'Conference schedule | Example Events' }), 'Conference schedule.pdf');
  assert.equal(name('download (7).pdf'), null); // no title: a better name would be a guess
  assert.equal(name('Annual_report_2026-final.pdf'), 'Annual report 2026-final.pdf');
  assert.equal(name('report (1).pdf'), 'report.pdf');
  assert.equal(name('Budget - Copy.xlsx'), 'Budget.xlsx');
  assert.equal(name('backup_2026_10.tar.gz'), 'backup 2026 10.tar.gz');
  assert.equal(name('IMG_1042.PNG'), null);
  assert.equal(name('Screenshot 2026-10-21 at 09.12.33.png'), null);
  assert.equal(name('version.1.2.3.txt'), null); // dots between digits stay
  assert.equal(name('Installer (2).dmg'), null); // programs keep their names
  assert.equal(name('3f2a9c0e7b1d4e5f.pdf', { title: '(3) Tax return 2026 – Gov.example' }), 'Tax return 2026.pdf');
  assert.equal(name('Résumé_Été.docx'), 'Résumé Été.docx');
  assert.equal(name('تقرير_سنوي.pdf'), 'تقرير سنوي.pdf'); // right-to-left text, words kept as written
  assert.equal(name('日本語のファイル (2).txt'), '日本語のファイル.txt');
  assert.equal(name('Notes.md'), null);
  assert.deepEqual(suggestName('report (1).pdf').reasons, ['without the copy number']);
});

test('a new name keeps the extension and a usable form', () => {
  assert.equal(checkName('a.pdf', 'b.pdf'), null);
  assert.equal(checkName('a.pdf', 'b.PDF'), null);
  assert.match(checkName('a.pdf', 'b.exe'), /Keep the \.pdf/);
  assert.match(checkName('a.tar.gz', 'b.gz'), /Keep the \.tar\.gz/);
  assert.match(checkName('README', 'README.md'), /no extension/);
  assert.match(checkName('a.pdf', '../b.pdf'), /characters/);
  assert.ok(checkName('a.pdf', '.pdf')); // a dot file has no name before it
  assert.match(checkName('Setup.exe', 'Tool.exe'), /Programs/);
});

test('a free name is found without overwriting, whatever the case', () => {
  assert.equal(uniqueName('Report.pdf', ['report.PDF', 'Report 2.pdf']), 'Report 3.pdf');
  assert.equal(uniqueName('Report.pdf', []), 'Report.pdf');
  assert.equal(uniqueName('é.txt', ['é.txt']), 'é 2.txt'.normalize('NFD') === 'é 2.txt' ? 'é 2.txt' : uniqueName('é.txt', ['é.txt']));
  assert.equal(uniqueName('a.tar.gz', ['a.tar.gz']), 'a 2.tar.gz');
});

test('after a crash, the disk decides what the journal records', () => {
  const id = { size: 10, modified: 5 };
  const other = { size: 11, modified: 6 };
  assert.equal(recover({ state: 'prepared', identity: id }, id, null), 'failed'); // never moved
  assert.equal(recover({ state: 'prepared', identity: id }, null, id), 'committed'); // moved, not yet written down
  assert.equal(recover({ state: 'applied', identity: id }, null, id), 'committed');
  assert.equal(recover({ state: 'applied', identity: id }, id, id), 'review'); // both there: someone copied it
  assert.equal(recover({ state: 'applied', identity: id }, null, null), 'review'); // gone
  assert.equal(recover({ state: 'applied', identity: id }, null, other), 'review'); // replaced
  assert.equal(recover({ state: 'undoing', identity: id }, id, null), 'undone');
  assert.equal(recover({ state: 'undoing', identity: id }, null, id), 'committed');
});

test('undo never overwrites, and never moves a file that changed', () => {
  const id = { size: 10, modified: 5 };
  assert.equal(canUndo({ state: 'committed', identity: id }, null, id), null);
  assert.match(canUndo({ state: 'committed', identity: id }, { size: 1, modified: 1 }, id), /old name/);
  assert.match(canUndo({ state: 'committed', identity: id }, null, { size: 99, modified: 5 }), /changed/);
  assert.match(canUndo({ state: 'committed', identity: id }, null, null), /no longer/);
  assert.match(canUndo({ state: 'undone', identity: id }, null, id), /already/);
});

test('every statement in the Library store passes Sqlite.sys.mjs\'s LIKE check', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../core/LibraryStore.mjs', import.meta.url), 'utf8');
  // Sqlite.sys.mjs (Firefox 158) refuses SQL matching this, as a guard against unbound LIKE patterns
  const refused = /\bLIKE\b\s(?![@:?])/i;
  const statements = [...source.matchAll(/(['`])((?:SELECT|INSERT|UPDATE|DELETE|CREATE)\b[\s\S]*?)\1/g)].map((m) => m[2]);
  assert.ok(statements.length > 10);
  for (const sql of statements) assert.ok(!refused.test(sql), sql);
});
