// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The pure half of the sticky notes (see ../Notes.mjs). A note is a markdown
// file in a folder, the format textarea's folder sync reads and writes: an
// optional front matter block, then the text. Xiao shows and edits the text
// and leaves a block it finds exactly as it was; the file's new mtime is what
// tells textarea the note changed.

// The front matter block (with its closing fence) and the text after it.
export function splitNote(source) {
  const s = String(source ?? '').replace(/^﻿/, '').replace(/\r\n/g, '\n');
  if (s.startsWith('---\n')) {
    const end = s.indexOf('\n---\n', 3);
    if (end !== -1) return { head: s.slice(0, end + 5), text: s.slice(end + 5) };
  }
  return { head: '', text: s };
}

// A note's own file name, never a path: what list() handed out, or nothing.
export const safeName = (name) => typeof name === 'string' && /^[^/\\:\0]{1,120}\.md$/.test(name) && !name.startsWith('.');

// A file name for a new note: its first line, made safe, not yet taken.
export function nameFor(text, taken) {
  const first = String(text ?? '').split('\n').find((l) => l.trim()) ?? '';
  const base = first.replace(/^#+\s*/, '').replace(/[/\\:*?"<>|\0]/g, '-').replace(/^\.+/, '').trim().slice(0, 60) || 'Note';
  const lower = new Set([...taken].map((n) => n.toLowerCase())); // macOS folders ignore case
  let name = `${base}.md`;
  for (let n = 2; lower.has(name.toLowerCase()); n++) name = `${base} (${n}).md`;
  return name;
}

// The note kept for one website ("Note for this site"): named after its host.
export const siteName = (host) => (/^[\w.-]{1,100}$/.test(host ?? '') ? `${host}.md` : null);

// #tags in a note, as textarea tints them: a # after a space or line start, then
// a letter or digit. Headings ("# Title") have a space, so they don't count.
export const tagsOf = (text) => [...new Set([...String(text ?? '').matchAll(/(?:^|\s)(#[\p{L}\p{N}][\p{L}\p{N}_-]*)/gu)].map((m) => m[1].toLowerCase()))];

export const allTags = (notes) => [...new Set(notes.flatMap((n) => tagsOf(n.text)))].sort();
