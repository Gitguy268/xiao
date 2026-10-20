// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// What Blocker.sys.mjs needs to know about a network request, worked out
// from plain values so node can test it. Blocker reads the values from the
// channel's nsILoadInfo.

// nsIContentPolicy TYPE_* name → the request type Ghostery's filters use
// (the same names WebExtensions' webRequest gives them).
const TYPES = {
  TYPE_DOCUMENT: 'main_frame',
  TYPE_SUBDOCUMENT: 'sub_frame',
  TYPE_STYLESHEET: 'stylesheet',
  TYPE_SCRIPT: 'script',
  TYPE_IMAGE: 'image',
  TYPE_IMAGESET: 'imageset',
  TYPE_OBJECT: 'object',
  TYPE_OBJECT_SUBREQUEST: 'object_subrequest',
  TYPE_XMLHTTPREQUEST: 'xmlhttprequest',
  TYPE_FETCH: 'xmlhttprequest',
  TYPE_BEACON: 'beacon',
  TYPE_PING: 'ping',
  TYPE_FONT: 'font',
  TYPE_MEDIA: 'media',
  TYPE_WEBSOCKET: 'websocket',
  TYPE_CSP_REPORT: 'csp_report',
  TYPE_XSLT: 'xslt',
  TYPE_WEB_MANIFEST: 'web_manifest',
  TYPE_SPECULATIVE: 'speculative',
};

// policyTypes: the nsIContentPolicy interface (or any { TYPE_*: number }).
export function typeNames(policyTypes) {
  const byNumber = new Map();
  for (const [name, type] of Object.entries(TYPES)) {
    if (typeof policyTypes[name] === 'number') byNumber.set(policyTypes[name], type);
  }
  return (n) => byNumber.get(n) ?? 'other';
}

export function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

const WEB = /^https?:/;

// info: { url, type, frameUrl (the document making the request), topUrl
// (the tab's page, if there is a tab), system (made by the browser itself) }
//
// The page a request belongs to: a tab's top page, or for a service worker
// (no tab) the site that registered it.
export function pageOf(info) {
  if (info.type === 'main_frame') return info.url;
  return info.topUrl && WEB.test(info.topUrl) ? info.topUrl : info.frameUrl ?? '';
}

// Filter only what web pages ask for: requests the browser makes for itself
// (updates, Xiao's own engine download) or for its own pages are left alone.
export function fromWeb(info) {
  if (info.system && info.type !== 'main_frame') return false;
  return WEB.test(pageOf(info));
}

// The raw details Ghostery's Request.fromRawDetails expects.
export function ghosteryDetails(info) {
  const sourceUrl = info.type === 'main_frame' ? undefined : info.frameUrl || info.topUrl;
  return sourceUrl ? { url: info.url, type: info.type, sourceUrl } : { url: info.url, type: info.type };
}
