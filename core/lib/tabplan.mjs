// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Tab commands in words (Dia's "manage tabs through chat", D33, done with
// rules rather than a model): "close all youtube tabs", "archive tabs older
// than 3 days", "move github tabs to Work", "mute news.example tabs",
// "close duplicate tabs", "group tabs by site". A command becomes a plan, a
// list of tabs and one action, that the page shows before anything happens.
// Pure, node-tested; core/TabCommands.mjs carries plans out.
export const ACTIONS = ['close', 'archive', 'move', 'mute', 'unmute', 'group'];

const UNITS = { minute: 1 / 60, hour: 1, day: 24, week: 168 };

export function parseCommand(text) {
  let t = String(text ?? '').trim().toLowerCase().replace(/[.!?]+$/, '').replace(/\s+/g, ' ');
  if (!t) return null;
  if (/^(group|sort|organi[sz]e) (all |my |the )?tabs by (site|domain|website)$/.test(t)) return { action: 'group', filter: {} };
  let space = null;
  const move = /^move (.+?) to (?:the )?(?:space )?"?([^"]+?)"?(?: space)?$/.exec(t);
  if (move) {
    t = `move ${move[1]}`;
    space = move[2];
  }
  const m = /^(close|archive|move|mute|unmute|group) (.*)$/.exec(t);
  if (!m) return null;
  const [, action] = m;
  let rest = m[2];
  if (action === 'move' && !space) return null;
  const filter = {};
  const older = /\b(?:older than|not used (?:for|in)|unused for(?: more than)?) (\d+) (minute|hour|day|week)s?\b/.exec(rest);
  if (older) {
    filter.olderThanHours = Number(older[1]) * UNITS[older[2]];
    rest = rest.replace(older[0], ' ');
  }
  if (/\bduplicates?\b|\bduplicate tabs\b/.test(rest)) {
    filter.duplicates = true;
    rest = rest.replace(/\bduplicates?\b/, ' ');
  }
  // what is left names the tabs: "all youtube tabs", "the tabs from github.com", "tabs about recipes"
  rest = rest.replace(/\b(all|my|the|of|every|other|open)\b/g, ' ')
    .replace(/\btabs?\b/g, ' ').replace(/\b(from|on|at|with|about|matching|containing)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
  if (rest) filter.text = rest;
  if (!filter.text && !filter.olderThanHours && !filter.duplicates) return null; // "close all tabs" is too broad to plan
  return { action, filter, ...(space && { space }) };
}

const site = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

// tabs: [{ id, url, title, lastAccessed, pinned, essential, selected }]. Pinned
// and Essential tabs are never in a plan; neither is the tab on screen for close or archive.
export function matchTabs(tabs, filter, now = Date.now()) {
  const word = filter.text?.toLowerCase();
  const seen = new Set();
  return tabs.filter((t) => {
    if (t.pinned || t.essential) return false;
    if (filter.olderThanHours && now - t.lastAccessed < filter.olderThanHours * 3_600_000) return false;
    if (word) {
      const host = site(t.url);
      const name = host.split('.').slice(-2, -1)[0] ?? '';
      if (!(host === word || host.endsWith(`.${word}`) || name === word || (t.title ?? '').toLowerCase().includes(word))) return false;
    }
    if (filter.duplicates) {
      const key = t.url.split('#')[0];
      if (!seen.has(key)) {
        seen.add(key);
        return false; // the first of each stays
      }
    }
    return true;
  });
}

export function planFor(command, tabs, now = Date.now()) {
  const c = typeof command === 'string' ? parseCommand(command) : command;
  if (!c) return { error: 'Try "close all youtube tabs", "archive tabs older than 3 days", "move github tabs to Work" or "close duplicate tabs".' };
  if (c.action === 'group' && !c.filter.text && !c.filter.olderThanHours && !c.filter.duplicates) return { action: 'group', bySite: true, ids: tabs.filter((t) => !t.pinned && !t.essential).map((t) => t.id) };
  let ids = matchTabs(tabs, c.filter, now).filter((t) => !((c.action === 'close' || c.action === 'archive') && t.selected)).map((t) => t.id);
  if (c.action === 'unmute') ids = ids.filter((id) => tabs.find((t) => t.id === id)?.muted);
  return { action: c.action, ids, ...(c.space && { space: c.space }) };
}
