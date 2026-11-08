import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkSource } from '../core/Calendar.mjs';

test('calendar addresses: https and webcal, or an .ics file', () => {
  assert.equal(checkSource('webcal://p01.example/cal.ics'), 'https://p01.example/cal.ics');
  assert.equal(checkSource(' https://cal.example/secret/basic.ics '), 'https://cal.example/secret/basic.ics');
  assert.equal(checkSource('/Users/me/work.ics'), '/Users/me/work.ics');
  assert.equal(checkSource(''), '');
  assert.throws(() => checkSource('http://cal.example/x.ics'), /https/);
  assert.throws(() => checkSource('file:///etc/passwd'), /https/);
});
