import assert from 'node:assert/strict';
import { test } from 'node:test';
import { highlightUrl, linkMarkdown, quoteMarkdown } from '../core/lib/markdown-link.mjs';

test('links come out as Markdown that survives brackets and parentheses', () => {
  assert.equal(linkMarkdown('A [b] c', 'https://x.org/a_(b)'), '[A \\[b\\] c](https://x.org/a_%28b%29)');
  assert.equal(linkMarkdown('', 'https://x.org/'), '[https://x.org/](https://x.org/)');
});

test('a quote links to its own words on the page', () => {
  assert.equal(highlightUrl('https://x.org/p#top', 'the quick-brown fox'), 'https://x.org/p#:~:text=the%20quick%2Dbrown%20fox');
  const long = highlightUrl('https://x.org/p', 'one two three four five six seven eight nine ten');
  assert.equal(long, 'https://x.org/p#:~:text=one%20two%20three%20four,seven%20eight%20nine%20ten');
  assert.equal(quoteMarkdown('line one\nline two', 'Page', 'https://x.org/p'), '> line one\n> line two\n\n— [Page](https://x.org/p#:~:text=line%20one%20line%20two)');
});
