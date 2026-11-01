// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// npm run packs → the optional features' downloads (see core/Packs.mjs):
//   dist-packs/<id>-<sha8>.zip   code, for the "packs" release on GitHub
//   dist-packs/mirror/<sha256>   every file by its hash, for the e2e's mirror
//   core/packs.json              the catalogue Xiao ships, pinning every file
//
// The voice organiser's code and models come from textarea (MIT, same
// author), the file converter from convert-gitguy268 (GPL-2.0, downloaded
// separately, never part of Xiao's own files), and the Library from
// OpenFinder (GPL-3.0-or-later, same author, built with npm run build:xiao):
//   TEXTAREA=~/textarea/textarea-master-claude CONVERT=~/convert-gitguy268/dist OPENFINDER=~/openfinder npm run packs
// Model files are not re-hosted: they are fetched from Hugging Face at the
// pinned revision, by byte range, in the same 64 MB chunks textarea checks.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, linkSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, posix, relative } from 'node:path';
import { build } from 'esbuild';
import { checkPack } from '../core/lib/packs.mjs';
import { zip } from './zip.mjs';

const root = new URL('..', import.meta.url).pathname;
const at = (...p) => join(root, ...p);
const TEXTAREA = process.env.TEXTAREA ?? join(homedir(), 'textarea/textarea-master-claude');
const CONVERT = process.env.CONVERT ?? join(homedir(), 'convert-gitguy268/dist');
const OPENFINDER = process.env.OPENFINDER ?? join(homedir(), 'openfinder');
const RELEASE = 'https://github.com/Gitguy268/xiao/releases/download/packs';
const MODELS = ['minicpm5-2b-2079a22f', 'whisper-small-2d67713f'];

const out = at('dist-packs');
const mirror = join(out, 'mirror');
rmSync(out, { recursive: true, force: true });
mkdirSync(mirror, { recursive: true });

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const tree = (dir, prefix = '') => walk(dir).map((p) => [posix.join(prefix, relative(dir, p).split('\\').join('/')), readFileSync(p)]);
const keep = (path, bytes, hash) => {
  const m = join(mirror, hash);
  if (!existsSync(m)) bytes ? writeFileSync(m, bytes) : linkSync(path, m);
};

// One zip of code per pack, named by its hash so a release never changes a file in place.
function codeZip(id, entries) {
  const body = zip(entries.sort(([a], [b]) => (a < b ? -1 : 1)));
  const hash = sha(body);
  const name = `${id}-${hash.slice(0, 8)}.zip`;
  writeFileSync(join(out, name), body);
  keep(null, body, hash);
  return { path: name, url: `${RELEASE}/${name}`, sha256: hash, size: body.length, unzip: true };
}

const fonts = [
  ['fonts/bricolage-grotesque-latin-wght-normal.woff2', at('node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2')],
  ['fonts/junicode-italic-latin.woff2', at('shared/fonts/junicode-italic-latin.woff2')],
  ['tokens.css', at('shared/tokens.css')],
].map(([name, p]) => [name, readFileSync(p)]);

// --- the voice organiser: textarea's speech and writing code, Xiao's page, two models ---
const ta = (...p) => join(TEXTAREA, ...p);
const notesCode = [
  ...tree(at('packs/notes-ai')),
  ...fonts,
  ...['organise.js', 'board-panel.js', 'gemma.js', 'whisper.js', 'whisper-worker.js'].map((f) => [`lib/${f}`, readFileSync(ta('lib', f))]),
  ...tree(ta('vendor/wllama'), 'vendor/wllama'),
  ...['transformers.min.js', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm', 'LICENSE', 'LICENSE-onnxruntime']
    .map((f) => [`vendor/transformers/${f}`, readFileSync(ta('vendor/transformers', f))]),
];
const modelFiles = [];
for (const dir of MODELS) {
  const manifest = JSON.parse(readFileSync(ta('models', dir, 'manifest.json'), 'utf8'));
  const parts = new Set();
  for (const [key, file] of Object.entries(manifest.files)) {
    let offset = 0;
    for (const chunk of file.chunks) {
      const local = posix.join(posix.dirname(key), chunk.path);
      parts.add(local);
      const path = `models/${dir}/${local}`;
      const bytes = readFileSync(ta('models', dir, local));
      if (bytes.length !== chunk.size || sha(bytes) !== chunk.sha256) throw new Error(`${path} does not match textarea's manifest`);
      keep(ta('models', dir, local), null, chunk.sha256);
      modelFiles.push({
        path,
        url: `https://huggingface.co/${manifest.name}/resolve/${manifest.revision}/${key}`,
        range: [offset, offset + chunk.size - 1],
        sha256: chunk.sha256,
        size: chunk.size,
      });
      offset += chunk.size;
    }
  }
  // The small files (manifest, configs, licence) ride in the code zip.
  notesCode.push(...tree(ta('models', dir), `models/${dir}`).filter(([name]) => !parts.has(name.slice(`models/${dir}/`.length))));
}

// --- the PDF tools: Xiao's page with pdf-lib bundled in ---
const bundled = await build({
  entryPoints: [at('packs/pdf/pdf.js')],
  bundle: true,
  format: 'esm',
  target: 'firefox140',
  write: false,
  minify: true,
  legalComments: 'eof',
  logLevel: 'warning',
});
const pdfCode = [
  ...['index.html', 'pdf.css'].map((f) => [f, readFileSync(at('packs/pdf', f))]),
  ['pdf.bundle.js', Buffer.from(bundled.outputFiles[0].contents)],
  ['LICENSE-pdf-lib.md', readFileSync(at('node_modules/@cantoo/pdf-lib/LICENSE.md'))],
  ...fonts,
];

const packs = [
  {
    id: 'notes-ai',
    licence: 'MPL-2.0 and MIT (code); Apache-2.0 (MiniCPM5) and MIT (Whisper)',
    files: [codeZip('notes-ai', notesCode), ...modelFiles],
  },
  { id: 'pdf', licence: 'MPL-2.0; pdf-lib MIT', files: [codeZip('pdf', pdfCode)] },
];
if (existsSync(join(CONVERT, 'index.html'))) {
  packs.push({ id: 'convert', licence: 'GPL-2.0', source: 'https://github.com/p2r3/convert', files: [codeZip('convert', tree(CONVERT))] });
} else {
  console.warn(`no convert build at ${CONVERT}: the catalogue leaves the file converter out`);
}

// --- the Library: OpenFinder's Xiao build, checked against this Xiao's contract ---
const libraryBuild = join(OPENFINDER, 'dist-xiao');
if (existsSync(join(libraryBuild, 'openfinder-build.json'))) {
  const build = JSON.parse(readFileSync(join(libraryBuild, 'openfinder-build.json'), 'utf8'));
  const { PROTOCOL } = await import('../core/lib/library-protocol.mjs');
  if (build.protocol !== PROTOCOL) throw new Error(`OpenFinder speaks Library protocol ${build.protocol}, this Xiao ${PROTOCOL}`);
  for (const [name, hash] of Object.entries(build.contract)) {
    if (sha(readFileSync(at('core/lib', name))) !== hash) throw new Error(`OpenFinder was built with an older copy of core/lib/${name}: run npm run contract && npm run build:xiao in ${OPENFINDER}`);
  }
  if (sha(readFileSync(at('shared/tokens.css'))) !== build.tokens) console.warn('OpenFinder was built with older design tokens: run npm run tokens there');
  const git = (...args) => {
    try {
      return execFileSync('git', ['-C', OPENFINDER, ...args], { encoding: 'utf8' }).trim();
    } catch {
      return '';
    }
  };
  const files = tree(libraryBuild);
  // What went into the pack: the revision alone does not say it when the tree had changes.
  const manifest = {
    openfinder: build.version,
    revision: git('rev-parse', 'HEAD') || 'unknown',
    dirty: !!git('status', '--porcelain'),
    fingerprint: sha(files.map(([name, bytes]) => `${name} ${sha(bytes)}`).join('\n')),
    protocol: { min: PROTOCOL, max: PROTOCOL },
    tokens: build.tokens,
    files: Object.fromEntries(files.map(([name, bytes]) => [name, sha(bytes)])),
  };
  mkdirSync(at('packs/library'), { recursive: true });
  writeFileSync(at('packs/library/manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
  packs.push({
    id: 'library',
    licence: 'GPL-3.0-or-later (OpenFinder); fonts OFL-1.1',
    source: 'https://github.com/Gitguy268/openfinder',
    files: [codeZip('library', [...files, ['manifest.json', Buffer.from(JSON.stringify(manifest))]])],
  });
} else {
  console.warn(`no OpenFinder build at ${libraryBuild} (npm run build:xiao there): the catalogue leaves the Library out`);
}

for (const p of packs) {
  const checked = checkPack(p);
  if (checked instanceof Error) throw checked;
}
writeFileSync(at('core/packs.json'), `${JSON.stringify(packs, null, 1)}\n`);
for (const p of packs) {
  const mb = p.files.reduce((n, f) => n + f.size, 0) / 1e6;
  console.log(`${p.id}: ${p.files.length} files, ${mb.toFixed(1)} MB`);
}
cpSync(at('core/packs.json'), join(out, 'packs.json'));
