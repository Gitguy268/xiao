// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Tidy names: what a file could be called instead, and whether a name the
// reader typed is safe to use. Rules only, and they hold back when they have
// nothing to go on: they never guess a subject, a date, an amount or a person.
// A model's suggestion (later, optional) goes through checkName like anyone's.
//
//   "download (7).pdf" + page title "Conference schedule | Example" → "Conference schedule.pdf"
//   "Annual_report_2026-final.pdf"  → "Annual report 2026-final.pdf"
//   "IMG_1042.PNG"                  → stays: a camera's name says nothing more
import { extensionOf, isProgram } from './library.mjs';
import { safeName } from './library-protocol.mjs';

// Names that say nothing about the file: what a site or browser calls a file
// when it has no better idea.
const OPAQUE = /^(download|file|document|untitled|unnamed|attachment|export|image|scan|output|data|invoice|getfile|view|index|temp|tmp)$/i;
const MACHINE = /^([0-9a-f]{12,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Za-z0-9_-]{20,})$/;
const CAMERA = /^(IMG|DSC|DSCN|DCIM|PXL|MVIMG|VID|MOV|GOPR|DJI|Screenshot|Screen Shot|Scan)[ _-]?\d/i;
// what browsers and systems add to tell copies apart
const COPY = /(\s*\(\d{1,3}\)|\s+-\s+copy(\s*\d+)?|\s+copy(\s+\d+)?)+$/i;

export function splitName(name) {
  const ext = extensionOf(name);
  return ext ? { base: name.slice(0, -(ext.length + 1)), ext: name.slice(-ext.length) } : { base: name, ext: '' };
}

const join = (base, ext) => (ext ? `${base}.${ext}` : base);

// A page title as a file name: no site name tacked on, no unread counts, no
// characters a file name can't hold.
export function cleanTitle(title) {
  if (typeof title !== 'string') return '';
  let t = title.normalize('NFC').replace(/^\(\d+\+?\)\s*/, '').replace(/\s+/g, ' ').trim();
  // "Subject | Site", "Subject - Site", "Subject — Site": keep the subject when it is the longer part
  const parts = t.split(/\s+[|·—–-]\s+/);
  if (parts.length > 1 && parts[0].length >= Math.max(...parts.slice(1).map((p) => p.length))) t = parts[0];
  return t.replace(/[/\\:*?"<>|\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').replace(/[. ]+$/, '').trim().slice(0, 120);
}

// A suggestion, or null when the name is fine or there is nothing to go on.
// context: { title } (the page a download came from, when known).
export function suggestName(name, context = {}) {
  if (typeof name !== 'string' || !name || isProgram(name)) return null;
  const { base, ext } = splitName(name.normalize('NFC'));
  if (CAMERA.test(base)) return null;
  const reasons = [];
  let next = base;
  const withoutCopy = next.replace(COPY, '');
  if (withoutCopy && withoutCopy !== next) {
    next = withoutCopy;
    reasons.push('without the copy number');
  }
  // snake_case or dotted.words become spaces; dots between digits (1.2.3) stay
  if (!/\s/.test(next) && /[_+]|[A-Za-z]\.[A-Za-z]/.test(next)) {
    const spaced = next.replace(/[_+]+/g, ' ').replace(/(?<=[A-Za-z])\.(?=[A-Za-z])/g, ' ').replace(/\s+/g, ' ').trim();
    if (spaced && spaced !== next) {
      next = spaced;
      reasons.push('spaces between the words');
    }
  }
  if (OPAQUE.test(next.trim()) || MACHINE.test(next.trim())) {
    const title = cleanTitle(context.title);
    if (!title) return null; // a better name would be a guess
    next = title;
    reasons.push('named after the page it came from');
  }
  next = next.replace(/\s+/g, ' ').trim();
  const proposed = join(next, ext);
  if (!next || proposed === name.normalize('NFC') || checkName(name, proposed)) return null;
  return { name: proposed, reasons };
}

// Why a new name can't be used, or null. The extension stays what it was:
// renaming must never change what kind of file the system thinks it is.
export function checkName(original, proposed) {
  const safe = safeName(proposed);
  if (!safe) return 'That name has characters or a form files cannot have.';
  const before = splitName(original.normalize('NFC'));
  const after = splitName(safe);
  if (before.ext.toLowerCase() !== after.ext.toLowerCase()) {
    return before.ext ? `Keep the .${before.ext} at the end, so the file still opens.` : 'This file has no extension; do not add one.';
  }
  if (!after.base.trim()) return 'The name needs some words before the extension.';
  if (isProgram(original)) return 'Programs and installers keep their names.';
  return null;
}

// A name not yet taken in the folder, compared the way macOS and Windows do
// (case and Unicode form do not make a different name): "Report.pdf",
// then "Report 2.pdf", "Report 3.pdf"...
export function uniqueName(name, taken) {
  const fold = (n) => n.normalize('NFC').toLowerCase();
  const used = new Set([...taken].map(fold));
  if (!used.has(fold(name))) return name;
  const { base, ext } = splitName(name);
  for (let i = 2; i < 1000; i++) {
    const candidate = join(`${base} ${i}`, ext);
    if (!used.has(fold(candidate))) return candidate;
  }
  return null;
}
