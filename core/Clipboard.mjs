// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Clipboard history, after Maccy (the idea only): what you copy from pages in
// Xiao, kept on this computer. Off until switched on. XiaoChild reports a copy
// or cut, never its text, and never from a password field, a private window or
// a Tor tab; only then is the clipboard read, once.
import { addClip } from './lib/clips.mjs';

export const CLIPBOARD_URL = 'resource://xiao/clipboard/index.html';
const FILE = () => PathUtils.join(PathUtils.profileDir, 'xiao-clipboard.json');
const KEY = 'xiao:clipboard';

export class Clipboard {
  clips = [];

  constructor(xiao) {
    this.xiao = xiao;
  }

  async start() {
    this.publish();
    if (!this.on) return;
    this.clips = await IOUtils.readJSON(FILE()).catch(() => []);
  }

  get on() {
    return this.xiao.features.clipboard === true;
  }

  publish() {
    Services.ppmm.sharedData.set(KEY, this.on);
    Services.ppmm.sharedData.flush();
  }

  async set(on) {
    this.publish();
    if (on) this.clips = await IOUtils.readJSON(FILE()).catch(() => []);
    else await this.clear();
  }

  read(win) {
    const trans = Cc['@mozilla.org/widget/transferable;1'].createInstance(Ci.nsITransferable);
    trans.init(null);
    trans.addDataFlavor('text/plain');
    Services.clipboard.getData(trans, Ci.nsIClipboard.kGlobalClipboard, win?.browsingContext?.currentWindowContext ?? null);
    const value = {};
    trans.getTransferData('text/plain', value);
    return value.value?.QueryInterface(Ci.nsISupportsString).data ?? '';
  }

  // The copy has happened by the next turn of the event loop, once the event has finished.
  copied(browsingContext) {
    const bc = browsingContext;
    if (!this.on || bc.usePrivateBrowsing || bc.originAttributes.userContextId === this.xiao.tor.torId) return;
    setTimeout(() => {
      try {
        this.clips = addClip(this.clips, this.read(bc.topChromeWindow), Date.now());
        this.save();
      } catch (e) {
        console.warn('Xiao: clipboard', e);
      }
    }, 50);
  }

  save() {
    return IOUtils.writeJSON(FILE(), this.clips, { tmpPath: `${FILE()}.tmp` }).catch((e) => console.error('Xiao: clipboard', e));
  }

  page(name, data) {
    if (!this.on) throw new Error('Clipboard history is off.');
    if (name === 'clip.list') return this.clips;
    if (name === 'clip.copy') {
      const clip = this.clips.find((c) => c.at === data?.at);
      if (clip) Cc['@mozilla.org/widget/clipboardhelper;1'].getService(Ci.nsIClipboardHelper).copyString(clip.text);
      return !!clip;
    }
    if (name === 'clip.remove') {
      this.clips = this.clips.filter((c) => c.at !== data?.at);
      this.save();
      return this.clips;
    }
    if (name === 'clip.clear') return this.clear().then(() => []);
    throw new Error(`unknown call ${name}`);
  }

  async clear() {
    this.clips = [];
    await IOUtils.remove(FILE(), { ignoreAbsent: true });
  }
}
