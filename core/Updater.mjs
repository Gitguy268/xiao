// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Xiao's own updates. Once at launch (never in silent mode, where only the
// button asks) this reads updates.json from the latest GitHub release, checks
// its Ed25519 signature against the key in this build, downloads the kit and
// checks its SHA-256, and leaves it ready in <data>/update/. xiao-launch installs
// it at the next start, and puts the old version back if that start never
// reaches this file. Builds with no launcher beside the profile never update here.
import { checkManifest, fromBase64, hexOf, isNewer, UPDATE_KEY } from './lib/updates.mjs';

const MANIFEST = 'https://github.com/Gitguy268/xiao/releases/latest/download/updates.json';
const HOSTS = ['github.com'];
const DAY = 20 * 60 * 60 * 1000;

const { AppConstants } = ChromeUtils.importESModule('resource://gre/modules/AppConstants.sys.mjs');
const env = (name) => Services.env.get(name);
const dataDir = () => PathUtils.parent(PathUtils.profileDir);
const updateDir = () => PathUtils.join(dataDir(), 'update');

export class Updater {
  state = 'idle'; // idle, checking, current, ready, failed, none

  constructor(xiao) {
    this.xiao = xiao;
  }

  get key() {
    return env('XIAO_UPDATE_TEST_KEY') || UPDATE_KEY; // the e2e signs its own
  }

  get manifestUrl() {
    return env('XIAO_UPDATE_TEST_URL') || MANIFEST;
  }

  async managed() {
    const launcher = PathUtils.join(dataDir(), AppConstants.platform === 'win' ? 'xiao-launch.ps1' : 'xiao-launch');
    return !!this.key && IOUtils.exists(launcher);
  }

  // This start got far enough: the update it may have just installed works.
  async started() {
    await IOUtils.remove(PathUtils.join(updateDir(), 'trying'), { ignoreAbsent: true });
  }

  // At launch. A day's wait, so restarting often doesn't mean asking often.
  atLaunch() {
    const { store, features, silent } = this.xiao;
    if (silent.on || features.updates === false) return;
    if (Date.now() - (store.updateAt || 0) < DAY) return;
    this.check().catch((e) => console.warn('Xiao: update check', e));
  }

  status() {
    return { state: this.state, version: this.version, running: XIAO_VERSION, problem: this.problem };
  }

  async check() {
    if (!(await this.managed())) {
      this.state = 'none';
      return this.status();
    }
    this.state = 'checking';
    this.problem = null;
    this.xiao.store.updateAt = Date.now();
    this.xiao.store.save();
    const url = this.manifestUrl;
    const hosts = [...HOSTS, new URL(url).host];
    try {
      await this.xiao.silent.asking(hosts, async () => {
        const [body, sig] = await Promise.all([this.bytes(url), this.bytes(`${url}.sig`)]);
        const key = await crypto.subtle.importKey('raw', fromBase64(this.key), 'Ed25519', false, ['verify']);
        if (!(await crypto.subtle.verify('Ed25519', key, sig, body))) throw new Error('the update is not signed by Xiao\'s key');
        const manifest = checkManifest(JSON.parse(new TextDecoder().decode(body)));
        if (manifest instanceof Error) throw manifest;
        const refused = await IOUtils.readUTF8(PathUtils.join(dataDir(), 'update-refused')).catch(() => '');
        if (!isNewer(manifest.version, XIAO_VERSION) || refused.trim() === manifest.version) {
          this.state = 'current';
          return;
        }
        await this.stage(manifest);
        this.version = manifest.version;
        this.state = 'ready';
      });
    } catch (e) {
      console.warn('Xiao: update', e);
      this.state = 'failed';
      this.problem = e.message;
    }
    return this.status();
  }

  async bytes(url) {
    const r = await fetch(url, { cache: 'no-store', credentials: 'omit' });
    if (!r.ok) throw new Error(`no update answer from ${new URL(url).host}`);
    return new Uint8Array(await r.arrayBuffer());
  }

  // Only a complete, checked kit ever gets the "ready" file the launcher looks for.
  async stage({ kit, version }) {
    const dir = updateDir();
    await IOUtils.remove(dir, { recursive: true, ignoreAbsent: true });
    await IOUtils.makeDirectory(dir, { createAncestors: true });
    const bytes = await this.bytes(kit.url);
    if (bytes.length !== kit.size || hexOf(await crypto.subtle.digest('SHA-256', bytes)) !== kit.sha256) throw new Error('the update came out damaged, so it was not kept');
    const zipPath = PathUtils.join(dir, 'kit.zip');
    await IOUtils.write(zipPath, bytes);
    const target = PathUtils.join(dir, 'new');
    await IOUtils.makeDirectory(target, { createAncestors: true });
    this.xiao.packs.unzip(zipPath, target);
    await IOUtils.remove(zipPath);
    await IOUtils.writeUTF8(PathUtils.join(dir, 'ready'), `${version}\n`);
  }
}
