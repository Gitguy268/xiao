// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Xiao 0.5's features in a real Zen, in a throwaway home: fingerprint noise,
// the blank camera, bangs, start page styles, download problems and updates.
//
//   npm run build && npm run e2e:new
//   ONLY=updates,bangs npm run e2e:new  some sections (shield, bangs, styles, packs, pdf, more, extras, silent, drm, updates)
import { execFileSync, spawn } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { PDFDocument } from '@cantoo/pdf-lib';
import { Marionette } from './marionette.mjs';
import { zip } from '../../scripts/zip.mjs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const out = process.env.E2E_OUT ?? join(root, 'test/e2e/out');
const ONLY = process.env.ONLY;
const want = (name) => !ONLY || ONLY.split(',').includes(name);
const START = 'resource://xiao/start/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${String(detail).slice(0, 300)})` : ''}`);
}
const until = async (what, fn, ms = 30_000) => {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e.message;
    }
    await sleep(500);
  }
  throw new Error(`timed out waiting for ${what} (last: ${JSON.stringify(last)})`);
};

// --- fixture server: pages, a mirror that can misbehave, an update feed ---
const PROBE = readFileSync(join(root, 'test/e2e/fixtures/probe.html'));
const feed = { manifest: null, sig: null, kit: null };
let mirrorMode = 'missing';
const seen = [];
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://x').pathname.slice(1);
  seen.push(req.url);
  if (name === 'updates.json') return res.writeHead(feed.manifest ? 200 : 404).end(feed.manifest);
  if (name === 'updates.json.sig') return res.writeHead(feed.sig ? 200 : 404).end(feed.sig);
  if (name === 'kit.zip') return res.writeHead(200).end(feed.kit);
  if (name.startsWith('mirror/')) {
    const file = join(root, 'dist-packs/mirror', name.slice(7));
    if (mirrorMode === 'missing') return res.writeHead(404).end();
    if (mirrorMode === 'busy') return res.writeHead(503).end();
    if (req.method === 'HEAD') return res.writeHead(200).end();
    if (mirrorMode === 'damaged') return res.writeHead(200).end('not the file');
    return res.writeHead(200).end(readFileSync(file));
  }
  if (name === 'french') return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<!doctype html><html lang="fr"><title>Bonjour</title><p>Bonjour le monde. Ceci est une page en français pour tester la traduction du navigateur, avec assez de mots.</p>');
  if (name === 'search') { // Xiao Search's JSON, for instant links
    return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ results: [
      { url: `http://127.0.0.1:${port}/article?r1`, title: 'R1' }, { url: `http://127.0.0.1:${port}/article?r2`, title: 'R2' }, { url: 'javascript:alert(1)', title: 'bad' }] }));
  }
  if (name === 'article') {
    const topic = new URL(req.url, 'http://x').search.slice(1) || 'plain';
    return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<!doctype html><title>Article ${topic}</title><h1>Article ${topic}</h1>
      ${topic === 'ferry' ? '<p>Ferries leave the harbour every hour in summer.</p>' : '<p>The lighthouse on the island was built in 1874 and painted red.</p>'}<p>Topic ${topic} is discussed here at length.</p>`);
  }
  if (name.startsWith('own')) return res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>own bang</title>');
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(PROBE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

// --- throwaway home ---
const home = mkdtempSync(join(process.env.RUNNER_TEMP ?? tmpdir(), 'xiao-new-'));
mkdirSync(join(home, 'Downloads'));
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const rawKey = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
const env = {
  ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1', HOME: home, MOZ_HEADLESS_WIDTH: '1280', MOZ_HEADLESS_HEIGHT: '800',
  XIAO_UPDATE_TEST_KEY: rawKey, XIAO_UPDATE_TEST_URL: `http://127.0.0.1:${port}/updates.json`,
};
delete env.XDG_DATA_HOME;
execFileSync('sh', [join(root, 'dist/kit/install.sh')], { env, stdio: process.env.E2E_QUIET === '0' ? 'inherit' : 'ignore' });
const data = process.platform === 'darwin' ? join(home, 'Library/Application Support/xiao-kit') : join(home, '.local/share/xiao-kit');

let m;
let launcher;
const launch = async () => {
  launcher = spawn(join(data, 'xiao-launch'), ['--marionette', '--remote-allow-system-access', '--headless'], { env, stdio: 'ignore', detached: true });
  m = await Marionette.connect(2828, 120_000);
  // Downloads stay in the throwaway home: macOS gives Firefox the real ~/Downloads whatever HOME says.
  await m.chrome((dir) => {
    Services.prefs.setStringPref('browser.download.dir', dir);
    Services.prefs.setIntPref('browser.download.folderList', 2);
    Services.prefs.setBoolPref('browser.download.useDownloadDir', true);
  }, join(home, 'Downloads')).catch(() => {}); // before Xiao is up, Marionette may need a moment
};
const quit = async () => {
  try { await m.send('Marionette:Quit'); } catch {}
  try { m.close(); } catch {}
  await until('Xiao to quit', () => {
    try {
      execFileSync('pgrep', ['-f', '--', `-profile ${join(data, 'profile')}`], { stdio: 'ignore' });
      return false;
    } catch {
      return true;
    }
  }, 30_000);
};
const ready = () => until('Xiao core', () => m.chrome(async () => {
  const { Xiao } = ChromeUtils.importESModule('resource://xiao/XiaoCore.sys.mjs');
  await Xiao.ready;
  return Xiao.started && !!Services.wm.getMostRecentWindow('navigator:browser')?.gBrowser;
}), 60_000);
const xiao = (fn, ...args) => m.chrome(`async (...args) => {
  const { Xiao } = ChromeUtils.importESModule('resource://xiao/XiaoCore.sys.mjs');
  return (${fn})(Xiao, ...args);
}`, ...args);
const tab = (url) => m.chrome(async (url) => {
  const w = Services.wm.getMostRecentWindow('navigator:browser');
  const t = w.gBrowser.addTab(url, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
  w.gBrowser.selectedTab = t;
  const { NavigableManager } = mod('remote/shared/NavigableManager.sys.mjs');
  return NavigableManager.getIdForBrowser(t.linkedBrowser);
}, url);
const loaded = (h) => until('page load', () => m.content(h, () => document.readyState === 'complete' && document.documentURI !== 'about:blank'));
const open = async (url) => {
  const h = await tab(url);
  await loaded(h);
  return h;
};
const closeTab = () => m.chrome(() => {
  const w = Services.wm.getMostRecentWindow('navigator:browser');
  w.gBrowser.removeTab(w.gBrowser.selectedTab);
});
// <name>-light.png and <name>-dark.png in test/e2e/out (E2E_OUT), for the README
const shoot = async (handle, name) => {
  mkdirSync(out, { recursive: true });
  for (const [theme, override] of [['light', 1], ['dark', 0]]) {
    await m.chrome((o) => Services.prefs.setIntPref('layout.css.prefers-color-scheme.content-override', o), override);
    await sleep(600);
    writeFileSync(join(out, `${name}-${theme}.png`), await m.screenshot(handle));
  }
  await m.chrome(() => Services.prefs.clearUserPref('layout.css.prefers-color-scheme.content-override'));
};
const probe = async (host) => {
  const h = await open(`http://${host}:${port}/probe`);
  const r = await m.content(h, () => window.probe());
  await closeTab();
  return r;
};

let failedToRun = null;
try {
  await launch();
  await ready();

  if (want('shield')) {
    const sites = await xiao((Xiao) => Xiao.features.shield);
    check('fingerprint noise is on by default', sites === true);
    const a = await probe('127.0.0.1');
    const a2 = await probe('127.0.0.1');
    const b = await probe('localhost');
    console.log('     ', JSON.stringify(a), '\n     ', JSON.stringify(b));
    const same = (x, y, keys) => keys.every((k) => x[k] === y[k]);
    const FIELDS = ['audio', 'copyAudio', 'canvasData', 'canvasPixels', ...(a.webgl ? ['webgl'] : [])];
    if (!a.webgl) console.log('SKIP webgl: this computer has no WebGL to measure');
    check('a site reads the same values twice in a session', same(a, a2, [...FIELDS, 'cores']), JSON.stringify(FIELDS.filter((k) => a[k] !== a2[k])));
    for (const k of FIELDS) check(`${k} differs between two sites`, a[k] !== b[k], `${a[k]} / ${b[k]}`);
    check('the core count is never more than the real one', a.cores >= 2 && a.cores <= 16 && b.cores >= 2, `${a.cores}, ${b.cores}`);
    check('a same-site frame sees the same noise', a.frameAudio === a.audio, `${a.frameAudio} / ${a.audio}`);
    check('a frame can\'t reach clean APIs', a.blankFrameCores === a.cores && a.sandboxAudio && a.sandboxAudio === a.audio, JSON.stringify([a.blankFrameCores, a.sandboxAudio]));
    check('the replaced functions look native', a.looksNative === true);
    check('colour scheme, language and time zone stay real', a.lang && a.tz === Intl.DateTimeFormat().resolvedOptions().timeZone, `${a.lang} ${a.tz}`);
    check('canvas still draws what the page asked', Math.abs(a.canvasRed - 204) <= 1, a.canvasRed);
    check('screen size reads as a common value', a.screen !== '1280x800', a.screen);

    await xiao((Xiao, site) => Xiao.shield.setSite(site, false), '127.0.0.1');
    await sleep(300);
    const off = await probe('127.0.0.1');
    check('the per-site switch takes the audio noise and core count away', off.audio !== a.audio && off.nativeCores === true, `${off.audio} ${off.cores}`);
    await xiao((Xiao, site) => Xiao.shield.setSite(site, true), '127.0.0.1');

    const noCam = await m.content(await open(`http://127.0.0.1:${port}/probe`), () => window.camera());
    await closeTab();
    await xiao(async (Xiao, site) => {
      await Xiao.setFeature({ id: 'fakeCamera', on: true });
      Xiao.shield.setCamera(site, true);
    }, '127.0.0.1');
    await sleep(300);
    const h = await open(`http://127.0.0.1:${port}/probe`);
    const cam = await m.content(h, () => window.camera());
    await closeTab();
    check('without the blank camera a site gets the normal path', noCam.fake === false, JSON.stringify(noCam));
    check('a chosen site gets a blank picture, with no prompt and no real camera', cam.fake === true && cam.tracks === 1, JSON.stringify(cam));
    const otherCam = await m.content(await open(`http://localhost:${port}/probe`), () => window.camera());
    await closeTab();
    check('other sites don\'t', otherCam.fake === false, JSON.stringify(otherCam));
    await xiao((Xiao, site) => Xiao.shield.setCamera(site, false), '127.0.0.1');

    await sleep(6000); // Store.save waits 5 s
    await quit();
    await launch();
    await ready();
    const later = await probe('127.0.0.1');
    for (const k of ['audio', 'copyAudio']) check(`${k} on the same site changes after a restart`, later[k] !== a[k], `${later[k]} / ${a[k]}`);
    const canvasMoved = later.canvasPixels !== a.canvasPixels || later.webgl !== a.webgl || later.canvasData !== a.canvasData;
    check('canvas or WebGL readings on the same site change after a restart', canvasMoved);
  }

  if (want('bangs')) {
    const bar = (text) => m.chrome(async (text) => {
      const w = Services.wm.getMostRecentWindow('navigator:browser');
      w.gURLBar.focus();
      w.gURLBar.search(text);
      await new Promise((r) => w.setTimeout(r, 1200));
      const first = w.gURLBar.view.visibleResults?.[0];
      w.gURLBar.view.close();
      return { url: first?.payload?.url ?? null, action: first?.payload?.action ?? null, engine: first?.payload?.engine ?? null, heuristic: first?.heuristic };
    }, text);
    const gh = await bar('!gh cats and dogs');
    check('address bar: "!gh cats and dogs" goes straight to GitHub', gh.url === 'https://github.com/search?q=cats+and+dogs' && gh.heuristic, JSON.stringify(gh));
    const last = await bar('cats !yt');
    check('address bar: the bang can come last', /youtube\.com.*cats/.test(last.url ?? ''), JSON.stringify(last));
    const lib = await bar('!note');
    check('address bar: !note offers the notes', lib.action === 'notes', JSON.stringify(lib));
    const none = await bar('!nosuchbangexists cats');
    check('address bar: an unknown bang is left to the search engine', !/^http/.test(none.url ?? '') || !/nosuchbang.*\.org/.test(none.url ?? ''), JSON.stringify(none));

    await xiao((Xiao, url) => {
      Xiao.store.settings = { ...Xiao.store.settings, bangs: { mine: url } };
    }, `http://127.0.0.1:${port}/own?q=%s`);
    seen.length = 0;
    const s = await open(START);
    await m.content(s, () => {
      document.getElementById('q').value = '!mine hello there';
      document.getElementById('search').requestSubmit();
    });
    await until('the bang to load', () => m.content(s, () => document.title === 'own bang'));
    check('start page: your own bang opens its address and nothing else asks the network', seen.some((u) => u === '/own?q=hello+there'), seen.join(' '));
    await closeTab();
    const off = await xiao(async (Xiao) => {
      await Xiao.setFeature({ id: 'bangs', on: false });
      return Xiao.bangs.resolve('!gh cats');
    });
    check('switching bangs off leaves "!gh cats" as plain words', off === null);
    await xiao((Xiao) => Xiao.setFeature({ id: 'bangs', on: true }));

    const notes = await m.chrome(async () => {
      const { Xiao } = ChromeUtils.importESModule('resource://xiao/XiaoCore.sys.mjs');
      const w = Services.wm.getMostRecentWindow('navigator:browser');
      const before = Xiao.features.sticky;
      const events = [];
      for (const t of ['popupshowing', 'popupshown', 'popuphiding', 'popuphidden']) w.document.addEventListener(t, (e) => e.target.id === 'xiao-sticky-panel' && events.push(t), true);
      await Xiao.bangs.run('notes', w);
      let panel;
      for (let i = 0; i < 40 && panel?.state !== 'open'; i++) {
        await new Promise((r) => w.setTimeout(r, 100));
        panel = w.document.getElementById('xiao-sticky-panel');
      }
      const state = panel?.state;
      panel?.hidePopup();
      return { before, after: Xiao.features.sticky, state, events };
    });
    check('!note switches the note on and opens it', notes.before === false && notes.after === true && notes.state === 'open', JSON.stringify(notes));
    const action = await m.chrome(() => {
      const { globalActions } = ChromeUtils.importESModule('resource:///modules/ZenUBGlobalActions.sys.mjs');
      return globalActions.some((a) => a.commandId === 'xiao:notes');
    });
    check('the command bar has "Open your notes"', action);
  }

  if (want('styles')) {
    const s = await open(START);
    await until('the start page', () => m.content(s, () => document.getElementById('status').textContent !== 'Checking protection…'));
    const save = (style, theme, glass = false) => m.content(s, async (style, theme, glass) => {
      const { settings } = await window.xiao.call('get');
      await window.xiao.call('save', { ...settings, bangs: '', style, theme, glass });
      location.reload();
    }, style, theme, glass);
    const shots = join(out, 'styles');
    mkdirSync(shots, { recursive: true });
    for (const style of ['normal', 'glass', 'terminal', 'retrofind']) {
      for (const theme of ['light', 'dark']) {
        await save(style, theme);
        await sleep(900);
        await loaded(s);
        await until('the style', () => m.content(s, (style) => document.documentElement.dataset.style === style, style));
        await sleep(500);
        writeFileSync(join(shots, `${style}-${theme}.png`), await m.screenshot(s));
        const look = await m.content(s, () => {
          const q = document.getElementById('q').getBoundingClientRect();
          const parse = (c) => c.match(/[\d.]+/g).map(Number);
          return { q: q.width > 100 && q.height > 10, sky: !document.getElementById('desktop').hidden,
            prompt: getComputedStyle(document.getElementById('term-prompt')).display !== 'none',
            logo: getComputedStyle(document.querySelector('.retro-logo')).display !== 'none',
            overflow: document.documentElement.scrollWidth > innerWidth, ink: parse(getComputedStyle(document.getElementById('status')).color) };
        });
        const ok = look.q && !look.overflow && look.sky === (style === 'glass' || style === 'retrofind')
          && look.prompt === (style === 'terminal') && look.logo === (style === 'retrofind');
        check(`${style} / ${theme} shows its own parts and fits`, ok, JSON.stringify(look));
      }
    }
    await save('terminal', 'auto');
    await sleep(900);
    await loaded(s);
    await until('terminal', () => m.content(s, () => document.documentElement.dataset.style === 'terminal'));
    const line = async (text) => m.content(s, async (text) => {
      document.getElementById('q').value = text;
      document.getElementById('search').requestSubmit();
      await new Promise((r) => setTimeout(r, 400));
      return document.getElementById('term-log').textContent;
    }, text);
    check('terminal: help lists the commands', /open <name or address>/.test(await line('help')));
    check('terminal: ls lists your sites', /Wikipedia\s+https:/.test(await line('ls')));
    check('terminal: clear clears', (await line('clear')) === '');
    await line('style retrofind');
    check('terminal: style changes the style and remembers it', await m.content(s, async () => (await window.xiao.call('get')).settings.style === 'retrofind' && document.documentElement.dataset.style === 'retrofind'));

    const glassOn = () => m.chrome(() => Services.wm.getMostRecentWindow('navigator:browser').document.documentElement.hasAttribute('xiao-glass')
      && Services.prefs.getBoolPref('zen.theme.acrylic-sidebar') && Services.prefs.getBoolPref('zen.theme.acrylic-urlbar'));
    check('glass toolbars are off until asked for', !(await glassOn()));
    await save('normal', 'auto', true);
    await sleep(600);
    check('the Liquid glass switch dresses the browser window', await glassOn());
    const chromeShot = async (name) => {
      await m.send('Marionette:SetContext', { value: 'chrome' });
      const handle = (await m.send('WebDriver:GetWindowHandle')).value;
      const { value } = await m.send('WebDriver:TakeScreenshot', { full: false, handle });
      writeFileSync(join(shots, name), Buffer.from(value, 'base64'));
    };
    await chromeShot('window-glass.png');
    await save('glass', 'auto', false);
    await sleep(600);
    check('the Liquid glass style counts as asking for it', await glassOn());
    await save('normal', 'auto', false);
    await sleep(600);
    check('and both can be turned off', !(await glassOn()));
    await chromeShot('window-plain.png');
    await closeTab();
  }

  if (want('packs')) {
    await m.chrome((u) => Services.prefs.setStringPref('xiao.packs.mirror', u), `http://127.0.0.1:${port}/mirror/`);
    const state = (id) => xiao(async (Xiao, id) => (await Xiao.packs.list()).find((p) => p.id === id), id);
    const tryPack = async (id) => {
      await xiao((Xiao, id) => Xiao.setFeature({ id, on: true }), id);
      return until(`${id} to stop or finish`, async () => {
        const p = await state(id);
        return (p.error || p.installed) && p;
      }, 60_000);
    };
    const words = (e) => !/\b\d{3}\b|SHA|resource:|http/i.test(e ?? '');
    mirrorMode = 'missing';
    const missing = await tryPack('pdf');
    check('no release yet: it says so in words and marks the switch unavailable', /not available/.test(missing.error) && missing.missing === true && words(missing.error), missing.error);
    const noFiles = !existsSync(join(data, '../../..', 'never'));
    check('nothing is written before the check passes', noFiles);
    mirrorMode = 'busy';
    const busy = await tryPack('pdf');
    check('a server fault says try later, and retry works from the same switch', /trouble/.test(busy.error) && !busy.missing && words(busy.error), busy.error);
    mirrorMode = 'damaged';
    const damaged = await tryPack('pdf');
    check('a damaged download is not kept and says why', /damaged/.test(damaged.error) && !damaged.installed && words(damaged.error), damaged.error);
    await m.chrome(() => Services.prefs.setStringPref('xiao.packs.mirror', 'http://127.0.0.1:1/'));
    const down = await tryPack('pdf');
    check('no connection says check your connection', /connection/.test(down.error) && words(down.error), down.error);
    await m.chrome((u) => Services.prefs.setStringPref('xiao.packs.mirror', u), `http://127.0.0.1:${port}/mirror/`);
    mirrorMode = 'ok';
    const good = await tryPack('pdf');
    check('after all that, trying again simply works', good.installed && !good.error, JSON.stringify(good));
    const s = await open(START);
    const ui = await m.content(s, async () => {
      document.getElementById('open-features').click();
      await new Promise((r) => setTimeout(r, 600));
      return document.querySelector('[data-size="pdf"]').textContent;
    });
    check('the start page shows it downloaded', /Downloaded/.test(ui), ui);
    await closeTab();
    await m.chrome(() => Services.prefs.clearUserPref('xiao.packs.mirror'));
  }

  if (want('pdf')) {
    const pdfOf = async (n) => {
      const doc = await PDFDocument.create();
      for (let i = 0; i < n; i++) doc.addPage([300, 400]).drawText(`page ${i + 1}`, { x: 20, y: 200 });
      return Buffer.from(await doc.save()).toString('base64');
    };
    const pages = async (b64) => (await PDFDocument.load(Buffer.from(b64, 'base64'))).getPageCount();
    await xiao(async (Xiao) => {
      await Xiao.setFeature({ id: 'pdf', on: false });
      await Xiao.setFeature({ id: 'pdf', on: true, remove: true }).catch(() => {});
      await Xiao.packs.remove('pdf').catch(() => {});
      await Xiao.servePacks();
    });
    // Firefox's about:pdf (Zen 1.24) carries a button to Xiao's tools
    let h = await open('about:pdf');
    const firefox = await until('Xiao\'s button on about:pdf', () => m.content(h, () => {
      const b = document.querySelector('#xiao-pdf-tools moz-button');
      return b && { label: b.getAttribute('label'), bridge: typeof window.xiao, dropzone: !!document.getElementById('dropzone') };
    }), 15_000).catch((e) => e.message);
    check('Firefox\'s about:pdf is there, with a button to Xiao\'s PDF tools and no way to reach Xiao from the page', firefox?.dropzone && /More PDF tools/.test(firefox.label) && firefox.bridge === 'undefined', JSON.stringify(firefox));
    await shoot(h, 'about-pdf');
    await m.content(h, () => document.querySelector('#xiao-pdf-tools moz-button').click());
    const went = await until('the PDF tools to open', () => m.chrome(() => Services.wm.getMostRecentWindow('navigator:browser').gBrowser.selectedBrowser.currentURI.spec === 'resource://xiao/pdf/index.html'), 10_000).catch(() => false);
    check('the button opens Xiao\'s PDF tools', went === true);
    await closeTab();
    await closeTab();
    // without the pack: Xiao's page that offers the download
    h = await m.chrome(() => {
      const { Xiao } = ChromeUtils.importESModule('resource://xiao/XiaoCore.sys.mjs');
      const tab = Xiao.aboutPdf.open(Services.wm.getMostRecentWindow('navigator:browser'));
      const { NavigableManager } = mod('remote/shared/NavigableManager.sys.mjs');
      return NavigableManager.getIdForBrowser(tab.linkedBrowser);
    });
    await loaded(h);
    const bare = await m.content(h, async () => {
      await new Promise((r) => setTimeout(r, 800));
      return { uri: document.documentURI, title: document.title, get: !!document.getElementById('get'), bridge: typeof window.xiao?.call, origin: window.origin, size: document.getElementById('size')?.textContent };
    });
    const plain = await m.chrome(() => {
      const p = Services.wm.getMostRecentWindow('navigator:browser').gBrowser.selectedBrowser.contentPrincipal;
      return { origin: p.origin, system: p.isSystemPrincipal, content: p.isContentPrincipal };
    });
    check('before the download, Xiao\'s PDF page offers it, as an ordinary page', bare.uri === 'resource://xiao/pdf/index.html' && bare.title === 'PDF tools' && bare.get && bare.bridge === 'function' && bare.size !== 'a few hundred KB' && !plain.system && plain.content, JSON.stringify({ ...bare, ...plain }));
    // the download from the page, then the page turns into the tools by itself
    await m.chrome((u) => Services.prefs.setStringPref('xiao.packs.mirror', u), `http://127.0.0.1:${port}/mirror/`);
    mirrorMode = 'ok';
    await m.content(h, () => document.getElementById('get').click());
    const tools = await until('the page to become the tools', () => m.content(h, () => !!document.getElementById('work') && document.documentURI === 'resource://xiao-pdf/index.html' && document.title), 60_000).catch((e) => e.message);
    check('"Get the PDF tools" downloads them and the page turns into them', tools === 'PDF tools', String(tools));
    await closeTab();
    // a PDF handed over, then merged with a second one picked in the page
    const [two, three] = [await pdfOf(2), await pdfOf(3)];
    h = await m.chrome(async (b64) => {
      const { Xiao } = ChromeUtils.importESModule('resource://xiao/XiaoCore.sys.mjs');
      const w = Services.wm.getMostRecentWindow('navigator:browser');
      const tab = Xiao.aboutPdf.open(w, { name: 'two.pdf', bytes: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) });
      const { NavigableManager } = mod('remote/shared/NavigableManager.sys.mjs');
      return NavigableManager.getIdForBrowser(tab.linkedBrowser);
    }, two);
    await loaded(h);
    const handed = await until('the handed-over PDF', () => m.content(h, () => document.getElementById('file-info').textContent), 15_000).catch((e) => e.message);
    check('a PDF handed to the PDF tools shows its name and page count', /^2 pages/.test(handed), handed);
    await shoot(h, 'pdf-tools');
    const merged = await m.content(h, async (b64) => {
      const doc = window.wrappedJSObject?.document ?? document;
      document.querySelector('[value="merge"]').click();
      const dt = new DataTransfer();
      dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'three.pdf', { type: 'application/pdf' }));
      doc.querySelector('[data-for="merge"] input').files = dt.files;
      document.querySelector('#options button[type="submit"]').click();
      for (let i = 0; i < 40 && !/^Done|error/i.test(document.getElementById('status').textContent); i++) await new Promise((r) => setTimeout(r, 250));
      return document.getElementById('status').textContent;
    }, three);
    const file = await until('the merged download', () => m.chrome(async () => {
      const { Downloads } = mod('toolkit/components/downloads/Downloads.sys.mjs');
      const d = (await (await Downloads.getList(Downloads.PUBLIC)).getAll()).find((x) => x.succeeded && /\(merge\)\.pdf$/.test(x.target.path));
      if (!d) return null;
      const bytes = await IOUtils.read(d.target.path);
      let bin = '';
      for (const b of bytes) bin += String.fromCharCode(b);
      return { path: d.target.path, b64: btoa(bin) };
    }), 20_000).catch(() => null);
    check('Merge gives back one PDF with every page of both', /^Done/.test(merged) && file && (await pages(file.b64)) === 5, `${merged} ${file ? await pages(file.b64) : 'no file'}`);
    await closeTab();
    // downloaded lately, and the viewer
    h = await open('resource://xiao-pdf/index.html');
    const recent = await until('the recent list', () => m.content(h, () => [...document.querySelectorAll('#recent button')].map((b) => b.textContent)), 10_000).catch(() => []);
    check('the PDF tools list the PDF just downloaded', recent.some((n) => /\(merge\)\.pdf$/.test(n)), JSON.stringify(recent));
    const viewer = await m.content(h, async () => {
      document.querySelector('#recent button').click();
      for (let i = 0; i < 20 && !/pages/.test(document.getElementById('file-info').textContent); i++) await new Promise((r) => setTimeout(r, 250));
      document.getElementById('view').click();
      return document.getElementById('file-info').textContent;
    });
    const shown = await until('the viewer tab', () => m.chrome(() => {
      const b = Services.wm.getMostRecentWindow('navigator:browser').gBrowser.selectedBrowser;
      return b.documentContentType === 'application/pdf' && b.currentURI.spec;
    }), 15_000).catch(() => '');
    check('a recent PDF loads into the page and opens in Firefox\'s viewer from there', /^5 pages/.test(viewer) && /^file:.*\(merge\)\.pdf$/.test(shown), `${viewer} ${shown}`);
    // and back: "More tools for this PDF" from the viewer
    h = await m.chrome(async () => {
      const { Xiao } = ChromeUtils.importESModule('resource://xiao/XiaoCore.sys.mjs');
      const tab = await Xiao.aboutPdf.fromViewer(Services.wm.getMostRecentWindow('navigator:browser'));
      const { NavigableManager } = mod('remote/shared/NavigableManager.sys.mjs');
      return NavigableManager.getIdForBrowser(tab.linkedBrowser);
    });
    await loaded(h);
    const back = await until('the PDF from the viewer', () => m.content(h, () => document.getElementById('file-info').textContent), 15_000).catch((e) => e.message);
    check('"More tools for this PDF" brings the viewer\'s PDF over to the PDF tools', /^5 pages/.test(back), back);
    await closeTab();
    await closeTab();
    // a web page can't take a tab to Xiao's PDF page
    h = await open(`http://127.0.0.1:${port}/probe`);
    await m.content(h, () => { try { location.href = 'resource://xiao-pdf/index.html'; } catch {} });
    await sleep(1500);
    const stayed = await m.content(h, () => document.documentURI);
    check('a web page can\'t open Xiao\'s PDF page', !stayed.startsWith('resource:'), stayed);
    await closeTab();
    const bang = await xiao((Xiao) => Xiao.bangs.resolve('!pdf'));
    check('!pdf opens about:pdf', bang?.action === 'pdf', JSON.stringify(bang));
    await m.chrome(() => Services.prefs.clearUserPref('xiao.packs.mirror'));
  }

  if (want('more')) {
    const url = (q) => `http://127.0.0.1:${port}/article?${q}`;
    const browserIdOf = (h) => m.chrome((h) => {
      const { NavigableManager } = mod('remote/shared/NavigableManager.sys.mjs');
      return NavigableManager.getBrowserById(h)?.browserId;
    }, h);
    // Copy as Markdown
    let h = await open(url('md'));
    const md = await xiao((Xiao) => {
      const w = Services.wm.getMostRecentWindow('navigator:browser');
      const browser = w.gBrowser.selectedBrowser;
      return {
        item: !!w.document.getElementById('xiao-markdown'),
        page: Xiao.toolbar.markdownFor({ browser }),
        quote: Xiao.toolbar.markdownFor({ browser, isTextSelected: true, selectionInfo: { fullText: 'painted red' } }),
        link: Xiao.toolbar.markdownFor({ browser, onLink: true, linkURL: 'https://user:pw@example.org/a_(b)', linkTextStr: 'A [b]' }),
      };
    });
    check('Copy as Markdown: the page, a quote linking to its words, and a link without its login', md.item && md.page === `[Article md](${url('md')})`
      && md.quote.endsWith(`— [Article md](${url('md')}#:~:text=painted%20red)`) && md.link === '[A \\[b\\]](https://example.org/a_%28b%29)', JSON.stringify(md));
    // site mute
    const muted = await xiao(async (Xiao, second) => {
      const w = Services.wm.getMostRecentWindow('navigator:browser');
      const first = w.gBrowser.selectedTab;
      Xiao.siteMute.set(first.linkedBrowser.currentURI, true);
      const a = first.muted;
      const t = w.gBrowser.addTab(second, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
      await new Promise((r) => setTimeout(r, 2500));
      const b = t.muted;
      Xiao.siteMute.set(first.linkedBrowser.currentURI, false);
      const after = [first.muted, t.muted];
      w.gBrowser.removeTab(t);
      return { a, b, after, saved: [...Xiao.store.muted] };
    }, url('again'));
    check('"Always mute this site" mutes its tabs, new ones too, and unmutes only what it muted', muted.a && muted.b && !muted.after[0] && !muted.after[1] && muted.saved.length === 0, JSON.stringify(muted));
    await closeTab();
    // empty new tabs
    const cleanup = await xiao(async (Xiao, start, page) => {
      const w = Services.wm.getMostRecentWindow('navigator:browser');
      await Xiao.setFeature({ id: 'newTabCleanup', value: 5 });
      const empty = w.gBrowser.addTab(start, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
      const used = w.gBrowser.addTab(page, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
      await new Promise((r) => setTimeout(r, 2000));
      for (const t of [empty, used]) t.updateLastAccessed(Date.now() - 10 * 60_000);
      const closed = Xiao.closeEmptyTabs(5);
      const out = { closed, emptyGone: !empty.isConnected, usedKept: used.isConnected };
      if (used.isConnected) w.gBrowser.removeTab(used);
      await Xiao.setFeature({ id: 'newTabCleanup', value: 0 });
      return out;
    }, START, url('used'));
    check('new tabs left empty close after the chosen time; a tab with a page stays', cleanup.emptyGone && cleanup.usedKept && cleanup.closed >= 1, JSON.stringify(cleanup));
    // All tabs: a command becomes a plan, and only the confirmed plan acts
    for (const q of ['yt1', 'yt2', 'keep']) await tab(url(q));
    await sleep(2500);
    h = await open('resource://xiao/tabs/index.html');
    const planned = await m.content(h, async () => {
      const p = await window.xiao.call('tabs.plan', { text: 'close tabs about yt' });
      return { n: p.ids?.length, titles: (p.tabs ?? []).map((t) => t.title).sort(), error: p.error };
    });
    check('"close tabs about yt" plans the two matching tabs, and nothing closes yet', planned.n === 2 && planned.titles.join() === 'Article yt1,Article yt2', JSON.stringify(planned));
    await m.content(h, async () => {
      document.getElementById('command').value = 'close tabs about yt';
      document.getElementById('command-form').requestSubmit();
      for (let i = 0; i < 20 && document.getElementById('plan').hidden; i++) await new Promise((r) => setTimeout(r, 200));
    });
    await shoot(h, 'all-tabs');
    const ran = await m.content(h, async () => {
      const text = document.getElementById('plan-text').textContent;
      document.getElementById('plan-go').click();
      for (let i = 0; i < 20 && !/Done/.test(document.getElementById('status').textContent); i++) await new Promise((r) => setTimeout(r, 200));
      return { text, status: document.getElementById('status').textContent, left: (await window.xiao.call('tabs.list')).tabs.map((t) => t.title) };
    });
    check('confirming the plan closes exactly those tabs', /Close 2 tabs/.test(ran.text) && /Done: 2/.test(ran.status) && !ran.left.some((t) => /yt/.test(t)) && ran.left.includes('Article keep'), JSON.stringify(ran));
    const moved = await xiao(async (Xiao) => {
      const w = Services.wm.getMostRecentWindow('navigator:browser');
      const space = await w.gZenWorkspaces.createAndSaveWorkspace('Work', undefined, true);
      const plan = Xiao.tabCommands.plan('move tabs about keep to work');
      const r = await Xiao.tabCommands.run(plan);
      const tab = [...w.gZenWorkspaces.allStoredTabs].find((t) => t.label === 'Article keep');
      return { done: r.done, inWork: tab?.getAttribute('zen-workspace-id') === space.uuid, nope: Xiao.tabCommands.plan('move tabs about keep to nowhere').error };
    });
    check('"move … to Work" moves the tab to that space; an unknown space is named in the error', moved.done === 1 && moved.inWork && /nowhere/.test(moved.nope), JSON.stringify(moved));
    await closeTab();
    // Assist: another tab mentioned, a skill, the reader's style
    const ha = await open(url('lighthouse'));
    const hb = await open(url('ferry'));
    const [a, b] = [await browserIdOf(ha), await browserIdOf(hb)];
    const across = await xiao(async (Xiao, a, b) => {
      await Xiao.setFeature({ id: 'assist', on: true }).catch(() => {});
      const mentions = Xiao.assist.mentionable(a);
      const ev = await Xiao.assist.evidence(a, 'when do ferries leave the harbour', [b]);
      const skill = await Xiao.assist.newSkill('Kids', 'Explain it to a ten-year-old.');
      const skills = await Xiao.assist.skills();
      const dup = await Xiao.assist.newSkill('Kids', 'again').catch((e) => e.message);
      await Xiao.setFeature({ id: 'assist', on: false });
      return { mentioned: mentions.tabs.some((t) => t.id === b), titles: ev.titles, top: ev.evidence[0], skill, skills: skills.map((s) => s.name), dup };
    }, a, b);
    check('Assist reads a mentioned tab too, and each passage keeps its page', across.mentioned && across.titles.length === 2 && across.top?.source === 1 && /Ferries/.test(across.top.text), JSON.stringify(across));
    check('a skill is saved as a note "Skill Kids.md" and runs as /kids; a second with the same name is refused', across.skill === 'kids' && across.skills.includes('kids') && /already/.test(across.dup), JSON.stringify(across));
    await closeTab();
    await closeTab();
    // Instant links, from Xiao Search's JSON only
    const instant = await xiao(async (Xiao, base) => {
      const w = Services.wm.getMostRecentWindow('navigator:browser');
      const saved = Xiao.searchUrl;
      Xiao.searchUrl = '';
      const without = await Xiao.instantLinks.open(w, 'lighthouse').catch((e) => e.message);
      Xiao.searchUrl = base;
      const { opened, folder, tabs } = await Xiao.instantLinks.open(w, 'lighthouse');
      const urls = tabs.map((t) => t.linkedBrowser.currentURI.spec);
      Xiao.searchUrl = saved;
      for (const t of tabs) {
        w.gBrowser.unpinTab(t);
        w.gBrowser.removeTab(t);
      }
      return { without, opened, folder, urls };
    }, `http://127.0.0.1:${port}`);
    check('!top opens the top results in a folder named after the search, and without Xiao Search it says what it needs', instant.opened === 2 && instant.folder === 'lighthouse' && /Xiao Search/.test(instant.without), JSON.stringify(instant));
    // calendar preview from an .ics file
    const ics = join(home, 'work.ics');
    const soon = new Date(Date.now() + 12 * 60_000);
    const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    writeFileSync(ics, ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'SUMMARY:Standup', `DTSTART:${stamp(soon)}`, `DTEND:${stamp(new Date(soon.getTime() + 900_000))}`, 'LOCATION:https://meet.google.com/abc-defg-hij', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n'));
    const cal = await xiao(async (Xiao, ics) => {
      const bad = await Xiao.setFeature({ id: 'calendar', value: 'http://insecure.example/c.ics' }).catch((e) => e.message);
      await Xiao.setFeature({ id: 'calendar', value: ics });
      await Xiao.calendar.refresh();
      const next = Xiao.calendar.next();
      await Xiao.setFeature({ id: 'calendar', value: '' });
      return { bad, next, off: Xiao.calendar.next().on };
    }, ics);
    const e0 = cal.next.events[0];
    check('the calendar preview shows the next meeting with a countdown and its Join link; http addresses are refused', e0?.title === 'Standup' && /^in 1[12] min$/.test(e0.when) && e0.join === 'https://meet.google.com/abc-defg-hij' && /https/.test(cal.bad) && cal.off === false, JSON.stringify(cal));
    // Zen's importer, from the start page
    const importer = await m.chrome(() => ({
      keys: mod('browser/components/migration/MigrationUtils.sys.mjs').MigrationUtils.availableMigratorKeys,
      wizard: typeof mod('browser/components/migration/MigrationUtils.sys.mjs').MigrationUtils.showMigrationWizard,
    }));
    // Zen's Arc importer is for macOS and Windows, its Dia importer for macOS only
    const wants = { darwin: ['arc', 'dia'], win32: ['arc'] }[process.platform] ?? [];
    check(`Zen's importer is there for the start page's import button${wants.length ? `, with ${wants.join(' and ')}` : ''}`, wants.every((k) => importer.keys.includes(k)) && importer.wizard === 'function', JSON.stringify(importer));
  }

  if (want('extras')) {
    const hidden = () => m.chrome(() => ['media.peerconnection.ice.no_host', 'media.peerconnection.ice.default_address_only', 'media.peerconnection.ice.obfuscate_host_addresses'].map((p) => Services.prefs.getBoolPref(p)));
    check('this computer\'s address starts hidden', (await hidden()).every(Boolean), JSON.stringify(await hidden()));
    await xiao(async (Xiao) => {
      for (const id of ['sendDevice', 'noteWriting', 'clipboard', 'reader', 'sticky']) await Xiao.setFeature({ id, on: true });
      await Xiao.notes.save({ name: null, text: '# Trip\nPack the #tent and #boots' });
    });
    const openSend = async () => {
      const h = await m.chrome(async () => {
        const { Xiao } = ChromeUtils.importESModule('resource://xiao/XiaoCore.sys.mjs');
        const t = await Xiao.send.open(Services.wm.getMostRecentWindow('navigator:browser'));
        const { NavigableManager } = mod('remote/shared/NavigableManager.sys.mjs');
        return NavigableManager.getIdForBrowser(t.linkedBrowser);
      });
      await loaded(h);
      return h;
    };
    const a = await openSend();
    await until('the note list', () => m.content(a, () => document.getElementById('note').options.length > 0));
    check('a Send page opens this computer\'s address to WebRTC', !(await hidden()).some(Boolean), JSON.stringify(await hidden()));
    const server = await xiao(async (Xiao) => {
      const code = async (path) => (await fetch(`http://${Xiao.send.host}${path}`).catch(() => ({ status: 0 }))).status;
      return { right: await code(`${Xiao.send.prefix}index.html`), wrong: await code('/index.html'), out: await code(`${Xiao.send.prefix}../XiaoCore.sys.mjs`), bound: Xiao.send.host.startsWith('127.0.0.1:') };
    });
    check('the local server answers only under its secret path, on this computer', server.right === 200 && server.wrong === 404 && server.out === 404 && server.bound, JSON.stringify(server));
    const burst = await xiao(async (Xiao) => {
      const url = `http://${Xiao.send.host}${Xiao.send.prefix}vendor/qr/qrcode.mjs`;
      const want = (await (await fetch('resource://xiao/send/vendor/qr/qrcode.mjs')).arrayBuffer()).byteLength;
      const got = await Promise.all(Array.from({ length: 40 }, async () => {
        try {
          const r = await fetch(url, { cache: 'no-store' });
          return r.status === 200 && (await r.arrayBuffer()).byteLength === want ? 'ok' : `status ${r.status}`;
        } catch (e) {
          return String(e);
        }
      }));
      return { want, bad: got.filter((g) => g !== 'ok') };
    });
    check('the local server answers 40 requests at once, complete', burst.bad.length === 0, JSON.stringify({ want: burst.want, bad: burst.bad.length, first: burst.bad[0] }));
    const offer = await m.content(a, async () => {
      document.getElementById('make').click();
      for (let i = 0; i < 60 && !document.querySelector('#offer-qr svg'); i++) await new Promise((r) => setTimeout(r, 200));
      return { code: document.getElementById('offer-code').value, qr: !!document.querySelector('#offer-qr svg'), said: document.getElementById('status').textContent };
    });
    check('sending shows a pairing code and its QR code', offer.code.startsWith('1o') && offer.qr, `${offer.code.slice(0, 20)} ${offer.said}`);
    const b = await openSend();
    await until('the second page', () => m.content(b, () => !!document.getElementById('incoming')));
    const reply = await m.content(b, async (code) => {
      document.getElementById('incoming').value = code;
      document.getElementById('answer').click();
      for (let i = 0; i < 60 && !document.getElementById('answer-out').value; i++) await new Promise((r) => setTimeout(r, 200));
      return document.getElementById('answer-out').value;
    }, offer.code);
    if (process.env.DEBUG_SEND) {
      const lines = await m.content(a, async (o, r) => {
        const { decodeSignal } = await import('./lib/nearby.js');
        const pick = async (c) => (await decodeSignal(c)).sdp.split('\r\n').filter((l) => /^a=(candidate|setup|ice-ufrag|group)|^c=|^m=/.test(l)).map((l) => l.slice(0, 80));
        return { offer: await pick(o), reply: await pick(r) };
      }, offer.code, reply);
      console.log(JSON.stringify(lines, null, 1));
    }
    await m.content(a, (reply) => {
      document.getElementById('answer-code').value = reply;
      document.getElementById('connect').click();
    }, reply);
    // macOS's firewall stops two copies on one Mac reaching each other, even as the same app. CI's Linux job proves this part.
    const reached = await until('the note to be offered', () => m.content(b, () => !document.getElementById('offered').hidden), 30_000).then(() => true, () => false);
    if (!reached && process.platform === 'darwin') {
      console.log('SKIP a note goes between two Send pages: blocked by the macOS firewall here; the Linux CI job must pass this');
    } else if (!reached) {
      check('a note goes between two Send pages, after the receiver says yes', false, await m.content(a, () => document.getElementById('status').textContent));
    } else {
      const offered = await m.content(b, () => {
        const said = document.getElementById('offered-what').textContent;
        document.getElementById('accept').click();
        return said;
      });
      const got = await until('the note to arrive', () => m.content(b, () => /Saved/.test(document.getElementById('status').textContent) && document.getElementById('status').textContent), 30_000);
      const sender = await until('the sender to finish', () => m.content(a, () => /Sent/.test(document.getElementById('status').textContent) && document.getElementById('status').textContent), 15_000);
      check('a note goes between two Send pages, after the receiver says yes', /Trip/.test(offered) && !!got && !!sender, `${offered} ${got} ${sender}`);
      const copies = await xiao(async (Xiao) => (await Xiao.notes.list()).filter((n) => /Pack the #tent/.test(n.text)).length);
      check('and is saved as a note', copies === 2, copies);
    }
    await closeTab();
    await closeTab();
    await sleep(500);
    check('closing the Send pages hides the address again', (await hidden()).every(Boolean), JSON.stringify(await hidden()));
    const closed = await xiao((Xiao) => !Xiao.send.server && Xiao.send.origin === '');
    check('and stops the page\'s local server', closed);

    const tagInfo = await m.chrome(async () => {
      const { Xiao } = ChromeUtils.importESModule('resource://xiao/XiaoCore.sys.mjs');
      Xiao.assist.engine = async () => 'A better note #tent';
      const w = Services.wm.getMostRecentWindow('navigator:browser');
      const features = Xiao.features;
      await Xiao.setFeature({ id: 'assist', on: true });
      Xiao.assist.model = async () => true;
      await Xiao.notes.openFrom(w);
      const panel = w.document.getElementById('xiao-sticky-panel');
      for (let i = 0; i < 30 && panel.state !== 'open'; i++) await new Promise((r) => w.setTimeout(r, 100));
      const tags = [...panel.querySelectorAll('.xiao-sticky-tag')].map((c) => c.textContent);
      const paper = panel.querySelector('.xiao-sticky-text');
      const before = paper.textContent;
      const select = panel.querySelector('.xiao-sticky-writing select');
      select.value = 'improve';
      select.dispatchEvent(new w.Event('change'));
      for (let i = 0; i < 30 && paper.textContent === before; i++) await new Promise((r) => w.setTimeout(r, 100));
      const rewritten = paper.textContent;
      panel.querySelector('.xiao-sticky-writing button').click();
      const undone = paper.textContent === before;
      panel.hidePopup();
      delete Xiao.assist.engine;
      delete Xiao.assist.model;
      await Xiao.setFeature({ id: 'assist', on: false });
      return { tags, rewritten, undone, features: features.noteWriting };
    });
    check('the sticky note lists its #tags', tagInfo.tags.includes('#tent') && tagInfo.tags.includes('#boots'), JSON.stringify(tagInfo.tags));
    check('a writing tool rewrites the note, and Undo puts it back', tagInfo.rewritten === 'A better note #tent' && tagInfo.undone, JSON.stringify(tagInfo));

    const copyPage = await open(`http://127.0.0.1:${port}/probe`);
    // A real copy, by the browser's own command: pages can't fake the event Xiao listens for.
    const copy = async (text, password) => {
      await m.content(copyPage, (text, password) => {
        const field = document.createElement('input');
        field.id = 'copy-me';
        field.type = password ? 'password' : 'text';
        field.value = text;
        document.body.append(field);
        field.focus();
        field.select();
      }, text, password);
      await m.chrome(async () => {
        const w = Services.wm.getMostRecentWindow('navigator:browser');
        w.gBrowser.selectedBrowser.focus();
        w.goDoCommand('cmd_copy');
        await new Promise((r) => w.setTimeout(r, 300));
      });
      await m.content(copyPage, () => document.getElementById('copy-me').remove());
    };
    await copy('a copied line', false);
    await sleep(400);
    await copy('hunter2', true);
    await sleep(400);
    const clips = await xiao((Xiao) => Xiao.clipboard.clips.map((c) => c.text));
    check('a copy from a page is remembered', clips.includes('a copied line'), JSON.stringify(clips));
    check('a copy from a password field is not', !clips.includes('hunter2'), JSON.stringify(clips));
    await closeTab();
    const cp = await open('resource://xiao/clipboard/index.html');
    const listed = await until('the clipboard page', () => m.content(cp, () => document.querySelectorAll('#clips li').length));
    check('the clipboard page lists it', listed >= 1, listed);
    await m.content(cp, () => document.getElementById('clear').click());
    await sleep(400);
    check('Clear all empties it', (await xiao((Xiao) => Xiao.clipboard.clips.length)) === 0);
    await closeTab();
    await xiao((Xiao) => Xiao.setFeature({ id: 'clipboard', on: false }));

    const translate = await m.chrome(() => {
      const w = Services.wm.getMostRecentWindow('navigator:browser');
      return { panel: typeof w.FullPageTranslationsPanel?.open, pref: Services.prefs.getBoolPref('browser.translations.enable') };
    });
    check('Firefox\'s local translation is there for the panel to open', translate.panel === 'function' && translate.pref, JSON.stringify(translate));
    await open(`http://127.0.0.1:${port}/french`);
    const opened = await m.chrome(async () => {
      const w = Services.wm.getMostRecentWindow('navigator:browser');
      const button = w.document.getElementById('translations-button');
      for (let i = 0; i < 80 && !button.checkVisibility(); i++) await new Promise((r) => w.setTimeout(r, 200));
      await w.FullPageTranslationsPanel.open(new w.Event('command'), false);
      const panel = w.document.getElementById('full-page-translations-panel');
      for (let i = 0; i < 40 && panel?.state !== 'open'; i++) await new Promise((r) => w.setTimeout(r, 200));
      const state = panel?.state;
      panel?.hidePopup?.();
      return state;
    });
    check('the Translate row\'s panel opens', opened === 'open' || opened === 'showing', opened);
    await closeTab();

    const book = zip([
      ['mimetype', Buffer.from('application/epub+zip')],
      ['META-INF/container.xml', Buffer.from('<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/book.opf"/></rootfiles></container>')],
      ['OEBPS/book.opf', Buffer.from('<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>Test Book</dc:title></metadata><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/><item id="b" href="b.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>')],
      ['OEBPS/a.xhtml', Buffer.from(`<html><head><title>A</title><link rel="stylesheet" href="http://127.0.0.1:${port}/tracker.css"/></head><body><h1>Chapter one</h1><img src="http://127.0.0.1:${port}/tracker.png"/><script>parent.scriptRan = 1</script>${'<p>A long paragraph of the book. </p>'.repeat(400)}</body></html>`)],
      ['OEBPS/b.xhtml', Buffer.from('<html><head><title>B</title></head><body><h1>Chapter two</h1></body></html>')],
    ]);
    seen.length = 0;
    const r = await open('resource://xiao/reader/index.html');
    const read = await m.content(r, async (bytes) => {
      const file = new File([Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0))], 'test.epub', { type: 'application/epub+zip' });
      await window.xiaoReader.open(file);
      await new Promise((ok) => setTimeout(ok, 300));
      const frame = document.getElementById('page');
      const root = frame.contentDocument.documentElement;
      const first = root.scrollLeft;
      window.xiaoReader.turn(1);
      await new Promise((ok) => setTimeout(ok, 100));
      const second = root.scrollLeft;
      const chapterOne = frame.contentDocument.body.textContent.includes('Chapter one');
      document.getElementById('chapter').value = '1';
      document.getElementById('chapter').dispatchEvent(new Event('change'));
      await new Promise((ok) => setTimeout(ok, 500));
      return { title: document.getElementById('title').textContent, first, second, chapterOne, chapterTwo: frame.contentDocument.body.textContent.includes('Chapter two'),
        script: window.scriptRan ?? null, sandbox: frame.getAttribute('sandbox') };
    }, Buffer.from(book).toString('base64'));
    check('the reader opens an EPUB, with its title and chapters', read.title === 'Test Book' && read.chapterOne && read.chapterTwo, JSON.stringify(read));
    check('a page turn moves on a screen', read.second > read.first, JSON.stringify(read));
    check('a book can\'t run scripts', read.script === null && read.sandbox === 'allow-same-origin', JSON.stringify(read));
    check('and can\'t reach the network', !seen.some((u) => /tracker/.test(u)), seen.join(' '));
    await closeTab();
    await xiao(async (Xiao) => {
      for (const id of ['sendDevice', 'noteWriting', 'reader', 'sticky']) await Xiao.setFeature({ id, on: false });
    });
  }

  if (want('silent')) {
    await xiao((Xiao) => Xiao.silent.set(true));
    await sleep(300);
    const typed = await m.chrome(async (url) => {
      const { Xiao } = ChromeUtils.importESModule('resource://xiao/XiaoCore.sys.mjs');
      const { NetUtil } = ChromeUtils.importESModule('resource://gre/modules/NetUtil.sys.mjs');
      const li = NetUtil.newChannel({ uri: url, loadUsingSystemPrincipal: true, contentPolicyType: Ci.nsIContentPolicy.TYPE_SAVEAS_DOWNLOAD }).QueryInterface(Ci.nsIHttpChannel);
      const plain = NetUtil.newChannel({ uri: url, loadUsingSystemPrincipal: true }).QueryInterface(Ci.nsIHttpChannel);
      const run = (ch) => new Promise((ok) => {
        ch.asyncOpen({ onStartRequest() {}, onDataAvailable(r, s, o, c) { const b = Cc['@mozilla.org/binaryinputstream;1'].createInstance(Ci.nsIBinaryInputStream); b.setInputStream(s); b.readBytes(c); }, onStopRequest(r, status) { ok(Components.isSuccessCode(status)); } });
      });
      return { saveAs: await run(li), background: await run(plain), on: Xiao.silent.on };
    }, 'https://example.org/').catch((e) => ({ error: String(e) }));
    check('silent mode lets "Save Link As" go out, and still stops the browser\'s own requests', typed.saveAs === true && typed.background === false, JSON.stringify(typed));
    const page = await open(`http://127.0.0.1:${port}/probe`);
    check('silent mode still loads a page you ask for', await m.content(page, () => document.title === 'probe'));
    await closeTab();
    await xiao((Xiao) => Xiao.silent.set(false));
  }

  if (want('drm')) {
    const silentDrm = await xiao(async (Xiao) => {
      await Xiao.silent.set(true);
      const before = Services.prefs.getBoolPref('media.gmp-manager.updateEnabled');
      const version = await Xiao.silent.installDrm().catch((e) => `error: ${e.message}`);
      const after = Services.prefs.getBoolPref('media.gmp-manager.updateEnabled');
      await Xiao.silent.set(false);
      return { before, version, after };
    });
    check('in silent mode the Download DRM button fetches Widevine, and only then', silentDrm.before === false && silentDrm.after === false && /^\d+\.\d+/.test(silentDrm.version), JSON.stringify(silentDrm));
  }

  // From the real public release, with no mirror. Only when asked for by name.
  if (ONLY?.split(',').includes('public')) {
    const pages = { pdf: 'resource://xiao-pdf/index.html', convert: 'resource://xiao-convert/index.html', library: 'resource://xiao-library/index.html', 'notes-ai': 'resource://xiao-notes-ai/organise.html' };
    for (const id of (process.env.PACKS ?? 'pdf,library,convert,notes-ai').split(',')) {
      const started = Date.now();
      await xiao((Xiao, id) => Xiao.setFeature({ id, on: true }), id);
      const p = await until(`${id} to download`, async () => {
        const list = await xiao(async (Xiao) => Xiao.packs.list());
        const me = list.find((x) => x.id === id);
        return (me.error || me.installed) && me;
      }, 25 * 60_000);
      check(`${id} downloads from the public release (${p.size}, ${Math.round((Date.now() - started) / 1000)} s)`, p.installed && !p.error, p.error ?? '');
      if (!p.installed) continue;
      const h = await open(pages[id]);
      await sleep(4000);
      const look = await m.content(h, () => ({ title: document.title, url: document.documentURI, text: document.body?.innerText?.length ?? 0, shown: /error|failed|could not/i.test(document.body?.innerText ?? '') ? document.body.innerText.slice(0, 200) : '' }));
      check(`${id} opens with no error on the page`, look.text > 0 && !look.shown && !/neterror|about:/.test(look.url), JSON.stringify(look));
      await closeTab();
    }
    if ((process.env.PACKS ?? 'notes-ai').includes('notes-ai')) {
      const TEXT = 'I has went to the the shop yesterday and buyed three apple, because we was out of apples at home and my sister she really wanted to make a apple pie for the party on saturday evening.';
      await xiao(async (Xiao) => {
        await Xiao.setFeature({ id: 'assist', on: true });
        await Xiao.setFeature({ id: 'noteWriting', on: true });
      });
      for (const tool of (process.env.TOOLS ?? 'fix,improve,shorten,summarize,casual').split(',')) {
        const said = await xiao(async (Xiao, tool, text) => {
          const start = Date.now();
          const out = await Xiao.rewriteNote({ tool, text }).catch((e) => `error: ${e.message}`);
          return { out, seconds: Math.round((Date.now() - start) / 1000) };
        }, tool, TEXT);
        check(`writing tool "${tool}" really changes the text, on the real model`, !said.out.startsWith('error') && said.out.trim() !== TEXT, JSON.stringify(said));
      }
    }
  }

  if (want('updates')) {
    const walk = (dir) => readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
    const kitZip = (edit) => {
      const kit = join(home, 'kit-copy');
      rmSync(kit, { recursive: true, force: true });
      cpSync(join(root, 'dist/kit'), kit, { recursive: true });
      edit?.(kit);
      return zip(walk(kit).sort().map((p) => [`xiao-kit/${relative(kit, p)}`, readFileSync(p)]));
    };
    const publish = (version, kit, key = privateKey) => {
      feed.kit = kit;
      feed.manifest = Buffer.from(JSON.stringify({ version, kit: { url: `http://127.0.0.1:${port}/kit.zip`.replace('http:', 'https:'), sha256: createHash('sha256').update(kit).digest('hex'), size: kit.length } }));
      feed.sig = sign(null, feed.manifest, key);
    };
    const checkNow = () => xiao((Xiao) => Xiao.updater.check());
    const fresh = await checkNow();
    check('no release yet: the check fails quietly', fresh.state === 'failed', JSON.stringify(fresh));

    const { privateKey: other } = generateKeyPairSync('ed25519');
    publish('9.9.9', kitZip(), other);
    const forged = await checkNow();
    check('a manifest signed by anyone else is refused', forged.state === 'failed' && /signed/.test(forged.problem), JSON.stringify(forged));

    publish('0.0.1', kitZip());
    const older = await checkNow();
    check('an older version is not offered', older.state === 'current', JSON.stringify(older));

    // https only in a real manifest; the fixture is plain http, so the test allows its own host here.
    await m.chrome(() => {
      const { Xiao } = ChromeUtils.importESModule('resource://xiao/XiaoCore.sys.mjs');
      const real = Xiao.updater.bytes.bind(Xiao.updater);
      Xiao.updater.bytes = (url) => real(url.replace('https://127.0.0.1', 'http://127.0.0.1'));
    });
    const marker = 'xiao-update-marker.txt';
    publish('9.9.9', kitZip((k) => writeFileSync(join(k, 'xiao', marker), 'new version')));
    feed.kit = feed.kit; // unchanged
    const staged = await checkNow();
    check('a signed newer version is staged, ready for the next start', staged.state === 'ready' && existsSync(join(data, 'update/ready')), JSON.stringify(staged));

    await quit();
    await launch();
    await ready();
    const appXiao = process.platform === 'darwin' ? join(home, 'Applications/Xiao.app/Contents/Resources/xiao', marker) : join(data, 'app/xiao', marker);
    const updateLog = () => (existsSync(join(data, 'update.log')) ? readFileSync(join(data, 'update.log'), 'utf8').slice(-600) : 'no update.log');
    check('the next start installs it', existsSync(appXiao), existsSync(appXiao) ? '' : updateLog());
    await until('the trying marker to clear', () => !existsSync(join(data, 'update/trying')), 30_000);
    check('a good start clears the marker', !existsSync(join(data, 'update/trying')));
    check('the old kit is kept for a rollback', existsSync(join(data, 'kit-previous/install.sh')));

    await m.chrome(() => {
      const { Xiao } = ChromeUtils.importESModule('resource://xiao/XiaoCore.sys.mjs');
      const real = Xiao.updater.bytes.bind(Xiao.updater);
      Xiao.updater.bytes = (url) => real(url.replace('https://127.0.0.1', 'http://127.0.0.1'));
    });
    publish('99.9.9', kitZip((k) => writeFileSync(join(k, 'xiao/XiaoCore.sys.mjs'), 'throw new Error("a broken release");\n')));
    const broken = await checkNow();
    check('a broken release gets staged like any other', broken.state === 'ready', JSON.stringify(broken));
    await quit();
    await launch(); // installs the broken one; Core never starts, so the marker stays
    await sleep(8000);
    check('its marker stays, as it never reached a working start', existsSync(join(data, 'update/trying')));
    await quit();
    await launch(); // the launcher sees the marker and puts the old version back
    await ready();
    check('the next start puts the working version back', existsSync(appXiao));
    check('and that version won\'t be offered again', readFileSync(join(data, 'update-refused'), 'utf8').trim() === '99.9.9');
  }
} catch (e) {
  failedToRun = e;
  console.log(`FAIL the run stopped: ${e.stack ?? e}`);
} finally {
  await quit().catch(() => {});
  try { process.kill(-launcher.pid); } catch {}
  server.close();
  await sleep(1000);
  rmSync(home, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} / ${results.length} passed${failedToRun ? ', and the run stopped early' : ''}`);
process.exit(failed.length || failedToRun ? 1 : 0);
