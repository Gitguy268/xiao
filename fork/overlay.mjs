// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Turns a zen-browser/desktop checkout into Xiao.
//   node fork/overlay.mjs <desktop>            before `npm run import` (rename, branding, prefs, links)
//   node fork/overlay.mjs <desktop> --engine   after it (Xiao's browser code, branding prefs in engine/)
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
// Links to Zen's site that a Xiao user would follow: about, donate, privacy, uninstall feedback.
const relink = (text) => text
  .replace(/https:\/\/(www\.)?zen-browser\.app\/(donate|about\/?)/g, `${SITE}/about/`)
  .replace(/https:\/\/(www\.)?zen-browser\.app\/privacy-policy\/?/g, `${SITE}/privacy/`)
  .replace(/https:\/\/links\.zen-browser\.app\/uninstall-feedback/g, 'https://github.com/Gitguy268/xiao/issues/new');

function source() {
  // 1. Name and identity: Xiao must not share Zen's app id, profile folder or bundle id.
  //    The ids stay lowercase "xiao"; the names people see are "Xiao".
  const surfer = JSON.parse(readFileSync(join(desktop, 'surfer.json'), 'utf8'));
  surfer.name = 'Xiao';
  surfer.vendor = 'Xiao';
  surfer.appId = 'xiao';
  surfer.binaryName = 'xiao';
  surfer.brands = {
    release: {
      ...surfer.brands.release,
      backgroundColor: '#1b1b1b',
      brandShorterName: 'Xiao',
      brandShortName: 'Xiao',
      brandFullName: 'Xiao',
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
# Xiao: no updater (Zen's update key and server are not ours)
ac_add_options --disable-updater
`);

  // 2. Branding
  rmSync(join(desktop, 'configs/branding/twilight'), { recursive: true, force: true });
  rmSync(join(desktop, 'configs/branding/release'), { recursive: true, force: true });
  cpSync(join(here, 'branding/release'), join(desktop, 'configs/branding/release'), { recursive: true });

  // 3. Prefs: Xiao's hardening, speed, look and fork prefs. Zen's prefs tool sorts all YAML by
  //    name and reads folders in no fixed order, so a pref defined twice would
  //    end up with either value. Remove Zen's copy of every pref Xiao sets.
  const ours = [join(root, 'shared/prefs/balanced.yaml'), join(root, 'shared/prefs/look.yaml'), join(here, 'prefs/fork.yaml'),
    join(root, 'shared/prefs/speed.yaml')];
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
  cpSync(ours[3], join(desktop, 'prefs/xiao/speed.yaml'));

  // 4. Links
  for (const file of walk(join(desktop, 'src'))) {
    if (!/\.(m?js|patch|xhtml|ftl|inc)$/.test(file)) continue;
    const text = readFileSync(file, 'utf8');
    const next = relink(text);
    if (next !== text) writeFileSync(file, next);
  }
  console.log(`overlay: renamed to Xiao ${version}, branding replaced, ${names.size} prefs added (${removed} Zen duplicates removed)`);
}

function engine() {
  const eng = join(desktop, 'engine');
  if (!existsSync(join(eng, 'mach'))) throw new Error('engine/ missing: run `npm run download && npm run import` first');

  // 5. Xiao's browser code (dist/core) and the AutoConfig files that load it,
  //    installed next to the app the same way the kit puts them in its copy of Zen.
  const core = join(root, 'dist/core');
  if (!existsSync(join(core, 'XiaoCore.sys.mjs'))) throw new Error('dist/core missing: run `npm run build` in xiao first');
  const target = join(eng, 'browser/xiao');
  rmSync(target, { recursive: true, force: true });
  cpSync(core, join(target, 'xiao'), { recursive: true });
  cpSync(join(root, 'dist/loader'), join(target, 'loader'), { recursive: true });
  const byDir = new Map();
  for (const f of walk(join(target, 'xiao'))) {
    const rel = relative(target, f);
    const dir = rel.slice(0, rel.lastIndexOf('/'));
    byDir.set(dir, [...(byDir.get(dir) ?? []), rel]);
  }
  const lines = [...byDir].sort().map(([dir, files]) => {
    const path = dir.split('/').map((d) => `["${d}"]`).join('');
    return `FINAL_TARGET_FILES${path} += [\n${files.sort().map((f) => `    "${f}",`).join('\n')}\n]`;
  });
  lines.push('FINAL_TARGET_FILES += ["loader/xiao.cfg"]', 'FINAL_TARGET_FILES.defaults.pref += ["loader/autoconfig.js"]');
  writeFileSync(join(target, 'moz.build'), `# Generated by Xiao's fork/overlay.mjs\n\n${lines.join('\n\n')}\n`);
  const list = join(eng, 'browser/moz.build');
  const mozBuild = readFileSync(list, 'utf8');
  if (!mozBuild.includes('"xiao"')) {
    const next = mozBuild.replace(/DIRS \+= \[/, 'DIRS += [\n    "xiao",');
    if (next === mozBuild) throw new Error('overlay: could not find DIRS in browser/moz.build');
    writeFileSync(list, next);
  }
  const manifest = join(eng, 'browser/installer/package-manifest.in');
  const pkg = readFileSync(manifest, 'utf8');
  if (!pkg.includes('@RESPATH@/xiao.cfg')) {
    writeFileSync(manifest, `${pkg}\n; Xiao's browser code and its loader (fork/overlay.mjs)\n@RESPATH@/xiao.cfg\n@RESPATH@/defaults/pref/autoconfig.js\n@RESPATH@/xiao/*\n`);
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
  console.log('overlay: Xiao\'s browser code and loader added, branding links replaced');
}

if (mode === '--engine') engine();
else source();
