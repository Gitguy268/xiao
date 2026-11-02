// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Upgrade from 0.1 (the extension kit) to this build, in a throwaway home
// folder: install 0.1, leave a bookmark and a history entry in its profile,
// install this build over it, and check what the README promises. macOS and
// Linux.
//
//   npm run build && node test/e2e/upgrade.mjs     (KIT01=/path/to/0.1/dist/kit to reuse a built 0.1 kit)

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marionette } from './marionette.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const MAC = process.platform === 'darwin';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failed++;
};

// 0.1's kit, built from its commit unless one is given
let kit01 = process.env.KIT01;
const scratch = mkdtempSync(join(tmpdir(), 'xiao-upgrade-'));
if (!kit01) {
  const src = join(scratch, 'xiao-0.1');
  mkdirSync(src);
  execFileSync('sh', ['-c', `git -C "${root}" archive 0a85736 | tar -x -C "${src}"`]);
  execFileSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: src, stdio: 'ignore' });
  execFileSync('npm', ['run', 'build'], { cwd: src, stdio: 'ignore' });
  kit01 = join(src, 'dist/kit');
}

const home = join(scratch, 'home');
mkdirSync(home);
const env = { ...process.env, HOME: home, MOZ_HEADLESS_WIDTH: '1440', MOZ_HEADLESS_HEIGHT: '900' };
delete env.XDG_DATA_HOME;
const data = MAC ? join(home, 'Library/Application Support/xiao-kit') : join(home, '.local/share/xiao-kit');
const zenArgs = ['--marionette', '--remote-allow-system-access', '--headless'];

async function run(fn) {
  const child = spawn(join(data, 'xiao-launch'), zenArgs, { env, stdio: 'ignore', detached: true });
  const m = await Marionette.connect(2828, 180_000);
  try {
    return await fn(m);
  } finally {
    await m.chrome(() => Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit)).catch(() => {});
    m.close();
    await Promise.race([new Promise((r) => child.once('exit', r)), sleep(60_000)]);
    await sleep(2000);
  }
}

try {
  execFileSync('sh', [join(kit01, 'install.sh')], { env, stdio: 'ignore' });
  check('0.1 installs', existsSync(MAC ? join(home, 'Applications/xiao.app') : join(data, 'profile')));
  const before = await run((m) => m.chrome(async () => {
    const { PlacesUtils } = ChromeUtils.importESModule('resource://gre/modules/PlacesUtils.sys.mjs');
    await PlacesUtils.bookmarks.insert({ parentGuid: PlacesUtils.bookmarks.toolbarGuid, url: 'https://example.org/kept-bookmark', title: 'Kept bookmark' });
    await PlacesUtils.history.insert({ url: 'https://example.org/kept-history', visits: [{ date: new Date() }] });
    const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
    return { addons: (await AddonManager.getAddonsByTypes(['extension'])).filter((a) => !a.isSystem && !a.isBuiltin).map((a) => a.id) };
  }));
  check('0.1 runs with its extension', before.addons.includes('xiao@gitguy268.github.io'), before.addons.join(', '));

  execFileSync('sh', [join(root, 'dist/kit/install.sh')], { env, stdio: 'ignore' });
  if (MAC) {
    // APFS is case-insensitive by default: list the folder to see the name as written
    const apps = existsSync(join(home, 'Applications')) ? readdirSync(join(home, 'Applications')) : [];
    check('the app is now Xiao.app, and xiao.app is gone', apps.includes('Xiao.app') && !apps.includes('xiao.app'), apps.join(', ') || 'no Applications folder');
  }
  const after = await run((m) => m.chrome(async () => {
    const { PlacesUtils } = ChromeUtils.importESModule('resource://gre/modules/PlacesUtils.sys.mjs');
    const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
    const { Xiao } = ChromeUtils.importESModule('resource://xiao/XiaoCore.sys.mjs');
    await Xiao.ready;
    const f = await Xiao.featureState();
    return {
      addons: (await AddonManager.getAddonsByTypes(['extension'])).filter((a) => !a.isSystem && !a.isBuiltin).map((a) => a.id),
      bookmark: !!(await PlacesUtils.bookmarks.fetch({ url: 'https://example.org/kept-bookmark' })),
      history: !!(await PlacesUtils.history.fetch('https://example.org/kept-history')),
      on: ['sticky', 'perSite', 'assist', 'boards', 'quickWindow'].filter((k) => f[k]).concat(f.tabSleep ? ['tabSleep'] : [], f.autoArchive ? ['autoArchive'] : []),
      packs: f.packs.filter((p) => p.installed).map((p) => p.id),
      newtab: Services.wm.getMostRecentWindow('navigator:browser').gBrowser.selectedBrowser.currentURI.spec,
    };
  }));
  check('after the upgrade, Xiao\'s own code runs and 0.1\'s extension is gone', after.addons.length === 0, after.addons.join(', ') || 'no add-ons');
  check('the bookmark and history from 0.1 are kept', after.bookmark && after.history, JSON.stringify({ bookmark: after.bookmark, history: after.history }));
  check('every feature starts off, nothing is downloaded', after.on.length === 0 && after.packs.length === 0, JSON.stringify({ on: after.on, packs: after.packs }));
  check('Xiao starts on its start page', /^resource:\/\/xiao\/start\//.test(after.newtab), after.newtab);
} catch (e) {
  check('upgrade run', false, e.message);
} finally {
  if (!process.env.E2E_KEEP) rmSync(scratch, { recursive: true, force: true, maxRetries: 5 });
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
