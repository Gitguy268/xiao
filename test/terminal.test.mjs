import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runCommand } from '../core/start/terminal.mjs';

const links = [{ name: 'GitHub', url: 'https://github.com' }];

test('commands answer with what to do', () => {
  assert.ok(runCommand('help').print.length > 5);
  assert.deepEqual(runCommand('notes'), { action: 'notes' });
  assert.deepEqual(runCommand('lib'), { action: 'library' });
  assert.deepEqual(runCommand('clear'), { clear: true });
  assert.deepEqual(runCommand('style retrofind'), { style: 'retrofind' });
  assert.deepEqual(runCommand('theme dark'), { theme: 'dark' });
  assert.match(runCommand('ls', links).print[0], /GitHub\s+https:\/\/github\.com/);
});

test('open takes one of your sites or any address', () => {
  assert.deepEqual(runCommand('open github', links), { go: 'https://github.com' });
  assert.deepEqual(runCommand('open example.org', links), { go: 'example.org' });
});

test('a wrong style or theme lists the right ones and changes nothing', () => {
  assert.match(runCommand('style purple').print[0], /retrofind/);
  assert.match(runCommand('theme purple').print[0], /dark/);
});

test('anything else, bangs included, is a search', () => {
  assert.deepEqual(runCommand('how do cats purr'), { search: 'how do cats purr' });
  assert.deepEqual(runCommand('!gh cats'), { search: '!gh cats' });
});
