// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Host of the page a webRequest/proxy request belongs to (the tab's top frame).
export function topHost(details) {
  const url = details.type === 'main_frame'
    ? details.url
    : details.frameAncestors?.at(-1)?.url ?? details.documentUrl ?? details.originUrl;
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}
