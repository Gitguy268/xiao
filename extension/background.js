// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { adblockStatus, cosmetics, refresh, setAllowed, startAdblock } from './adblock.js';
import { newCircuit, startTor, torContainerId, torStatus } from './tor.js';

const ready = Promise.all([startTor(), startAdblock()]).catch((e) => console.error('xiao start', e));

async function status({ tabId, host }) {
  await ready;
  return {
    ...adblockStatus(tabId, host),
    https: (await browser.privacy.network.httpsOnlyMode.get({})).value,
    tor: await torStatus(),
    torContainer: torContainerId(),
  };
}

const handlers = {
  status,
  allow: ({ host, on }) => setAllowed(host, on),
  refreshLists: () => refresh(),
  torCheck: () => torStatus({ fresh: true }),
  newCircuit: ({ host }) => newCircuit(host),
  openTor: async ({ url }) => {
    await ready;
    return browser.tabs.create({ cookieStoreId: torContainerId(), url });
  },
};

browser.runtime.onMessage.addListener((msg, sender) => {
  if (msg.action === 'getCosmeticsFilters') return cosmetics(msg, sender);
  // Only xiao's own pages (start page, popup) may use these, not content scripts on websites.
  if (sender.url?.startsWith(browser.runtime.getURL('')) && Object.hasOwn(handlers, msg.xiao)) {
    return handlers[msg.xiao](msg);
  }
  return undefined;
});
