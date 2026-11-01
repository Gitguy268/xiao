// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Fingerprint noise and the fake camera: the choices. XiaoChild applies them
// in each frame before the page's own scripts run. The seed lives only in
// memory, so every start of Xiao gives every site a different fingerprint.
const KEY = 'xiao:shield';

export class Shield {
  constructor(xiao) {
    this.xiao = xiao;
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    this.seed = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    this.publish();
  }

  get store() {
    return this.xiao.store;
  }

  // Read by every content process (XiaoChild), so nothing here is per-page.
  publish() {
    const { features } = this.xiao;
    Services.ppmm.sharedData.set(KEY, {
      seed: this.seed,
      on: features.shield !== false,
      off: [...this.store.shieldOff],
      camera: features.fakeCamera === true ? [...this.store.cameraSites] : [],
    });
    Services.ppmm.sharedData.flush();
  }

  isOn(site) {
    return !this.store.shieldOff.has(site);
  }

  setSite(site, on) {
    if (on) this.store.shieldOff.delete(site);
    else this.store.shieldOff.add(site);
    this.store.save();
    this.publish();
  }

  hasCamera(site) {
    return this.store.cameraSites.has(site);
  }

  setCamera(site, on) {
    if (on) this.store.cameraSites.add(site);
    else this.store.cameraSites.delete(site);
    this.store.save();
    this.publish();
  }
}
