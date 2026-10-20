// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Renders the built website in Zen (Firefox's engine) and saves full-page
// screenshots: desktop and phone width, light and dark. It also reports any
// page that is wider than the window (a horizontal scrollbar) and any console
// error. Uses a throwaway Zen profile with Marionette on port 2829.
//
//   npm run site:build && node test/e2e/site-shots.mjs [out dir]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { Marionette } from './marionette.mjs';

const root = new URL('../..', import.meta.url).pathname;
const dist = join(root, 'site/dist');
const out = process.argv[2] ?? join(root, 'test/e2e/out/site');
const zen = process.env.ZEN ?? '/Applications/Zen.app/Contents/MacOS/zen';
const PAGES = ['', 'download/', 'privacy/', 'release-notes/', 'about/'];
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.xml': 'application/xml' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// GitHub Pages serves the site under /xiao/.
const server = http.createServer((req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/xiao/, '');
  let file = join(dist, path);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!file.startsWith(dist) || !existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/xiao/`;

const profile = mkdtempSync(join(tmpdir(), 'xiao-site-'));
writeFileSync(join(profile, 'user.js'), 'user_pref("marionette.port", 2829);\nuser_pref("browser.shell.checkDefaultBrowser", false);\n');
const browser = spawn(zen, ['-profile', profile, '-no-remote', '--marionette', '--remote-allow-system-access', '--headless'], {
  env: { ...process.env, MOZ_HEADLESS_WIDTH: '1440', MOZ_HEADLESS_HEIGHT: '900' }, stdio: 'ignore',
});
const problems = [];
let m;
try {
  m = await Marionette.connect(2829, 60_000);
  mkdirSync(out, { recursive: true });
  const { value: handle } = await m.send('WebDriver:GetWindowHandle');
  for (const [size, width, height] of [['desktop', 1440, 900], ['phone', 390, 844]]) {
    await m.send('WebDriver:SetWindowRect', { width, height });
    for (const [theme, override] of [['light', 1], ['dark', 0]]) {
      await m.send('Marionette:SetContext', { value: 'chrome' });
      await m.eval((o) => Services.prefs.setIntPref('layout.css.prefers-color-scheme.content-override', o), [override]);
      for (const page of PAGES) {
        await m.send('Marionette:SetContext', { value: 'content' });
        await m.send('WebDriver:Navigate', { url: base + page });
        // Scroll through so every section has revealed, then back to the top.
        const wide = await m.eval(async () => {
          for (let y = 0; y < document.body.scrollHeight; y += 400) {
            scrollTo(0, y);
            await new Promise((r) => setTimeout(r, 60));
          }
          await new Promise((r) => setTimeout(r, 900));
          scrollTo(0, 0);
          // A full-page picture paints everything at once; content-visibility would leave far sections blank.
          document.head.insertAdjacentHTML('beforeend', '<style>main > section { content-visibility: visible !important; }</style>');
          await new Promise((r) => setTimeout(r, 300));
          return document.documentElement.scrollWidth > innerWidth + 1 ? document.documentElement.scrollWidth : 0;
        }, []);
        if (wide) problems.push(`${page || 'home'} (${size}): ${wide}px wide in a ${width}px window`);
        const name = `${(page || 'home').replace(/\/$/, '')}-${size}-${theme}.png`;
        const { value } = await m.send('WebDriver:TakeScreenshot', { full: true, hash: false });
        writeFileSync(join(out, name), Buffer.from(value, 'base64'));
      }
    }
  }
  await m.send('Marionette:SetContext', { value: 'chrome' });
  const errors = await m.eval(() => Services.console.getMessageArray()
    .filter((e) => e instanceof Ci.nsIScriptError && !(e.flags & Ci.nsIScriptError.warningFlag) && /127\.0\.0\.1/.test(e.sourceName))
    .map((e) => `${e.errorMessage} (${e.sourceName}:${e.lineNumber})`), []);
  problems.push(...new Set(errors));
  void handle;
} finally {
  m?.close();
  browser.kill();
  server.close();
  await sleep(1500);
  rmSync(profile, { recursive: true, force: true });
}
console.log(problems.length ? `Problems:\n- ${problems.join('\n- ')}` : 'No horizontal scroll, no console errors.');
console.log(`Screenshots in ${out}`);
process.exit(problems.length ? 1 : 0);
