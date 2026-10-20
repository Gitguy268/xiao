// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The start page is what a new tab, the Home button and a fresh start show.
// These are set as defaults, not user prefs, so the two choices on the start
// page ("A new tab opens", "When Xiao starts") are kept across restarts.

export const START_URL = 'resource://xiao/start/index.html';

const NEWTAB = 'zen.urlbar.replace-newtab'; // true: Zen's floating address bar instead of a page
const LAUNCH = 'browser.startup.page'; // 1: home page, 3: last session

export function setDefaults() {
  const d = Services.prefs.getDefaultBranch('');
  d.setBoolPref(NEWTAB, false);
  d.setIntPref(LAUNCH, 1);
  d.setStringPref('browser.startup.homepage', START_URL);
  // Xiao 0.1's extension set its own start page as the user's home page.
  if (Services.prefs.getStringPref('browser.startup.homepage', '').startsWith('moz-extension://')) {
    Services.prefs.clearUserPref('browser.startup.homepage');
  }
  forgetExtensionPrefs();
}

// Xiao 0.1's user.js let the official Zen load its unsigned extension. user.js
// no longer sets these, but Firefox keeps them in prefs.js, so put them back
// to Firefox's own values (only if they are still exactly what 0.1 set).
const OLD = [['xpinstall.signatures.required', false], ['extensions.autoDisableScopes', 0], ['extensions.enabledScopes', 15]];
function forgetExtensionPrefs() {
  for (const [name, value] of OLD) {
    if (!Services.prefs.prefHasUserValue(name)) continue;
    const now = typeof value === 'boolean' ? Services.prefs.getBoolPref(name) : Services.prefs.getIntPref(name);
    if (now === value) Services.prefs.clearUserPref(name);
  }
}

export function choicesFromPrefs() {
  return {
    newtab: Services.prefs.getBoolPref(NEWTAB, false) ? 'floating' : 'start',
    launch: Services.prefs.getIntPref(LAUNCH, 1) === 3 ? 'restore' : 'start',
  };
}

export function applyChoices({ newtab, launch }) {
  Services.prefs.setBoolPref(NEWTAB, newtab === 'floating');
  Services.prefs.setIntPref(LAUNCH, launch === 'restore' ? 3 : 1);
  for (const name of [NEWTAB, LAUNCH]) {
    if (!Services.prefs.prefHasDefaultValue(name)) continue;
    const d = Services.prefs.getDefaultBranch('');
    const same = name === NEWTAB ? d.getBoolPref(name) === Services.prefs.getBoolPref(name)
      : d.getIntPref(name) === Services.prefs.getIntPref(name);
    if (same) Services.prefs.clearUserPref(name);
  }
}
