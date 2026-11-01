// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// npm run build →
//   dist/core/        Xiao's browser code (the "xiao" folder next to xiao.cfg)
//   dist/loader/      autoconfig.js and xiao.cfg, which load it
//   dist/engine/      the prebuilt blocking engine, as the website serves it
//   dist/kit/         the kit: installers, prefs, core, loader
//   dist/xiao-kit.zip the release download
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { adsAndTrackingLists, ENGINE_VERSION, FiltersEngine } from '@ghostery/adblocker';
import { build } from 'esbuild';
import { buildUserJs, readPrefs } from './userjs.mjs';
import { zip } from './zip.mjs';

const root = new URL('..', import.meta.url).pathname;
const at = (...p) => join(root, ...p);
const { version } = JSON.parse(readFileSync(at('package.json'), 'utf8'));
const core = at('dist/core');

rmSync(at('dist'), { recursive: true, force: true });
mkdirSync(core, { recursive: true });

// System modules have no timers of their own.
const timers = 'import { setTimeout, clearTimeout, setInterval, clearInterval } from "resource://gre/modules/Timer.sys.mjs";';
await build({
  entryPoints: [at('core/XiaoCore.sys.mjs'), at('core/actors/XiaoParent.sys.mjs'), at('core/actors/XiaoChild.sys.mjs')],
  outdir: core,
  outbase: at('core'),
  outExtension: { '.js': '.mjs' },
  bundle: true,
  format: 'esm',
  target: 'firefox140',
  external: ['resource://*', 'moz-src://*', 'chrome://*'],
  banner: { js: timers },
  define: { XIAO_SILENT_PREFS: JSON.stringify(readPrefs('zero')), XIAO_VERSION: JSON.stringify(version) },
  legalComments: 'linked',
  logLevel: 'warning',
});

for (const p of ['start', 'assist', 'board', 'icons', 'locales', 'chrome.css', 'packs.json', 'bangs.json']) cpSync(at('core', p), join(core, p), { recursive: true });
cpSync(at('core/lib/bangs.mjs'), join(core, 'lib/bangs.mjs'));
cpSync(at('shared/tokens.css'), join(core, 'tokens.css'));
for (const [from, file] of [
  ['node_modules/@fontsource-variable/bricolage-grotesque/files', 'bricolage-grotesque-latin-wght-normal.woff2'],
  ['shared/fonts', 'junicode-italic-latin.woff2'],
]) cpSync(at(from, file), join(core, 'fonts', file));
cpSync(at('node_modules/@fontsource-variable/bricolage-grotesque/LICENSE'), join(core, 'fonts/OFL-Bricolage-Grotesque.txt'));
cpSync(at('shared/fonts/OFL-Junicode.txt'), join(core, 'fonts/OFL-Junicode.txt'));
cpSync(at('LICENSE'), join(core, 'LICENSE'));
cpSync(at('core/loader'), at('dist/loader'), { recursive: true });

// The blocking engine, built here so the browser never parses raw lists.
// Downloaded lists are reused for a day (XIAO_ENGINE_CACHE=0 to refetch).
const cache = at(`node_modules/.cache/xiao/engine-${ENGINE_VERSION}.bin`);
let engine;
if (existsSync(cache) && process.env.XIAO_ENGINE_CACHE !== '0' && Date.now() - statSync(cache).mtimeMs < 86_400_000) {
  engine = readFileSync(cache);
} else {
  try {
    const built = await FiltersEngine.fromLists(fetch, adsAndTrackingLists, { loadExtendedSelectors: true });
    engine = Buffer.from(built.serialize());
    mkdirSync(join(cache, '..'), { recursive: true });
    writeFileSync(cache, engine);
  } catch (e) {
    if (!existsSync(cache)) throw new Error(`could not download the filter lists: ${e.message}`);
    console.warn(`filter lists not downloaded (${e.message}); using the cached engine`);
    engine = readFileSync(cache);
  }
}
writeFileSync(join(core, 'engine.bin'), engine);
const sha = createHash('sha256').update(engine).digest('hex');
mkdirSync(at('dist/engine'));
writeFileSync(at(`dist/engine/engine-${ENGINE_VERSION}.bin`), engine);
writeFileSync(at(`dist/engine/engine-${ENGINE_VERSION}.bin.sha256`), `${sha}  engine-${ENGINE_VERSION}.bin\n`);

const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const size = (dir) => walk(dir).reduce((n, p) => n + statSync(p).size, 0);

const kit = at('dist/kit');
mkdirSync(kit);
writeFileSync(join(kit, 'user.js'), buildUserJs('balanced'));
writeFileSync(join(kit, 'user-strict.js'), buildUserJs('strict'));
for (const f of readdirSync(at('kit'))) cpSync(at('kit', f), join(kit, f), { recursive: true });
cpSync(core, join(kit, 'xiao'), { recursive: true });
cpSync(at('dist/loader'), join(kit, 'loader'), { recursive: true });
cpSync(at('LICENSE'), join(kit, 'LICENSE'));
writeFileSync(at('dist/xiao-kit.zip'), zip(walk(kit).sort().map((p) => [`xiao-kit/${relative(kit, p)}`, readFileSync(p)])));

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(`Xiao ${version}: dist/core (${kb(size(core))}, engine ${kb(engine.length)}), dist/kit/, dist/xiao-kit.zip`);
