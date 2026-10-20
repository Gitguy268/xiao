// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Ghostery's adblock engine (MPL-2.0) with xiao's per-site switch and counts.
// Filter lists (EasyList, EasyPrivacy, uBO lists...) are downloaded by the
// engine at runtime and cached; none are shipped in the extension.
import { WebExtensionBlocker } from '@ghostery/adblocker-webextension';
import { topHost } from './site.js';

const DAY = 24 * 60 * 60 * 1000;

let blocker = null;
let allowed = new Set();
const perTab = new Map();
let total = 0;
let listsAt = 0;
let retry = null;

async function load() {
  const { engine, engineAt = 0, allow = [], total: saved = 0 } =
    await browser.storage.local.get(['engine', 'engineAt', 'allow', 'total']);
  allowed = new Set(allow);
  total = saved;
  if (engine) {
    try {
      blocker = WebExtensionBlocker.deserialize(new Uint8Array(engine));
      listsAt = engineAt;
    } catch (e) {
      console.warn('xiao: cached engine unreadable, refetching', e);
    }
  }
  if (!blocker || Date.now() - engineAt > DAY) await refreshOrRetry();
}

// A failed download (offline at first start) is tried again after 1, 5 and
// 15 minutes, then by the hourly check.
async function refreshOrRetry(attempt = 0) {
  clearTimeout(retry);
  try {
    await refresh();
  } catch (e) {
    console.warn('xiao: filter lists not downloaded', e);
    const wait = [1, 5, 15][attempt];
    if (wait) retry = setTimeout(() => refreshOrRetry(attempt + 1), wait * 60_000);
  }
}

export async function refresh() {
  const fresh = await WebExtensionBlocker.fromPrebuiltAdsAndTracking(fetch);
  blocker = fresh;
  listsAt = Date.now();
  await browser.storage.local.set({ engine: fresh.serialize(), engineAt: listsAt });
}

let saving = null;
function count(tabId) {
  total++;
  saving ??= setTimeout(() => {
    saving = null;
    browser.storage.local.set({ total });
  }, 5_000);
  if (tabId === -1) return;
  const n = (perTab.get(tabId) ?? 0) + 1;
  perTab.set(tabId, n);
  browser.browserAction.setBadgeText({ tabId, text: String(n) }).catch(() => {});
}

// Requests outside a tab (tabId -1) are filtered only when a web page or its
// service worker made them, never the browser's or an extension's own.
export const fromWeb = (details) =>
  details.tabId !== -1 || /^https?:/.test(details.originUrl ?? details.documentUrl ?? '');

const skip = (details) => !blocker || !fromWeb(details) || allowed.has(topHost(details));

export function startAdblock() {
  browser.browserAction.setBadgeBackgroundColor({ color: '#e70923' });
  browser.webRequest.onBeforeRequest.addListener((details) => {
    if (details.type === 'main_frame') perTab.set(details.tabId, 0);
    if (skip(details)) return {};
    const result = blocker.onBeforeRequest(browser, details);
    if (result.cancel || result.redirectUrl) count(details.tabId);
    return result;
  }, { urls: ['http://*/*', 'https://*/*'] }, ['blocking']);
  browser.webRequest.onHeadersReceived.addListener(
    (details) => (skip(details) ? {} : blocker.onHeadersReceived(browser, details)),
    { urls: ['http://*/*', 'https://*/*'] }, ['blocking', 'responseHeaders'],
  );
  browser.tabs.onRemoved.addListener((tabId) => perTab.delete(tabId));
  setInterval(() => Date.now() - listsAt > DAY && refreshOrRetry(), 60 * 60 * 1000);
  return load();
}

// Cosmetic filtering: answers the content script (cosmetics.js).
export function cosmetics(msg, sender) {
  if (!blocker || allowed.has(new URL(sender.tab?.url ?? sender.url).hostname)) return undefined;
  return blocker.onRuntimeMessage(browser, msg, sender);
}

export function adblockStatus(tabId, host) {
  return { blocked: perTab.get(tabId) ?? 0, total, listsAt, ready: !!blocker, allowed: allowed.has(host) };
}

export async function setAllowed(host, on) {
  if (on) allowed.add(host);
  else allowed.delete(host);
  await browser.storage.local.set({ allow: [...allowed] });
}
