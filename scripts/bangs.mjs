// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// npm run bangs → core/bangs.json, from Kagi's list (MIT) at a pinned commit.
// The result is committed, so a build never needs the network for it.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const COMMIT = 'd6cfe0de64d6990150a1bcfee7a31809816517d4';
const SHA256 = '97ca7d69333de389086732b895c0ea3711839cfba6eba3d957c5d0a23aec33c7';
const url = `https://raw.githubusercontent.com/kagisearch/bangs/${COMMIT}/data/bangs.json`;

// Xiao's additions, which win over Kagi's for the same name.
const OURS = { ol: 'https://openlibrary.org/search?q=%s' };

const body = await (await fetch(url)).text();
const got = createHash('sha256').update(body).digest('hex');
if (got !== SHA256) throw new Error(`bangs.json does not match its pinned hash (got ${got})`);

const flagsOf = (fmt) => {
  if (!fmt) return '';
  return [
    !fmt.includes('url_encode_placeholder') && 'r',
    !fmt.includes('url_encode_space_to_plus') && 's',
    !fmt.includes('open_base_path') && !fmt.includes('open_snap_domain') && 'n',
    fmt.includes('open_snap_domain') && 'd',
  ].filter(Boolean).join('');
};

const table = {};
for (const b of JSON.parse(body)) {
  if (!b.u?.includes('{{{s}}}') || !/^https?:\/\//.test(b.u)) continue;
  const template = b.u.replaceAll('{{{s}}}', '%s');
  const flags = flagsOf(b.fmt);
  const entry = flags ? (flags.includes('d') ? [template, flags, b.d] : [template, flags]) : template;
  for (const name of [b.t, ...(b.ts ?? [])]) table[String(name).toLowerCase()] ??= entry;
}
Object.assign(table, OURS);

const sorted = Object.fromEntries(Object.entries(table).sort(([a], [b]) => (a < b ? -1 : 1)));
writeFileSync(new URL('../core/bangs.json', import.meta.url), JSON.stringify(sorted));
console.log(`core/bangs.json: ${Object.keys(sorted).length} names`);
