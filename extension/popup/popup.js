// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

const $ = (id) => document.getElementById(id);
const ask = (xiao, extra = {}) => browser.runtime.sendMessage({ xiao, ...extra });

function ago(t) {
  if (!t) return 'Filter lists are downloading.';
  const h = Math.round((Date.now() - t) / 3_600_000);
  return h < 1 ? 'Filter lists updated within the hour.' : `Filter lists updated ${h} h ago.`;
}

const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
let host = '';
try {
  const u = new URL(tab.url);
  if (u.protocol.startsWith('http')) host = u.hostname;
} catch {}

const s = await ask('status', { tabId: tab.id, host });
$('host').textContent = host || 'This page';
$('count').textContent = host
  ? `${s.blocked} blocked on this page, ${s.total.toLocaleString()} in total.`
  : `${s.total.toLocaleString()} ads and trackers blocked in total.`;
$('block').checked = !s.allowed;
$('block').disabled = !host;
$('block').addEventListener('change', async (e) => {
  await ask('allow', { host, on: !e.target.checked });
  await browser.tabs.reload(tab.id);
});

const inTor = tab.cookieStoreId === s.torContainer;
$('tor').textContent = s.tor.isTor
  ? (inTor ? 'This tab goes through Tor.' : 'Tor is connected.')
  : 'Tor is not connected (still starting, or xiao was installed without Tor).';
$('tor').classList.toggle('on', s.tor.isTor);
$('tor-open').hidden = !s.tor.isTor || inTor;
$('tor-open').addEventListener('click', async () => {
  await ask('openTor');
  window.close();
});
// tor picks a new exit for the site; the reload uses it.
$('tor-circuit').hidden = !inTor || !host;
$('tor-circuit').addEventListener('click', async () => {
  await ask('newCircuit', { host });
  await browser.tabs.reload(tab.id, { bypassCache: true });
  window.close();
});
$('lists').textContent = ago(s.listsAt);
