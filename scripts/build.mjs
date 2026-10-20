// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// npm run build → dist/xiao.xpi, dist/kit/ and dist/xiao-kit.zip (the release download)
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { build } from 'esbuild';
import { buildUserJs } from './userjs.mjs';
import { zip } from './zip.mjs';

const root = new URL('..', import.meta.url).pathname;
const at = (...p) => join(root, ...p);
const { version } = JSON.parse(readFileSync(at('package.json'), 'utf8'));
const ext = at('dist/ext');

rmSync(at('dist'), { recursive: true, force: true });
mkdirSync(ext, { recursive: true });

await build({
  entryPoints: [at('extension/background.js'), at('extension/cosmetics.js')],
  outdir: ext,
  bundle: true,
  format: 'iife',
  target: 'firefox128',
  legalComments: 'linked',
  logLevel: 'warning',
});

for (const p of ['webrtc-guard.js', 'newtab', 'popup', 'icons']) cpSync(at('extension', p), join(ext, p), { recursive: true });
cpSync(at('shared/tokens.css'), join(ext, 'tokens.css'));
for (const [pkg, file] of [
  ['@fontsource/eb-garamond', 'eb-garamond-latin-400-normal.woff2'],
  ['@fontsource/eb-garamond', 'eb-garamond-latin-400-italic.woff2'],
  ['@fontsource-variable/inter', 'inter-latin-wght-normal.woff2'],
]) cpSync(at('node_modules', pkg, 'files', file), join(ext, 'fonts', file));
cpSync(at('node_modules/@fontsource/eb-garamond/LICENSE'), join(ext, 'fonts/OFL-EB-Garamond.txt'));
cpSync(at('node_modules/@fontsource-variable/inter/LICENSE'), join(ext, 'fonts/OFL-Inter.txt'));
cpSync(at('LICENSE'), join(ext, 'LICENSE'));

const manifest = JSON.parse(readFileSync(at('extension/manifest.json'), 'utf8'));
writeFileSync(join(ext, 'manifest.json'), JSON.stringify({ ...manifest, version }, null, 2));

const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const files = walk(ext).sort().map((p) => [relative(ext, p), readFileSync(p)]);
const xpi = zip(files);
writeFileSync(at('dist/xiao.xpi'), xpi);

const kit = at('dist/kit');
mkdirSync(kit);
writeFileSync(join(kit, 'user.js'), buildUserJs('balanced'));
writeFileSync(join(kit, 'user-strict.js'), buildUserJs('strict'));
writeFileSync(join(kit, 'xiao.xpi'), xpi);
for (const f of readdirSync(at('kit'))) cpSync(at('kit', f), join(kit, f), { recursive: true });
cpSync(at('LICENSE'), join(kit, 'LICENSE'));
writeFileSync(at('dist/xiao-kit.zip'), zip(walk(kit).sort().map((p) => [`xiao-kit/${relative(kit, p)}`, readFileSync(p)])));

console.log(`xiao ${version}: dist/xiao.xpi (${(xpi.length / 1024).toFixed(0)} KB), dist/kit/, dist/xiao-kit.zip`);
