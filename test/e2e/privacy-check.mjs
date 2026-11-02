// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Runs the EFF's Cover Your Tracks on its public site, in Xiao, in a throwaway
// home, twice with a restart between, and prints what it says. Not in CI: it
// depends on a live site, and its verdicts are for reading.
//
//   npm run build && node test/e2e/privacy-check.mjs
//   KIT=/path/to/an/older/dist/kit node test/e2e/privacy-check.mjs     to compare
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Marionette } from './marionette.mjs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const home = mkdtempSync(join(tmpdir(), 'xiao-privacy-'));
const env = { ...process.env, HOME: home, MOZ_HEADLESS_WIDTH: '1440', MOZ_HEADLESS_HEIGHT: '900' };
delete env.XDG_DATA_HOME;
execFileSync('sh', [join(process.env.KIT ?? join(root, 'dist/kit'), 'install.sh')], { env, stdio: 'ignore' });
const data = process.platform === 'darwin' ? join(home, 'Library/Application Support/xiao-kit') : join(home, '.local/share/xiao-kit');

async function run() {
  const launcher = spawn(join(data, 'xiao-launch'), ['--marionette', '--remote-allow-system-access', '--headless'], { env, stdio: 'ignore', detached: true });
  const m = await Marionette.connect(2828, 120_000);
  await sleep(5000);
  const handle = await m.chrome((url) => {
    const w = Services.wm.getMostRecentWindow('navigator:browser');
    const t = w.gBrowser.addTab(url, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
    w.gBrowser.selectedTab = t;
    const { NavigableManager } = mod('remote/shared/NavigableManager.sys.mjs');
    return NavigableManager.getIdForBrowser(t.linkedBrowser);
  }, 'https://coveryourtracks.eff.org/kcarter?aat=1');
  let page = '';
  for (let i = 0; i < 90; i++) {
    await sleep(2000);
    page = await m.content(handle, () => document.body?.innerText ?? '').catch(() => page);
    if (/Our tests indicate|your browser has|bits of identifying|unique fingerprint|randomized fingerprint/i.test(page) && /Canvas|Hash of canvas/i.test(page)) break;
  }
  try { await m.send('Marionette:Quit'); } catch {}
  m.close();
  await sleep(6000);
  try { process.kill(-launcher.pid); } catch {}
  return { page };
}

const verdict = (page) => page.split('\n').map((l) => l.trim()).filter((l) => /tests indicate|strong protection|some protection|unique fingerprint|randomized|nearly-unique|Blocking tracking|invisible trackers|bits of identifying/i.test(l)).slice(0, 12);
const first = await run();
const second = await run();
console.log('First run:');
for (const l of verdict(first.page)) console.log(`  ${l.slice(0, 200)}`);
console.log('After a restart:');
for (const l of verdict(second.page)) console.log(`  ${l.slice(0, 200)}`);
rmSync(home, { recursive: true, force: true });
process.exit(0);
