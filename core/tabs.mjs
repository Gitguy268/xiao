// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// In Zen, gBrowser.tabs holds only the space on screen (and Essentials).
// Work that is about every tab (sleep, archive, export, finding a tab) uses
// this instead; work about what the reader sees keeps gBrowser.tabs.
export const everyTab = (win) => [...(win.gZenWorkspaces?.allStoredTabs ?? win.gBrowser.tabs)];
