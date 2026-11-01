// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The Terminal style's prompt, kept free of the page so node can test it. A
// command answers with what to print and what to do; anything else is a search.
export const STYLES = ['normal', 'glass', 'terminal', 'retrofind'];
export const THEMES = ['auto', 'light', 'dark'];

const HELP = [
  'open <name or address>   open one of your sites, or any address',
  'ls                       list your sites',
  'notes                    open your notes',
  'lib                      open the Library',
  'features                 turn features on and off',
  'settings                 edit this page',
  'style <name>             normal, glass, terminal or retrofind',
  'theme <name>             auto, light or dark',
  'clear                    clear the screen',
  '!gh cats                 go straight to a site\'s search',
  'anything else            search for it',
];

export function runCommand(line, links = []) {
  const text = line.trim();
  const [word = '', ...rest] = text.split(/\s+/);
  const arg = rest.join(' ');
  switch (word.toLowerCase()) {
    case '':
      return {};
    case 'help':
    case '?':
      return { print: HELP };
    case 'clear':
      return { clear: true };
    case 'ls':
      return { print: links.length ? links.map((l) => `${l.name.padEnd(24)} ${l.url}`) : ['No sites yet: add them with settings.'] };
    case 'notes':
    case 'note':
      return { action: 'notes' };
    case 'lib':
    case 'library':
      return { action: 'library' };
    case 'features':
      return { open: 'features' };
    case 'settings':
      return { open: 'settings' };
    case 'open': {
      if (!arg) return { print: ['open what? Try: ls'] };
      const named = links.find((l) => l.name.toLowerCase() === arg.toLowerCase());
      return { go: named?.url ?? arg };
    }
    case 'style':
      return STYLES.includes(arg) ? { style: arg } : { print: [`style: ${STYLES.join(', ')}`] };
    case 'theme':
      return THEMES.includes(arg) ? { theme: arg } : { print: [`theme: ${THEMES.join(', ')}`] };
    default:
      return { search: text };
  }
}
