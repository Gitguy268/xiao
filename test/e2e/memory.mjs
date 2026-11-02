// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// How much memory Xiao uses: installs dist/kit into a throwaway home, opens
// the start page and six pages, waits for blocking to settle, then reads
// every process's memory from Firefox itself, before and after a memory
// minimise. Writes test/e2e/out/memory.json (or MEMORY_OUT).
//
//   npm run build && node test/e2e/memory.mjs
//   KIT=/path/to/another/dist/kit node test/e2e/memory.mjs   (to measure another version)
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Marionette } from './marionette.mjs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const outFile = process.env.MEMORY_OUT ?? join(root, 'test/e2e/out/memory.json');
const SETTLE = Number(process.env.MEMORY_SETTLE ?? 60) * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const home = mkdtempSync(join(tmpdir(), 'xiao-mem-'));
const env = { ...process.env, HOME: home, MOZ_HEADLESS_WIDTH: '1440', MOZ_HEADLESS_HEIGHT: '900' };
delete env.XDG_DATA_HOME;
execFileSync('sh', [join(process.env.KIT ?? join(root, 'dist/kit'), 'install.sh'), ...(process.env.ZEN ? ['--zen', process.env.ZEN] : [])], { env, stdio: 'inherit' });
const data = process.platform === 'darwin' ? join(home, 'Library/Application Support/xiao-kit') : join(home, '.local/share/xiao-kit');

const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://x').pathname.slice(1) || 'page.html';
  let body;
  try {
    body = readFileSync(join(root, 'test/e2e/fixtures', name));
  } catch {
    return res.writeHead(404).end();
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const { port } = server.address();

const launcher = spawn(join(data, 'xiao-launch'), ['--marionette', '--remote-allow-system-access', '--headless'],
  { env, stdio: 'ignore', detached: true });
let m;
try {
  m = await Marionette.connect(2828, 90_000);
  await m.chrome(async (port) => {
    const w = Services.wm.getMostRecentWindow('navigator:browser');
    const principal = Services.scriptSecurityManager.getSystemPrincipal();
    const { AboutNewTab } = ChromeUtils.importESModule('resource:///modules/AboutNewTab.sys.mjs');
    w.gBrowser.addTab(AboutNewTab.newTabURL, { triggeringPrincipal: principal });
    for (const url of ['https://www.wikipedia.org/', 'https://www.theguardian.com/international', 'https://www.bbc.com/news',
      'https://edition.cnn.com/', 'https://www.reddit.com/', `http://127.0.0.1:${port}/page.html`]) {
      w.gBrowser.addTab(url, { triggeringPrincipal: principal });
    }
  }, port);
  await sleep(SETTLE);
  const measure = () => m.chrome(async () => {
    const info = await ChromeUtils.requestProcInfo();
    const byType = { parent: info.memory };
    for (const c of info.children) byType[c.type] = (byType[c.type] ?? 0) + c.memory;
    const mb = (n) => Math.round(n / 1048576);
    return {
      totalMB: mb(Object.values(byType).reduce((a, b) => a + b, 0)),
      processes: 1 + info.children.length,
      byTypeMB: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, mb(v)])),
    };
  });
  const settled = await measure();
  await m.chrome(() => new Promise((r) => Cc['@mozilla.org/memory-reporter-manager;1']
    .getService(Ci.nsIMemoryReporterManager).minimizeMemoryUsage(r)));
  await sleep(5000);
  const minimised = await measure();
  const result = { at: new Date().toISOString(), zen: await m.chrome(() => Services.appinfo.version), settled, minimised };
  console.log(JSON.stringify(result, null, 2));
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`);
  await m.chrome(() => Services.startup.quit(Ci.nsIAppStartup.eForceQuit)).catch(() => {});
} finally {
  m?.close();
  server.close();
  await sleep(3000);
  try { process.kill(-launcher.pid); } catch {}
  rmSync(home, { recursive: true, force: true, maxRetries: 5 });
}
