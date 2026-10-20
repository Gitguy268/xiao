// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Turns a zen-browser/desktop checkout into xiao.
//   node fork/overlay.mjs <desktop>            before `npm run import` (rename, branding, prefs, links)
//   node fork/overlay.mjs <desktop> --engine   after it (built-in extension, branding prefs in engine/)
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse, parseDocument } from 'yaml';

const [desktop, mode] = process.argv.slice(2);
if (!desktop || !existsSync(join(desktop, 'surfer.json'))) {
  console.error('usage: node fork/overlay.mjs <zen-browser/desktop checkout> [--engine]');
  process.exit(2);
}
const here = new URL('.', import.meta.url).pathname;
const root = join(here, '..');
const SITE = 'https://gitguy268.github.io/xiao';
const EXT_ID = 'xiao@gitguy268.github.io';
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const edit = (file, fn) => {
  const path = join(desktop, file);
  const before = readFileSync(path, 'utf8');
  const after = fn(before);
  if (after === before) throw new Error(`overlay: nothing changed in ${file}; did Zen move it?`);
  writeFileSync(path, after);
};
const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
// Links to Zen's site that a xiao user would follow: about, donate, privacy, uninstall feedback.
const relink = (text) => text
  .replace(/https:\/\/(www\.)?zen-browser\.app\/(donate|about\/?)/g, `${SITE}/about/`)
  .replace(/https:\/\/(www\.)?zen-browser\.app\/privacy-policy\/?/g, `${SITE}/privacy/`)
  .replace(/https:\/\/links\.zen-browser\.app\/uninstall-feedback/g, 'https://github.com/Gitguy268/xiao/issues/new');

function source() {
  // 1. Name and identity: xiao must not share Zen's app id, profile folder or bundle id.
  const surfer = JSON.parse(readFileSync(join(desktop, 'surfer.json'), 'utf8'));
  surfer.name = 'xiao';
  surfer.vendor = 'xiao';
  surfer.appId = 'xiao';
  surfer.binaryName = 'xiao';
  surfer.brands = {
    release: {
      ...surfer.brands.release,
      backgroundColor: '#1b1b1b',
      brandShorterName: 'xiao',
      brandShortName: 'xiao',
      brandFullName: 'xiao',
      release: { ...surfer.brands.release.release, displayVersion: version, github: { repo: 'Gitguy268/xiao' } },
    },
  };
  delete surfer.updateHostname; // surfer then points updates at a host that never resolves
  writeFileSync(join(desktop, 'surfer.json'), `${JSON.stringify(surfer, null, 2)}\n`);

  edit('configs/common/mozconfig', (t) => `${t
    .replace('--with-app-basename=Zen', '--with-app-basename=xiao')
    .replace('MOZ_APP_BASENAME=Zen', 'MOZ_APP_BASENAME=xiao')
    .replace('--with-distribution-id=app.zen-browser', '--with-distribution-id=io.github.gitguy268')
    .replace('MOZ_SOURCE_REPO=https://github.com/zen-browser/desktop', 'MOZ_SOURCE_REPO=https://github.com/Gitguy268/xiao')}
# xiao: no updater (Zen's update key and server are not ours)
ac_add_options --disable-updater
`);

  // 2. Branding
  rmSync(join(desktop, 'configs/branding/twilight'), { recursive: true, force: true });
  rmSync(join(desktop, 'configs/branding/release'), { recursive: true, force: true });
  cpSync(join(here, 'branding/release'), join(desktop, 'configs/branding/release'), { recursive: true });

  // 3. Prefs: xiao's hardening, look and fork prefs. Zen's prefs tool sorts all YAML by
  //    name and reads folders in no fixed order, so a pref defined twice would
  //    end up with either value. Remove Zen's copy of every pref xiao sets.
  const ours = [join(root, 'shared/prefs/balanced.yaml'), join(root, 'shared/prefs/look.yaml'), join(here, 'prefs/fork.yaml')];
  const names = new Set(ours.flatMap((f) => parse(readFileSync(f, 'utf8')).map((p) => p.name)));
  let removed = 0;
  for (const file of walk(join(desktop, 'prefs')).filter((f) => f.endsWith('.yaml'))) {
    const doc = parseDocument(readFileSync(file, 'utf8'));
    const before = doc.contents.items.length;
    doc.contents.items = doc.contents.items.filter((item) => !names.has(item.get('name')));
    if (doc.contents.items.length !== before) {
      removed += before - doc.contents.items.length;
      writeFileSync(file, doc.toString());
    }
  }
  cpSync(ours[0], join(desktop, 'prefs/xiao/hardening.yaml'));
  cpSync(ours[1], join(desktop, 'prefs/xiao/look.yaml'));
  cpSync(ours[2], join(desktop, 'prefs/xiao/fork.yaml'));

  // 4. Links
  for (const file of walk(join(desktop, 'src'))) {
    if (!/\.(m?js|patch|xhtml|ftl|inc)$/.test(file)) continue;
    const text = readFileSync(file, 'utf8');
    const next = relink(text);
    if (next !== text) writeFileSync(file, next);
  }
  console.log(`overlay: renamed to xiao ${version}, branding replaced, ${names.size} prefs added (${removed} Zen duplicates removed)`);
}

function engine() {
  const eng = join(desktop, 'engine');
  if (!existsSync(join(eng, 'mach'))) throw new Error('engine/ missing: run `npm run download && npm run import` first');

  // 5. xiao's extension as a built-in add-on (surfer's own addon layout).
  const ext = join(root, 'dist/ext');
  if (!existsSync(join(ext, 'manifest.json'))) throw new Error('dist/ext missing: run `npm run build` in xiao first');
  const target = join(eng, 'browser/extensions/xiao');
  rmSync(target, { recursive: true, force: true });
  cpSync(ext, target, { recursive: true });
  const byDir = new Map();
  for (const f of walk(target)) {
    const rel = relative(target, f);
    const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    byDir.set(dir, [...(byDir.get(dir) ?? []), rel]);
  }
  const lines = [...byDir].sort().map(([dir, files]) => {
    const path = dir ? dir.split('/').map((d) => `["${d}"]`).join('') : '';
    return `FINAL_TARGET_FILES.features["${EXT_ID}"]${path} += [\n${files.sort().map((f) => `    "${f}",`).join('\n')}\n]`;
  });
  writeFileSync(join(target, 'moz.build'), `# Generated by xiao fork/overlay.mjs\n\n${lines.join('\n\n')}\n`);
  const list = join(eng, 'browser/extensions/moz.build');
  const mozBuild = readFileSync(list, 'utf8');
  if (!mozBuild.includes('"xiao"')) {
    const next = mozBuild.replace(/DIRS \+= \[/, 'DIRS += [\n    "xiao",');
    if (next === mozBuild) throw new Error('overlay: could not find DIRS in browser/extensions/moz.build');
    writeFileSync(list, next);
  }

  // 6. surfer's generated branding prefs and installer strings point at zen-browser.app.
  for (const f of walk(join(eng, 'browser/branding/release')).filter((p) => /\.(js|nsi|nsh)$/.test(p))) {
    const t = readFileSync(f, 'utf8');
    const next = relink(t)
      // no page opens by itself on first run or after an update
      .replace(/pref\("(startup\.homepage_(?:welcome|override)_url(?:\.additional)?)", "[^"]*"\);/g, 'pref("$1", "");')
      .replace(/https:\/\/(www\.)?zen-browser\.app[^"\s]*/g, `${SITE}/`);
    if (next !== t) writeFileSync(f, next);
  }
  console.log('overlay: extension added as a built-in add-on, branding links replaced');
}

if (mode === '--engine') engine();
else source();
