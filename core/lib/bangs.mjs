// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// !bangs, resolved on this computer: "!gh cats" goes straight to GitHub's
// search and no search engine ever sees it. The table is core/bangs.json, made
// by scripts/bangs.mjs from Kagi's list. An entry is a template with %s, or
// [template, flags, domain] when it differs from the usual behaviour:
//   r  put the words in unencoded          s  spaces stay %20 rather than +
//   n  with no words, open the template    d  with no words, open the domain

// "!x words", "words !x" or "!x" alone; null when it isn't a bang.
export function parseBang(text) {
  const t = String(text ?? '').trim();
  let m = /^!(\S+)(?:\s+([\s\S]*))?$/.exec(t);
  if (m) return { key: m[1].toLowerCase(), query: (m[2] ?? '').trim() };
  m = /^([\s\S]*\S)\s+!(\S+)$/.exec(t);
  return m ? { key: m[2].toLowerCase(), query: m[1].trim() } : null;
}

function encode(query, flags) {
  if (flags.includes('r')) return query;
  const coded = encodeURIComponent(query);
  return flags.includes('s') ? coded : coded.replace(/%20/g, '+');
}

// The address for a table entry and some words, or null if it can't make a web address.
export function bangUrl(entry, query) {
  const [template, flags = '', domain] = typeof entry === 'string' ? [entry] : entry;
  let url;
  if (query) url = template.replaceAll('%s', encode(query, flags));
  else if (flags.includes('d') && domain) url = `https://${domain}/`;
  else if (flags.includes('n')) url = template.replaceAll('%s', '');
  else {
    try {
      url = `${new URL(template.replaceAll('%s', '')).origin}/`;
    } catch {
      return null;
    }
  }
  return /^https?:\/\//i.test(url) ? url : null;
}

// Xiao's own bangs and the reader's come first, in that order, then the table.
// "action" entries open something in Xiao instead of a web address.
export const ACTIONS = { note: 'notes', notes: 'notes', lib: 'library', library: 'library' };

export function resolveBang(text, table, own = {}) {
  const bang = parseBang(text);
  if (!bang) return null;
  if (own[bang.key]) {
    const url = bangUrl(own[bang.key], bang.query);
    return url && { ...bang, url };
  }
  if (ACTIONS[bang.key]) return { ...bang, action: ACTIONS[bang.key] };
  const entry = table[bang.key];
  if (!entry) return null;
  const url = bangUrl(entry, bang.query);
  return url && { ...bang, url };
}

// "Your own bangs" in the start page's settings: "!x https://site/?q=%s", one a line.
export function parseOwnBangs(text) {
  const own = {};
  for (const line of String(text ?? '').split('\n')) {
    const m = /^\s*!?([^\s!]+)\s+(https?:\/\/\S*%s\S*)\s*$/i.exec(line);
    if (m) own[m[1].toLowerCase()] = m[2];
  }
  return own;
}

export const ownBangsText = (own) => Object.entries(own ?? {}).map(([k, v]) => `!${k} ${v}`).join('\n');
