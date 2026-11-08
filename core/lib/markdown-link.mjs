// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// "Copy as Markdown": a link, a page, or a quote with a link that scrolls to
// the quoted words (a text fragment, #:~:text=). Pure, node-tested.
const esc = (s) => String(s).replace(/([\\[\]])/g, '\\$1').replace(/\s+/g, ' ').trim();
const escUrl = (u) => String(u).replace(/[()\s]/g, (c) => ({ '(': '%28', ')': '%29' })[c] ?? '%20');

export function linkMarkdown(title, url) {
  return `[${esc(title) || url}](${escUrl(url)})`;
}

// The fragment names the quote's first and last few words when it is long,
// which is what browsers match on; a page's own fragment is replaced.
export function highlightUrl(url, quote) {
  const words = String(quote).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (!words.length) return url;
  const enc = (s) => encodeURIComponent(s).replace(/-/g, '%2D').replace(/,/g, '%2C');
  const text = words.length > 8 ? `${enc(words.slice(0, 4).join(' '))},${enc(words.slice(-4).join(' '))}` : enc(words.join(' '));
  return `${String(url).split('#')[0]}#:~:text=${text}`;
}

export function quoteMarkdown(quote, title, url) {
  const lines = String(quote).trim().split(/\r?\n/).map((l) => `> ${l}`.trimEnd());
  return `${lines.join('\n')}\n\n— ${linkMarkdown(title, highlightUrl(url, quote))}`;
}
