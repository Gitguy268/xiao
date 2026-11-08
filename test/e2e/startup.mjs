// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// How long Xiao takes to start, and what its main process holds once idle:
// installs dist/kit into a throwaway home, then starts and quits Xiao RUNS
// times (default 6). The first start is left out of the medians: it builds
// Xiao.app and fills the system's file cache. Writes test/e2e/out/startup.json
// (or STARTUP_OUT).
//
//   npm run build && node test/e2e/startup.mjs
//   KIT=/path/to/another/dist/kit node test/e2e/startup.mjs    (another version)
//   LIBRARY=1 node test/e2e/startup.mjs     with the Library on (from dist-packs/mirror)
import { execFileSync, spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Marionette } from './marionette.mjs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const outFile = process.env.STARTUP_OUT ?? join(root, 'test/e2e/out/startup.json');
const RUNS = Number(process.env.RUNS ?? 6);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

const home = mkdtempSync(join(tmpdir(), 'xiao-start-'));
const env = { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1', HOME: home, MOZ_HEADLESS_WIDTH: '1440', MOZ_HEADLESS_HEIGHT: '900' };
delete env.XDG_DATA_HOME;
execFileSync('sh', [join(process.env.KIT ?? join(root, 'dist/kit'), 'install.sh'), ...(process.env.ZEN ? ['--zen', process.env.ZEN] : [])], { env, stdio: 'inherit' });
const data = process.platform === 'darwin' ? join(home, 'Library/Application Support/xiao-kit') : join(home, '.local/share/xiao-kit');

const MIRROR = process.env.MIRROR ?? join(root, 'dist-packs/mirror');
const server = http.createServer((req, res) => {
  const file = join(MIRROR, new URL(req.url, 'http://x').pathname.split('/').pop());
  if (!existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200);
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));

const runs = [];
let launcher;
try {
  for (let i = 0; i < RUNS; i++) {
    launcher = spawn(join(data, 'xiao-launch'), ['--marionette', '--remote-allow-system-access', '--headless'], { env, stdio: 'ignore', detached: true });
    const m = await Marionette.connect(2828, 120_000);
    if (i === 0 && process.env.LIBRARY === '1') {
      await m.chrome(async (mirror) => {
        Services.prefs.setStringPref('xiao.packs.mirror', mirror);
        const { Xiao } = ChromeUtils.importESModule('resource://xiao/XiaoCore.sys.mjs');
        await Xiao.ready;
        await Xiao.packsReady;
        await Xiao.setFeature({ id: 'library', on: true });
        while (!(await Xiao.packs.installed('library'))) await new Promise((r) => setTimeout(r, 200));
      }, `http://127.0.0.1:${server.address().port}/`);
    }
    await sleep(10_000); // idle, as after a normal start
    runs.push(await m.chrome(async () => {
      const { Xiao } = ChromeUtils.importESModule('resource://xiao/XiaoCore.sys.mjs');
      await Xiao.ready;
      const s = Services.startup.getStartupInfo();
      const info = await ChromeUtils.requestProcInfo();
      return {
        startupMs: Math.round(s.sessionRestored - s.process),
        firstPaintMs: Math.round((s.firstPaint2 ?? s.firstPaint) - s.process),
        parentMB: Math.round(info.memory / 1048576),
        parentCpuMs: Math.round(info.cpuTime / 1e6), // the main process's CPU time so far: steadier than the clock when the machine is busy
        library: Xiao.libraryOn === true,
        database: !!Xiao.library?.store.db,
      };
    }));
    console.log(`run ${i + 1}: ${JSON.stringify(runs.at(-1))}`);
    await m.chrome(() => Services.startup.quit(Ci.nsIAppStartup.eForceQuit)).catch(() => {});
    m.close();
    await new Promise((r) => (launcher.exitCode !== null ? r() : launcher.once('exit', r)));
    await sleep(2000);
  }
  const counted = runs.slice(1);
  const result = {
    at: new Date().toISOString(),
    kit: process.env.KIT ?? 'dist/kit',
    library: process.env.LIBRARY === '1',
    runs: counted.length,
    medianStartupMs: median(counted.map((r) => r.startupMs)),
    medianFirstPaintMs: median(counted.map((r) => r.firstPaintMs)),
    medianParentMB: median(counted.map((r) => r.parentMB)),
    medianParentCpuMs: median(counted.map((r) => r.parentCpuMs)),
    all: runs,
  };
  console.log(JSON.stringify(result, null, 2));
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`);
} finally {
  server.close();
  try { process.kill(-launcher.pid); } catch {}
  rmSync(home, { recursive: true, force: true, maxRetries: 5 });
}
