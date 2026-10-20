// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Turns the Zen-style prefs YAML in shared/prefs into a user.js for the kit.
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const PREFS = new URL('../shared/prefs/', import.meta.url);

export const readPrefs = (name) => parse(readFileSync(new URL(`${name}.yaml`, PREFS), 'utf8'));

// Later lists win, so strict.yaml can override balanced.yaml.
export function merge(...lists) {
  const byName = new Map();
  for (const list of lists) for (const p of list) byName.set(p.name, p.value);
  return byName;
}

export function toUserJs(prefs, header = '') {
  const lines = [...prefs].map(([name, value]) => {
    if (!['boolean', 'number', 'string'].includes(typeof value)) {
      throw new TypeError(`${name}: unsupported value ${JSON.stringify(value)}`);
    }
    return `user_pref(${JSON.stringify(name)}, ${JSON.stringify(value)});`;
  });
  return `${header}${lines.join('\n')}\n`;
}

export function buildUserJs(level) {
  const lists = [readPrefs('balanced'), readPrefs('look'), readPrefs('kit')];
  if (level === 'strict') lists.push(readPrefs('strict'));
  const header = `// xiao ${level} prefs. Generated from shared/prefs/*.yaml; re-applied at every start.\n` +
    '// Edit the YAML and reinstall rather than this file.\n\n';
  return toUserJs(merge(...lists), header);
}
