// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The pure half of fingerprint noise (see ../Shield.mjs and XiaoChild), after
// Brave's "farbling": what a site can measure is nudged by an amount that stays
// the same on that site until the browser restarts and differs on every other
// site, so pages work and a measurement can't follow you from site to site.

// FNV-1a: only spreads a seed and a site name over 32 bits, it guards no secret.
export function hash32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Mulberry32: a repeatable stream of numbers in [0, 1).
export function rngFrom(salt) {
  let a = salt >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const siteSalt = (seed, site) => hash32(`${seed}|${site}`);

// A core count no higher than the real one, as Brave does: claiming more than
// the machine has can make a site start more workers than it can run.
export function pickCores(salt, real) {
  const top = Math.max(2, Math.floor(real) || 2);
  return 2 + Math.floor(rngFrom(salt ^ 0x51ed270b)() * (top - 1));
}

// Up to PIXELS pixels change one colour by one step: invisible, and enough to
// change any hash of the image. Fully transparent pixels stay as they are, so
// a page testing what it drew still sees its shapes.
const PIXELS = 64;

export function farblePixels(data, salt) {
  const count = Math.floor(data.length / 4);
  if (!count) return data;
  const rng = rngFrom(salt ^ 0x2f6e2b1);
  for (let n = 0; n < Math.min(PIXELS, count); n++) {
    const at = Math.floor(rng() * count) * 4;
    const channel = Math.floor(rng() * 3);
    const up = rng() < 0.5;
    if (data[at + 3] === 0) continue;
    const v = data[at + channel];
    data[at + channel] = up ? (v < 255 ? v + 1 : v - 1) : (v > 0 ? v - 1 : v + 1);
  }
  return data;
}

const MOST = 4096;

// Nudges up to MOST evenly spread samples by a few parts in a million: far too
// little to hear, and enough to change any hash of them. The change depends only
// on the salt and the position, so reading the same audio twice agrees.
export function farbleSamples(samples, salt) {
  const stride = Math.max(1, Math.floor(samples.length / MOST));
  for (let i = 0; i < samples.length; i += stride) {
    const r = rngFrom(salt ^ Math.imul(i + 1, 0x9e3779b1))();
    samples[i] *= 1 + (r - 0.5) * 8e-6;
  }
  return samples;
}
