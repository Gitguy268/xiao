// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Before an Astro build, copies into site/public:
//   tokens.css, fonts/, favicon.svg  the shared design tokens, typefaces and mark
//   demo/                            the real start page (core/start) with a stand-in for Xiao (site/demo/shim.mjs)
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const at = (p) => new URL(`../${p}`, import.meta.url).pathname;
mkdirSync(at('site/public/fonts'), { recursive: true });
cpSync(at('shared/tokens.css'), at('site/public/tokens.css'));
cpSync(at('core/icons/xiao.svg'), at('site/public/favicon.svg'));
cpSync(at('node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2'),
  at('site/public/fonts/bricolage-grotesque-latin-wght-normal.woff2'));
cpSync(at('shared/fonts/junicode-italic-latin.woff2'), at('site/public/fonts/junicode-italic-latin.woff2'));

const demo = at('site/public/demo');
rmSync(demo, { recursive: true, force: true });
mkdirSync(at('site/public/demo/start'), { recursive: true });
for (const f of ['start.css', 'start.js', 'links.mjs', 'terminal.mjs', 'wallpaper.mjs', 'styles']) cpSync(at(`core/start/${f}`), `${demo}/start/${f}`, { recursive: true });
cpSync(at('core/lib/bangs.mjs'), `${demo}/lib/bangs.mjs`);
cpSync(at('site/demo/shim.mjs'), `${demo}/start/shim.mjs`);
cpSync(at('shared/tokens.css'), `${demo}/tokens.css`);
cpSync(at('site/public/fonts'), `${demo}/fonts`, { recursive: true });
// The same page, with the stand-in loaded first.
const page = readFileSync(at('core/start/index.html'), 'utf8');
const withShim = page.replace('<script src="start.js" type="module"></script>',
  '<script src="shim.mjs" type="module"></script>\n  <script src="start.js" type="module"></script>');
if (withShim === page) throw new Error('site-assets: start page script tag not found');
writeFileSync(`${demo}/start/index.html`, withShim);
