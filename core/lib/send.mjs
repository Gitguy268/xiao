// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// What the Send page's local server may hand out (see ../Send.mjs): the path
// under resource://xiao/, or null. Only a plain path under the secret prefix,
// and only the Send page's own folder plus the shared stylesheet and fonts.
const PLAIN = /^[\w-]+(\.[\w-]+)*(\/[\w-]+(\.[\w-]+)*)*$/;

export function sendFile(target, prefix) {
  if (typeof target !== 'string' || !target.startsWith(prefix)) return null;
  const path = target.slice(prefix.length);
  if (!PLAIN.test(path)) return null;
  if (path === 'tokens.css' || path.startsWith('fonts/')) return path;
  return `send/${path}`;
}

const TYPES = { html: 'text/html; charset=utf-8', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', woff2: 'font/woff2' };

export const contentTypeOf = (file) => TYPES[file.split('.').pop()] ?? 'application/octet-stream';
