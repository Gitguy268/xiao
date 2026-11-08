import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchTabs, parseCommand, planFor } from '../core/lib/tabplan.mjs';

const now = Date.parse('2026-11-08T12:00:00Z');
const H = 3_600_000;
const tabs = [
  { id: 1, url: 'https://www.youtube.com/watch?v=a', title: 'Cats', lastAccessed: now - 1 * H },
  { id: 2, url: 'https://youtube.com/watch?v=b', title: 'Dogs', lastAccessed: now - 100 * H },
  { id: 3, url: 'https://github.com/x/y', title: 'Repo', lastAccessed: now - 2 * H, selected: true },
  { id: 4, url: 'https://github.com/x/y#readme', title: 'Repo', lastAccessed: now - 3 * H },
  { id: 5, url: 'https://news.example/recipes', title: 'Best recipes', lastAccessed: now - 80 * H, pinned: true },
  { id: 6, url: 'https://notyoutube.org/', title: 'Other', lastAccessed: now },
];

test('commands read the way people write them', () => {
  assert.deepEqual(parseCommand('Close all YouTube tabs.'), { action: 'close', filter: { text: 'youtube' } });
  assert.deepEqual(parseCommand('archive tabs older than 3 days'), { action: 'archive', filter: { olderThanHours: 72 } });
  assert.deepEqual(parseCommand('move github tabs to Work'), { action: 'move', filter: { text: 'github' }, space: 'work' });
  assert.deepEqual(parseCommand('close duplicate tabs'), { action: 'close', filter: { duplicates: true } });
  assert.deepEqual(parseCommand('group tabs by site'), { action: 'group', filter: {} });
  assert.deepEqual(parseCommand('mute the tabs from news.example'), { action: 'mute', filter: { text: 'news.example' } });
  assert.equal(parseCommand('close all tabs'), null, 'too broad');
  assert.equal(parseCommand('make me a sandwich'), null);
  assert.equal(parseCommand('move github tabs'), null, 'move needs a space');
});

test('matching never takes pinned tabs, and a site name matches its own host only', () => {
  assert.deepEqual(matchTabs(tabs, { text: 'youtube' }, now).map((t) => t.id), [1, 2]);
  assert.deepEqual(matchTabs(tabs, { text: 'recipes' }, now).map((t) => t.id), [], 'pinned stays');
  assert.deepEqual(matchTabs(tabs, { olderThanHours: 72 }, now).map((t) => t.id), [2]);
  assert.deepEqual(matchTabs(tabs, { duplicates: true }, now).map((t) => t.id), [4], 'the first copy stays');
});

test('plans leave the tab on screen open and explain a command they cannot read', () => {
  assert.deepEqual(planFor('close github tabs', tabs, now), { action: 'close', ids: [4] });
  assert.deepEqual(planFor('move youtube tabs to Watch later', tabs, now), { action: 'move', ids: [1, 2], space: 'watch later' });
  assert.equal(planFor('group tabs by site', tabs, now).bySite, true);
  assert.match(planFor('hello', tabs, now).error, /Try/);
});
