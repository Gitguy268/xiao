// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// What does Xiao connect to when nobody asks it to? Installs into a throwaway
// home, leaves the browser idle on its start page and records every connection:
// HTTP requests from inside the browser, and every socket the browser's
// processes hold, seen from outside it (lsof), which also catches what never
// goes through HTTP.
//
//   node test/e2e/network-audit.mjs               both modes, 10 minutes each
//   AUDIT_MINUTES=3 AUDIT_MODE=silent node ...    one mode, shorter
//
// Silent mode must show no connection beyond this computer. The normal mode
// must stay inside ALLOWED, which is what Xiao's documentation promises.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Marionette } from './marionette.mjs';

const root = new URL('../..', import.meta.url).pathname;
const MINUTES = Number(process.env.AUDIT_MINUTES ?? 10);
const MODES = process.env.AUDIT_MODE ? [process.env.AUDIT_MODE] : ['silent', 'normal'];
const REPORT = process.env.AUDIT_REPORT ?? join(root, 'test/e2e/out/network-audit.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The normal mode's named list, by purpose. See README, "What Xiao connects to".
export const ALLOWED = [
  [/(^|\.)github\.com$|\.githubusercontent\.com$/, 'Xiao: filter and update check at start'],
  [/^firefox\.settings\.services\.mozilla\.com$|^firefox-settings-attachments\.cdn\.mozilla\.net$|^content-signature-2\.cdn\.mozilla\.net$/, 'Firefox: certificate revocation lists and intermediates'],
  [/^safebrowsing\.googleapis\.com$|^shavar\.services\.mozilla\.com$|^tracking-protection\.cdn\.mozilla\.net$/, 'Firefox: phishing, malware and tracking-protection lists'],
  [/^aus5\.mozilla\.org$|^redirector\.gvt1\.com$|\.gvt1\.com$|^update\.googleapis\.com$|\.cdn\.mozilla\.net$|^ciscobinary\.openh264\.org$/, 'Firefox: DRM (Widevine) and video codec downloads'],
  [/^dns\.quad9\.net$|^mozilla\.cloudflare-dns\.com$|^dns\.mullvad\.net$|^base\.dns\.mullvad\.net$/, 'Encrypted DNS'],
  [/^ocsp\./, 'Certificate checks for the connections above'],
];

const isLocal = (host) => /^(127\.|\[?::1\]?$|localhost$|\*$)/.test(host);

// One line of `lsof -F`-less output → the remote end of a socket, or null.
export function remoteOf(line) {
  const m = line.match(/->(\[[^\]]+\]|[^:\s]+):(\d+)/);
  return m ? m[1].replace(/[[\]]/g, '') : null;
}

// A run that dies halfway must not leave a browser or a copy of Zen behind.
const cleanup = new Set();
process.on('exit', () => { for (const f of cleanup) f(); });

async function audit(mode) {
  const home = mkdtempSync(join(process.env.RUNNER_TEMP ?? tmpdir(), 'xiao-audit-'));
  const removeHome = () => rmSync(home, { recursive: true, force: true });
  cleanup.add(removeHome);
  const env = { ...process.env, HOME: home, MOZ_HEADLESS_WIDTH: '1280', MOZ_HEADLESS_HEIGHT: '800' };
  delete env.XDG_DATA_HOME;
  execFileSync('sh', [join(root, 'dist/kit/install.sh')], { env, stdio: 'ignore' });
  const data = process.platform === 'darwin' ? join(home, 'Library/Application Support/xiao-kit') : join(home, '.local/share/xiao-kit');
  const profile = join(data, 'profile');
  const args = ['--marionette', '--remote-allow-system-access', '--headless'];
  const launch = () => spawn(join(data, 'xiao-launch'), args, { env, stdio: 'ignore', detached: true });

  let launcher = launch();
  let m = await Marionette.connect(2828, 90_000);
  const ready = async () => {
    for (let i = 0; i < 60; i++) {
      try {
        if (await m.chrome(async () => {
          const { Xiao } = ChromeUtils.importESModule('resource://xiao/XiaoCore.sys.mjs');
          await Xiao.ready;
          return Xiao.started;
        })) return;
      } catch {}
      await sleep(1000);
    }
    throw new Error('Xiao did not start');
  };
  await ready();
  if (mode === 'silent') {
    await m.chrome(async () => {
      const { Xiao } = ChromeUtils.importESModule('resource://xiao/XiaoCore.sys.mjs');
      await Xiao.silent.set(true);
    });
    await sleep(6000); // Store.save waits 5 s
  }
  // Restart, so what is measured is a start in this mode, from its first second.
  try { await m.send('Marionette:Quit'); } catch {}
  m.close();
  await sleep(6000);

  const http = new Map();
  const sockets = new Map();
  let stopWatching = false;
  const watcher = (async () => {
    while (!stopWatching) {
      let pids = '';
      try {
        pids = execFileSync('pgrep', ['-f', profile], { encoding: 'utf8' }).trim().split('\n').join(',');
        // Content and socket processes are children, and don't name the profile.
        const children = pids.split(',').flatMap((p) => {
          try { return execFileSync('pgrep', ['-P', p], { encoding: 'utf8' }).trim().split('\n'); } catch { return []; }
        });
        pids = [...pids.split(','), ...children].filter(Boolean).join(',');
        const lines = execFileSync('lsof', ['-nP', '-i', '-a', '-p', pids], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n');
        for (const line of lines) {
          const remote = remoteOf(line);
          if (remote && !isLocal(remote)) sockets.set(remote, (sockets.get(remote) ?? 0) + 1);
        }
      } catch {} // lsof exits 1 when there are no sockets
      await sleep(1000);
    }
  })();

  launcher = launch();
  m = await Marionette.connect(2828, 90_000);
  await ready();
  // Kept on the Xiao module: each Marionette call gets a fresh scope.
  await m.chrome(() => {
    const { Xiao } = ChromeUtils.importESModule('resource://xiao/XiaoCore.sys.mjs');
    Xiao.auditLog = [];
    Xiao.auditObserver = {
      observe(channel) {
        channel.QueryInterface(Ci.nsIHttpChannel);
        Xiao.auditLog.push(channel.URI.spec);
      },
    };
    Services.obs.addObserver(Xiao.auditObserver, 'http-on-modify-request'); // after silent mode's check: only what really goes out
  });
  const started = await m.chrome(() => ({ silent: Services.prefs.getBoolPref('xiao.zero', false), fxa: Services.prefs.getBoolPref('identity.fxaccounts.enabled', true) }));
  console.log(`${mode}: idle for ${MINUTES} minutes (silent=${started.silent})`);
  await sleep(MINUTES * 60_000);

  // Using local data must not connect either: a note, the Library's search.
  const log = () => m.chrome(() => ChromeUtils.importESModule('resource://xiao/XiaoCore.sys.mjs').Xiao.auditLog);
  const before = (await log()).length;
  const used = await m.chrome(async () => {
    const { Xiao } = ChromeUtils.importESModule('resource://xiao/XiaoCore.sys.mjs');
    await Xiao.setFeature({ id: 'sticky', on: true });
    await Xiao.notes.save({ text: 'A private note' });
    return (await Xiao.notes.list()).length > 0;
  });
  await sleep(6000);
  const seen = await log();
  for (const url of seen) {
    try {
      const host = new URL(url).hostname;
      if (!isLocal(host)) http.set(host, [...(http.get(host) ?? []), url]);
    } catch {}
  }
  stopWatching = true;
  await watcher;
  // In silent mode the browser's own requests are refused, and what the reader
  // asks for gets through, redirects included (a model file redirects to a CDN).
  const asked = mode !== 'silent' ? null : await m.chrome(async () => {
    const { Xiao } = ChromeUtils.importESModule('resource://xiao/XiaoCore.sys.mjs');
    const url = (await (await fetch('resource://xiao/packs.json')).json()).flatMap((p) => p.files).find((f) => f.url.startsWith('https://huggingface.co') && f.range).url;
    const tiny = () => fetch(url, { headers: { Range: 'bytes=0-99' }, cache: 'no-store' }).then((r) => r.status, (e) => e.name);
    return { unasked: await tiny(), asked: await Xiao.silent.asking(['huggingface.co'], tiny) };
  });
  try { await m.send('Marionette:Quit'); } catch {}
  m.close();
  await sleep(4000);
  try { process.kill(-launcher.pid); } catch {}
  removeHome();
  cleanup.delete(removeHome);

  return {
    mode, minutes: MINUTES, started,
    http: Object.fromEntries([...http].map(([h, urls]) => [h, { count: urls.length, first: urls[0].slice(0, 120) }])),
    sockets: Object.fromEntries(sockets),
    localDataRequests: seen.slice(before).filter((u) => !isLocal(new URL(u).hostname)),
    usedLocalData: used,
    asked,
  };
}

// Skip the run when this file is only imported for its helpers.
if (process.argv[1]?.endsWith('network-audit.mjs')) {
  const reports = [];
  let failed = false;
  for (const mode of MODES) {
    const r = await audit(mode);
    reports.push(r);
    const hosts = Object.keys(r.http);
    if (mode === 'silent') {
      const ok = hosts.length === 0 && Object.keys(r.sockets).length === 0;
      console.log(`${ok ? 'ok  ' : 'FAIL'} silent mode connects to nothing`);
      for (const h of hosts) console.log(`     http ${h}: ${r.http[h].first}`);
      for (const s of Object.keys(r.sockets)) console.log(`     socket ${s}`);
      failed ||= !ok;
      const gate = r.asked?.unasked === 'TypeError' && r.asked?.asked === 206;
      console.log(`${gate ? 'ok  ' : 'FAIL'} silent mode refuses the browser's own request and lets an asked-for one through (${JSON.stringify(r.asked)})`);
      failed ||= !gate;
    } else {
      const unknown = hosts.filter((h) => !ALLOWED.some(([re]) => re.test(h)));
      console.log(`${unknown.length ? 'FAIL' : 'ok  '} normal mode stays inside its list (${hosts.length} hosts, ${Object.keys(r.sockets).length} socket addresses)`);
      for (const h of hosts) console.log(`     ${ALLOWED.find(([re]) => re.test(h))?.[1] ?? 'NOT ON THE LIST'}: ${h}: ${r.http[h].first}`);
      failed ||= unknown.length > 0;
    }
    const clean = r.localDataRequests.length === 0;
    console.log(`${clean ? 'ok  ' : 'FAIL'} ${mode}: using a note made no connection`);
    failed ||= !clean;
  }
  writeFileSync(REPORT, JSON.stringify(reports, null, 2));
  process.exit(failed ? 1 : 0);
}
