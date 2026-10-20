// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// End-to-end test of the kit on a real Zen. Installs into a throwaway home
// folder (never the real one), starts xiao through its own launcher and
// drives it over Marionette.
//
//   npm run build && npm run e2e            (ZEN=/path/to/zen to pick a Zen)
//   E2E_TOR=0 npm run e2e                    skip the Tor checks (no network to tor)
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Marionette } from './marionette.mjs';
import { merge, readPrefs } from '../../scripts/userjs.mjs';

const root = new URL('../..', import.meta.url).pathname;
const out = process.env.E2E_OUT ?? join(root, 'test/e2e/out');
const WIN = process.platform === 'win32';
const WANT_TOR = process.env.E2E_TOR !== '0';
const HOST = 'news.xiao-test.example';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}
async function until(what, fn, timeoutMs) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e.message;
    }
    await sleep(1000);
  }
  throw new Error(`timed out waiting for ${what} (last: ${JSON.stringify(last)})`);
}

// --- throwaway home + install ---
const home = mkdtempSync(join(process.env.RUNNER_TEMP ?? tmpdir(), 'xiao-e2e-'));
const env = { ...process.env, HOME: home, APPDATA: join(home, 'AppData'), MOZ_HEADLESS_WIDTH: '1440', MOZ_HEADLESS_HEIGHT: '900' };
delete env.XDG_DATA_HOME;
mkdirSync(env.APPDATA, { recursive: true });
const kit = join(root, 'dist/kit');
const flags = WANT_TOR ? ['--tor'] : [];
if (WIN) {
  execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(kit, 'install.ps1'),
    ...(WANT_TOR ? ['-Tor'] : []), ...(process.env.ZEN ? ['-Zen', process.env.ZEN] : [])], { env, stdio: 'inherit' });
} else {
  execFileSync('sh', [join(kit, 'install.sh'), ...flags, ...(process.env.ZEN ? ['--zen', process.env.ZEN] : [])], { env, stdio: 'inherit' });
}
const data = WIN ? join(env.APPDATA, 'xiao-kit')
  : process.platform === 'darwin' ? join(home, 'Library/Application Support/xiao-kit') : join(home, '.local/share/xiao-kit');

// --- fixture server ---
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://x').pathname.slice(1) || 'page.html';
  let body;
  try {
    body = readFileSync(join(root, 'test/e2e/fixtures', name));
  } catch {
    return res.writeHead(404).end();
  }
  res.writeHead(200, { 'content-type': name.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' }).end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

// --- launch through the real launcher ---
// A Zen left over from an earlier run would answer on 2828 instead of ours.
const busy = await new Promise((r) => {
  const s = net.connect(2828, '127.0.0.1', () => { s.end(); r(true); }).on('error', () => r(false));
});
if (busy) throw new Error('port 2828 is in use: quit the Zen started by an earlier e2e run first');
const zenArgs = ['--marionette', '--remote-allow-system-access', '--headless'];
const launch = () => (WIN
  ? spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(data, 'xiao-launch.ps1'), ...zenArgs], { env, stdio: 'ignore' })
  : spawn(join(data, 'xiao-launch'), zenArgs, { env, stdio: 'ignore', detached: true }));
const exited = (child) => new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r)));
// macOS: pretend Zen.app updated since the install, so the launcher has to rebuild xiao.app first.
const MAC = process.platform === 'darwin';
const zenBuild = () => readFileSync(join(data, 'zen-build'), 'utf8').trim();
if (MAC) writeFileSync(join(data, 'zen-build'), 'older\n');
let launcher = launch();
const torAlive = () => {
  try {
    process.kill(Number(readFileSync(join(data, 'tor.pid'), 'utf8')), 0);
    return true;
  } catch {
    return false;
  }
};

let m;
try {
  m = await Marionette.connect(2828, 90_000);

  const openTab = async (url, { tor = false } = {}) => m.chrome(async (url, tor) => {
    const { ContextualIdentityService } = mod('toolkit/components/contextualidentity/ContextualIdentityService.sys.mjs');
    const userContextId = tor ? ContextualIdentityService.getPublicIdentities().find((i) => i.name === 'Tor')?.userContextId : 0;
    if (tor && !userContextId) throw new Error('no Tor container');
    const w = Services.wm.getMostRecentWindow('navigator:browser');
    const tab = w.gBrowser.addTab(url, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(), userContextId });
    w.gBrowser.selectedTab = tab;
    const { NavigableManager } = mod('remote/shared/NavigableManager.sys.mjs');
    return NavigableManager.getIdForBrowser(tab.linkedBrowser);
  }, url, tor);
  // A new tab starts on about:blank, which is "complete" before the real page begins.
  const loaded = (handle) => until('page load', () => m.content(handle, () =>
    document.readyState === 'complete' && document.documentURI !== 'about:blank' && document.documentURI), 60_000);

  // 1. extension, new tab, container
  const state = await until('xiao extension', () => m.chrome(async () => {
    const { AddonManager } = mod('toolkit/mozapps/extensions/AddonManager.sys.mjs');
    const { AboutNewTab } = mod('browser/modules/AboutNewTab.sys.mjs');
    const { ContextualIdentityService } = mod('toolkit/components/contextualidentity/ContextualIdentityService.sys.mjs');
    const addon = await AddonManager.getAddonByID('xiao@gitguy268.github.io');
    const tor = ContextualIdentityService.getPublicIdentities().some((i) => i.name === 'Tor');
    return addon?.isActive && tor && { version: addon.version, newtab: AboutNewTab.newTabURL, zen: Services.appinfo.version };
  }), 60_000);
  check('xiao extension is active', true, `v${state.version} on Zen ${state.zen}`);
  check('new tab is the xiao start page', state.newtab.endsWith('/newtab/index.html'), state.newtab);
  check('Tor container exists', true);
  if (MAC) {
    const ini = readFileSync(join(readFileSync(join(data, 'zen-app'), 'utf8').trim(), 'Contents/Resources/application.ini'), 'utf8');
    const want = ini.match(/^BuildID=(.*)$/m)[1];
    const id = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier',
      join(home, 'Applications/xiao.app/Contents/Info.plist')], { encoding: 'utf8' }).trim();
    check('xiao.app is rebuilt after a Zen update', zenBuild() === want && id === 'io.github.gitguy268.xiao', `${zenBuild()} ${id}`);
  }

  // 2. prefs from user.js are in effect
  const expected = [...merge(readPrefs('balanced'), readPrefs('kit'))];
  const prefs = await m.chrome((list) => list.map(([name]) => {
    const t = Services.prefs.getPrefType(name);
    const value = t === 128 ? Services.prefs.getBoolPref(name) : t === 64 ? Services.prefs.getIntPref(name)
      : t === 32 ? Services.prefs.getStringPref(name) : null;
    return [name, value, Services.prefs.getDefaultBranch('').getPrefType(name) !== 0];
  }), expected);
  const wrong = prefs.filter(([name, value], i) => value !== expected[i][1]).map(([n, v]) => `${n}=${v}`);
  check('every hardening pref is applied', wrong.length === 0, wrong.join(', ') || `${prefs.length} prefs`);
  const unknown = prefs.filter(([, , known]) => !known).map(([n]) => n);
  if (unknown.length) console.log(`info: prefs Zen does not define by default (still set): ${unknown.join(', ')}`);

  // 3. start page renders and lists download
  const newtab = await openTab(state.newtab);
  await loaded(newtab);
  const status = await until('filter lists', () => m.content(newtab, () => {
    const t = document.getElementById('status').textContent;
    return !/Downloading|Checking/.test(t) && t;
  }), 120_000);
  check('start page reports protection', /ads and trackers blocked/.test(status), status);
  // Screenshots for the website, taken once Tor is up so the status line is real.
  const screenshots = async () => {
    mkdirSync(out, { recursive: true });
    await m.send('WebDriver:SetWindowRect', { width: 1440, height: 900 }).catch(() => {});
    await m.content(newtab, () => location.reload());
    await loaded(newtab);
    await sleep(2500);
    for (const theme of ['light', 'dark']) {
      await m.content(newtab, (t) => { document.documentElement.dataset.theme = t; }, theme);
      await sleep(400);
      writeFileSync(join(out, `start-${theme}.png`), await m.screenshot(newtab));
    }
  };
  if (!WANT_TOR) await screenshots();

  // 4. ads blocked, real content not
  await m.chrome((host, port) => {
    Services.prefs.setStringPref('network.dns.localDomains', host);
    Services.prefs.setBoolPref('devtools.jsonview.enabled', false); // read JSON responses as plain text
    const p = Services.scriptSecurityManager.createContentPrincipalFromOrigin(`http://${host}:${port}`);
    Services.perms.addFromPrincipal(p, 'https-only-load-insecure', Ci.nsIHttpsOnlyModePermission.LOAD_INSECURE_ALLOW);
  }, HOST, port);
  const page = await openTab(`http://${HOST}:${port}/page.html`);
  await loaded(page);
  const ads = await until('fixture scripts', () => m.content(page, () =>
    (window.wrappedJSObject ?? window).results?.ad && (window.wrappedJSObject ?? window).results?.control && {
      ad: (window.wrappedJSObject ?? window).results.ad,
      control: (window.wrappedJSObject ?? window).results.control,
    }), 30_000);
  // Cosmetic CSS arrives a moment after the page, so give it a few seconds.
  ads.cosmetic = await until('cosmetic filter', () => m.content(page, () =>
    getComputedStyle(document.getElementById('cosmetic')).display === 'none' && 'none'), 15_000).catch(() => 'visible');
  check('ad script is blocked', ads.ad === 'blocked', ads.ad);
  check('normal script still loads', ads.control === 'loaded', ads.control);
  check('ad slot is hidden by cosmetic filters', ads.cosmetic === 'none', ads.cosmetic);

  // Requests from a service worker have no tab; ads among them are blocked too.
  const swPage = await openTab(`http://127.0.0.1:${port}/sw.html`);
  await loaded(swPage);
  const sw = await m.content(swPage, () => (window.wrappedJSObject ?? window).sw.then((r) => ({ ...r })));
  check('ad fetched by a service worker is blocked', sw.ad === 'blocked' && sw.control === 'loaded', JSON.stringify(sw));

  // 5. WebRTC does not reveal local addresses
  const rtc = await openTab(`http://${HOST}:${port}/webrtc.html`);
  await loaded(rtc);
  const ice = await m.content(rtc, () => (window.wrappedJSObject ?? window).webrtc.then((r) => ({ available: r.available, candidates: [...r.candidates] })));
  const local = ice.candidates.filter((c) => /(^|\s)(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|fe80:|169\.254\.)/i.test(c));
  check('WebRTC shows no local IP', local.length === 0, `${ice.candidates.length} candidates`);

  // 6. Tor
  if (WANT_TOR) {
    const ipOf = (handle) => m.content(handle, () => JSON.parse(document.body.textContent));
    const torTab = await openTab('https://check.torproject.org/api/ip', { tor: true });
    const viaTor = await until('tor to bootstrap', async () => {
      const uri = await loaded(torTab).catch(() => null); // a request can hang while tor builds circuits
      if (!uri || uri.startsWith('about:neterror')) {
        await m.content(torTab, () => location.reload());
        return false;
      }
      return ipOf(torTab);
    }, 180_000);
    check('Tor tab goes through Tor', viaTor.IsTor === true, viaTor.IP);
    await screenshots();
    const plain = await openTab('https://check.torproject.org/api/ip');
    await loaded(plain);
    const direct = await ipOf(plain);
    check('normal tab does not', direct.IsTor === false);

    // Pages in a Tor tab lose RTCPeerConnection
    const torPage = await openTab('https://check.torproject.org/', { tor: true });
    await loaded(torPage);
    const hasRtc = await m.content(torPage, () => typeof (window.wrappedJSObject ?? window).RTCPeerConnection);
    check('Tor tab has no WebRTC', hasRtc === 'undefined', hasRtc);
    // A page can take a fresh window's globals from an iframe it has just made.
    const frameRtc = (handle) => m.content(handle, () => {
      const page = window.wrappedJSObject ?? window; // the page's own view, as its scripts see it
      const f = page.document.createElement('iframe');
      page.document.body.append(f);
      return typeof f.contentWindow.RTCPeerConnection;
    });
    // In a normal tab the same probe must find WebRTC, or it proves nothing.
    const [inTor, inNormal] = [await frameRtc(torPage), await frameRtc(rtc)];
    check('Tor tab iframes have no WebRTC', inTor === 'undefined' && inNormal === 'function', `Tor ${inTor}, normal ${inNormal}`);

    // The start page searches DuckDuckGo's onion service from Tor tabs.
    const onion = await openTab('https://duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion/?q=xiao', { tor: true });
    const onionUri = await until('onion search', async () => {
      const uri = await loaded(onion).catch(() => null);
      if (!uri || uri.startsWith('about:neterror')) {
        await m.content(onion, () => location.reload());
        return false;
      }
      return uri;
    }, 180_000).catch((e) => e.message);
    check('Tor tab search reaches the onion service', /^https:\/\/[a-z2-7]{56}\.onion\//.test(onionUri), onionUri.slice(0, 80));

    // "New Tor circuit for this site" (popup): the next load of the site uses another exit.
    const ext = await openTab(state.newtab.replace('/newtab/index.html', '/popup/index.html'));
    await loaded(ext);
    const exits = [viaTor.IP];
    for (let i = 0; i < 3 && exits.at(-1) === viaTor.IP; i++) {
      await m.content(ext, () => (window.wrappedJSObject ?? window).browser.runtime
        .sendMessage({ xiao: 'newCircuit', host: 'check.torproject.org' }).then(() => true));
      await m.content(torTab, () => location.reload());
      await sleep(1000);
      const next = await until('new circuit', async () => (await loaded(torTab).catch(() => null)) && ipOf(torTab), 60_000).catch(() => null);
      exits.push(next?.IP);
    }
    check('new circuit gives the site another Tor exit', exits.at(-1) && exits.at(-1) !== viaTor.IP, exits.join(' → '));

    // Opening xiao again while it runs must not stop the running xiao's tor.
    const second = launch();
    await Promise.race([exited(second), sleep(30_000)]);
    check('a second launch leaves Tor running', torAlive());

    // Restart with a Tor tab selected: the restored tab must never load directly,
    // even though it starts loading before the extension knows the Tor container.
    // The tab first fails (tor stopped), so after the restart it has to load fresh, not from cache.
    const restoreOn = await m.chrome(() => Services.prefs.getIntPref('browser.startup.page'));
    process.kill(Number(readFileSync(join(data, 'tor.pid'), 'utf8')));
    await sleep(1500);
    await openTab('https://check.torproject.org/api/ip?restored', { tor: true });
    await sleep(3000);
    await m.chrome(() => Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit)).catch(() => {});
    m.close();
    const quit = await Promise.race([exited(launcher).then(() => true), sleep(60_000).then(() => false)]);
    if (!quit) console.log('info: the first launcher was still running 60 s after quitting');
    launcher = launch();
    m = await Marionette.connect(2828, 90_000);
    const restored = await until('restored Tor tab', () => m.chrome(() => {
      const { NavigableManager } = mod('remote/shared/NavigableManager.sys.mjs');
      const tab = Services.wm.getMostRecentWindow('navigator:browser')?.gBrowser.tabs
        .find((t) => t.linkedBrowser.currentURI.spec.includes('?restored'));
      return tab && NavigableManager.getIdForBrowser(tab.linkedBrowser);
    }), 60_000).catch(() => null);
    if (!restored) {
      check('restored Tor tab never goes direct', false, `tab not restored (browser.startup.page=${restoreOn})`);
    } else {
      const seen = await until('restored tab to load', () => m.content(restored, () =>
        document.documentURI.startsWith('about:neterror') ? 'error page'
          : document.readyState === 'complete' && document.body?.textContent.includes('IsTor') && document.body.textContent), 60_000)
        .catch((e) => e.message);
      const direct = /"IsTor":\s*false/.test(seen);
      check('restored Tor tab never goes direct', !direct && (/"IsTor":\s*true/.test(seen) || seen === 'error page'), seen.slice(0, 60));
    }
    check('tor runs again after the restart', await until('tor after restart', torAlive, 30_000).catch(() => false));

    // kill tor: the Tor tab must fail, not fall back to a direct connection
    const pid = Number(readFileSync(join(data, 'tor.pid'), 'utf8'));
    process.kill(pid);
    await sleep(2000);
    const dead = await openTab('https://check.torproject.org/api/ip?after-kill', { tor: true });
    // Error pages never reach readyState "complete", so wait for the URI instead.
    const after = await until('error page', () => m.content(dead, () =>
      document.documentURI.startsWith('about:neterror') && document.documentURI), 30_000).catch((e) => e.message);
    check('with tor stopped, Tor tabs fail closed', /e=proxyConnectFailure/.test(after), after.slice(0, 60));
  }

  // 7. popup page renders
  const popupUrl = state.newtab.replace('/newtab/index.html', '/popup/index.html');
  const popup = await openTab(popupUrl);
  await loaded(popup);
  await sleep(1500);
  const popupText = await m.content(popup, () => document.getElementById('count').textContent);
  check('popup reports counts', /blocked/.test(popupText), popupText);

  await m.chrome(() => Services.startup.quit(Ci.nsIAppStartup.eForceQuit)).catch(() => {});
} catch (e) {
  check('e2e run', false, e.message);
} finally {
  m?.close();
  server.close();
  await sleep(3000);
  try {
    if (WIN) launcher.kill(); else process.kill(-launcher.pid);
  } catch {}
  if (!process.env.E2E_KEEP) rmSync(home, { recursive: true, force: true, maxRetries: 5 });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
