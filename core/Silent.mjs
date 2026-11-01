// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Silent mode: while it is on, nothing leaves this computer unless the reader
// asked for it. The prefs (shared/prefs/zero.yaml, put in by scripts/build.mjs)
// are set again at every start, before any window, because user.js restores
// its own values first. Prefs can't stop everything (release builds ignore the
// Remote Settings server pref), so while it is on every request the browser
// makes for itself is also cancelled before it leaves. A file in the profile tells xiao-launch to leave Tor
// and Xiao Search stopped, since both connect out as soon as they start.
import { engage, isBackground, release } from './lib/silent.mjs';

const ON = 'xiao.zero';
const SAVED = 'xiao.zero.saved';
const FLAG = () => PathUtils.join(PathUtils.profileDir, 'xiao-zero');

const access = {
  read(name) {
    const b = Services.prefs;
    if (!b.prefHasUserValue(name)) return undefined;
    const type = b.getPrefType(name);
    return type === b.PREF_BOOL ? b.getBoolPref(name) : type === b.PREF_INT ? b.getIntPref(name) : b.getStringPref(name);
  },
  write(name, value) {
    const b = Services.prefs;
    if (typeof value === 'boolean') b.setBoolPref(name, value);
    else if (typeof value === 'number') b.setIntPref(name, value);
    else b.setStringPref(name, value);
  },
  clear(name) {
    Services.prefs.clearUserPref(name);
  },
};

export class Silent {
  get on() {
    return Services.prefs.getBoolPref(ON, false);
  }

  asked = new Map(); // host → how many things the reader asked for are using it

  start() {
    if (!this.on) return;
    for (const { name, value } of XIAO_SILENT_PREFS) access.write(name, value);
    this.watch(true);
    this.flag(true);
  }

  watch(on) {
    if (on === !!this.watching) return;
    this.watching = on;
    if (on) Services.obs.addObserver(this, 'http-on-opening-request');
    else Services.obs.removeObserver(this, 'http-on-opening-request');
  }

  observe(channel) {
    try {
      channel.QueryInterface(Ci.nsIHttpChannel);
      const li = channel.loadInfo;
      const stop = isBackground({
        system: !!li.triggeringPrincipal?.isSystemPrincipal,
        content: !!li.browsingContext?.isContent,
        host: channel.URI.host,
        redirectedFrom: li.redirectChain.map((e) => e.principal?.URI?.host).filter(Boolean),
      }, new Set(this.asked.keys()));
      if (stop) channel.cancel(Cr.NS_ERROR_ABORT);
    } catch (e) {
      console.error('Xiao: silent mode', e);
    }
  }

  // Runs something the reader asked for, which may reach these hosts until it ends.
  async asking(hosts, run) {
    for (const h of hosts) this.asked.set(h, (this.asked.get(h) ?? 0) + 1);
    try {
      return await run();
    } finally {
      for (const h of hosts) {
        const n = this.asked.get(h) - 1;
        if (n) this.asked.set(h, n);
        else this.asked.delete(h);
      }
    }
  }

  async set(on) {
    if (on === this.on) return;
    if (on) Services.prefs.setStringPref(SAVED, JSON.stringify(engage(XIAO_SILENT_PREFS, access)));
    else {
      release(XIAO_SILENT_PREFS, JSON.parse(Services.prefs.getStringPref(SAVED, '{}')), access);
      Services.prefs.clearUserPref(SAVED);
    }
    Services.prefs.setBoolPref(ON, on);
    this.watch(on);
    await this.flag(on);
  }

  flag(on) {
    return (on ? IOUtils.writeUTF8(FLAG(), 'Xiao is in silent mode.\n') : IOUtils.remove(FLAG(), { ignoreAbsent: true }))
      .catch((e) => console.error('Xiao: silent mode flag', e));
  }
}
