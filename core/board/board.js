// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The board page: one board's topics as cards. The board is a sticky note;
// this page reads it, and writes it back through Xiao when an item is added,
// ticked or removed. Everything shown is text, except http(s) links.
import { parseBoard, parts, progress, setDone } from './model.mjs';

const $ = (id) => document.getElementById(id);
const ask = (name, data) => window.xiao.call(name, data);
let boards = [];
let current = null; // a board's file name

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

function itemNode(item, board) {
  const li = el('li', { className: item.kind });
  if (item.kind === 'task') {
    const box = el('input', { type: 'checkbox', checked: item.done, ariaLabel: item.text });
    box.addEventListener('change', () => save(setDone(board.text, item.line, box.checked)));
    li.append(box);
  }
  const text = el('span');
  for (const p of parts(item.text)) {
    text.append(p.href ? el('a', { href: p.href, target: '_blank', rel: 'noopener noreferrer', textContent: p.text }) : p.text);
  }
  const remove = el('button', { type: 'button', className: 'remove', textContent: '×', ariaLabel: `Remove “${item.text.slice(0, 60)}”`, title: 'Remove' });
  remove.addEventListener('click', () => {
    const lines = board.text.split('\n');
    lines.splice(item.line, 1);
    save(lines.join('\n'));
  });
  li.append(text, remove);
  return li;
}

function card(topic, board) {
  const { done, total } = progress(topic);
  const add = el('form', { className: 'inline add' }, el('input', { placeholder: 'Add…', maxLength: 2000, ariaLabel: `Add to ${topic.topic}`, autocomplete: 'off' }));
  add.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = add.querySelector('input');
    if (!input.value.trim()) return;
    await ask('board.add', { board: current, topic: topic.topic, text: input.value });
    input.value = '';
    await refresh();
    document.querySelector(`input[aria-label="Add to ${CSS.escape(topic.topic)}"]`)?.focus();
  });
  return el('section', { className: 'card' },
    el('h2', { textContent: topic.topic }),
    ...(total ? [el('p', { className: 'soft', textContent: `${done} of ${total} done` }), el('progress', { max: total, value: done })] : []),
    el('ul', {}, ...topic.items.map((i) => itemNode(i, board))),
    add);
}

function render() {
  $('boards').replaceChildren(...boards.map((b) => el('option', { value: b.name, textContent: b.title, selected: b.name === current })));
  const board = boards.find((b) => b.name === current);
  $('title').textContent = board ? board.title : 'Boards';
  document.title = board ? `${board.title} · Boards` : 'Boards';
  for (const id of ['boards', 'export-md', 'export-html', 'topic-name']) $(id).disabled = !board;
  if (!board) {
    $('cards').replaceChildren(el('p', { className: 'soft', textContent: 'No boards yet. Name one above, then use "Add to Board" in a page\'s menu, or add to it here.' }));
    return;
  }
  // topics with nothing in them still get a card, so there is somewhere to add
  const topics = parseBoard(board.text);
  for (const line of board.text.split('\n')) {
    const h = line.match(/^\s{0,3}#{2,6}\s+(.+?)\s*$/);
    if (h && !topics.some((t) => t.topic === h[1])) topics.push({ topic: h[1], items: [] });
  }
  $('cards').replaceChildren(...topics.map((t) => card(t, board)));
}

async function refresh() {
  boards = await ask('board.list');
  if (!boards.some((b) => b.name === current)) current = boards[0]?.name ?? null;
  render();
}

async function save(text) {
  await ask('board.save', { board: current, text });
  await refresh();
}

function download(name, type, text) {
  const a = el('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

$('boards').addEventListener('change', (e) => {
  current = e.target.value;
  render();
});
$('new-board').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    current = await ask('board.create', { title: $('new-title').value });
    $('new-title').value = '';
    await refresh();
  } catch (err) {
    $('note').textContent = String(err.message ?? err);
  }
});
$('new-topic').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('topic-name').value.replace(/\s+/g, ' ').trim();
  const board = boards.find((b) => b.name === current);
  if (!name || !board) return;
  await save(`${board.text.replace(/\n+$/, '')}\n\n## ${name}\n`);
  $('topic-name').value = '';
});
$('export-md').addEventListener('click', () => {
  const board = boards.find((b) => b.name === current);
  if (board) download(`${board.title}.md`, 'text/markdown', board.text);
});
$('export-html').addEventListener('click', async () => {
  const board = boards.find((b) => b.name === current);
  if (board) download(`${board.title}.html`, 'text/html', await ask('board.html', { board: current }));
});
// "Add to Board" from another tab changes the note: show it on coming back
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refresh());

refresh().catch((err) => {
  $('note').textContent = String(err.message ?? err);
});
