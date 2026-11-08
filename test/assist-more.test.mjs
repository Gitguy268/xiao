import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applySkill, askAcrossMessages, chatEntry, isSkill, newSkillNote, numberAcross, skillFile, skillName, skillPrompt } from '../core/lib/assist-more.mjs';

test('skills are notes named "Skill <name>.md"', () => {
  assert.equal(skillFile('For kids'), 'Skill For kids.md');
  assert.equal(skillFile('a/b:c'), 'Skill a b c.md');
  assert.equal(skillFile('  '), null);
  assert.ok(isSkill('Skill For kids.md'));
  assert.ok(!isSkill('Board Trip.md'));
  assert.equal(skillName('Skill For kids.md'), 'for-kids');
  assert.equal(skillPrompt('# For kids\n\nExplain it to a ten-year-old.'), 'Explain it to a ten-year-old.');
  assert.equal(newSkillNote('Kids', ' Explain   simply. '), '# Kids\n\nExplain simply.\n');
  assert.throws(() => newSkillNote('Kids', ''), /what the skill should do/);
});

test('"/name" runs a skill; anything else is a plain question', () => {
  const skills = [{ name: 'for-kids', prompt: 'Explain it to a ten-year-old.' }];
  assert.deepEqual(applySkill('/for-kids why is the sky blue', skills), { question: 'Explain it to a ten-year-old.\n\nwhy is the sky blue', skill: 'for-kids', asked: 'why is the sky blue' });
  assert.equal(applySkill('/for-kids', skills).question, 'Explain it to a ten-year-old.\n\nDo this for the page.');
  assert.deepEqual(applySkill('/nope hi', skills), { question: '/nope hi', skill: null });
});

test('passages from several pages are numbered across them and keep their page', () => {
  const ev = numberAcross([{ title: 'A', passages: [{ n: 1, text: 'a1' }, { n: 2, text: 'a2' }] }, { title: 'B', passages: [{ n: 1, text: 'b1' }] }]);
  assert.deepEqual(ev, [{ n: 1, text: 'a1', source: 0 }, { n: 2, text: 'a2', source: 0 }, { n: 3, text: 'b1', source: 1 }]);
  const [sys, user] = askAcrossMessages('compare', ev, ['A', 'B'], 'Answer in Dutch.   Short.');
  assert.match(sys.content, /style only.*Answer in Dutch\. Short\./);
  assert.match(user.content, /\(2\) B/);
  assert.match(user.content, /\[3\] \(page 2\) b1/);
  assert.doesNotMatch(askAcrossMessages('q', ev, ['A', 'B'])[0].content, /style/);
});

test('a saved chat names its question, time and pages', () => {
  const md = chatEntry({ question: 'What is it?', answer: 'A thing [1].', titles: ['Page [x]'], urls: ['https://x.org/'], at: Date.parse('2026-11-08T10:00:00Z') });
  assert.equal(md, '## What is it?\n\n2026-11-08 10:00 · [Page x](https://x.org/)\n\nA thing [1].\n');
});
