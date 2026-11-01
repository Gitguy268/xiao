// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Boards: a board is a sticky note named "Board <title>.md", in the voice
// organiser's shape (## topics, - items), so it syncs, backs up and opens
// anywhere like any note. Links are markdown links; nothing else in an item
// is ever more than text. Pure, so it is tested in node and shared by the
// board page and Xiao's "Add to Board" menu.

import { parseBoard, progress, setDone } from './organise.js';

export { parseBoard, progress, setDone };

export const PREFIX = 'Board ';
export const TOPICS = ['Links', 'Quotes', 'Notes'];
const HEADING = /^\s{0,3}#{1,6}\s+(.+?)\s*$/;
const LINK = /\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)\)/g;

export const isBoard = (name) => typeof name === 'string' && name.startsWith(PREFIX) && name.endsWith('.md');
export const boardTitle = (name) => name.slice(PREFIX.length, -3);

// A title the reader typed → the note's file name, or null.
export function boardFile(title) {
  const clean = String(title ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return clean && !/^\.+$/.test(clean) ? `${PREFIX}${clean}.md` : null;
}

export const newBoard = (title) => `# ${title}\n\n${TOPICS.map((t) => `## ${t}\n`).join('\n')}`;

const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const label = (s) => oneLine(s).replace(/[[\]]/g, '').slice(0, 200);

export const linkItem = ({ title, url }) => `[${label(title) || url}](${url})`;
export const quoteItem = ({ text, title, url }) => `“${oneLine(text).slice(0, 2000)}” — ${linkItem({ title, url })}`;

// Adds "- text" at the end of a topic, adding the topic when it is not there.
export function addItem(markdown, topic, text) {
  const item = `- ${oneLine(text)}`;
  const lines = String(markdown ?? '').replace(/\n+$/, '').split('\n');
  const at = lines.findIndex((l) => HEADING.test(l) && l.match(HEADING)[1].toLowerCase() === topic.toLowerCase() && !/^#\s/.test(l.trim()));
  if (at < 0) return `${lines.join('\n')}\n\n## ${topic}\n${item}\n`;
  let end = at + 1;
  while (end < lines.length && !HEADING.test(lines[end])) end++;
  let last = end;
  while (last > at + 1 && !lines[last - 1].trim()) last--;
  lines.splice(last, 0, item);
  return `${lines.join('\n')}\n`;
}

// An item's text as parts: plain text and links (http and https only).
export function parts(text) {
  const out = [];
  let from = 0;
  for (const m of text.matchAll(LINK)) {
    if (m.index > from) out.push({ text: text.slice(from, m.index) });
    out.push({ text: m[1] || m[2], href: m[2] });
    from = m.index + m[0].length;
  }
  if (from < text.length) out.push({ text: text.slice(from) });
  return out;
}

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// The board as one HTML file that opens anywhere: no script, nothing loaded.
export function toHtml(markdown, title) {
  const cards = parseBoard(markdown).map((t) => {
    const { done, total } = progress(t);
    const items = t.items.map((i) => {
      const body = parts(i.text).map((p) => (p.href ? `<a href="${esc(p.href)}">${esc(p.text)}</a>` : esc(p.text))).join('');
      return `<li class="${i.kind}">${i.kind === 'task' ? (i.done ? '☑ ' : '☐ ') : ''}${body}</li>`;
    }).join('');
    return `<section><h2>${esc(t.topic)}</h2>${total ? `<p>${done} of ${total} done</p>` : ''}<ul>${items}</ul></section>`;
  }).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${esc(title)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:60rem;margin:2rem auto;padding:0 1rem;color:#1d1b19;background:#faf8f5}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(16rem,1fr));gap:1rem}section{background:#fff;border:1px solid #e4dfd8;border-radius:12px;padding:0 1rem}
h2{font-size:1.1rem}ul{padding-left:1.1rem}li.question{font-style:italic}p{color:#6b645c;font-size:.9rem;margin:0}</style></head>
<body><h1>${esc(title)}</h1><main>
${cards}
</main></body></html>
`;
}
