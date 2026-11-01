// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The pure half of silent mode (see ../Silent.mjs): which prefs to set, and
// what to put back. `prefs` is { read(name) → value or undefined, write(name,
// value), clear(name) }, so the tests need no browser.

// Every pref in the list takes its silent value. Returns what each held
// before; undefined means it held only its default.
export function engage(list, prefs) {
  const saved = {};
  for (const { name, value } of list) {
    saved[name] = prefs.read(name);
    prefs.write(name, value);
  }
  return saved;
}

// Only values the list set are touched, so a pref the reader changed by hand
// while silent mode was on stays as they left it.
export function release(list, saved, prefs) {
  for (const { name, value } of list) {
    if (prefs.read(name) !== value) continue;
    if (saved?.[name] === undefined) prefs.clear(name);
    else prefs.write(name, saved[name]);
  }
}

const LOCAL = /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?)$/;

// Is this a request the browser is making for itself? A tab's page and whatever
// that page loads are the reader's; so are the hosts of something they just
// asked for (a download, "Update filters now"), and wherever those redirect.
// { system, content, host, redirectedFrom: [host] }; asked: Set of hosts.
export function isBackground({ system, content, host, redirectedFrom = [] }, asked) {
  if (!system || content || LOCAL.test(host)) return false;
  return !asked.has(host) && !redirectedFrom.some((h) => asked.has(h));
}
