// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Copies the shared design tokens, fonts and the mark into site/public before an Astro build.
import { cpSync, mkdirSync } from 'node:fs';

const at = (p) => new URL(`../${p}`, import.meta.url).pathname;
mkdirSync(at('site/public/fonts'), { recursive: true });
cpSync(at('shared/tokens.css'), at('site/public/tokens.css'));
cpSync(at('extension/icons/xiao.svg'), at('site/public/favicon.svg'));
for (const [pkg, file] of [
  ['@fontsource/eb-garamond', 'eb-garamond-latin-400-normal.woff2'],
  ['@fontsource/eb-garamond', 'eb-garamond-latin-400-italic.woff2'],
  ['@fontsource-variable/inter', 'inter-latin-wght-normal.woff2'],
]) cpSync(at(`node_modules/${pkg}/files/${file}`), at(`site/public/fonts/${file}`));
